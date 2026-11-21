// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SyncConflicts } from "./SyncConflicts";
const { resolveConflict } = vi.hoisted(() => ({ resolveConflict: vi.fn() }));
vi.mock("../../app/ProjectContext", () => ({
  useProject: () => ({
    resolveConflict,
    conflicts: [
      {
        id: 1,
        message: "列名は空欄にできません",
        command: { type: "renameColumn", name: "", col: 0 },
      },
    ],
  }),
}));
afterEach(cleanup);
it("空の列名の再適用を無効にし、破棄して修正する案内を表示する", () => {
  const { getByRole, getByText } = render(<SyncConflicts />);
  const retry = getByRole("button", { name: "現在の状態に再適用" });
  expect((retry as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(retry);
  expect(resolveConflict).not.toHaveBeenCalled();
  expect(getByText(/操作を破棄して列名を入力し直して/)).toBeTruthy();
  fireEvent.click(getByRole("button", { name: "この操作を破棄" }));
  expect(resolveConflict).toHaveBeenCalledWith(1, false);
});
