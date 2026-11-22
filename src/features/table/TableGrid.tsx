import { sortDisplayRows, type DisplaySort } from "./displayOrder";
import {
  ColumnValueFilter,
  type ColumnFilterState,
  type ColumnFilters,
} from "./ColumnValueFilter";
import { matchingRows } from "./quickSearch";
import { Icon } from "../../components/Icon";
import { SummaryFooter } from "./SummaryFooter";
import { pasteInputError } from "../../validation/input";
import { useRowReorder } from "./useRowReorder";
import { useHeaderSelection } from "./useHeaderSelection";
import { useTableWheel } from "./useTableWheel";
import { useColumnReorder } from "./useColumnReorder";
import { ColumnResizeHandle, DEFAULT_COLUMN_WIDTH } from "./ColumnResizeHandle";
import { useDeletionAnimation } from "./useDeletionAnimation";
import { TableContextMenu } from "./TableContextMenu";
import { ColumnHeader } from "./ColumnHeader";
import { Fragment, useMemo, useRef, useState } from "react";
import type { TableData } from "../../api/project";
import { useProject } from "../../app/ProjectContext";
import { Cell } from "./Cell";
import { formatTsv, parseTsv } from "./clipboard";
const ROW_HEIGHT = 36;
type Point = { row: number; col: number };
export function TableGrid({
  table,
  readOnly = false,
  onCanvasScroll,
  search,
  columnFilters,
}: {
  table: TableData;
  columnFilters?: {
    state: ColumnFilterState;
    onChange: (state: ColumnFilterState) => void;
  };
  search?: { value: string; onChange: (value: string) => void };
  readOnly?: boolean;
  onCanvasScroll?: (dx: number, dy: number) => void;
}) {
  const { dispatch } = useProject();
  const [localQuery, setLocalQuery] = useState("");
  const query = search?.value ?? localQuery;
  const [localFilters, setLocalFilters] = useState<ColumnFilterState>({
    schema: "",
    values: {},
  });
  const filterState = columnFilters?.state ?? localFilters;
  const schema = JSON.stringify(table.columns);
  const filters = useMemo(
    () => (filterState.schema === schema ? filterState.values : {}),
    [filterState, schema],
  );
  const sort = filterState.schema === schema ? filterState.sort : null;
  const transformed =
    !!sort || query.trim().length > 0 || Object.keys(filters).length > 0;
  const searching = query.trim().length > 0 || Object.keys(filters).length > 0;
  const visibleRows = useMemo(
    () =>
      sortDisplayRows(
        table.rows,
        matchingRows(table.rows, query, filters),
        sort,
      ),
    [table.rows, query, filters, sort],
  );
  const visibleSet = new Set(visibleRows);

  const viewport = useRef<HTMLDivElement>(null);
  useDeletionAnimation(viewport, table);
  useTableWheel(viewport, onCanvasScroll);
  const headers = useHeaderSelection(table, visibleRows);
  const canReorderColumns =
    !readOnly || (table.kind === "display" && !table.stale && !table.error);
  const reorder = useColumnReorder(
    table,
    viewport,
    dispatch,
    headers.selection?.kind === "column" ? headers.selection.indices : [],
    headers.moving,
  );
  const rowReorder = useRowReorder(
    table,
    viewport,
    dispatch,
    headers.selection?.kind === "row" ? headers.selection.indices : [],
    (indices, to, source) => headers.moving(indices, to, source, "row"),
  );
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    index: number;
    indices: number[];
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
  const startIndex = Math.max(0, visibleRows.indexOf(selection.start.row));
  const endIndex = Math.max(0, visibleRows.indexOf(selection.end.row));
  const selectedRows = visibleRows.slice(
    Math.min(startIndex, endIndex),
    Math.max(startIndex, endIndex) + 1,
  );
  const selectedRowSet = new Set(selectedRows);
  const minRow = selectedRows[0] ?? 0,
    maxRow = selectedRows.at(-1) ?? 0;
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
    Math.min(visibleRows.length - 1, Math.floor(top / ROW_HEIGHT) - 5),
  );
  const last = Math.min(
    visibleRows.length,
    first + Math.ceil(table.height / ROW_HEIGHT) + 12,
  );
  // 画面外へスクロールしても、IME 変換中のセルをアンマウントしない。
  const renderedRows = Array.from(
    new Set([
      ...Array.from({ length: last - first }, (_, i) => first + i),
      ...(!transformed &&
      rowReorder.draggedRow !== null &&
      rowReorder.draggedRow < table.rows.length
        ? [rowReorder.draggedRow]
        : []),
      ...(focusedRow !== null && visibleSet.has(focusedRow)
        ? [visibleRows.indexOf(focusedRow)]
        : []),
    ]),
  ).sort((a, b) => a - b);
  function changeQuery(value: string) {
    (search?.onChange ?? setLocalQuery)(value);
    headers.clear();
    setContextMenu(null);
    setPasteError("");
    setFocusedCell(null);
    const first =
      sortDisplayRows(
        table.rows,
        matchingRows(table.rows, value, filters),
        sort,
      )[0] ?? 0;
    setSelection({
      start: { row: first, col: 0 },
      end: { row: first, col: 0 },
    });
    if (viewport.current) viewport.current.scrollTop = 0;
    setTop(0);
  }
  function changeFilters(next: ColumnFilters) {
    (columnFilters?.onChange ?? setLocalFilters)({
      schema,
      values: next,
      sort,
    });
    headers.clear();
    setContextMenu(null);
    setPasteError("");
    setFocusedCell(null);
    const first =
      sortDisplayRows(
        table.rows,
        matchingRows(table.rows, query, next),
        sort,
      )[0] ?? 0;
    setSelection({
      start: { row: first, col: 0 },
      end: { row: first, col: 0 },
    });
    if (viewport.current) viewport.current.scrollTop = 0;
    setTop(0);
  }
  function changeSort(next: DisplaySort | null) {
    (columnFilters?.onChange ?? setLocalFilters)({
      schema,
      values: filters,
      sort: next,
    });
    headers.clear();
    setContextMenu(null);
    setPasteError("");
    setFocusedCell(null);
    const first =
      sortDisplayRows(
        table.rows,
        matchingRows(table.rows, query, filters),
        next,
      )[0] ?? 0;
    setSelection({
      start: { row: first, col: 0 },
      end: { row: first, col: 0 },
    });
    if (viewport.current) viewport.current.scrollTop = 0;
    setTop(0);
  }
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
    let r = visibleRows.indexOf(row),
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
    if (r < 0 || r >= visibleRows.length) {
      (document.activeElement as HTMLElement)?.blur();
      return;
    }
    const sourceRow = visibleRows[r];
    setSelection({
      start: { row: sourceRow, col: c },
      end: { row: sourceRow, col: c },
    });
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
          `[data-row="${sourceRow}"] [data-col="${c}"] textarea`,
        )
        ?.focus(),
    );
  }
  return (
    <>
      <div className="quick-search nodrag nopan nowheel">
        <Icon name="search" />
        <input
          type="search"
          aria-label={`${table.title} クイック検索`}
          placeholder="この表を検索（全列）"
          value={query}
          onChange={(e) => changeQuery(e.target.value)}
        />
        {query && (
          <button
            aria-label={`${table.title} 検索をクリア`}
            onClick={() => changeQuery("")}
          >
            <Icon name="close" />
          </button>
        )}
        {Object.keys(filters).length > 0 && (
          <button onClick={() => changeFilters({})}>列の絞り込みを解除</button>
        )}
        <span role="status">
          {visibleRows.length.toLocaleString()} /{" "}
          {table.rows.length.toLocaleString()} 行
        </span>
      </div>
      {transformed && (
        <div className="quick-search-note">
          表示のみ絞り込み・並べ替え · 出力・集計は元の全行
          {!readOnly
            ? " · 行の並べ替え・複数行の貼り付けは絞り込み・並べ替え解除後"
            : ""}
        </div>
      )}
      {contextMenu && (!readOnly || table.kind === "display") && (
        <TableContextMenu
          {...contextMenu}
          hideOnly={readOnly}
          hiddenColumns={table.projection?.columns
            .filter((c) => !c.visible)
            .map((c) => {
              const config = table.projection!;
              const name = c.name.trim() || config.schema[c.column];
              const duplicate = config.columns.some(
                (other) =>
                  other.visible &&
                  (other.name.trim() || config.schema[other.column]) === name,
              );
              return {
                column: c.column,
                name,
                disabled: table.stale || !!table.error || duplicate,
                reason: duplicate
                  ? "同名の出力列があります。出力列の設定で名前を変更してください。"
                  : table.stale || table.error
                    ? "結果を更新してから再表示してください。"
                    : undefined,
              };
            })}
          onShow={(column) => {
            const config = table.projection;
            if (!config) return;
            dispatch({
              type: "setProjection",
              id: table.id,
              config: {
                ...config,
                columns: config.columns.map((c) =>
                  c.column === column ? { ...c, visible: true } : c,
                ),
              },
            });
          }}
          count={contextMenu.indices.length}
          insertDisabled={
            contextMenu.kind === "row"
              ? contextMenu.rows.length + contextMenu.indices.length > 5000
              : contextMenu.columns.length + contextMenu.indices.length > 50
          }
          onInsert={(after) => {
            const at = after
              ? Math.max(...contextMenu.indices) + 1
              : Math.min(...contextMenu.indices);
            const count = contextMenu.indices.length;
            const settled = headers.inserting(contextMenu.kind, at, count, {
              ...table,
              columns: contextMenu.columns,
              rows: contextMenu.rows,
            });
            dispatch(
              {
                type:
                  contextMenu.kind === "row" ? "insertRows" : "insertColumns",
                id: table.id,
                at,
                count,
                expectedColumns: contextMenu.columns,
                expectedRows: contextMenu.rows,
              },
              settled,
            );
          }}
          targetLabel={
            contextMenu.indices.length > 1
              ? `選択した${contextMenu.indices.length}${contextMenu.kind === "row" ? "行" : "列"}`
              : contextMenu.kind === "row"
                ? `行${contextMenu.index + 1} `
                : `「${contextMenu.columns[contextMenu.index]}」列`
          }
          disabled={
            (readOnly && (table.stale || !!table.error)) ||
            (contextMenu.kind === "row"
              ? contextMenu.rows.length
              : contextMenu.columns.length) <= contextMenu.indices.length
          }
          onPreview={(preview) =>
            setContextMenu((menu) => (menu ? { ...menu, preview } : null))
          }
          onClose={() => setContextMenu(null)}
          onDelete={() =>
            dispatch(
              readOnly
                ? {
                    type: "hideOutputColumn",
                    id: table.id,
                    col: contextMenu.index,
                    expectedColumns: contextMenu.columns,
                  }
                : contextMenu.indices.length > 1
                  ? contextMenu.kind === "row"
                    ? {
                        type: "removeRows",
                        id: table.id,
                        indices: contextMenu.indices,
                        expectedRows: contextMenu.rows,
                      }
                    : {
                        type: "removeColumns",
                        id: table.id,
                        indices: contextMenu.indices,
                        expectedRows: contextMenu.rows,
                        expectedColumns: contextMenu.columns,
                      }
                  : contextMenu.kind === "row"
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
        className="grid-scroll nodrag nopan"
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
        onKeyDown={(e) => {
          if (e.key === "Escape") headers.clear();
        }}
        onPaste={(e) => {
          if (readOnly || (e.target as HTMLElement).closest("thead, tfoot"))
            return;
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
          if (
            readOnly ||
            (e.target as HTMLElement).closest(
              "thead textarea, thead input, tfoot",
            )
          )
            return;
          if (headers.selection) {
            e.preventDefault();
            const { kind, indices } = headers.selection;
            e.clipboardData.setData(
              "text/plain",
              formatTsv(
                kind === "row"
                  ? visibleRows
                      .filter((i) => indices.includes(i))
                      .map((i) => table.rows[i])
                  : visibleRows.map((r) =>
                      indices.map((i) => table.rows[r][i]),
                    ),
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
                  aria-sort={
                    sort?.column === c
                      ? sort.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                  {...(canReorderColumns ? reorder.sourceProps(c) : {})}
                  {...(canReorderColumns ? reorder.targetProps(c) : {})}
                  className={
                    [
                      headers.contains("column", c) ? "selected-header" : "",
                      focusedCell?.col === c ? "editing-header" : "",
                      canReorderColumns && reorder.marker?.col === c
                        ? `column-drop-${reorder.marker.side}`
                        : "",
                      contextMenu?.preview &&
                      contextMenu.kind === "column" &&
                      contextMenu.indices.includes(c)
                        ? "delete-preview"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined
                  }
                  tabIndex={readOnly ? undefined : -1}
                  aria-selected={headers.contains("column", c)}
                  onClick={(e) => {
                    if (
                      readOnly ||
                      (e.target as HTMLElement).closest(
                        "textarea, input, button.column-value-filter, [role=separator]",
                      )
                    )
                      return;
                    e.stopPropagation();
                    if (!(e.target as HTMLElement).closest(".column-name"))
                      e.currentTarget.focus();
                    headers.select("column", c, e);
                  }}
                  onContextMenu={(e) => {
                    if (readOnly && table.kind !== "display") return;
                    e.preventDefault();
                    e.stopPropagation();
                    setContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      index: c,
                      indices: headers.contains("column", c)
                        ? headers.selection!.indices
                        : [c],
                      kind: "column",
                      columns: table.columns,
                      rows: table.rows,
                    });
                  }}
                >
                  <span className="column-letter">
                    {String.fromCharCode(65 + c)}
                  </span>
                  {canReorderColumns ? (
                    <ColumnHeader table={table} col={c} />
                  ) : (
                    name
                  )}
                  <ColumnValueFilter
                    key={`${schema}-${c}`}
                    label={`${table.title} ${name}`}
                    values={table.rows.map((row) => row[c])}
                    selected={filters[c]}
                    sortDirection={
                      sort?.column === c ? sort.direction : undefined
                    }
                    onSort={(direction) =>
                      changeSort(direction ? { column: c, direction } : null)
                    }
                    onChange={(values) => {
                      const next = { ...filters };
                      if (values === undefined) delete next[c];
                      else next[c] = values;
                      changeFilters(next);
                    }}
                  />
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
            {renderedRows.map((viewRow, index) => {
              const r = visibleRows[viewRow];
              const row = table.rows[r];
              const previous = index === 0 ? -1 : renderedRows[index - 1];
              return (
                <Fragment key={r}>
                  {spacer(viewRow - previous - 1)}
                  <tr
                    key={r}
                    data-row={r}
                    {...(!readOnly && !transformed
                      ? rowReorder.targetProps(r)
                      : {})}
                    className={
                      !readOnly && rowReorder.marker?.row === r
                        ? `row-drop-${rowReorder.marker.side}`
                        : undefined
                    }
                    onContextMenu={(e) => {
                      if (readOnly) return;
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        index: r,
                        indices: headers.contains("row", r)
                          ? headers.selection!.indices.filter((i) =>
                              visibleSet.has(i),
                            )
                          : [r],
                        kind: "row",
                        columns: table.columns,
                        rows: table.rows,
                      });
                    }}
                  >
                    <th
                      {...(!readOnly && !transformed
                        ? rowReorder.sourceProps(r)
                        : {})}
                      tabIndex={readOnly ? undefined : -1}
                      aria-selected={headers.contains("row", r)}
                      onClick={(e) => {
                        if (!readOnly) {
                          e.stopPropagation();
                          e.currentTarget.focus();
                          headers.select("row", r, e);
                        }
                      }}
                      className={`row-number${headers.contains("row", r) ? " selected-header" : ""}${focusedRow === r ? " editing-header" : ""}${contextMenu?.preview && contextMenu.kind === "row" && contextMenu.indices.includes(r) ? " delete-preview" : ""}`}
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
                            ? contextMenu.indices.includes(r)
                            : contextMenu.indices.includes(c))
                            ? "delete-preview"
                            : headers.contains("row", r) ||
                                headers.contains("column", c)
                              ? "header-selected-cell"
                              : undefined
                        }
                      >
                        {readOnly ? (
                          <span className="result-cell">{value}</span>
                        ) : (
                          <Cell
                            onValidationError={setPasteError}
                            value={value}
                            label={`${table.title} ${r + 1}行 ${c + 1}列`}
                            selected={
                              !headers.selection &&
                              selectedRowSet.has(r) &&
                              c >= minCol &&
                              c <= maxCol
                            }
                            onSelect={(extend) => {
                              headers.clear();
                              setSelection((s) => ({
                                start: extend ? s.start : { row: r, col: c },
                                end: { row: r, col: c },
                              }));
                            }}
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
            {spacer(visibleRows.length - (renderedRows.at(-1) ?? -1) - 1)}
          </tbody>
          <SummaryFooter table={table} />
        </table>
      </div>
      {searching && visibleRows.length === 0 && (
        <div className="empty-result">検索に一致する行はありません</div>
      )}
      {readOnly && table.rows.length === 0 && !searching && (
        <div className="empty-result">
          {table.stale
            ? "結果はまだありません"
            : "条件に一致する行はありません（0件）"}
        </div>
      )}
      <div className="table-footer nodrag nopan">
        {table.kind !== "csv" && (
          <button
            onClick={() =>
              dispatch({
                type: "setFooter",
                id: table.id,
                columns: table.footer ? null : table.columns.map(() => false),
                expectedColumns: table.columns,
              })
            }
          >
            {table.footer ? "フッターを削除" : "＋ フッター行"}
          </button>
        )}
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
