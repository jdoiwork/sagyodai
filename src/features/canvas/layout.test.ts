import { expect, it } from "vitest";
import { reconcileNodes, type TableFlowNode, type Layout } from "./layout";
import type { TableData } from "../../api/project";
const tables: TableData[] = [1, 2].map((i) => ({
  id: `table-${i}`,
  kind: "input" as const,
  source: null,
  filter: null,
  manual: false,
  compact: false,
  stale: false,
  error: null,
  title: `表${i}`,
  columnWidths: [],
  columns: ["列"],
  rows: [[""]],
  x: i * 100,
  y: i * 200,
  width: 760,
  height: 390,
}));
const noop = () => {};
const initial = () =>
  reconcileNodes(tables, [], new Set(), new Map(), noop, noop);
it("表1の応答が届いても、反映待ちの表2の新しい配置を巻き戻さない", () => {
  const target: Layout = { x: 700, y: 800, width: 800, height: 400 };
  const waiting = new Map([["table-2", target]]);
  const local = reconcileNodes(
    tables,
    initial(),
    new Set(),
    waiting,
    noop,
    noop,
  );
  const response = [{ ...tables[0], x: 150 }, tables[1]];
  const next = reconcileNodes(response, local, new Set(), waiting, noop, noop);
  expect(next[0].position).toEqual({ x: 150, y: 200 });
  expect(next[1].position).toEqual({ x: 700, y: 800 });
  expect(next[1].style).toMatchObject({ width: 800, height: 400 });
});
it("古い応答が届いてもドラッグ中の位置と測定情報を保ち、操作していない表は動かさない", () => {
  const local = initial();
  local[0] = {
    ...local[0],
    position: { x: 350, y: 450 },
    measured: { width: 760, height: 390 },
  };
  const pending = new Map([
    ["table-1", { x: 200, y: 250, width: 760, height: 390 }],
  ]);
  const next = reconcileNodes(
    tables,
    local,
    new Set(["table-1"]),
    pending,
    noop,
    noop,
  );
  expect(next[0].position).toEqual({ x: 350, y: 450 });
  expect(next[0].measured).toEqual(local[0].measured);
  expect(next[1].position).toEqual(local[1].position);
});
it("操作が確定した後は Undo の配置を受け入れる", () => {
  const local: TableFlowNode[] = initial().map((n) => ({
    ...n,
    position: { x: 900, y: 900 },
  }));
  const next = reconcileNodes(tables, local, new Set(), new Map(), noop, noop);
  expect(next.map((n) => n.position)).toEqual([
    { x: 100, y: 200 },
    { x: 200, y: 400 },
  ]);
});
it.each(["input", "filter", "display"] as const)(
  "%s の折りたたみ中の移動後も元のサイズへ戻る",
  (kind) => {
    const filter: TableData = { ...tables[0], kind, compact: true };
    const compact = reconcileNodes(
      [filter],
      [],
      new Set(),
      new Map(),
      noop,
      noop,
    );
    expect(compact[0].style).toMatchObject({ width: 380, height: 102 });
    compact[0].position = { x: 500, y: 600 };
    const dragging = reconcileNodes(
      [filter],
      compact,
      new Set([filter.id]),
      new Map(),
      noop,
      noop,
    );
    expect(dragging[0].position).toEqual({ x: 500, y: 600 });
    const expanded = reconcileNodes(
      [{ ...filter, compact: false, x: 500, y: 600 }],
      dragging,
      new Set(),
      new Map(),
      noop,
      noop,
    );
    expect(expanded[0].style).toMatchObject({ width: 760, height: 390 });
    expect(expanded[0].position).toEqual({ x: 500, y: 600 });
  },
);

it("リサイズで設定されたノード寸法も折りたたみ・展開に追従する", () => {
  const filter: TableData = {
    ...tables[0],
    kind: "filter",
    width: 900,
    height: 600,
  };
  const initial = reconcileNodes(
    [filter],
    [],
    new Set(),
    new Map(),
    noop,
    noop,
  );
  // NodeResizer の dimensions(setAttributes: true) が残す状態を再現する。
  const resized: TableFlowNode[] = initial.map((node) => ({
    ...node,
    width: 900,
    height: 600,
    measured: { width: 900, height: 600 },
  }));
  expect(resized[0].width).toBe(900);
  const compact = reconcileNodes(
    [{ ...filter, compact: true }],
    resized,
    new Set(),
    new Map(),
    noop,
    noop,
  );
  expect(compact[0]).toMatchObject({
    width: 380,
    height: 102,
    style: { width: 380, height: 102 },
  });
  const expanded = reconcileNodes(
    [filter],
    compact,
    new Set(),
    new Map(),
    noop,
    noop,
  );
  expect(expanded[0]).toMatchObject({
    width: 900,
    height: 600,
    style: { width: 900, height: 600 },
  });
});
