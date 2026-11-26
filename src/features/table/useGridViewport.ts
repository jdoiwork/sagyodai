import {
  useState,
  type RefObject,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { TableData } from "../../api/project";

export const ROW_HEIGHT = 36;
type Point = { row: number; col: number };
export type CellSelection = { start: Point; end: Point };

// visibleRowsの添字は表示位置、値は原本の行番号。フォーカスと編集は原本に結び付ける。
export function useGridViewport({
  table,
  viewport,
  visibleRows,
  transformed,
  draggedRow,
  setSelection,
}: {
  table: TableData;
  viewport: RefObject<HTMLDivElement | null>;
  visibleRows: number[];
  transformed: boolean;
  draggedRow: number | null;
  setSelection: Dispatch<SetStateAction<CellSelection>>;
}) {
  const [top, setTop] = useState(0);
  const [focusedCell, setFocusedCell] = useState<Point | null>(null);
  const focusedRow = focusedCell?.row ?? null;
  const first = Math.max(
    0,
    Math.min(visibleRows.length - 1, Math.floor(top / ROW_HEIGHT) - 5),
  );
  const last = Math.min(
    visibleRows.length,
    first + Math.ceil(table.height / ROW_HEIGHT) + 12,
  );
  const renderedPositions = new Set(
    Array.from({ length: last - first }, (_, index) => first + index),
  );
  // 並べ替えていない表では、ドラッグ元の行番号と表示位置が一致する。
  if (!transformed && draggedRow !== null && draggedRow < table.rows.length) {
    renderedPositions.add(draggedRow);
  }
  // 画面外へスクロールしても、IME 変換中のセルをアンマウントしない。
  const focusedPosition =
    focusedRow === null ? -1 : visibleRows.indexOf(focusedRow);
  if (focusedPosition >= 0) renderedPositions.add(focusedPosition);
  const renderedRows = [...renderedPositions].sort((a, b) => a - b);
  function navigate(
    row: number,
    col: number,
    direction: "next" | "previous" | "down" | "up",
  ) {
    let viewRow = visibleRows.indexOf(row),
      column = col;
    if (direction === "down") viewRow++;
    if (direction === "up") viewRow--;
    if (direction === "next") {
      column++;
      if (column >= table.columns.length) {
        column = 0;
        viewRow++;
      }
    }
    if (direction === "previous") {
      column--;
      if (column < 0) {
        column = table.columns.length - 1;
        viewRow--;
      }
    }
    if (viewRow < 0 || viewRow >= visibleRows.length) {
      (document.activeElement as HTMLElement)?.blur();
      return;
    }
    const sourceRow = visibleRows[viewRow];
    setSelection({
      start: { row: sourceRow, col: column },
      end: { row: sourceRow, col: column },
    });
    const element = viewport.current;
    if (
      element &&
      (viewRow * ROW_HEIGHT < element.scrollTop ||
        (viewRow + 2) * ROW_HEIGHT > element.scrollTop + element.clientHeight)
    ) {
      element.scrollTop = Math.max(0, viewRow * ROW_HEIGHT - ROW_HEIGHT);
      setTop(element.scrollTop);
    }
    requestAnimationFrame(() =>
      element
        ?.querySelector<HTMLTextAreaElement>(
          `[data-row="${sourceRow}"] [data-col="${column}"] textarea`,
        )
        ?.focus(),
    );
  }
  return {
    renderedRows,
    focusedCell,
    focusedRow,
    setFocusedCell,
    setTop,
    navigate,
  };
}
