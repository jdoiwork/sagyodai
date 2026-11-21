import { NodeResizer, type NodeProps } from "@xyflow/react";
import type { TableFlowNode } from "./layout";
import { useProject } from "../../app/ProjectContext";
import { TableGrid } from "../table/TableGrid";
export function TableNode({ data, selected }: NodeProps<TableFlowNode>) {
  const { dispatch } = useProject();
  const table = data.table;
  return (
    <section className="table-node" aria-label={table.title}>
      <NodeResizer
        isVisible={selected}
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
        <div className="table-icon">▦</div>
        <div>
          <h2>{table.title}</h2>
          <span>入力ソース</span>
        </div>
        <span className="editable-badge">編集可能</span>
        <span className="grip" aria-hidden="true">
          ⠿
        </span>
      </header>
      <div className="table-actions nodrag nopan">
        <span className="table-mode">文字列の表</span>
        <button
          onClick={() => dispatch({ type: "addRows", id: table.id, count: 1 })}
        >
          ＋ 行
        </button>
        <button onClick={() => dispatch({ type: "addColumn", id: table.id })}>
          ＋ 列
        </button>
        <button
          title="スクロール確認用に空の行を追加"
          onClick={() =>
            dispatch({ type: "addRows", id: table.id, count: 100 })
          }
        >
          ＋ 100 行
        </button>
      </div>
      <TableGrid table={table} />
    </section>
  );
}
