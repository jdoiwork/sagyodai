// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AddNodeMenu } from "./AddNodeMenu";
afterEach(cleanup);
it("入力元をメニューから選択し、選択後に閉じる", () => {
  const onAdd = vi.fn();
  const ui = render(
    <AddNodeMenu category="source" disabled={false} onAdd={onAdd} />,
  );
  for (const [label, kind] of [
    ["表を追加", "input"],
    ["CSV", "csv"],
    ["テキスト", "text"],
    ["メモ", "note"],
  ]) {
    fireEvent.click(ui.getByRole("button", { name: "入力を追加" }));
    fireEvent.click(ui.getByRole("menuitem", { name: label }));
    expect(onAdd).toHaveBeenLastCalledWith(kind);
    expect(ui.queryByRole("menu")).toBeNull();
  }
});
it("矢印キー・Escape・外側クリックに対応し、無効時は開かない", () => {
  const ui = render(
    <AddNodeMenu category="source" disabled={false} onAdd={vi.fn()} />,
  );
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
  ui.rerender(<AddNodeMenu category="source" disabled onAdd={vi.fn()} />);
  fireEvent.click(trigger);
  expect(ui.queryByRole("menu")).toBeNull();
});

it("加工をメニューから選択し、入力メニューと同時に開かない", () => {
  const onAdd = vi.fn();
  const ui = render(
    <>
      <AddNodeMenu category="source" disabled={false} onAdd={onAdd} />
      <AddNodeMenu category="processing" disabled={false} onAdd={onAdd} />
    </>,
  );
  fireEvent.click(ui.getByRole("button", { name: "入力を追加" }));
  for (const [label, kind] of [
    ["フィルタ", "filter"],
    ["ソート", "sort"],
    ["結合", "union"],
    ["集計", "aggregate"],
    ["置換", "replace"],
  ]) {
    fireEvent.click(ui.getByRole("button", { name: "加工を追加" }));
    expect(ui.queryByRole("menu", { name: "入力ノードを追加" })).toBeNull();
    fireEvent.click(ui.getByRole("menuitem", { name: label }));
    expect(onAdd).toHaveBeenLastCalledWith(kind);
    expect(ui.queryByRole("menu")).toBeNull();
  }
});
