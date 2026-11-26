import { useProject } from "../../app/ProjectContext";
import { EdgeContextMenu } from "./EdgeContextMenu";
import type { useCanvasConnections } from "./useCanvasConnections";

export function CanvasEdgeMenu({
  menu: edgeMenu,
  onClose,
}: {
  menu: ReturnType<typeof useCanvasConnections>["edgeMenu"];
  onClose: () => void;
}) {
  const { project, dispatch } = useProject();
  if (!edgeMenu || project?.revision !== edgeMenu.revision) return null;
  const target = project.tables.find((table) => table.id === edgeMenu.target);
  if (
    !target ||
    !(
      target.source === edgeMenu.source ||
      target.unionInputs?.some((input) => input.source === edgeMenu.source)
    )
  )
    return null;
  return (
    <EdgeContextMenu
      x={edgeMenu.x}
      y={edgeMenu.y}
      color={
        target.unionInputs?.find((i) => i.source === edgeMenu.source)?.color ??
        target.edgeColor
      }
      onColor={(color) =>
        dispatch(
          target.kind === "union"
            ? {
                type: "setUnionEdgeColor",
                id: edgeMenu.target,
                source: edgeMenu.source,
                color,
              }
            : {
                type: "setColor",
                id: edgeMenu.target,
                target: "edge",
                color,
              },
        )
      }
      onClose={onClose}
      onDisconnect={() => {
        if (target.kind === "union") {
          const sources = (target.unionInputs ?? []).map((i) => i.source);
          dispatch({
            type: "setUnion",
            id: target.id,
            sources: sources.filter((s) => s !== edgeMenu.source),
            expectedSources: sources,
            distinct: !!target.unionDistinct,
          });
        } else dispatch({ type: "connect", id: target.id, source: null });
      }}
    />
  );
}
