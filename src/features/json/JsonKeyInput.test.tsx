// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { TableData } from "../../api/project";
import { JsonKeyInput } from "./JsonKeyInput";
afterEach(cleanup);
const source = (text: string) =>
  ({
    columns: ["JSON"],
    rows: [[text]],
    stale: false,
    error: null,
  }) as TableData;
it("入力元の直下のキーを絞り込み、キーボード・マウスで選択できる", () => {
  const change = vi.fn();
  const props = {
    source: source('{"chapters":[],"children":{},"日本語":1,"":null,"a.b":2}'),
    value: "",
    onChange: change,
    label: "キー",
    invalid: false,
  };
  const ui = render(<JsonKeyInput {...props} />);
  const field = ui.getByRole("combobox");
  fireEvent.focus(field);
  expect(ui.getAllByRole("option")).toHaveLength(5);
  ui.rerender(<JsonKeyInput {...props} value="CH" />);
  expect(ui.getAllByRole("option")).toHaveLength(2);
  fireEvent.keyDown(field, { key: "ArrowDown" });
  fireEvent.keyDown(field, { key: "Enter" });
  expect(change).toHaveBeenLastCalledWith("chapters");
  expect(ui.queryByRole("listbox")).toBeNull();
  ui.rerender(<JsonKeyInput {...props} />);
  fireEvent.focus(field);
  fireEvent.click(ui.getByRole("option", { name: "（空のキー）" }));
  expect(change).toHaveBeenLastCalledWith("");
  fireEvent.focus(field);
  fireEvent.keyDown(field, { key: "Escape" });
  expect(ui.queryByRole("listbox")).toBeNull();
});
it("IME変換中は補完せず、入力元の変更・無効なJSONに追従する", () => {
  const change = vi.fn();
  const props = {
    source: source('{"日本語":1}'),
    value: "",
    onChange: change,
    label: "キー",
    invalid: false,
  };
  const ui = render(<JsonKeyInput {...props} />);
  const field = ui.getByRole("combobox");
  fireEvent.focus(field);
  fireEvent.compositionStart(field);
  fireEvent.keyDown(field, { key: "ArrowDown" });
  fireEvent.keyDown(field, { key: "Enter", isComposing: true });
  expect(change).not.toHaveBeenCalled();
  expect(ui.queryByRole("listbox")).toBeNull();
  fireEvent.compositionEnd(field);
  expect(ui.getByRole("option").textContent).toBe("日本語");
  ui.rerender(<JsonKeyInput {...props} source={source('{"次":2}')} />);
  expect(ui.getByRole("option").textContent).toBe("次");
  for (const text of ["bad", "null", "[1,2]", "3"]) {
    ui.rerender(<JsonKeyInput {...props} source={source(text)} />);
    expect(ui.queryByRole("listbox")).toBeNull();
  }
  ui.rerender(
    <JsonKeyInput {...props} source={{ ...props.source, stale: true }} />,
  );
  expect(ui.queryByRole("listbox")).toBeNull();
});
