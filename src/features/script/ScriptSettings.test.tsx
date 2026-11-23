// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ScriptSettings } from "./ScriptSettings";
import type { TableData } from "../../api/project";
const { dispatch } = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("../../app/ProjectContext", () => ({
  useProject: () => ({
    dispatch,
    pending: 0,
    project: { revision: 12, tables: [] },
  }),
}));
const idle = {
  runId: 0,
  state: "idle",
  message: null,
  log: "",
  logTruncated: false,
  automaticAllowed: false,
};
const config = {
  program: "/usr/bin/python3",
  scriptPath: "/tmp/test.py",
  args: [],
  cwd: "/tmp",
  timeoutSeconds: 30,
  outputMode: "table" as const,
  inputRowFormat: "list" as const,
  outputRowFormat: "list" as const,
};
const table = {
  id: "script",
  title: "スクリプト",
  kind: "script",
  source: null,
  rows: [],
  columns: [],
  manual: false,
  script: { config },
} as unknown as TableData;
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it("設定編集では実行せず、他タブ更新でも日本語の下書きを保持する", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => idle });
  vi.stubGlobal("fetch", fetch);
  const ui = render(<ScriptSettings table={table} />);
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  const input = ui.getByLabelText("スクリプトのパス");
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "/tmp/日本語.py" } });
  fireEvent.compositionEnd(input);
  ui.rerender(
    <ScriptSettings
      table={{ ...table, script: { config: { ...config, cwd: "/new" } } }}
    />,
  );
  expect(
    (ui.getByLabelText("スクリプトのパス") as HTMLInputElement).value,
  ).toBe("/tmp/日本語.py");
  fireEvent.change(ui.getByLabelText("入力JSONLの行形式"), {
    target: { value: "dict" },
  });
  fireEvent.change(ui.getByLabelText("出力JSONLの行形式"), {
    target: { value: "dict" },
  });
  fireEvent.change(ui.getByLabelText("出力モード"), {
    target: { value: "text" },
  });
  fireEvent.click(ui.getByRole("button", { name: "設定を適用" }));
  expect(dispatch).toHaveBeenCalledWith({
    type: "setScript",
    id: "script",
    config: {
      ...config,
      scriptPath: "/tmp/日本語.py",
      outputMode: "text",
      inputRowFormat: "dict",
      outputRowFormat: "dict",
    },
  });
  expect(
    fetch.mock.calls.every(
      ([url]) => url === "/api/script/status" || url === "/api/settings",
    ),
  ).toBe(true);
});
it("明示実行で観測したrevisionと許可を渡し、実行IDを指定して停止する", async () => {
  const fetch = vi.fn().mockImplementation(async (url: string) => ({
    ok: true,
    json: async () =>
      url.endsWith("/cancel")
        ? { cancelRequested: true }
        : url.endsWith("/start")
          ? { ...idle, runId: 7, state: "running", automaticAllowed: true }
          : idle,
  }));
  vi.stubGlobal("fetch", fetch);
  const ui = render(<ScriptSettings table={table} />);
  await waitFor(() =>
    expect(ui.getByRole("status").textContent).toContain("未実行"),
  );
  fireEvent.click(
    ui.getByLabelText("この設定の自動実行も許可する（コア終了まで）"),
  );
  fireEvent.click(ui.getByRole("button", { name: "外部スクリプトを実行" }));
  await waitFor(() =>
    expect(ui.getByRole("status").textContent).toContain("実行中"),
  );
  const call = fetch.mock.calls.find(([url]) => url === "/api/script/start");
  expect(JSON.parse(call?.[1].body)).toEqual({
    id: "script",
    expectedRevision: 12,
    allowAutomatic: true,
  });
  fireEvent.click(ui.getByRole("button", { name: "停止・自動実行を解除" }));
  await waitFor(() =>
    expect(fetch.mock.calls.some(([url]) => url === "/api/script/cancel")).toBe(
      true,
    ),
  );
  expect(
    JSON.parse(
      fetch.mock.calls.find(([url]) => url === "/api/script/cancel")?.[1].body,
    ),
  ).toEqual({ id: "script", runId: 7 });
});
it("お気に入りは設定の下書きへコピーし、直接編集と適用を維持する", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url === "/api/settings"
          ? {
              version: 1,
              revision: 0,
              favorites: [
                {
                  id: "env",
                  name: "分析環境",
                  program: "/env/bin/python",
                  cwd: "/work",
                },
              ],
            }
          : idle,
    })),
  );
  const ui = render(<ScriptSettings table={table} />);
  await ui.findByRole("option", { name: "分析環境" });
  fireEvent.change(ui.getByLabelText("お気に入りの環境・プログラム"), {
    target: { value: "env" },
  });
  expect(dispatch).not.toHaveBeenCalled();
  expect(
    (ui.getByLabelText("スクリプトのパス") as HTMLInputElement).value,
  ).toBe(config.scriptPath);
  expect((ui.getByLabelText("作業フォルダ") as HTMLInputElement).value).toBe(
    "/work",
  );
  fireEvent.change(ui.getByLabelText("実行プログラム"), {
    target: { value: "/other/bin/python" },
  });
  fireEvent.click(ui.getByRole("button", { name: "設定を適用" }));
  expect(dispatch).toHaveBeenCalledWith({
    type: "setScript",
    id: "script",
    config: { ...config, program: "/other/bin/python", cwd: "/work" },
  });
});
