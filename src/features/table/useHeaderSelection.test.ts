// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useHeaderSelection } from "./useHeaderSelection";
import type { TableData } from "../../api/project";
const table = {
  columns: ["A", "B", "C", "D"],
  rows: [["a", "b", "c", "d"]],
} as TableData;
const moved = {
  ...table,
  columns: ["B", "D", "A", "C"],
  rows: [["b", "d", "a", "c"]],
};
it.each([true, false])(
  "応答が先でも後でも移動先の複数選択を維持する（応答先行: %s）",
  (responseFirst) => {
    const { result, rerender } = renderHook((t) => useHeaderSelection(t), {
      initialProps: table,
    });
    act(() => result.current.select("column", 0));
    act(() =>
      result.current.select("column", 2, {
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
      }),
    );
    let settled!: (ok: boolean) => void;
    act(() => {
      settled = result.current.moving([0, 2], 2, table);
    });
    if (responseFirst) act(() => settled(true));
    expect(result.current.selection?.indices).toEqual([0, 2]);
    rerender(moved);
    if (!responseFirst) act(() => settled(true));
    expect(result.current.selection?.indices).toEqual([2, 3]);
    // そのまま続けて元の先頭へ移動できる。
    act(() => {
      settled = result.current.moving([2, 3], 0, moved);
    });
    act(() => settled(true));
    rerender({
      ...table,
      columns: ["A", "C", "B", "D"],
      rows: [["a", "c", "b", "d"]],
    });
    expect(result.current.selection?.indices).toEqual([0, 1]);
  },
);
it("失敗時は元の選択を保ち、待機中の選択変更を上書きしない", () => {
  const { result, rerender } = renderHook((t) => useHeaderSelection(t), {
    initialProps: table,
  });
  act(() => result.current.select("column", 0));
  let settled!: (ok: boolean) => void;
  act(() => {
    settled = result.current.moving([0, 2], 2, table);
  });
  act(() => settled(false));
  expect(result.current.selection?.indices).toEqual([0]);
  act(() => {
    settled = result.current.moving([0, 2], 2, table);
  });
  act(() => result.current.clear());
  act(() => settled(true));
  rerender(moved);
  expect(result.current.selection).toBeNull();
});
