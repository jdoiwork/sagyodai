// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Snapshot } from "../api/project";
import { ProjectProvider, useProject } from "./ProjectContext";
const api = vi.hoisted(() => ({
  loadProject: vi.fn(),
  sendCommand: vi.fn(),
  exportProject: vi.fn(),
  subscribeProject: vi.fn(
    (_notify: () => void, _status: (connected: boolean) => void) => () => {},
  ),
  CommandError: class extends Error {},
}));
vi.mock("../api/project", () => api);
const initial: Snapshot = {
  revision: 0,
  tables: [],
  canUndo: false,
  canRedo: false,
};
beforeEach(() => {
  api.subscribeProject.mockImplementation(() => () => {});
  api.loadProject.mockResolvedValue(initial);
  api.exportProject.mockResolvedValue({ blob: new Blob(["{}"]), revision: 1 });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("未反映のセル操作が確定してからファイルを生成する", async () => {
  let resolveEdit!: (p: Snapshot) => void;
  api.sendCommand.mockReturnValue(
    new Promise<Snapshot>((resolve) => {
      resolveEdit = resolve;
    }),
  );
  const { result } = renderHook(useProject, { wrapper: ProjectProvider });
  await waitFor(() => expect(result.current.project).toEqual(initial));
  act(() => result.current.dispatch({ type: "addTable" }));
  let saving!: Promise<{ blob: Blob; revision: number }>;
  act(() => {
    saving = result.current.prepareExport();
  });
  await waitFor(() => expect(api.sendCommand).toHaveBeenCalled());
  expect(api.exportProject).not.toHaveBeenCalled();
  await act(async () => {
    resolveEdit({ ...initial, revision: 1 });
    await saving;
  });
  expect(api.exportProject).toHaveBeenCalledOnce();
});
it("不正なファイルで既存状態を維持し、その後も編集できる", async () => {
  api.sendCommand
    .mockRejectedValueOnce(new Error("非対応形式"))
    .mockResolvedValueOnce({ ...initial, revision: 1 });
  const { result } = renderHook(useProject, { wrapper: ProjectProvider });
  await waitFor(() => expect(result.current.project).toEqual(initial));
  await act(async () => {
    await expect(result.current.openProject({})).rejects.toThrow("非対応形式");
  });
  expect(result.current.project).toEqual(initial);
  act(() => result.current.dispatch({ type: "addTable" }));
  await waitFor(() => expect(result.current.project?.revision).toBe(1));
});
it("書き出し後でも未確定のセル入力があれば離脱を警告する", async () => {
  const { result } = renderHook(useProject, { wrapper: ProjectProvider });
  await waitFor(() => expect(result.current.project).toEqual(initial));
  act(() => result.current.markExported(0));
  expect(result.current.dirty).toBe(false);
  const cell = document.createElement("textarea");
  cell.dataset.committedValue = "保存済み";
  cell.value = "入力途中";
  document.body.append(cell);
  cell.focus();
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  cell.remove();
});

it("通知を受けると再取得し、遅れて届いた古い応答で巻き戻さない", async () => {
  const { result } = renderHook(useProject, { wrapper: ProjectProvider });
  await waitFor(() => expect(result.current.project?.revision).toBe(0));
  const notify = api.subscribeProject.mock.calls[0][0];
  api.loadProject.mockResolvedValueOnce({ ...initial, revision: 3 });
  await act(async () => notify());
  expect(result.current.project?.revision).toBe(3);
  api.loadProject.mockResolvedValueOnce({ ...initial, revision: 2 });
  await act(async () => notify());
  expect(result.current.project?.revision).toBe(3);
});
it("セル編集中は表の置換を保留し、blur 後に最新の状態を表示する", async () => {
  const { result } = renderHook(useProject, { wrapper: ProjectProvider });
  await waitFor(() => expect(result.current.project?.revision).toBe(0));
  const cell = document.createElement("textarea");
  cell.className = "cell";
  document.body.append(cell);
  cell.focus();
  cell.value = "入力途中";
  api.loadProject.mockResolvedValueOnce({ ...initial, revision: 4 });
  await act(async () => api.subscribeProject.mock.calls[0][0]());
  expect(result.current.project?.revision).toBe(0);
  expect(cell.value).toBe("入力途中");
  await act(async () => cell.blur());
  expect(result.current.project?.revision).toBe(4);
  cell.remove();
});
it("失敗した入力を保持し、明示的な再適用まで送信せず保存も止める", async () => {
  const { result } = renderHook(useProject, { wrapper: ProjectProvider });
  await waitFor(() => expect(result.current.project).toEqual(initial));
  api.sendCommand.mockRejectedValueOnce(new Error("同じセルが変更されました"));
  act(() =>
    result.current.dispatch({
      type: "paste",
      id: "t",
      row: 0,
      col: 0,
      values: [["自分の入力"]],
      expectedValues: [["元の値"]],
    }),
  );
  await waitFor(() => expect(result.current.conflicts).toHaveLength(1));
  expect(result.current.conflicts[0].command).toMatchObject({
    values: [["自分の入力"]],
  });
  await expect(result.current.prepareExport()).rejects.toThrow("未反映");
  api.sendCommand.mockResolvedValueOnce({ ...initial, revision: 1 });
  act(() =>
    result.current.resolveConflict(result.current.conflicts[0].id, true),
  );
  await waitFor(() => expect(result.current.project?.revision).toBe(1));
  expect(result.current.conflicts).toHaveLength(0);
});

it("再接続後の取得失敗も再試行し、取得成功後に同期状態へ戻る", async () => {
  const { result } = renderHook(useProject, { wrapper: ProjectProvider });
  await waitFor(() => expect(result.current.project).toEqual(initial));
  const [notify, status] = api.subscribeProject.mock.calls[0];
  vi.useFakeTimers();
  try {
    api.loadProject
      .mockRejectedValueOnce(new Error("503"))
      .mockResolvedValueOnce({ ...initial, revision: 2 });
    await act(async () => {
      status(true);
      notify();
    });
    expect(result.current.connected).toBe(false);
    expect(result.current.error).not.toBe("");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(result.current.connected).toBe(true);
    expect(result.current.project?.revision).toBe(2);
    expect(result.current.error).toBe("");
  } finally {
    vi.useRealTimers();
  }
});
