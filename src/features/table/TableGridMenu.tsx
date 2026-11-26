import type { Dispatch, SetStateAction } from "react";
import type { TableData } from "../../api/project";
import { useProject } from "../../app/ProjectContext";
import { TableContextMenu } from "./TableContextMenu";
import type { useHeaderSelection } from "./useHeaderSelection";

export type TableGridMenuState = {
  x: number;
  y: number;
  index: number;
  indices: number[];
  kind: "row" | "column";
  preview?: boolean;
  columns: string[];
  rows: string[][];
};

export function TableGridMenu({
  table,
  readOnly,
  menu: contextMenu,
  onChange: setContextMenu,
  onInserting,
}: {
  table: TableData;
  readOnly: boolean;
  menu: TableGridMenuState;
  onChange: Dispatch<SetStateAction<TableGridMenuState | null>>;
  onInserting: ReturnType<typeof useHeaderSelection>["inserting"];
}) {
  const { dispatch } = useProject();
  function deleteSelection() {
    const { index, indices, kind, rows, columns } = contextMenu;
    if (readOnly) {
      dispatch({
        type: "hideOutputColumn",
        id: table.id,
        col: index,
        expectedColumns: columns,
      });
      return;
    }
    if (kind === "row") {
      dispatch(
        indices.length > 1
          ? { type: "removeRows", id: table.id, indices, expectedRows: rows }
          : { type: "removeRow", id: table.id, row: index, expectedRows: rows },
      );
      return;
    }
    dispatch(
      indices.length > 1
        ? {
            type: "removeColumns",
            id: table.id,
            indices,
            expectedRows: rows,
            expectedColumns: columns,
          }
        : {
            type: "removeColumn",
            id: table.id,
            col: index,
            expectedRows: rows,
            expectedColumns: columns,
          },
    );
  }
  return (
    <TableContextMenu
      {...contextMenu}
      hideOnly={readOnly}
      hiddenColumns={table.projection?.columns
        .filter((c) => !c.visible)
        .map((c) => {
          const config = table.projection!;
          const name = c.name.trim() || config.schema[c.column];
          const duplicate = config.columns.some(
            (other) =>
              other.visible &&
              (other.name.trim() || config.schema[other.column]) === name,
          );
          return {
            column: c.column,
            name,
            disabled: table.stale || !!table.error || duplicate,
            reason: duplicate
              ? "同名の出力列があります。出力列の設定で名前を変更してください。"
              : table.stale || table.error
                ? "結果を更新してから再表示してください。"
                : undefined,
          };
        })}
      onShow={(column) => {
        const config = table.projection;
        if (!config) return;
        dispatch({
          type: "setProjection",
          id: table.id,
          config: {
            ...config,
            columns: config.columns.map((c) =>
              c.column === column ? { ...c, visible: true } : c,
            ),
          },
        });
      }}
      count={contextMenu.indices.length}
      insertDisabled={
        contextMenu.kind === "row"
          ? contextMenu.rows.length + contextMenu.indices.length > 5000
          : contextMenu.columns.length + contextMenu.indices.length > 50
      }
      onInsert={(after) => {
        const at = after
          ? Math.max(...contextMenu.indices) + 1
          : Math.min(...contextMenu.indices);
        const count = contextMenu.indices.length;
        const settled = onInserting(contextMenu.kind, at, count, {
          ...table,
          columns: contextMenu.columns,
          rows: contextMenu.rows,
        });
        dispatch(
          {
            type: contextMenu.kind === "row" ? "insertRows" : "insertColumns",
            id: table.id,
            at,
            count,
            expectedColumns: contextMenu.columns,
            expectedRows: contextMenu.rows,
          },
          settled,
        );
      }}
      targetLabel={
        contextMenu.indices.length > 1
          ? `選択した${contextMenu.indices.length}${contextMenu.kind === "row" ? "行" : "列"}`
          : contextMenu.kind === "row"
            ? `行${contextMenu.index + 1} `
            : `「${contextMenu.columns[contextMenu.index]}」列`
      }
      disabled={
        (readOnly && (table.stale || !!table.error)) ||
        (contextMenu.kind === "row"
          ? contextMenu.rows.length
          : contextMenu.columns.length) <= contextMenu.indices.length
      }
      onPreview={(preview) =>
        setContextMenu((menu) => (menu ? { ...menu, preview } : null))
      }
      onClose={() => setContextMenu(null)}
      onDelete={deleteSelection}
    />
  );
}
