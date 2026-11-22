// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { TableData } from "../../api/project";
import { ReplaceConditions } from "./ReplaceConditions";
const { dispatch } = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("../../app/ProjectContext", () => ({
  useProject: () => ({ dispatch, pending: 0 }),
}));
afterEach(() => {
  cleanup();
  dispatch.mockReset();
});
it("未適用を表示し、空検索を拒否して正規表現の設定を送る", () => {
  const table = { id: "r", title: "置換", compact: false } as TableData;
  const ui = render(
    <ReplaceConditions
      table={table}
      source={{ columns: ["品名"] } as TableData}
    />,
  );
  expect(
    (ui.getByRole("button", { name: "置換を適用" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.change(ui.getByLabelText("置換 検索文字列"), {
    target: { value: "(赤)" },
  });
  fireEvent.change(ui.getByLabelText("置換 置換方法"), {
    target: { value: "regex" },
  });
  fireEvent.change(ui.getByLabelText("置換 置換後の文字列"), {
    target: { value: "${1}色" },
  });
  expect(ui.getByText("未適用の変更があります")).toBeTruthy();
  fireEvent.click(ui.getByRole("button", { name: "置換を適用" }));
  expect(dispatch.mock.calls[0][0]).toEqual({
    type: "setReplacement",
    id: "r",
    config: {
      column: 0,
      regex: true,
      pattern: "(赤)",
      replacement: "${1}色",
      addColumn: false,
      columnName: "",
    },
  });
});

it("新しい列の名前を指定でき、長すぎる名前は編集時に拒否する", () => {
  const table = {
    id: "r",
    title: "置換",
    compact: false,
    replacement: {
      column: 0,
      regex: false,
      pattern: "赤",
      replacement: "白",
      addColumn: false,
      columnName: "",
    },
  } as TableData;
  const ui = render(
    <ReplaceConditions
      table={table}
      source={{ columns: ["品名"] } as TableData}
    />,
  );
  fireEvent.click(ui.getByLabelText("結果を新しい列に追加"));
  expect(ui.getByPlaceholderText("置換（品名）")).toBeTruthy();
  fireEvent.change(ui.getByLabelText("置換 出力列名"), {
    target: { value: "あ".repeat(241) },
  });
  expect(ui.getByRole("alert").textContent).toContain("240文字");
  fireEvent.click(ui.getByRole("button", { name: "置換を適用" }));
  expect(dispatch).not.toHaveBeenCalled();
  fireEvent.change(ui.getByLabelText("置換 出力列名"), {
    target: { value: "加工済み" },
  });
  fireEvent.click(ui.getByRole("button", { name: "置換を適用" }));
  expect(dispatch.mock.calls[0][0].config).toMatchObject({
    addColumn: true,
    columnName: "加工済み",
  });
  fireEvent.click(ui.getByLabelText("結果を新しい列に追加"));
  expect(ui.queryByLabelText("置換 出力列名")).toBeNull();
});
