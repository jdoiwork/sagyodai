// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NodeActions, NodeNavigation } from "./NodeActions";
import type { TableData } from "../../api/project";
const { dispatch } = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("../../app/ProjectContext", () => ({
  useProject: () => ({
    dispatch,
    pending: 0,
    project: {
      revision: 1,
      sheets: [
        { id: "sheet-1", title: "入力" },
        { id: "sheet-2", title: "結果" },
      ],
    },
  }),
}));
afterEach(() => {
  cleanup();
  dispatch.mockReset();
});
const table = { id: "table-1", title: "売上", sheetId: "sheet-1" } as TableData;
it("アクションから移動先を選び、成功後だけ移動先を表示する", () => {
  const moved = vi.fn();
  const ui = render(
    <NodeNavigation.Provider value={{ activeSheet: "sheet-1", onMoved: moved }}>
      <NodeActions table={table} />
    </NodeNavigation.Provider>,
  );
  fireEvent.click(ui.getByRole("button", { name: "売上 のアクション" }));
  fireEvent.click(ui.getByRole("menuitem", { name: "別のシートへ移動" }));
  expect(ui.queryByRole("menuitem", { name: "入力" })).toBeNull();
  fireEvent.click(ui.getByRole("menuitem", { name: "結果" }));
  expect(dispatch.mock.calls[0][0]).toEqual({
    type: "moveNodeToSheet",
    id: "table-1",
    sheetId: "sheet-2",
    expectedSheetId: "sheet-1",
  });
  expect(ui.queryByRole("menu")).toBeNull();
  expect(moved).not.toHaveBeenCalled();
  dispatch.mock.calls[0][1](false);
  expect(moved).not.toHaveBeenCalled();
  const next = { ...table, sheetId: "sheet-2" };
  dispatch.mock.calls[0][1](true, { tables: [next] });
  expect(moved).toHaveBeenCalledWith(next);
});
it("Escapeと外側クリックで移動せず閉じる", () => {
  const ui = render(<NodeActions table={table} />);
  const trigger = ui.getByRole("button", { name: "売上 のアクション" });
  fireEvent.click(trigger);
  fireEvent.keyDown(ui.getByRole("menu"), { key: "Escape" });
  expect(ui.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.pointerDown(document.body);
  expect(ui.queryByRole("menu")).toBeNull();
  expect(dispatch).not.toHaveBeenCalled();
});
