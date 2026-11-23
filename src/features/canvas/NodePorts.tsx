import { sheetOf, sourceLabel } from "../sheets/model";
import { unionInputHandle } from "../union/ports";
import { useEffect, useState, type MouseEvent } from "react";
import { useProject } from "../../app/ProjectContext";
import { EdgeContextMenu } from "./EdgeContextMenu";
import { colorValue } from "./colors";
import { Handle, Position, useUpdateNodeInternals } from "@xyflow/react";
import type { TableData } from "../../api/project";

// ノード本体の overflow に隠れない位置に端子とラベルを配置する。
export function NodePorts({ table }: { table: TableData }) {
  const { project, dispatch, pending } = useProject();
  const inputSide = table.inputSide ?? "left";
  const outputSide = table.outputSide ?? "right";
  const positions = {
    left: Position.Left,
    right: Position.Right,
    top: Position.Top,
    bottom: Position.Bottom,
  };
  function placement(input: boolean, index = 0) {
    const side = input ? inputSide : outputSide;
    const same =
      inputSide === outputSide &&
      table.kind !== "input" &&
      table.kind !== "csv" &&
      table.kind !== "http" &&
      table.kind !== "text" &&
      table.kind !== "note";
    const count =
      table.kind === "union" ? (table.unionInputs?.length ?? 0) + 1 : 1;
    const offset =
      input && table.kind === "union"
        ? `${((index + 1) * (same ? 80 : 100)) / (count + 1)}%`
        : same
          ? input
            ? "30%"
            : "85%"
          : side === "left" || side === "right"
            ? 32
            : "50%";
    return side === "top" || side === "bottom"
      ? { left: offset }
      : { top: offset };
  }
  const updateNodeInternals = useUpdateNodeInternals();
  const sourceTable = project?.tables.find((t) => t.id === table.source);
  const externalSource =
    sourceTable && sheetOf(sourceTable) !== sheetOf(table)
      ? sourceLabel(project, sourceTable)
      : null;
  const inputOrder = (table.unionInputs ?? [])
    .map((input) => input.source)
    .join("\0");
  useEffect(() => {
    updateNodeInternals(table.id);
  }, [
    table.id,
    inputOrder,
    inputSide,
    outputSide,
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
          const source = project?.tables.find((t) => t.id === input.source);
          const title = source
            ? sheetOf(source) !== sheetOf(table)
              ? sourceLabel(project, source)
              : source.title
            : input.source;
          return (
            <Handle
              key={input.source}
              type="target"
              position={positions[inputSide]}
              id={unionInputHandle(input.source)}
              isConnectable={false}
              className="table-port union-input-port"
              style={{
                ...placement(true, index),
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
      {table.kind !== "input" &&
        table.kind !== "csv" &&
        table.kind !== "http" &&
        table.kind !== "text" &&
        table.kind !== "note" && (
          <Handle
            type="target"
            position={positions[inputSide]}
            id="in"
            className="table-port table-port-input"
            style={{
              ...placement(true, table.unionInputs?.length ?? 0),
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
            <span
              className={
                externalSource ? "port-label union-source-label" : "port-label"
              }
              title={externalSource ?? undefined}
            >
              {table.kind === "union" ? "＋ 入力" : (externalSource ?? "入力")}
            </span>
          </Handle>
        )}
      {
        <Handle
          type="source"
          position={positions[outputSide]}
          id="out"
          className="table-port table-port-output"
          style={{
            ...placement(false),
            background: colorValue(table.outputColor),
          }}
          onContextMenu={(e) => openMenu(e, "output")}
          aria-label={`${table.title} 出力端子`}
          title="出力：入力端子へドラッグして接続（複数ノードへ分岐できます）"
        >
          <span className="port-label">出力</span>
        </Handle>
      }
    </>
  );
}
