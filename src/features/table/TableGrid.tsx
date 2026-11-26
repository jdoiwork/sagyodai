import { sortDisplayRows, type DisplaySort } from "./displayOrder";
import {
  ColumnValueFilter,
  type ColumnFilterState,
  type ColumnFilters,
} from "./ColumnValueFilter";
import { matchingRows } from "./quickSearch";
import { Icon } from "../../components/Icon";
import { SummaryFooter } from "./SummaryFooter";
import { useRowReorder } from "./useRowReorder";
import { useHeaderSelection } from "./useHeaderSelection";
import { useTableWheel } from "./useTableWheel";
import { useColumnReorder } from "./useColumnReorder";
import { ColumnResizeHandle, DEFAULT_COLUMN_WIDTH } from "./ColumnResizeHandle";
import { useDeletionAnimation } from "./useDeletionAnimation";
import { TableGridMenu, type TableGridMenuState } from "./TableGridMenu";
import { ColumnHeader } from "./ColumnHeader";
import { Fragment, useMemo, useRef, useState } from "react";
import type { TableData } from "../../api/project";
import { useProject } from "../../app/ProjectContext";
import { Cell } from "./Cell";
import { useTableClipboard } from "./useTableClipboard";
import {
  useGridViewport,
  ROW_HEIGHT,
  type CellSelection,
} from "./useGridViewport";
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
  const cellErrors = useMemo(
    () =>
      new Map(
        (table.cellErrors ?? []).map((e) => [`${e.row}:${e.col}`, e.message]),
      ),
    [table.cellErrors],
  );
  function emptyPlaceholder(col: number) {
    const empty = table.columnSchema?.[col]?.config.empty;
    return empty?.mode === "value"
      ? empty.value || undefined
      : empty?.mode === "null"
        ? "null"
        : undefined;
  }
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
        !table.stale ? table.output?.rows : undefined,
      ),
    [table.rows, table.output, table.stale, query, filters, sort],
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
  const [contextMenu, setContextMenu] = useState<TableGridMenuState | null>(
    null,
  );
  const [columnPreview, setColumnPreview] = useState<{
    col: number;
    width: number;
  } | null>(null);
  const columnWidths = table.columns.map((_, col) =>
    columnPreview?.col === col
      ? columnPreview.width
      : (table.columnWidths[col] ?? DEFAULT_COLUMN_WIDTH),
  );
  const [selection, setSelection] = useState<CellSelection>({
    start: { row: 0, col: 0 },
    end: { row: 0, col: 0 },
  });
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
  const {
    renderedRows,
    focusedCell,
    focusedRow,
    setFocusedCell,
    setTop,
    navigate,
  } = useGridViewport({
    table,
    viewport,
    visibleRows,
    transformed,
    draggedRow: rowReorder.draggedRow,
    setSelection,
  });
  const { pasteError, setPasteError, onPaste, onCopy } = useTableClipboard({
    table,
    readOnly,
    transformed,
    visibleRows,
    selectedRows,
    minRow,
    maxRow,
    minCol,
    maxCol,
    headerSelection: headers.selection,
  });
  function resetVisibleSelection(
    nextQuery: string,
    nextFilters: ColumnFilters,
    nextSort: DisplaySort | null | undefined,
  ) {
    headers.clear();
    setContextMenu(null);
    setPasteError("");
    setFocusedCell(null);
    const first =
      sortDisplayRows(
        table.rows,
        matchingRows(table.rows, nextQuery, nextFilters),
        nextSort,
      )[0] ?? 0;
    setSelection({
      start: { row: first, col: 0 },
      end: { row: first, col: 0 },
    });
    if (viewport.current) viewport.current.scrollTop = 0;
    setTop(0);
  }
  function changeQuery(value: string) {
    (search?.onChange ?? setLocalQuery)(value);
    resetVisibleSelection(value, filters, sort);
  }
  function changeFilters(next: ColumnFilters) {
    (columnFilters?.onChange ?? setLocalFilters)({
      schema,
      values: next,
      sort,
    });
    resetVisibleSelection(query, next, sort);
  }
  function changeSort(next: DisplaySort | null) {
    (columnFilters?.onChange ?? setLocalFilters)({
      schema,
      values: filters,
      sort: next,
    });
    resetVisibleSelection(query, filters, next);
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
        <TableGridMenu
          table={table}
          readOnly={readOnly}
          menu={contextMenu}
          onChange={setContextMenu}
          onInserting={headers.inserting}
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
        onPaste={onPaste}
        onCopy={onCopy}
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
                          <span
                            className={
                              table.output?.rows[r]?.[c]?.type === "null"
                                ? "result-cell null-cell"
                                : "result-cell"
                            }
                          >
                            {value}
                          </span>
                        ) : (
                          <Cell
                            typeError={cellErrors.get(`${r}:${c}`)}
                            placeholder={emptyPlaceholder(c)}
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
        {table.kind !== "csv" && table.kind !== "text" && (
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
