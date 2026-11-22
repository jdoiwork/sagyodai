// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NodeSheetMove } from "./NodeSheetMove";
import type { TableData } from "../../api/project";
const { dispatch } = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("../../app/ProjectContext", () => ({
  useProject: () => ({
    dispatch,
    pending: 0,
    project: {
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
it("他シートへの移動だけを送り、成功後に移動先の表示を依頼する", () => {
  const table = {
    id: "table-1",
    title: "売上",
    sheetId: "sheet-1",
  } as TableData;
  const moved = vi.fn();
  const ui = render(<NodeSheetMove table={table} onMoved={moved} />);
  expect(ui.queryByRole("option", { name: "入力" })).toBeNull();
  expect(
    (ui.getByRole("button", { name: "移動" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.change(ui.getByLabelText("売上 の移動先シート"), {
    target: { value: "sheet-2" },
  });
  fireEvent.click(ui.getByRole("button", { name: "移動" }));
  expect(dispatch.mock.calls[0][0]).toEqual({
    type: "moveNodeToSheet",
    id: "table-1",
    sheetId: "sheet-2",
    expectedSheetId: "sheet-1",
  });
  expect(moved).not.toHaveBeenCalled();
  dispatch.mock.calls[0][1](false);
  expect(moved).not.toHaveBeenCalled();
  const next = { ...table, sheetId: "sheet-2" };
  dispatch.mock.calls[0][1](true, { tables: [next] });
  expect(moved).toHaveBeenCalledWith(next);
});
