// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AddSourceMenu } from "./AddSourceMenu";
afterEach(cleanup);
it("入力元をメニューから選択し、選択後に閉じる", () => {
  const onAdd = vi.fn();
  const ui = render(<AddSourceMenu disabled={false} onAdd={onAdd} />);
  for (const [label, kind] of [
    ["表を追加", "input"],
    ["CSV", "csv"],
    ["メモ", "note"],
  ]) {
    fireEvent.click(ui.getByRole("button", { name: "入力を追加" }));
    fireEvent.click(ui.getByRole("menuitem", { name: label }));
    expect(onAdd).toHaveBeenLastCalledWith(kind);
    expect(ui.queryByRole("menu")).toBeNull();
  }
});
it("矢印キー・Escape・外側クリックに対応し、無効時は開かない", () => {
  const ui = render(<AddSourceMenu disabled={false} onAdd={vi.fn()} />);
  const trigger = ui.getByRole("button", { name: "入力を追加" });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  expect(document.activeElement).toBe(
    ui.getByRole("menuitem", { name: "表を追加" }),
  );
  fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
  expect(document.activeElement).toBe(
    ui.getByRole("menuitem", { name: "CSV" }),
  );
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(document.activeElement).toBe(trigger);
  expect(ui.queryByRole("menu")).toBeNull();
  fireEvent.click(trigger);
  fireEvent.pointerDown(document.body);
  expect(ui.queryByRole("menu")).toBeNull();
  ui.rerender(<AddSourceMenu disabled onAdd={vi.fn()} />);
  fireEvent.click(trigger);
  expect(ui.queryByRole("menu")).toBeNull();
});
