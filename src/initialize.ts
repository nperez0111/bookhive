import { Database } from "bun:sqlite";
const db = new Database("./src/db/db.sqlite", { create: true });

db.exec("PRAGMA journal_mode = WAL;");
// db.query("CREATE TABLE IF NOT EXISTS rsvps (name text, createdAt text);").run();

db.close();
