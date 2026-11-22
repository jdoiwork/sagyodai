// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useTableView } from "./useTableView";
import { emptyTableView, type TableData } from "../../api/project";
const dispatch = vi.fn();
let shared: TableData | undefined;
vi.mock("../../app/ProjectContext", () => ({
  useProject: () => ({
    dispatch,
    project: shared ? { tables: [shared] } : null,
  }),
}));
beforeEach(() => {
  dispatch.mockClear();
  shared = undefined;
});
const table = { id: "t", view: emptyTableView } as TableData;
it("連続入力を即時表示し、古い応答で戻さず、確定後は共有状態を読む", () => {
  const { result, rerender } = renderHook((t) => useTableView(t), {
    initialProps: table,
  });
  act(() => result.current.setSearch("商"));
  act(() => result.current.setSearch("商品"));
  expect(result.current.search).toBe("商品");
  expect(dispatch.mock.calls[1][0].expectedQuery).toBe("商");
  act(() => dispatch.mock.calls[0][1](true));
  expect(result.current.search).toBe("商品");
  act(() => {
    rerender({ ...table, view: { ...emptyTableView, query: "商品" } });
    dispatch.mock.calls[1][1](true);
  });
  expect(result.current.search).toBe("商品");
  rerender(table);
  expect(result.current.search).toBe("");
});
it("保存済みの列条件を復元し、失敗後は確定状態へ戻る", () => {
  const columns = {
    schema: '["分類"]',
    values: { 0: ["食品"] },
    sort: { column: 0, direction: "desc" as const },
  };
  const { result } = renderHook(() =>
    useTableView({ ...table, view: { query: "日本語", columns } }),
  );
  expect(result.current.columnFilters).toEqual(columns);
  expect(result.current.search).toBe("日本語");
  act(() => result.current.setColumnFilters({ ...columns, sort: null }));
  expect(result.current.columnFilters.sort).toBeNull();
  expect(dispatch.mock.calls[0][0].expectedColumns).toEqual(columns);
  act(() => dispatch.mock.calls[0][1](false));
  expect(result.current.columnFilters).toEqual(columns);
});

it("キャンバスの古いノードより新しい共有状態を優先する", () => {
  const { result, rerender } = renderHook(() => useTableView(table));
  act(() => result.current.setSearch("新しい検索"));
  act(() => {
    shared = { ...table, view: { ...emptyTableView, query: "新しい検索" } };
    dispatch.mock.calls[0][1](true);
    rerender();
  });
  expect(result.current.search).toBe("新しい検索");
  shared = table;
  rerender();
  expect(result.current.search).toBe("");
});
