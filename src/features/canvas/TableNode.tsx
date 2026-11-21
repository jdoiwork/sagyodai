import { NodeTitle } from "./NodeTitle";
import { Icon } from "../../components/Icon";
import { NodeSettings } from "../filter/NodeSettings";
import { Handle, Position, NodeResizer, type NodeProps } from "@xyflow/react";
import type { TableFlowNode } from "./layout";
import { useProject } from "../../app/ProjectContext";
import { TableGrid } from "../table/TableGrid";
export function TableNode({ data, selected }: NodeProps<TableFlowNode>) {
  const { dispatch, project } = useProject();
  const table = data.table;
  return (
    <section className="table-node" aria-label={table.title}>
      {table.kind !== "input" && (
        <Handle
          type="target"
          position={Position.Left}
          id="in"
          aria-label={`${table.title} 入力端子`}
        />
      )}
      {table.kind !== "display" && (
        <Handle
          type="source"
          position={Position.Right}
          id="out"
          aria-label={`${table.title} 出力端子`}
        />
      )}
      <NodeResizer
        isVisible={selected && !table.compact}
        minWidth={380}
        minHeight={240}
        maxWidth={2400}
        maxHeight={1600}
        onResizeStart={data.onLayoutStart}
        onResizeEnd={(_, p) =>
          data.onLayoutEnd({ x: p.x, y: p.y, width: p.width, height: p.height })
        }
      />
      <header className="table-drag-handle">
        <div
          className="table-icon"
          title={
            table.kind === "input"
              ? "手入力の表"
              : table.kind === "filter"
                ? "フィルタ"
                : "結果表"
          }
        >
          <Icon
            name={
              table.kind === "input"
                ? "editableTable"
                : table.kind === "filter"
                  ? "filter"
                  : "table"
            }
          />
        </div>
        <div>
          <NodeTitle table={table} />
          <span>
            {table.kind === "input"
              ? "入力ソース"
              : table.kind === "filter"
                ? "行の絞り込み"
                : "結果の表示"}
          </span>
        </div>
        {table.kind === "filter" && (
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
        )}
        <span className="editable-badge" hidden={table.compact}>
          {table.kind === "input" ? "編集可能" : "読み取り専用"}
        </span>
        <span className="grip" aria-hidden="true">
          ⠿
        </span>
      </header>
      {table.kind === "input" ? (
        <>
          <div className="table-actions nodrag nopan">
            <span className="table-mode">文字列の表</span>
            <button
              onClick={() =>
                dispatch({ type: "addRows", id: table.id, count: 1 })
              }
            >
              <Icon name="plus" />行
            </button>
            <button
              onClick={() => dispatch({ type: "addColumn", id: table.id })}
            >
              <Icon name="plus" />列
            </button>
            <button
              title="スクロール確認用に空の行を追加"
              onClick={() =>
                dispatch({ type: "addRows", id: table.id, count: 100 })
              }
            >
              <Icon name="plus" />
              100 行
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
          <TableGrid table={table} />
        </>
      ) : (
        <>
          <NodeSettings table={table} />
          {table.kind === "display" && <TableGrid table={table} readOnly />}
        </>
      )}
    </section>
  );
}
