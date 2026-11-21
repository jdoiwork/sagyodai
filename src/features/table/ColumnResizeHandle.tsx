import { useEffect, useRef } from "react";
import type { TableData } from "../../api/project";
import { useProject } from "../../app/ProjectContext";

export const DEFAULT_COLUMN_WIDTH = 160;
const clamp = (width: number) =>
  Math.round(Math.max(60, Math.min(1200, width)));
export function ColumnResizeHandle({
  table,
  col,
  width,
  onPreview,
}: {
  table: TableData;
  col: number;
  width: number;
  onPreview: (width: number | null) => void;
}) {
  const { dispatch } = useProject();
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const drag = useRef<{
    x: number;
    width: number;
    current: number;
    scale: number;
    columns: string[];
  } | null>(null);
  function commit(value: number, original: number, columns: string[]) {
    const current = ++generation.current;
    if (value === original) {
      onPreview(null);
      return;
    }
    onPreview(value);
    dispatch(
      {
        type: "resizeColumn",
        id: table.id,
        col,
        width: value,
        expectedWidth: original,
        expectedColumns: columns,
      },
      () => {
        // 成功・失敗の反映まで保持し、前の応答で新しいドラッグを巻き戻さない。
        if (generation.current === current) onPreview(null);
      },
    );
  }
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={`${table.title} ${col + 1}列の幅`}
      aria-valuenow={width}
      aria-valuemin={60}
      aria-valuemax={1200}
      className="column-resize-handle nodrag nopan"
      title="ドラッグで列幅を変更（矢印キーでも変更可能）"
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.focus();
        const header = e.currentTarget.closest("th")!;
        const scale =
          header.getBoundingClientRect().width / header.offsetWidth || 1;
        generation.current++;
        drag.current = {
          x: e.clientX,
          width,
          current: width,
          scale,
          columns: table.columns,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const start = drag.current;
        if (!start) return;
        start.current = clamp(
          start.width + (e.clientX - start.x) / start.scale,
        );
        onPreview(start.current);
      }}
      onPointerUp={(e) => {
        const start = drag.current;
        if (!start) return;
        drag.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
        commit(start.current, start.width, start.columns);
      }}
      onLostPointerCapture={() => {
        // 通常の pointerup に続く capture 解放では確定待ちの幅を消さない。
        if (!drag.current) return;
        generation.current++;
        drag.current = null;
        onPreview(null);
      }}
      onPointerCancel={() => {
        drag.current = null;
        onPreview(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && drag.current) {
          drag.current = null;
          onPreview(null);
        }
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        e.stopPropagation();
        commit(
          clamp(width + (e.key === "ArrowRight" ? 10 : -10)),
          width,
          table.columns,
        );
      }}
    />
  );
}
