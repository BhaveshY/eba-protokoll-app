// Dev orchestrator: spawn Vite, wait for :5173, then spawn Electron pointing at it.
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import net from "node:net";

const VITE_HOST = "localhost";
const VITE_PORT = 5173;
const URL = `http://${VITE_HOST}:${VITE_PORT}`;

function waitForPort(host, port, timeoutMs = 30_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = net.createConnection({ host, port }, () => {
        sock.end();
        resolve();
      });
      sock.on("error", async () => {
        if (Date.now() - start > timeoutMs) reject(new Error("Vite did not start"));
        else {
          await delay(200);
          tryOnce();
        }
      });
    };
    tryOnce();
  });
}

const vite = spawn("npx", ["vite"], { stdio: "inherit" });
vite.on("exit", (code) => {
  if (electron && !electron.killed) electron.kill();
  process.exit(code ?? 0);
});

await waitForPort(VITE_HOST, VITE_PORT);

// Build electron main once so it's on disk
await new Promise((resolve, reject) => {
  const build = spawn("npm", ["run", "build:electron"], { stdio: "inherit" });
  build.on("exit", (code) =>
    code === 0 ? resolve() : reject(new Error(`build:electron failed (${code})`))
  );
});

const electron = spawn("npx", ["electron", "."], {
  stdio: "inherit",
  env: { ...process.env, VITE_DEV_SERVER_URL: URL },
});

electron.on("exit", () => {
  if (!vite.killed) vite.kill();
  process.exit(0);
});
