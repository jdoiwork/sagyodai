// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Cell } from "./Cell";
afterEach(cleanup);
it("変換中の Enter ではセル移動せず、確定済みの日本語を blur で反映する", () => {
  const onNavigate = vi.fn(),
    onCommit = vi.fn();
  const { getByRole } = render(
    <Cell
      value=""
      label="セル"
      selected
      onSelect={() => {}}
      onNavigate={onNavigate}
      onCommit={onCommit}
    />,
  );
  const cell = getByRole("textbox");
  fireEvent.focus(cell);
  fireEvent.compositionStart(cell);
  fireEvent.change(cell, { target: { value: "日本語" } });
  fireEvent.keyDown(cell, { key: "Enter", isComposing: true, keyCode: 229 });
  expect(onNavigate).not.toHaveBeenCalled();
  expect(onCommit).not.toHaveBeenCalled();
  fireEvent.compositionEnd(cell, { data: "日本語" });
  fireEvent.keyDown(cell, { key: "Enter" });
  expect(onNavigate).not.toHaveBeenCalled();
  fireEvent.blur(cell);
  expect(onCommit).toHaveBeenCalledExactlyOnceWith("日本語", "");
});
it("編集中に他の操作の応答が届いても入力途中の文字を消さない", () => {
  const props = {
    label: "セル",
    selected: true,
    onSelect: vi.fn(),
    onCommit: vi.fn(),
    onNavigate: vi.fn(),
  };
  const { getByRole, rerender } = render(<Cell value="前の値" {...props} />);
  const cell = getByRole("textbox") as HTMLTextAreaElement;
  fireEvent.focus(cell);
  fireEvent.change(cell, { target: { value: "入力途中" } });
  rerender(<Cell value="別の応答" {...props} />);
  expect(cell.value).toBe("入力途中");
});

it("長すぎる下書きは送信せず、他の応答でも保持して修正できる", () => {
  const onCommit = vi.fn(),
    onValidationError = vi.fn();
  const props = {
    label: "セル",
    selected: true,
    onSelect: vi.fn(),
    onNavigate: vi.fn(),
    onCommit,
    onValidationError,
  };
  const ui = render(<Cell value="元" {...props} />);
  const input = ui.getByRole("textbox") as HTMLTextAreaElement;
  fireEvent.focus(input);
  const long = "あ".repeat(33334);
  fireEvent.change(input, { target: { value: long } });
  fireEvent.blur(input);
  expect(onCommit).not.toHaveBeenCalled();
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(onValidationError).toHaveBeenLastCalledWith(
    expect.stringContaining("100000"),
  );
  ui.rerender(<Cell value="他タブ" {...props} />);
  expect(input.value).toBe(long);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "修正" } });
  fireEvent.blur(input);
  expect(onCommit).toHaveBeenCalledWith("修正", "元");
});
