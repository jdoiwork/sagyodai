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
