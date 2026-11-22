import { TextSettings } from "../text/TextSettings";
import { NoteNode } from "../note/NoteNode";
import { CsvSettings } from "../csv/CsvSettings";
import { useTableView } from "../table/useTableView";
import { NodeActions } from "./NodeActions";
import { unionPortHeight } from "../union/ports";
import { UnionSettings } from "../union/UnionSettings";
import { NodePorts } from "./NodePorts";
import { emptyRowIndices } from "../table/emptyRows";
import { useCallback } from "react";
import { CANVAS_SCROLL_SPEED } from "./scroll";
import { NodeTitle } from "./NodeTitle";
import { Icon } from "../../components/Icon";
import { NodeSettings } from "../filter/NodeSettings";
import { NodeResizer, useReactFlow, type NodeProps } from "@xyflow/react";
import type { TableFlowNode } from "./layout";
import { useProject } from "../../app/ProjectContext";
import { TableGrid } from "../table/TableGrid";
export function TableNode(props: NodeProps<TableFlowNode>) {
  return props.data.table.kind === "note" ? (
    <NoteNode {...props} />
  ) : (
    <DataNode {...props} />
  );
}
function DataNode({ data, selected }: NodeProps<TableFlowNode>) {
  const { dispatch, project } = useProject();
  const table = data.table;
  const { search, setSearch, columnFilters, setColumnFilters } =
    useTableView(table);
  const emptyRows = table.kind === "input" ? emptyRowIndices(table.rows) : [];
  const { getViewport, setViewport } = useReactFlow();
  const onCanvasScroll = useCallback(
    (dx: number, dy: number) => {
      const viewport = getViewport();
      void setViewport({
        ...viewport,
        x: viewport.x - dx * CANVAS_SCROLL_SPEED,
        y: viewport.y - dy * CANVAS_SCROLL_SPEED,
      });
    },
    [getViewport, setViewport],
  );
  return (
    <>
      <NodePorts table={table} />
      <section className="table-node" aria-label={table.title}>
        <NodeResizer
          isVisible={selected && !table.compact}
          minWidth={380}
          minHeight={Math.max(240, unionPortHeight(table))}
          maxWidth={2400}
          maxHeight={1600}
          onResizeStart={data.onLayoutStart}
          onResizeEnd={(_, p) =>
            data.onLayoutEnd({
              x: p.x,
              y: p.y,
              width: p.width,
              height: p.height,
            })
          }
        />
        <header className="table-drag-handle">
          <div
            className="table-icon"
            title={
              table.kind === "input"
                ? "手入力の表"
                : table.kind === "text"
                  ? "テキスト入力"
                  : table.kind === "csv"
                    ? "CSV入力"
                    : table.kind === "replace"
                      ? "置換"
                      : table.kind === "aggregate"
                        ? "集計"
                        : table.kind === "sort"
                          ? "ソート"
                          : table.kind === "filter"
                            ? "フィルタ"
                            : table.kind === "union"
                              ? "結合"
                              : "結果表"
            }
          >
            <Icon
              name={
                table.kind === "input"
                  ? "editableTable"
                  : table.kind === "text"
                    ? "note"
                    : table.kind === "csv"
                      ? "folder"
                      : table.kind === "replace"
                        ? "replace"
                        : table.kind === "aggregate"
                          ? "aggregate"
                          : table.kind === "sort"
                            ? "sort"
                            : table.kind === "filter"
                              ? "filter"
                              : table.kind === "union"
                                ? "union"
                                : "table"
              }
            />
          </div>
          <div>
            <NodeTitle table={table} />
            <span>
              {table.kind === "input"
                ? "入力ソース"
                : table.kind === "text"
                  ? "テキストファイルの読み込み"
                  : table.kind === "csv"
                    ? "CSVファイルの読み込み"
                    : table.kind === "replace"
                      ? "文字列の加工"
                      : table.kind === "aggregate"
                        ? "グループ集計"
                        : table.kind === "sort"
                          ? "行の並べ替え"
                          : table.kind === "filter"
                            ? "行の絞り込み"
                            : table.kind === "union"
                              ? "表の結合"
                              : "結果の表示"}
            </span>
          </div>
          <button
            className="nodrag nopan"
            aria-label={`${table.title} ${table.compact ? "展開" : "コンパクト表示"}`}
            aria-expanded={!table.compact}
            onClick={() =>
              dispatch({
                type: "setCompact",
                id: table.id,
                compact: !table.compact,
              })
            }
          >
            <Icon name={table.compact ? "expand" : "collapse"} />
            {table.compact ? "展開" : "縮小"}
          </button>
          {(table.kind === "input" || table.kind === "display") && (
            <span className="editable-badge" hidden={table.compact}>
              {table.kind === "input" ? "編集可能" : "読み取り専用"}
            </span>
          )}
          <NodeActions table={table} />
          <span className="grip" aria-hidden="true">
            ⠿
          </span>
        </header>
        {table.kind === "input" && table.compact ? (
          <div className="node-settings node-settings-compact">
            <span className="compact-condition">
              {table.rows.length} 行 × {table.columns.length} 列
            </span>
            <span className="node-status">編集可能</span>
          </div>
        ) : table.kind === "input" ? (
          <>
            <div className="table-actions nodrag nopan">
              <span className="table-mode">文字列の表</span>
              <button
                disabled={table.rows.length >= 5000}
                title={
                  table.rows.length >= 5000
                    ? "上限の5000行に達しています"
                    : "行を追加"
                }
                onClick={() =>
                  dispatch({ type: "addRows", id: table.id, count: 1 })
                }
              >
                <Icon name="plus" />行
              </button>
              <button
                disabled={table.columns.length >= 50}
                title={
                  table.columns.length >= 50
                    ? "上限の50列に達しています"
                    : "列を追加"
                }
                onClick={() => dispatch({ type: "addColumn", id: table.id })}
              >
                <Icon name="plus" />列
              </button>
              <button
                disabled={emptyRows.length === 0}
                title={
                  emptyRows.length
                    ? `全セルが空の${emptyRows.length}行を削除（全行が空なら1行残します）`
                    : "削除できる空行はありません（最低1行は残します）"
                }
                onClick={() => {
                  if (emptyRows.length)
                    dispatch({
                      type: "removeRows",
                      id: table.id,
                      indices: emptyRows,
                      expectedRows: table.rows,
                    });
                }}
              >
                <Icon name="trash" />
                空行を削除
              </button>
              <button
                className="action-danger"
                disabled={project?.tables.length === 1}
                title={
                  project?.tables.length === 1
                    ? "最後のノードは削除できません"
                    : "この表を削除（Undo で戻せます）"
                }
                onClick={() => dispatch({ type: "removeNode", id: table.id })}
              >
                <Icon name="trash" />
                削除
              </button>
            </div>
            <TableGrid
              table={table}
              onCanvasScroll={onCanvasScroll}
              search={{ value: search, onChange: setSearch }}
              columnFilters={{
                state: columnFilters,
                onChange: setColumnFilters,
              }}
            />
          </>
        ) : (
          <>
            {table.kind === "text" ? (
              <TextSettings table={table} />
            ) : table.kind === "csv" ? (
              <CsvSettings table={table} />
            ) : table.kind === "union" ? (
              <UnionSettings table={table} />
            ) : (
              <NodeSettings table={table} />
            )}
            {(table.kind === "display" ||
              table.kind === "csv" ||
              table.kind === "text") &&
              !table.compact && (
                <TableGrid
                  table={table}
                  readOnly
                  search={{ value: search, onChange: setSearch }}
                  columnFilters={{
                    state: columnFilters,
                    onChange: setColumnFilters,
                  }}
                  onCanvasScroll={onCanvasScroll}
                />
              )}
          </>
        )}
      </section>
    </>
  );
}
