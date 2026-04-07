/**
 * One-time data migration script: SQLite → PostgreSQL.
 *
 * Usage:
 *   bun run scripts/migrate-sqlite-to-pg.ts --sqlite-db ./db.sqlite --pg-url postgres://localhost:5432/bookhive [--sqlite-kv ./kv.sqlite]
 *
 * Migrates all 8 main tables + selected KV tables (identity, follows_sync).
 * Auth and cache KV tables are skipped (they rebuild organically).
 */
import { Database as DatabaseSync } from "bun:sqlite";
import pg from "pg";

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const sqliteDbPath = getArg("--sqlite-db");
const pgUrl = getArg("--pg-url");
const sqliteKvPath = getArg("--sqlite-kv");

if (!sqliteDbPath || !pgUrl) {
  console.error("Usage: bun run scripts/migrate-sqlite-to-pg.ts --sqlite-db <path> --pg-url <url> [--sqlite-kv <path>]");
  process.exit(1);
}

// PostgreSQL has a 65535 parameter limit per query.
// Dynamically compute batch size based on column count.
function batchSizeForColumns(numCols: number): number {
  return Math.floor(65000 / numCols);
}

async function migrateTable(
  sqlite: DatabaseSync,
  pool: pg.Pool,
  tableName: string,
  columns: string[],
  destTableName?: string,
) {
  const dest = destTableName || tableName;
  const quotedCols = columns.map((c) => `"${c}"`).join(", ");
  const total = (sqlite.prepare(`SELECT COUNT(*) as cnt FROM "${tableName}"`).get() as any).cnt;
  console.log(`  ${tableName}${dest !== tableName ? ` → ${dest}` : ""}: ${total} rows`);

  if (total === 0) return;

  const batchSize = batchSizeForColumns(columns.length);
  let offset = 0;
  let migrated = 0;

  while (offset < total) {
    const rows = sqlite
      .prepare(`SELECT ${quotedCols} FROM "${tableName}" LIMIT ${batchSize} OFFSET ${offset}`)
      .all() as Record<string, unknown>[];

    if (rows.length === 0) break;

    // Build a multi-row INSERT
    const placeholders: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    for (const row of rows) {
      const rowPlaceholders: string[] = [];
      for (const col of columns) {
        rowPlaceholders.push(`$${paramIdx++}`);
        values.push(row[col] ?? null);
      }
      placeholders.push(`(${rowPlaceholders.join(", ")})`);
    }

    const insertSql = `INSERT INTO "${dest}" (${quotedCols}) VALUES ${placeholders.join(", ")} ON CONFLICT DO NOTHING`;
    await pool.query(insertSql, values);

    migrated += rows.length;
    offset += rows.length;

    if (migrated % 50000 === 0) {
      console.log(`    ... ${migrated}/${total}`);
    }
  }

  console.log(`    done: ${migrated} rows migrated`);
}

async function getTableColumns(sqlite: DatabaseSync, tableName: string): Promise<string[]> {
  const cols = sqlite.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{ name: string }>;
  return cols.map((c) => c.name);
}

async function main() {
  console.log("Opening SQLite database:", sqliteDbPath);
  const sqlite = new DatabaseSync(sqliteDbPath!);
  sqlite.exec("PRAGMA busy_timeout = 10000");

  console.log("Connecting to PostgreSQL:", pgUrl);
  const pool = new pg.Pool({ connectionString: pgUrl, max: 5 });

  // Test PG connection
  const client = await pool.connect();
  client.release();
  console.log("PostgreSQL connected.\n");

  // Main tables in dependency order
  const mainTables = [
    "hive_book",
    "user_book",
    "buzz",
    "user_follows",
    "book_id_map",
    "hive_book_genre",
    "book_list",
    "book_list_item",
  ];

  console.log("=== Migrating main database tables ===");
  for (const table of mainTables) {
    try {
      let columns = await getTableColumns(sqlite, table);
      // Skip 'id' column for hive_book_genre (it's SERIAL in PG)
      if (table === "hive_book_genre") {
        columns = columns.filter((c) => c !== "rowid");
        // The SQLite table doesn't have an 'id' column, PG one does (SERIAL).
        // Just insert hiveId + genre; PG auto-generates id.
      }
      await migrateTable(sqlite, pool, table, columns);
    } catch (err) {
      console.error(`  ERROR migrating ${table}:`, err);
    }
  }

  sqlite.close();

  // KV tables (optional)
  if (sqliteKvPath) {
    console.log("\n=== Migrating KV tables ===");
    const kvSqlite = new DatabaseSync(sqliteKvPath);
    kvSqlite.exec("PRAGMA busy_timeout = 10000");

    // Only migrate identity and follows_sync — skip profile/kv caches and auth tables
    const kvTables: Record<string, string> = {
      identity: "kv_identity",
      follows_sync: "kv_follows_sync",
    };

    // Create KV tables in PG if they don't exist
    for (const destTable of Object.values(kvTables)) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "${destTable}" (
          id TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
    }

    for (const [srcTable, destTable] of Object.entries(kvTables)) {
      try {
        // Check if source table exists
        const exists = kvSqlite
          .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
          .get(srcTable) as any;
        if (!exists) {
          console.log(`  ${srcTable}: table does not exist, skipping`);
          continue;
        }

        const columns = await getTableColumns(kvSqlite, srcTable);
        await migrateTable(kvSqlite, pool, srcTable, columns, destTable);
      } catch (err) {
        console.error(`  ERROR migrating ${srcTable}:`, err);
      }
    }

    kvSqlite.close();
  }

  // Verify
  console.log("\n=== Verification ===");
  for (const table of mainTables) {
    const result = await pool.query(`SELECT COUNT(*) as cnt FROM "${table}"`);
    console.log(`  ${table}: ${result.rows[0].cnt} rows`);
  }

  await pool.end();
  console.log("\nMigration complete!");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
