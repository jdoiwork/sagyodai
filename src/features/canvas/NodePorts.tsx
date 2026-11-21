import { Handle, Position } from "@xyflow/react";
import type { TableData } from "../../api/project";

// ノード本体の overflow に隠れない位置に端子とラベルを配置する。
export function NodePorts({ table }: { table: TableData }) {
  return (
    <>
      {table.kind !== "input" && (
        <Handle
          type="target"
          position={Position.Left}
          id="in"
          className="table-port table-port-input"
          style={{ top: 32 }}
          aria-label={`${table.title} 入力端子`}
          title="入力：出力端子からドラッグして接続（入力から逆向きにも接続できます）"
        >
          <span className="port-label">入力</span>
        </Handle>
      )}
      {table.kind !== "display" && (
        <Handle
          type="source"
          position={Position.Right}
          id="out"
          className="table-port table-port-output"
          style={{ top: 32 }}
          aria-label={`${table.title} 出力端子`}
          title="出力：入力端子へドラッグして接続（複数ノードへ分岐できます）"
        >
          <span className="port-label">出力</span>
        </Handle>
      )}
    </>
  );
}
