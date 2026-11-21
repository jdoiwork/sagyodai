import { useCallback, useEffect, useRef } from "react";
import { useNodesState } from "@xyflow/react";
import type { Command, Snapshot } from "../../api/project";
import {
  reconcileNodes,
  sameLayout,
  type Layout,
  type TableFlowNode,
} from "./layout";

export function useCanvasNodes(
  project: Snapshot | null,
  dispatch: (command: Command) => void,
) {
  const [nodes, setNodes, onNodesChange] = useNodesState<TableFlowNode>([]);
  const active = useRef(new Set<string>());
  const pending = useRef(new Map<string, Layout>());
  const begin = useCallback((id: string) => {
    active.current.add(id);
  }, []);
  const finish = useCallback(
    (id: string, layout: Layout) => {
      active.current.delete(id);
      pending.current.set(id, layout);
      setNodes((old) =>
        old.map((node) =>
          node.id === id
            ? {
                ...node,
                position: { x: layout.x, y: layout.y },
                style: {
                  ...node.style,
                  width: layout.width,
                  height: layout.height,
                },
              }
            : node,
        ),
      );
      dispatch({ type: "place", id, ...layout });
    },
    [dispatch, setNodes],
  );
  useEffect(() => {
    if (!project) return;
    for (const table of project.tables) {
      const layout = pending.current.get(table.id);
      if (layout && sameLayout(layout, table)) pending.current.delete(table.id);
    }
    const editing = new Set(active.current),
      waiting = new Map(pending.current);
    setNodes((old) =>
      reconcileNodes(project.tables, old, editing, waiting, begin, finish),
    );
  }, [project, setNodes, begin, finish]);
  return { nodes, onNodesChange, begin, finish };
}
