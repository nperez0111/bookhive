/**
 * Strips the "workspaces" field from package.json and resolves any
 * "catalog:" dependency references by inlining the version from the catalog.
 * Used in Docker builds where the app workspace is excluded.
 */
export {};
const path = "package.json";
// @ts-ignore - Bun global available at runtime
const p = JSON.parse(await Bun.file(path).text());

const catalog: Record<string, string> = p.catalog ?? {};

function resolveCatalog(deps: Record<string, string> | undefined) {
  if (!deps) return;
  for (const [name, version] of Object.entries(deps)) {
    if (version === "catalog:" && catalog[name]) {
      deps[name] = catalog[name];
    }
  }
}

resolveCatalog(p.dependencies);
resolveCatalog(p.devDependencies);
resolveCatalog(p.overrides);

delete p.workspaces;
delete p.scripts?.prepare;
// @ts-ignore - Bun global available at runtime
await Bun.write(path, JSON.stringify(p, null, 2));
