// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GroupConditions } from "./GroupConditions";
import type { TableData } from "../../api/project";
const dispatch = vi.fn();
vi.mock("../../app/ProjectContext", () => ({
  useProject: () => ({ dispatch }),
}));
afterEach(() => {
  cleanup();
  dispatch.mockClear();
});
it("複数グループ列と合計・件数を適用し、集計項目なしを編集時に防ぐ", () => {
  const table = {
    id: "g",
    title: "集計",
    group: { groupBy: [], sums: [], count: true },
  } as unknown as TableData;
  const source = { columns: ["分類", "地域", "数量"] } as TableData;
  const ui = render(<GroupConditions table={table} source={source} />);
  fireEvent.click(ui.getByLabelText("集計 分類 でグループ化"));
  fireEvent.click(ui.getByLabelText("集計 地域 でグループ化"));
  fireEvent.click(ui.getByLabelText("集計 数量 の合計"));
  expect(dispatch).not.toHaveBeenCalled();
  fireEvent.click(ui.getByText("条件を適用"));
  expect(dispatch).toHaveBeenCalledWith({
    type: "setGroup",
    id: "g",
    config: { groupBy: [0, 1], sums: [2], count: true },
  });
  fireEvent.click(ui.getByLabelText("集計 数量 の合計"));
  fireEvent.click(ui.getByLabelText("件数（グループ内の行数）"));
  expect(ui.getByRole("alert").textContent).toContain("1つ以上");
  expect((ui.getByText("条件を適用") as HTMLButtonElement).disabled).toBe(true);
});
