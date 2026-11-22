import { unionInputHandle, unionPortTop } from "../union/ports";
import { useEffect, useState, type MouseEvent } from "react";
import { useProject } from "../../app/ProjectContext";
import { EdgeContextMenu } from "./EdgeContextMenu";
import { colorValue } from "./colors";
import { Handle, Position, useUpdateNodeInternals } from "@xyflow/react";
import type { TableData } from "../../api/project";

// ノード本体の overflow に隠れない位置に端子とラベルを配置する。
export function NodePorts({ table }: { table: TableData }) {
  const { project, dispatch, pending } = useProject();
  const updateNodeInternals = useUpdateNodeInternals();
  const inputOrder = (table.unionInputs ?? [])
    .map((input) => input.source)
    .join("\0");
  useEffect(() => {
    updateNodeInternals(table.id);
  }, [
    table.id,
    inputOrder,
    table.compact,
    table.width,
    table.height,
    updateNodeInternals,
  ]);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    target: "input" | "output";
    revision: number;
    source?: string;
  } | null>(null);
  const openMenu = (
    event: MouseEvent,
    target: "input" | "output",
    source?: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (project && !pending)
      setMenu({
        x: event.clientX,
        y: event.clientY,
        target,
        source,
        revision: project.revision,
      });
  };
  return (
    <>
      {menu && project?.revision === menu.revision && (
        <EdgeContextMenu
          x={menu.x}
          y={menu.y}
          label={menu.target === "input" ? "入力端子の操作" : "出力端子の操作"}
          color={
            menu.source
              ? table.unionInputs?.find((i) => i.source === menu.source)?.color
              : menu.target === "input"
                ? table.inputColor
                : table.outputColor
          }
          onClose={() => setMenu(null)}
          onColor={(color) =>
            dispatch(
              menu.source
                ? {
                    type: "setUnionEdgeColor",
                    id: table.id,
                    source: menu.source,
                    color,
                  }
                : {
                    type: "setColor",
                    id: table.id,
                    target: menu.target,
                    color,
                  },
            )
          }
        />
      )}
      {table.kind === "union" &&
        (table.unionInputs ?? []).map((input, index) => {
          const title =
            project?.tables.find((t) => t.id === input.source)?.title ??
            input.source;
          return (
            <Handle
              key={input.source}
              type="target"
              position={Position.Left}
              id={unionInputHandle(input.source)}
              isConnectable={false}
              className="table-port union-input-port"
              style={{
                top: unionPortTop(index),
                background: colorValue(input.color),
              }}
              aria-label={`${table.title} 入力${index + 1} ${title} の端子`}
              title={`入力${index + 1}: ${title}（入力を増やすには「＋ 入力」の端子へ接続）`}
              onContextMenu={(e) => openMenu(e, "input", input.source)}
            >
              <span className="union-port-number">{index + 1}</span>
              <span className="port-label union-source-label">{title}</span>
            </Handle>
          );
        })}
      {table.kind !== "input" && (
        <Handle
          type="target"
          position={Position.Left}
          id="in"
          className="table-port table-port-input"
          style={{
            top:
              table.kind === "union"
                ? unionPortTop(table.unionInputs?.length ?? 0)
                : 32,
            background: colorValue(table.inputColor),
          }}
          onContextMenu={(e) => openMenu(e, "input")}
          aria-label={`${table.title} ${table.kind === "union" ? "入力追加端子" : "入力端子"}`}
          title={
            table.kind === "union"
              ? "入力：複数の出力端子から接続できます（接続順に追加）"
              : "入力：出力端子からドラッグして接続（入力から逆向きにも接続できます）"
          }
        >
          <span className="port-label">
            {table.kind === "union" ? "＋ 入力" : "入力"}
          </span>
        </Handle>
      )}
      {table.kind !== "display" && (
        <Handle
          type="source"
          position={Position.Right}
          id="out"
          className="table-port table-port-output"
          style={{ top: 32, background: colorValue(table.outputColor) }}
          onContextMenu={(e) => openMenu(e, "output")}
          aria-label={`${table.title} 出力端子`}
          title="出力：入力端子へドラッグして接続（複数ノードへ分岐できます）"
        >
          <span className="port-label">出力</span>
        </Handle>
      )}
    </>
  );
}
