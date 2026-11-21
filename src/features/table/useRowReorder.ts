import { useRef, useState, type DragEvent, type RefObject } from "react";
import type { Command, TableData } from "../../api/project";

export function useRowReorder(
  table: TableData,
  viewport: RefObject<HTMLDivElement | null>,
  dispatch: (
    command: Command,
    onSettled?: (succeeded: boolean) => void,
  ) => void,
  selectedRows: number[] = [],
  onMoving?: (
    indices: number[],
    to: number,
    source: TableData,
  ) => (succeeded: boolean) => void,
) {
  const [draggedRow, setDraggedRow] = useState<number | null>(null);
  const source = useRef<{ indices: number[]; table: TableData } | null>(null);
  const [marker, setMarker] = useState<{
    row: number;
    side: "before" | "after";
  } | null>(null);
  function clear() {
    source.current = null;
    setDraggedRow(null);
    setMarker(null);
  }
  function destination(e: DragEvent, row: number) {
    const rect = e.currentTarget.getBoundingClientRect();
    const after = e.clientY >= rect.top + rect.height / 2;
    const boundary = row + (after ? 1 : 0);
    const indices = source.current!.indices;
    const to = boundary - indices.filter((n) => n < boundary).length;
    const order = source
      .current!.table.rows.map((_, i) => i)
      .filter((i) => !indices.includes(i));
    order.splice(to, 0, ...indices);
    return {
      to,
      unchanged: order.every((old, i) => old === i),
      side: after ? ("after" as const) : ("before" as const),
    };
  }
  return {
    marker,
    draggedRow,
    sourceProps: (from: number) => ({
      draggable: true,
      onDragStart: (e: DragEvent) => {
        e.stopPropagation();
        setDraggedRow(from);
        source.current = {
          indices: selectedRows.includes(from)
            ? [...selectedRows].sort((a, b) => a - b)
            : [from],
          table,
        };
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("application/x-sagyodai-row", table.id);
      },
      onDragEnd: clear,
    }),
    targetProps: (row: number) => ({
      onDragOver: (e: DragEvent) => {
        if (!source.current) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        const target = destination(e, row);
        setMarker(target.unchanged ? null : { row, side: target.side });
        const el = viewport.current;
        if (el) {
          const rect = el.getBoundingClientRect();
          if (e.clientY > rect.bottom - 28) el.scrollTop += 16;
          else if (e.clientY < rect.top + 64) el.scrollTop -= 16;
        }
      },
      onDrop: (e: DragEvent) => {
        const start = source.current;
        if (!start) return;
        e.preventDefault();
        e.stopPropagation();
        const { to, unchanged } = destination(e, row);
        clear();
        if (unchanged) return;
        const settled = onMoving?.(start.indices, to, start.table);
        dispatch(
          {
            type: "moveRows",
            indices: start.indices,
            id: table.id,
            to,
            expectedColumns: start.table.columns,
            expectedRows: start.table.rows,
          },
          settled,
        );
      },
      onDragLeave: () => setMarker(null),
    }),
  };
}
