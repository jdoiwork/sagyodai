// 実stdioプロトコルとGUI用HTTP/SSEを、分離した保存先・ポートで確認する。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const binary = fileURLToPath(
  new URL("../backend/target/debug/sagyodai-core", import.meta.url),
);
const directory = await mkdtemp(join(tmpdir(), "sagyodai-mcp-smoke-"));
const listener = createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const env = {
  ...process.env,
  SAGYODAI_CORE_PORT: String(port),
  SAGYODAI_AUTOSAVE_PATH: join(directory, "project.json"),
};
delete env.SAGYODAI_STARTUP_PROJECT;
let core;
let mcp;
let reader;
let id = 0;
const pending = new Map();
const deadline = setTimeout(() => {
  console.error("MCP smoke timed out");
  core?.kill();
  mcp?.kill();
  process.exitCode = 1;
}, 30000);
function request(method, params) {
  const requestId = ++id;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`Timeout: ${method}`));
    }, 5000);
    pending.set(requestId, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    mcp.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })}\n`,
    );
  });
}
async function call(name, args = {}) {
  const message = await request("tools/call", { name, arguments: args });
  assert.ok(message.result, JSON.stringify(message));
  return message.result;
}
async function stop(child) {
  if (child && child.exitCode === null && child.signalCode === null) {
    const closed = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await closed;
  }
}
try {
  core = spawn(binary, [], { env, stdio: ["ignore", "ignore", "inherit"] });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let n = 0; n < 100; n++) {
    try {
      ready = (await fetch(`${base}/api/project`)).ok;
    } catch {
      /* 起動を待つ */
    }
    if (ready) break;
    assert.equal(core.exitCode, null, "core exited");
    await delay(50);
  }
  assert.ok(ready, "core did not start");
  mcp = spawn(binary, ["--mcp"], { env, stdio: ["pipe", "pipe", "inherit"] });
  createInterface({ input: mcp.stdout }).on("line", (line) => {
    const message = JSON.parse(line); // stdoutに起動ログなどが混ざっても失敗する。
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });
  const initialized = await request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "sagyodai-smoke", version: "1.0" },
  });
  assert.ok(initialized.result.capabilities.tools);
  assert.equal(initialized.result.serverInfo.name, "sagyodai");
  mcp.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
  );
  const listed = await request("tools/list", {});
  assert.deepEqual(listed.result.tools.map((tool) => tool.name).sort(), [
    "apply_operation",
    "cancel_script",
    "get_node",
    "get_project",
    "script_source",
    "script_status",
    "start_script",
  ]);
  assert.ok(
    listed.result.tools.find((tool) => tool.name === "apply_operation")
      .inputSchema.properties.command,
  );
  const overview = (await call("get_project")).structuredContent;
  assert.equal(overview.revision, 0);
  const events = await fetch(`${base}/api/project/events`);
  reader = events.body.getReader();
  await reader.read(); // 接続時のrevision通知。
  const changed = await call("apply_operation", {
    expectedRevision: overview.revision,
    command: {
      type: "paste",
      id: overview.nodes[0].id,
      row: 0,
      col: 0,
      values: [["MCPから日本語"]],
    },
  });
  assert.notEqual(changed.isError, true);
  assert.equal(changed.structuredContent.revision, 1);
  const event = new TextDecoder().decode((await reader.read()).value);
  assert.match(event, /data: 1/);
  const gui = await (await fetch(`${base}/api/project`)).json();
  assert.equal(gui.tables[0].rows[0][0], "MCPから日本語");
  const conflict = await call("apply_operation", {
    expectedRevision: 0,
    command: { type: "undo" },
  });
  assert.equal(conflict.isError, true);
  assert.equal(conflict.structuredContent.code, "revision_conflict");
  const invalid = await request("tools/call", {
    name: "apply_operation",
    arguments: { expectedRevision: 1, command: { type: "fetchHttp" } },
  });
  assert.ok(invalid.error || invalid.result?.isError);
  const page = await call("get_node", { id: gui.tables[0].id, limit: 1 });
  assert.equal(page.structuredContent.rows[0][0], "MCPから日本語");
  // 同じstdio接続から、設定・外部実行・ログ・結果取得まで確認する。
  async function operation(command) {
    const current = (await call("get_project")).structuredContent;
    const result = await call("apply_operation", {
      expectedRevision: current.revision,
      command,
    });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    return result.structuredContent;
  }
  const added = await operation({ type: "addNode", kind: "script" });
  const scriptId = added.nodes.find((node) => node.kind === "script").id;
  await operation({ type: "connect", id: scriptId, source: gui.tables[0].id });
  await operation({
    type: "setScript",
    id: scriptId,
    config: {
      program: "/usr/bin/python3",
      scriptPath: fileURLToPath(
        new URL("../examples/script-uppercase.py", import.meta.url),
      ),
      args: [],
      cwd: directory,
      timeoutSeconds: 5,
    },
  });
  const source = await call("script_source", { id: scriptId });
  assert.ok(source.structuredContent.text.includes("json.loads"));
  const revision = (await call("get_project")).structuredContent.revision;
  const started = await call("start_script", {
    id: scriptId,
    expectedRevision: revision,
    allowAutomatic: false,
  });
  assert.notEqual(started.isError, true, JSON.stringify(started));
  let run;
  for (let n = 0; n < 100; n++) {
    run = (await call("script_status", { id: scriptId })).structuredContent;
    if (run.state !== "running") break;
    await delay(30);
  }
  assert.equal(run.state, "succeeded", JSON.stringify(run));
  assert.match(run.log, /行を加工しました/);
  const output = (await call("get_node", { id: scriptId, limit: 1 }))
    .structuredContent;
  assert.equal(output.rows[0][0], "MCPから日本語");
  // 型・原文・大きな整数をstdioとGUI共通状態で確認し、再起動後も保持する。
  const typedBefore = (
    await call("get_node", { id: gui.tables[0].id, limit: 1 })
  ).structuredContent;
  const column = typedBefore.columnSchema[1];
  await operation({
    type: "setColumnType",
    id: gui.tables[0].id,
    columnId: column.id,
    expectedConfig: column.config,
    config: {
      dataType: "integer",
      nullable: false,
      empty: { mode: "value", value: "0" },
    },
  });
  await operation({
    type: "paste",
    id: gui.tables[0].id,
    row: 0,
    col: 1,
    values: [["9007199254740993"]],
  });
  const typed = (await call("get_node", { id: gui.tables[0].id, limit: 1 }))
    .structuredContent;
  assert.deepEqual(typed.typedRows[0][1], {
    type: "integer",
    value: "9007199254740993",
  });
  const typedGui = await (await fetch(`${base}/api/project`)).json();
  assert.deepEqual(typedGui.tables[0].output.rows[0][1], typed.typedRows[0][1]);
  await operation({
    type: "paste",
    id: gui.tables[0].id,
    row: 0,
    col: 1,
    values: [["未定"]],
  });
  const invalidType = (
    await call("get_node", { id: gui.tables[0].id, limit: 1 })
  ).structuredContent;
  assert.equal(invalidType.rows[0][1], "未定");
  assert.equal(invalidType.cellErrors[0].col, 1);
  await operation({ type: "undo" });
  await reader.cancel();
  reader = undefined;
  await stop(core);
  const unavailable = await call("get_project");
  assert.equal(unavailable.isError, true);
  assert.equal(unavailable.structuredContent.code, "core_unavailable");
  core = spawn(binary, [], { env, stdio: ["ignore", "ignore", "inherit"] });
  for (let n = 0; n < 100; n++) {
    try {
      const restored = await (await fetch(`${base}/api/project`)).json();
      assert.equal(restored.tables[0].rows[0][0], "MCPから日本語");
      assert.equal(
        restored.tables[0].columnSchema[1].config.dataType,
        "integer",
      );
      assert.deepEqual(restored.tables[0].output.rows[0][1], {
        type: "integer",
        value: "9007199254740993",
      });
      ready = true;
      break;
    } catch {
      ready = false;
      await delay(50);
    }
  }
  assert.ok(ready, "saved data was not restored");
  console.log(
    "MCP stdio: initialize / tools / edit / HTTP+SSE sync / conflict / disconnect / restore passed",
  );
} finally {
  clearTimeout(deadline);
  await reader?.cancel();
  await stop(mcp);
  await stop(core);
  await rm(directory, { recursive: true, force: true });
}
