// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SortConditions } from "./SortConditions";
import type { TableData } from "../../api/project";
const dispatch = vi.fn();
vi.mock("../../app/ProjectContext", () => ({
  useProject: () => ({ dispatch }),
}));
afterEach(() => {
  cleanup();
  dispatch.mockClear();
});
it("複数列の比較方法・方向・優先順を設定し、適用時だけ送信する", () => {
  const table = {
    id: "s",
    title: "ソート",
    sortKeys: [],
  } as unknown as TableData;
  const source = { columns: ["分類", "数量"] } as TableData;
  const ui = render(<SortConditions table={table} source={source} />);
  fireEvent.click(ui.getByText("ソート列を追加"));
  fireEvent.click(ui.getByText("ソート列を追加"));
  fireEvent.change(ui.getByLabelText("ソート 比較方法 2"), {
    target: { value: "number" },
  });
  fireEvent.change(ui.getByLabelText("ソート 順序 2"), {
    target: { value: "desc" },
  });
  fireEvent.click(ui.getByLabelText("2番目の優先順位を上げる"));
  expect(dispatch).not.toHaveBeenCalled();
  expect(ui.getByText("未適用の変更あり")).toBeTruthy();
  fireEvent.click(ui.getByText("条件を適用"));
  expect(dispatch).toHaveBeenCalledWith({
    type: "setSort",
    id: "s",
    keys: [
      { column: 1, direction: "desc", mode: "number" },
      { column: 0, direction: "asc", mode: "text" },
    ],
  });
});
