// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Snapshot } from "../api/project";
import { ProjectProvider, useProject } from "./ProjectContext";
const api = vi.hoisted(() => ({
  loadProject: vi.fn(),
  sendCommand: vi.fn(),
  exportProject: vi.fn(),
}));
vi.mock("../api/project", () => api);
const initial: Snapshot = {
  revision: 0,
  tables: [],
  canUndo: false,
  canRedo: false,
};
beforeEach(() => {
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
