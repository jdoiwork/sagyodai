import { spawn } from "node:child_process";
const children = [
  spawn("cargo", ["run", "--manifest-path", "backend/Cargo.toml"], {
    stdio: "inherit",
  }),
  spawn("npm", ["run", "dev:web"], { stdio: "inherit" }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
for (const child of children) {
  child.on("error", (e) => {
    console.error(e);
    stop(1);
  });
  child.on("exit", (code) => stop(code ?? 1));
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
