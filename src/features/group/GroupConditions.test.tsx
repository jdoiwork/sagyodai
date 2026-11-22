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
const table = {
  id: "g",
  title: "集計",
  group: { groupBy: [], sums: [], count: true },
} as unknown as TableData;
const source = { columns: ["分類", "数量"] } as TableData;
it("出力列を追加し関数・対象・名前を指定して順番どおり適用する", () => {
  const ui = render(<GroupConditions table={table} source={source} />);
  fireEvent.click(ui.getByLabelText("集計 分類 でグループ化"));
  fireEvent.click(ui.getByText("出力列を追加"));
  fireEvent.change(ui.getByLabelText("出力列2の集約関数"), {
    target: { value: "average" },
  });
  fireEvent.change(ui.getByLabelText("出力列2の対象列"), {
    target: { value: "1" },
  });
  fireEvent.change(ui.getByLabelText("出力列2の列名"), {
    target: { value: "平均数量" },
  });
  expect(dispatch).not.toHaveBeenCalled();
  fireEvent.click(ui.getByText("条件を適用"));
  expect(dispatch).toHaveBeenCalledWith({
    type: "setGroup",
    id: "g",
    config: {
      groupBy: [0],
      sums: [],
      count: false,
      outputs: [
        { function: "count", column: null, name: "" },
        { function: "average", column: 1, name: "平均数量" },
      ],
    },
  });
});
it("空欄は標準名になり、不正な名前と集計項目なしは編集時に防ぐ", () => {
  const ui = render(<GroupConditions table={table} source={source} />);
  fireEvent.change(ui.getByLabelText("出力列1の列名"), {
    target: { value: "あ".repeat(241) },
  });
  expect(ui.getByRole("alert").textContent).toContain("240文字");
  expect((ui.getByText("条件を適用") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(ui.getByLabelText("出力列1の列名"), {
    target: { value: "" },
  });
  expect(ui.queryByRole("alert")).toBeNull();
  expect(ui.getByPlaceholderText("件数")).toBeTruthy();
  fireEvent.click(ui.getByText("条件を適用"));
  expect(dispatch).toHaveBeenCalledTimes(1);
  fireEvent.click(ui.getByLabelText("出力列1を削除"));
  expect(ui.getByRole("alert").textContent).toContain("1つ以上");
});
it("既存の集計を出力列として表示し、件数へ変更すると対象列を不要にする", () => {
  const ui = render(
    <GroupConditions
      table={{ ...table, group: { groupBy: [], sums: [1], count: false } }}
      source={source}
    />,
  );
  expect(ui.getByPlaceholderText("合計（数量）")).toBeTruthy();
  fireEvent.change(ui.getByLabelText("出力列1の集約関数"), {
    target: { value: "count" },
  });
  expect(
    (ui.getByLabelText("出力列1の対象列") as HTMLSelectElement).disabled,
  ).toBe(true);
  fireEvent.click(ui.getByText("条件を適用"));
  expect(dispatch.mock.calls[0][0].config.outputs).toEqual([
    { function: "count", column: null, name: "" },
  ]);
});

it("未適用の列名を含めて上下に移動し、境界では移動不可にする", () => {
  const ui = render(
    <GroupConditions
      table={{
        ...table,
        group: {
          groupBy: [0],
          sums: [],
          count: false,
          outputs: [
            { function: "count", column: null, name: "件数" },
            { function: "average", column: 1, name: "平均" },
            { function: "max", column: 1, name: "最大" },
          ],
        },
      }}
      source={source}
    />,
  );
  expect(
    (ui.getByLabelText("出力列1を上へ移動") as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(
    (ui.getByLabelText("出力列3を下へ移動") as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.change(ui.getByLabelText("出力列2の列名"), {
    target: { value: "平均数量" },
  });
  const movedInput = ui.getByLabelText("出力列2の列名");
  fireEvent.click(ui.getByLabelText("出力列2を上へ移動"));
  expect(ui.getByLabelText("出力列1の列名")).toBe(movedInput);
  expect((ui.getByLabelText("出力列1の列名") as HTMLInputElement).value).toBe(
    "平均数量",
  );
  expect(
    (ui.getByLabelText("出力列1の集約関数") as HTMLSelectElement).value,
  ).toBe("average");
  fireEvent.click(ui.getByLabelText("出力列2を下へ移動"));
  expect(dispatch).not.toHaveBeenCalled();
  expect(ui.getByText("未適用の変更あり")).toBeTruthy();
  fireEvent.click(ui.getByText("条件を適用"));
  expect(dispatch.mock.calls[0][0].config).toEqual({
    groupBy: [0],
    sums: [],
    count: false,
    outputs: [
      { function: "average", column: 1, name: "平均数量" },
      { function: "max", column: 1, name: "最大" },
      { function: "count", column: null, name: "件数" },
    ],
  });
});
