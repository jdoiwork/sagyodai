import { useColumnReorder } from "./useColumnReorder";
import { ColumnResizeHandle, DEFAULT_COLUMN_WIDTH } from "./ColumnResizeHandle";
import { useDeletionAnimation } from "./useDeletionAnimation";
import { TableContextMenu } from "./TableContextMenu";
import { ColumnHeader } from "./ColumnHeader";
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
  useDeletionAnimation(viewport, table);
  const reorder = useColumnReorder(table, viewport, dispatch);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    index: number;
    kind: "row" | "column";
    preview?: boolean;
    columns: string[];
    rows: string[][];
  } | null>(null);
  const [columnPreview, setColumnPreview] = useState<{
    col: number;
    width: number;
  } | null>(null);
  const columnWidths = table.columns.map((_, col) =>
    columnPreview?.col === col
      ? columnPreview.width
      : (table.columnWidths[col] ?? DEFAULT_COLUMN_WIDTH),
  );
  const [top, setTop] = useState(0);
  const [focusedCell, setFocusedCell] = useState<Point | null>(null);
  const focusedRow = focusedCell?.row ?? null;
  const [selection, setSelection] = useState<{ start: Point; end: Point }>({
    start: { row: 0, col: 0 },
    end: { row: 0, col: 0 },
  });
  const [pasteError, setPasteError] = useState("");
  const minRow = Math.min(
      selection.start.row,
      selection.end.row,
      Math.max(0, table.rows.length - 1),
    ),
    maxRow = Math.min(
      Math.max(selection.start.row, selection.end.row),
      Math.max(0, table.rows.length - 1),
    );
  const minCol = Math.min(
      selection.start.col,
      selection.end.col,
      Math.max(0, table.columns.length - 1),
    ),
    maxCol = Math.min(
      Math.max(selection.start.col, selection.end.col),
      Math.max(0, table.columns.length - 1),
    );
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
      {contextMenu && !readOnly && (
        <TableContextMenu
          {...contextMenu}
          targetLabel={
            contextMenu.kind === "row"
              ? `行${contextMenu.index + 1} `
              : `「${contextMenu.columns[contextMenu.index]}」列`
          }
          disabled={
            (contextMenu.kind === "row"
              ? contextMenu.rows.length
              : contextMenu.columns.length) <= 1
          }
          onPreview={(preview) =>
            setContextMenu((menu) => (menu ? { ...menu, preview } : null))
          }
          onClose={() => setContextMenu(null)}
          onDelete={() =>
            dispatch(
              contextMenu.kind === "row"
                ? {
                    type: "removeRow",
                    id: table.id,
                    row: contextMenu.index,
                    expectedRows: contextMenu.rows,
                  }
                : {
                    type: "removeColumn",
                    id: table.id,
                    col: contextMenu.index,
                    expectedRows: contextMenu.rows,
                    expectedColumns: contextMenu.columns,
                  },
            )
          }
        />
      )}
      {pasteError && (
        <div className="inline-error" role="alert">
          {pasteError}
        </div>
      )}
      <div
        ref={viewport}
        className="grid-scroll nodrag nopan nowheel"
        onFocusCapture={(e) => {
          const target = e.target as HTMLElement;
          const cell = target.closest<HTMLElement>("td[data-col]");
          const row = cell?.closest<HTMLElement>("tr[data-row]");
          setFocusedCell(
            !readOnly && target.matches("textarea.cell") && cell && row
              ? { row: Number(row.dataset.row), col: Number(cell.dataset.col) }
              : null,
          );
        }}
        onBlurCapture={() => setFocusedCell(null)}
        onScroll={(e) => setTop(e.currentTarget.scrollTop)}
        onPaste={(e) => {
          if (readOnly || (e.target as HTMLElement).closest("thead")) return;
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
          if (readOnly || (e.target as HTMLElement).closest("thead")) return;
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
        <table
          className="data-grid"
          style={{
            width: 42 + columnWidths.reduce((sum, width) => sum + width, 0),
          }}
        >
          <colgroup>
            <col style={{ width: 42 }} />
            {columnWidths.map((width, col) => (
              <col key={col} style={{ width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="row-number">#</th>
              {table.columns.map((name, c) => (
                <th
                  key={c}
                  data-column={c}
                  {...(!readOnly ? reorder.sourceProps(c) : {})}
                  {...(!readOnly ? reorder.targetProps(c) : {})}
                  className={
                    [
                      focusedCell?.col === c ? "editing-header" : "",
                      !readOnly && reorder.marker?.col === c
                        ? `column-drop-${reorder.marker.side}`
                        : "",
                      contextMenu?.preview &&
                      contextMenu.kind === "column" &&
                      contextMenu.index === c
                        ? "delete-preview"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined
                  }
                  onContextMenu={(e) => {
                    if (readOnly) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      index: c,
                      kind: "column",
                      columns: table.columns,
                      rows: table.rows,
                    });
                  }}
                >
                  <span className="column-letter">
                    {String.fromCharCode(65 + c)}
                  </span>
                  {readOnly ? name : <ColumnHeader table={table} col={c} />}
                  <ColumnResizeHandle
                    table={table}
                    col={c}
                    width={columnWidths[c]}
                    onPreview={(width) =>
                      setColumnPreview((current) =>
                        width === null
                          ? current?.col === c
                            ? null
                            : current
                          : { col: c, width },
                      )
                    }
                  />
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
                  <tr
                    key={r}
                    data-row={r}
                    onContextMenu={(e) => {
                      if (readOnly) return;
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        index: r,
                        kind: "row",
                        columns: table.columns,
                        rows: table.rows,
                      });
                    }}
                  >
                    <th
                      className={`row-number${focusedRow === r ? " editing-header" : ""}${contextMenu?.preview && contextMenu.kind === "row" && contextMenu.index === r ? " delete-preview" : ""}`}
                    >
                      {r + 1}
                    </th>
                    {row.map((value, c) => (
                      <td
                        key={c}
                        data-col={c}
                        className={
                          contextMenu?.preview &&
                          (contextMenu.kind === "row"
                            ? contextMenu.index === r
                            : contextMenu.index === c)
                            ? "delete-preview"
                            : undefined
                        }
                      >
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
