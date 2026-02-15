/**
 * Strips the "workspaces" field from package.json (for Docker build without app workspace).
 */
const path = "package.json";
const p = JSON.parse(await Bun.file(path).text());
delete p.workspaces;
await Bun.write(path, JSON.stringify(p, null, 2));
