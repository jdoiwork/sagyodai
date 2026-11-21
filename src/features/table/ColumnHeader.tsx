import { useState } from "react";
import type { TableData } from "../../api/project";
import { useProject } from "../../app/ProjectContext";
import { Cell } from "./Cell";

export function ColumnHeader({
  table,
  col,
}: {
  table: TableData;
  col: number;
}) {
  const { dispatch } = useProject();
  const [editing, setEditing] = useState(false);
  return (
    <div className="column-heading">
      {editing ? (
        <div className="column-name-editor" onBlur={() => setEditing(false)}>
          <Cell
            autoFocus
            value={table.columns[col]}
            label={`${table.title} ${col + 1}列の名前`}
            selected={false}
            onSelect={() => {}}
            onNavigate={() => (document.activeElement as HTMLElement)?.blur()}
            onCommit={(name, original) =>
              dispatch({
                type: "renameColumn",
                id: table.id,
                col,
                name,
                expectedColumns: table.columns.map((value, i) =>
                  i === col ? original : value,
                ),
              })
            }
          />
        </div>
      ) : (
        <span
          className="column-name"
          tabIndex={0}
          role="button"
          aria-label={`${table.title} ${col + 1}列の名前を編集`}
          title="ドラッグで列を移動・ダブルクリックで列名を編集"
          onDoubleClick={() => setEditing(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "F2") {
              e.preventDefault();
              e.stopPropagation();
              setEditing(true);
            }
          }}
        >
          {table.columns[col]}
        </span>
      )}
    </div>
  );
}
