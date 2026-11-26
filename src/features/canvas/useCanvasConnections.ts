import { acceptsInput } from "./nodeCapabilities";
import { useCallback, useRef, useState } from "react";
import type { ReactFlowProps } from "@xyflow/react";
import type { Command, Snapshot, TableData } from "../../api/project";
import { createsCycle } from "../../validation/input";
import { unionInputHandle } from "../union/ports";
import { colorValue } from "./colors";

export function useCanvasConnections(
  project: Snapshot | null,
  dispatch: (command: Command) => void,
  pending: number,
  visibleTables: TableData[],
  visibleIds: Set<string>,
) {
  const [edgeMenu, setEdgeMenu] = useState<{
    x: number;
    y: number;
    target: string;
    source: string;
    revision: number;
  } | null>(null);
  const connectionFromInput = useRef(false);
  const [connectionColor, setConnectionColor] = useState<string>();

  const closeEdgeMenu = useCallback(() => setEdgeMenu(null), []);

  const flowProps = {
    onEdgeContextMenu: (event, edge) => {
      event.preventDefault();
      event.stopPropagation();
      if (project && !pending)
        setEdgeMenu({
          x: event.clientX,
          y: event.clientY,
          target: edge.target,
          source: edge.source,
          revision: project.revision,
        });
    },
    onMoveStart: () => setEdgeMenu(null),
    onConnectStart: (_, params) => {
      connectionFromInput.current = params.handleType === "target";
      const table = project?.tables.find((table) => table.id === params.nodeId);
      setConnectionColor(
        colorValue(
          connectionFromInput.current ? table?.inputColor : table?.outputColor,
        ),
      );
    },
    onConnectEnd: () => setConnectionColor(undefined),
    connectionLineStyle: {
      stroke: connectionColor ?? "#396b5b",
      strokeWidth: 2.5,
    },
    onReconnect: (edge, connection) =>
      dispatch({
        type: "connect",
        id: edge.target,
        source: connection.source,
      }),
    edges: visibleTables.flatMap((table) => {
      const inputs =
        table.kind === "union"
          ? (table.unionInputs ?? [])
          : table.source
            ? [{ source: table.source, color: table.edgeColor }]
            : [];
      return inputs
        .filter((input) => visibleIds.has(input.source))
        .map((input) => ({
          id: `edge-${table.id}-${input.source}`,
          source: input.source,
          target: table.id,
          sourceHandle: "out",
          targetHandle:
            table.kind === "union" ? unionInputHandle(input.source) : "in",
          type: "smoothstep",
          reconnectable:
            table.kind === "union" ? (false as const) : ("source" as const),
          style: {
            stroke:
              colorValue(input.color) ?? (table.stale ? "#bd9147" : "#386e61"),
            strokeDasharray: table.stale ? "6 4" : undefined,
            strokeWidth: 2.5,
          },
        }));
    }),
    isValidConnection: (connection) => {
      if (!project) return false;
      const source = project.tables.find(
        (table) => table.id === connection.source,
      );
      const target = project.tables.find(
        (table) => table.id === connection.target,
      );
      if (!source || !target) return false;
      if (!acceptsInput(target.kind)) return false;
      // 結合ノードの既存端子には重ねて接続せず、追加用の入力端子だけを使う。
      if (target.kind === "union" && connection.targetHandle !== "in")
        return false;
      return !createsCycle(
        project.tables,
        connection.target,
        connection.source,
      );
    },
    onConnect: (connection) =>
      dispatch({
        type: "connectFromPort",
        id: connection.target,
        source: connection.source,
        fromInput: connectionFromInput.current,
      }),
  } satisfies Pick<
    ReactFlowProps,
    | "onEdgeContextMenu"
    | "onMoveStart"
    | "onConnectStart"
    | "onConnectEnd"
    | "connectionLineStyle"
    | "onReconnect"
    | "edges"
    | "isValidConnection"
    | "onConnect"
  >;
  return { flowProps, edgeMenu, closeEdgeMenu };
}
