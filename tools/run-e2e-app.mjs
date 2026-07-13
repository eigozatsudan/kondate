import { spawn } from "node:child_process";
import { startE2eFunctionServer } from "./e2e-function-server.mjs";

const functionServer = await startE2eFunctionServer();
const vite = spawn("npm", ["run", "dev", "--", "--host", "0.0.0.0"], {
  stdio: "inherit",
});

let stopping = false;
async function stop(signal) {
  if (stopping) return;
  stopping = true;
  vite.kill(signal);
}

process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));

vite.once("exit", async (code, signal) => {
  await functionServer.close();
  process.exitCode = code ?? (signal === null ? 1 : 0);
});
