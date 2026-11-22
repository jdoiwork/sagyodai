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
    config: { column: 0, regex: true, pattern: "(赤)", replacement: "${1}色" },
  });
});
