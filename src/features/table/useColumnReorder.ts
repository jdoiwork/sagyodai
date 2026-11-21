import { useRef, useState, type DragEvent, type RefObject } from "react";
import type { Command, TableData } from "../../api/project";

export function useColumnReorder(
  table: TableData,
  viewport: RefObject<HTMLDivElement | null>,
  dispatch: (command: Command) => void,
) {
  const source = useRef<{ from: number; table: TableData } | null>(null);
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
    const from = source.current!.from;
    return {
      to: boundary > from ? boundary - 1 : boundary,
      side: after ? ("after" as const) : ("before" as const),
    };
  }
  return {
    marker,
    sourceProps: (from: number) => ({
      draggable: true,
      onDragStart: (e: DragEvent) => {
        e.stopPropagation();
        source.current = { from, table };
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
        setMarker(
          target.to === source.current.from ? null : { col, side: target.side },
        );
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
        const { to } = destination(e, col);
        clear();
        if (to === start.from) return;
        dispatch({
          type: "moveColumn",
          id: table.id,
          from: start.from,
          to,
          expectedColumns: start.table.columns,
          expectedRows: start.table.rows,
        });
      },
      onDragLeave: () => setMarker(null),
    }),
  };
}
