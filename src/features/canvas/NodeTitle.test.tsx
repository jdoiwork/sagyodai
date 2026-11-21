// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NodeTitle } from "./NodeTitle";
import type { TableData } from "../../api/project";
const { dispatch } = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("../../app/ProjectContext", () => ({
  useProject: () => ({ dispatch }),
}));
afterEach(() => {
  cleanup();
  dispatch.mockClear();
});
const table: TableData = {
  id: "t",
  title: "元の表",
  kind: "input",
  source: null,
  filter: null,
  manual: false,
  stale: false,
  error: null,
  rows: [[""]],
  columns: ["列"],
  x: 0,
  y: 0,
  width: 760,
  height: 390,
};
it("変換中の Enter は確定せず、フォーカス移動で比較条件付きの名前変更を送る", () => {
  const ui = render(<NodeTitle table={table} />);
  fireEvent.click(ui.getByRole("button"));
  const input = ui.getByRole("textbox");
  fireEvent.change(input, { target: { value: "売上データ" } });
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(dispatch).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.blur(input);
  expect(dispatch).toHaveBeenCalledWith({
    type: "rename",
    id: "t",
    title: "売上データ",
    expectedTitle: "元の表",
  });
});
it("Escape で取り消し、別タブの更新でも入力途中の文字を保持する", () => {
  const ui = render(<NodeTitle table={table} />);
  fireEvent.click(ui.getByRole("button"));
  const input = ui.getByRole("textbox") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "入力途中" } });
  ui.rerender(<NodeTitle table={{ ...table, title: "他タブの変更" }} />);
  expect(input.value).toBe("入力途中");
  fireEvent.keyDown(input, { key: "Escape" });
  expect(dispatch).not.toHaveBeenCalled();
  expect(ui.getByRole("heading").textContent).toBe("他タブの変更");
});
