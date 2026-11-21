import {
  useRef,
  useState,
  type DragEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import type { Command, TableData } from "../../api/project";

export function useColumnReorder(
  table: TableData,
  viewport: RefObject<HTMLDivElement | null>,
  dispatch: (
    command: Command,
    onSettled?: (succeeded: boolean) => void,
  ) => void,
  selectedColumns: number[] = [],
  onMoving?: (
    indices: number[],
    to: number,
    source: TableData,
  ) => (succeeded: boolean) => void,
) {
  const blockedStart = useRef(false);
  const source = useRef<{ indices: number[]; table: TableData } | null>(null);
  const [marker, setMarker] = useState<{
    col: number;
    side: "before" | "after";
  } | null>(null);
  function clear() {
    source.current = null;
    setMarker(null);
  }
  function destination(e: DragEvent, col: number) {
    const rect = e.currentTarget.getBoundingClientRect();
    const after = e.clientX >= rect.left + rect.width / 2;
    const boundary = col + (after ? 1 : 0);
    const indices = source.current!.indices;
    const to = boundary - indices.filter((n) => n < boundary).length;
    const order = table.columns
      .map((_, i) => i)
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
    sourceProps: (from: number) => ({
      draggable: true,
      onPointerDownCapture: (e: PointerEvent) => {
        blockedStart.current = !!(e.target as HTMLElement).closest(
          "textarea, input, [role=separator]",
        );
      },
      onDragStart: (e: DragEvent) => {
        e.stopPropagation();
        if (
          blockedStart.current ||
          e.currentTarget.querySelector("textarea, input")
        ) {
          e.preventDefault();
          return;
        }
        source.current = {
          indices: selectedColumns.includes(from)
            ? [...selectedColumns].sort((a, b) => a - b)
            : [from],
          table,
        };
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("application/x-sagyodai-column", table.id);
      },
      onDragEnd: clear,
    }),
    targetProps: (col: number) => ({
      onDragOver: (e: DragEvent) => {
        if (!source.current) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        const target = destination(e, col);
        setMarker(target.unchanged ? null : { col, side: target.side });
        const el = viewport.current;
        if (el) {
          const rect = el.getBoundingClientRect();
          if (e.clientX > rect.right - 28) el.scrollLeft += 16;
          else if (e.clientX < rect.left + 28) el.scrollLeft -= 16;
        }
      },
      onDrop: (e: DragEvent) => {
        const start = source.current;
        if (!start) return;
        e.preventDefault();
        e.stopPropagation();
        const { to, unchanged } = destination(e, col);
        clear();
        if (unchanged) return;
        const settled = onMoving?.(start.indices, to, start.table);
        dispatch(
          {
            ...(start.indices.length === 1
              ? { type: "moveColumn" as const, from: start.indices[0] }
              : { type: "moveColumns" as const, indices: start.indices }),
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
