import { Fragment, useRef, useState } from "react";
import type { TableData } from "../../api/project";
import { useProject } from "../../app/ProjectContext";
import { Cell } from "./Cell";
import { formatTsv, parseTsv } from "./clipboard";
const ROW_HEIGHT = 36;
type Point = { row: number; col: number };
export function TableGrid({
  table,
  readOnly = false,
}: {
  table: TableData;
  readOnly?: boolean;
}) {
  const { dispatch } = useProject();
  const viewport = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [focusedRow, setFocusedRow] = useState<number | null>(null);
  const [selection, setSelection] = useState<{ start: Point; end: Point }>({
    start: { row: 0, col: 0 },
    end: { row: 0, col: 0 },
  });
  const [pasteError, setPasteError] = useState("");
  const minRow = Math.min(selection.start.row, selection.end.row),
    maxRow = Math.max(selection.start.row, selection.end.row);
  const minCol = Math.min(selection.start.col, selection.end.col),
    maxCol = Math.max(selection.start.col, selection.end.col);
  const first = Math.max(
    0,
    Math.min(table.rows.length - 1, Math.floor(top / ROW_HEIGHT) - 5),
  );
  const last = Math.min(
    table.rows.length,
    first + Math.ceil(table.height / ROW_HEIGHT) + 12,
  );
  // 画面外へスクロールしても、IME 変換中のセルをアンマウントしない。
  const renderedRows = Array.from(
    new Set([
      ...Array.from({ length: last - first }, (_, i) => first + i),
      ...(focusedRow !== null && focusedRow < table.rows.length
        ? [focusedRow]
        : []),
    ]),
  ).sort((a, b) => a - b);
  function spacer(count: number) {
    return count > 0 ? (
      <tr aria-hidden="true">
        <td
          colSpan={table.columns.length + 1}
          style={{ height: count * ROW_HEIGHT, padding: 0, border: 0 }}
        />
      </tr>
    ) : null;
  }
  function navigate(
    row: number,
    col: number,
    direction: "next" | "previous" | "down" | "up",
  ) {
    let r = row,
      c = col;
    if (direction === "down") r++;
    if (direction === "up") r--;
    if (direction === "next") {
      c++;
      if (c >= table.columns.length) {
        c = 0;
        r++;
      }
    }
    if (direction === "previous") {
      c--;
      if (c < 0) {
        c = table.columns.length - 1;
        r--;
      }
    }
    if (r < 0 || r >= table.rows.length) {
      (document.activeElement as HTMLElement)?.blur();
      return;
    }
    setSelection({ start: { row: r, col: c }, end: { row: r, col: c } });
    const el = viewport.current;
    if (
      el &&
      (r * ROW_HEIGHT < el.scrollTop ||
        (r + 2) * ROW_HEIGHT > el.scrollTop + el.clientHeight)
    ) {
      el.scrollTop = Math.max(0, r * ROW_HEIGHT - ROW_HEIGHT);
      setTop(el.scrollTop);
    }
    requestAnimationFrame(() =>
      el
        ?.querySelector<HTMLTextAreaElement>(
          `[data-row="${r}"] [data-col="${c}"] textarea`,
        )
        ?.focus(),
    );
  }
  return (
    <>
      {pasteError && (
        <div className="inline-error" role="alert">
          {pasteError}
        </div>
      )}
      <div
        ref={viewport}
        className="grid-scroll nodrag nopan nowheel"
        onFocusCapture={(e) => {
          const row = (e.target as HTMLElement).closest<HTMLElement>(
            "[data-row]",
          );
          if (row) setFocusedRow(Number(row.dataset.row));
        }}
        onBlurCapture={() => setFocusedRow(null)}
        onScroll={(e) => setTop(e.currentTarget.scrollTop)}
        onPaste={(e) => {
          if (readOnly) return;
          const text = e.clipboardData.getData("text/plain");
          if (!/[\t\r\n]/.test(text)) return;
          e.preventDefault();
          e.stopPropagation();
          try {
            const values = parseTsv(text);
            // 貼り付け前のセル編集を確定させてから、一括操作を送る。
            (document.activeElement as HTMLElement)?.blur();
            dispatch({
              type: "paste",
              id: table.id,
              row: minRow,
              col: minCol,
              values,
              expectedValues: values.map((cells, r) =>
                cells.map(
                  (_, c) => table.rows[minRow + r]?.[minCol + c] ?? null,
                ),
              ),
            });
            setPasteError("");
          } catch (error) {
            setPasteError(
              error instanceof Error
                ? error.message
                : "貼り付けに失敗しました。",
            );
          }
        }}
        onCopy={(e) => {
          if (readOnly) return;
          if (minRow === maxRow && minCol === maxCol) return;
          e.preventDefault();
          e.clipboardData.setData(
            "text/plain",
            formatTsv(
              table.rows
                .slice(minRow, maxRow + 1)
                .map((row) => row.slice(minCol, maxCol + 1)),
            ),
          );
        }}
      >
        <table className="data-grid">
          <thead>
            <tr>
              <th className="row-number">#</th>
              {table.columns.map((name, c) => (
                <th key={c}>
                  <span className="column-letter">
                    {String.fromCharCode(65 + c)}
                  </span>
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {renderedRows.map((r, index) => {
              const row = table.rows[r];
              const previous = index === 0 ? -1 : renderedRows[index - 1];
              return (
                <Fragment key={r}>
                  {spacer(r - previous - 1)}
                  <tr key={r} data-row={r}>
                    <th className="row-number">{r + 1}</th>
                    {row.map((value, c) => (
                      <td key={c} data-col={c}>
                        {readOnly ? (
                          <span className="result-cell">{value}</span>
                        ) : (
                          <Cell
                            value={value}
                            label={`${table.title} ${r + 1}行 ${c + 1}列`}
                            selected={
                              r >= minRow &&
                              r <= maxRow &&
                              c >= minCol &&
                              c <= maxCol
                            }
                            onSelect={(extend) =>
                              setSelection((s) => ({
                                start: extend ? s.start : { row: r, col: c },
                                end: { row: r, col: c },
                              }))
                            }
                            onCommit={(v, original) =>
                              dispatch({
                                type: "paste",
                                id: table.id,
                                row: r,
                                col: c,
                                values: [[v]],
                                expectedValues: [[original]],
                              })
                            }
                            onNavigate={(direction) =>
                              navigate(r, c, direction)
                            }
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                </Fragment>
              );
            })}
            {spacer(table.rows.length - (renderedRows.at(-1) ?? -1) - 1)}
          </tbody>
        </table>
      </div>
      {readOnly && table.rows.length === 0 && (
        <div className="empty-result">
          {table.stale
            ? "結果はまだありません"
            : "条件に一致する行はありません（0件）"}
        </div>
      )}
      <div className="table-footer nodrag nopan">
        <span>
          {table.rows.length.toLocaleString()} 行 × {table.columns.length} 列
        </span>
        <span>
          {minRow + 1}:{minCol + 1}
          {minRow !== maxRow || minCol !== maxCol
            ? ` — ${maxRow + 1}:${maxCol + 1}`
            : ""}
        </span>
      </div>
    </>
  );
}
