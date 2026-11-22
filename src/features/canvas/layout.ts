import { unionPortHeight } from "../union/ports";
import type { Node } from "@xyflow/react";
import type { TableData } from "../../api/project";
export const COMPACT_NODE_SIZE = { width: 380, height: 102 };
export function nodeSize(
  table: TableData,
  layout: Pick<TableData, "width" | "height"> = table,
) {
  const size = table.compact ? COMPACT_NODE_SIZE : layout;
  return {
    width: size.width,
    height: Math.max(size.height, unionPortHeight(table)),
  };
}
export type Layout = Pick<TableData, "x" | "y" | "width" | "height">;
export type TableFlowNode = Node<
  {
    table: TableData;
    onLayoutStart: () => void;
    onLayoutEnd: (layout: Layout) => void;
  },
  "table"
>;
export function sameLayout(a: Layout, b: Layout): boolean {
  return (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  );
}
export function reconcileNodes(
  tables: TableData[],
  previous: TableFlowNode[],
  active: ReadonlySet<string>,
  pending: ReadonlyMap<string, Layout>,
  begin: (id: string) => void,
  finish: (id: string, layout: Layout) => void,
): TableFlowNode[] {
  return tables.map((table) => {
    const old = previous.find((node) => node.id === table.id);
    // 全体スナップショットに他の表の古い配置が含まれていても、未反映の操作を保護する。
    const local =
      active.has(table.id) && old
        ? {
            x: old.position.x,
            y: old.position.y,
            width: table.compact
              ? table.width
              : Number(old.style?.width ?? table.width),
            height: table.compact
              ? table.height
              : Number(old.style?.height ?? table.height),
          }
        : (pending.get(table.id) ?? table);
    const size = nodeSize(table, local);
    return {
      ...old,
      // リサイズで設定される node.width/height は style より優先される。
      ...size,
      id: table.id,
      type: "table",
      dragHandle: ".table-drag-handle",
      position: { x: local.x, y: local.y },
      style: {
        ...old?.style,
        ...size,
      },
      selected: old?.selected ?? false,
      data: {
        table,
        onLayoutStart: () => begin(table.id),
        onLayoutEnd: (layout) => finish(table.id, layout),
      },
    };
  });
}
