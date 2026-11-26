import { useState, type ClipboardEvent } from "react";
import type { TableData } from "../../api/project";
import { useProject } from "../../app/ProjectContext";
import { pasteInputError } from "../../validation/input";
import { formatTsv, parseTsv } from "./clipboard";
import type { useHeaderSelection } from "./useHeaderSelection";

export function useTableClipboard({
  table,
  readOnly,
  transformed,
  visibleRows,
  selectedRows,
  minRow,
  maxRow,
  minCol,
  maxCol,
  headerSelection,
}: {
  table: TableData;
  readOnly: boolean;
  transformed: boolean;
  visibleRows: number[];
  selectedRows: number[];
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
  headerSelection: ReturnType<typeof useHeaderSelection>["selection"];
}) {
  const { dispatch } = useProject();
  const [pasteError, setPasteError] = useState("");
  function onPaste(e: ClipboardEvent<HTMLDivElement>) {
    if (readOnly || (e.target as HTMLElement).closest("thead, tfoot")) return;
    const text = e.clipboardData.getData("text/plain");
    if (!/[\t\r\n]/.test(text)) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      const values = parseTsv(text);
      if (transformed && values.length > 1) {
        setPasteError(
          "表示絞り込み・並べ替え中の複数行への貼り付けは、並べ替えと絞り込みを解除してから行ってください。",
        );
        return;
      }
      const message = pasteInputError(minRow, minCol, values);
      if (message) {
        setPasteError(message);
        return;
      }
      // 貼り付け前のセル編集を確定させてから、一括操作を送る。
      (document.activeElement as HTMLElement)?.blur();
      dispatch({
        type: "paste",
        id: table.id,
        row: minRow,
        col: minCol,
        values,
        expectedValues: values.map((cells, r) =>
          cells.map((_, c) => table.rows[minRow + r]?.[minCol + c] ?? null),
        ),
      });
      setPasteError("");
    } catch (error) {
      setPasteError(
        error instanceof Error ? error.message : "貼り付けに失敗しました。",
      );
    }
  }
  function onCopy(e: ClipboardEvent<HTMLDivElement>) {
    if (
      readOnly ||
      (e.target as HTMLElement).closest("thead textarea, thead input, tfoot")
    )
      return;
    if (headerSelection) {
      e.preventDefault();
      const { kind, indices } = headerSelection;
      e.clipboardData.setData(
        "text/plain",
        formatTsv(
          kind === "row"
            ? visibleRows
                .filter((i) => indices.includes(i))
                .map((i) => table.rows[i])
            : visibleRows.map((r) => indices.map((i) => table.rows[r][i])),
        ),
      );
      return;
    }
    if (minRow === maxRow && minCol === maxCol) return;
    e.preventDefault();
    e.clipboardData.setData(
      "text/plain",
      formatTsv(
        selectedRows.map((r) => table.rows[r].slice(minCol, maxCol + 1)),
      ),
    );
  }
  return { pasteError, setPasteError, onPaste, onCopy };
}
