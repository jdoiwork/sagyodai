// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { TableData } from "../../api/project";
import { OutputColumns } from "./OutputColumns";
const dispatch = vi.fn();
vi.mock("../../app/ProjectContext", () => ({
  useProject: () => ({ dispatch }),
}));
afterEach(() => {
  cleanup();
  dispatch.mockClear();
});
const table = {
  id: "d",
  title: "結果表",
  projection: null,
} as unknown as TableData;
const source = { columns: ["品名", "数量", "分類"] } as TableData;
it("列の選択・順序・名前をまとめて出力設定として適用する", () => {
  const ui = render(<OutputColumns table={table} source={source} />);
  fireEvent.click(ui.getByText("出力列の設定"));
  fireEvent.click(ui.getByLabelText("結果表 分類 を出力"));
  fireEvent.change(ui.getByLabelText("結果表 数量 の出力列名"), {
    target: { value: "個数" },
  });
  fireEvent.click(ui.getByLabelText("結果表 出力列2を上へ移動"));
  expect(dispatch).not.toHaveBeenCalled();
  fireEvent.click(ui.getByText("出力列を適用"));
  expect(dispatch).toHaveBeenCalledWith({
    type: "setProjection",
    id: "d",
    config: {
      schema: source.columns,
      columns: [
        { column: 1, name: "個数", visible: true },
        { column: 0, name: "", visible: true },
        { column: 2, name: "", visible: false },
      ],
    },
  });
});
it("重複する列名・全列非表示を防ぎ、修正すれば適用できる", () => {
  const ui = render(<OutputColumns table={table} source={source} />);
  fireEvent.click(ui.getByText("出力列の設定"));
  fireEvent.change(ui.getByLabelText("結果表 数量 の出力列名"), {
    target: { value: "品名" },
  });
  expect(ui.getByRole("alert").textContent).toContain("重複");
  expect((ui.getByText("出力列を適用") as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.change(ui.getByLabelText("結果表 数量 の出力列名"), {
    target: { value: "" },
  });
  expect(ui.queryByRole("alert")).toBeNull();
  for (const name of source.columns)
    fireEvent.click(ui.getByLabelText(`結果表 ${name} を出力`));
  expect(ui.getByRole("alert").textContent).toContain("1つ以上");
  fireEvent.click(ui.getByLabelText("結果表 品名 を出力"));
  fireEvent.click(ui.getByText("出力列を適用"));
  expect(dispatch).toHaveBeenCalledTimes(1);
});
