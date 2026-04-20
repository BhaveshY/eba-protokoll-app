// Drops a {"type": "commonjs"} marker into dist-electron so Node treats
// the tsc-emitted .js files as CommonJS, even though the root package.json
// declares "type": "module" for Vite/renderer.
import { writeFileSync, mkdirSync } from "node:fs";

mkdirSync("dist-electron", { recursive: true });
writeFileSync("dist-electron/package.json", JSON.stringify({ type: "commonjs" }) + "\n");
