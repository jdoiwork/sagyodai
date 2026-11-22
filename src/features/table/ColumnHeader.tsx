import { columnNameError } from "./columnName";
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
  const [error, setError] = useState("");
  function validate(name: string) {
    if (table.kind !== "display") return columnNameError(name);
    if (!name.trim()) return "列名を入力してください。";
    if ([...name].length > 240) return "出力列名は240文字以内にしてください。";
    if (table.columns.some((value, i) => i !== col && value === name.trim()))
      return "出力列名が重複しています。別の名前を指定してください。";
    return "";
  }
  return (
    <div className="column-heading">
      {editing ? (
        <div
          className="column-name-editor"
          onChangeCapture={() => setError("")}
          onBlur={(event) => {
            if (!(event.target instanceof HTMLTextAreaElement)) return;
            const message = validate(event.target.value);
            setError(message);
            if (!message) setEditing(false);
          }}
        >
          <Cell
            autoFocus
            value={table.columns[col]}
            label={`${table.title} ${col + 1}列の名前`}
            selected={false}
            onSelect={() => {}}
            onNavigate={() => (document.activeElement as HTMLElement)?.blur()}
            onCommit={(name, original) => {
              if (validate(name)) return;
              dispatch({
                type: "renameColumn",
                id: table.id,
                col,
                name,
                expectedColumns: table.columns.map((value, i) =>
                  i === col ? original : value,
                ),
              });
            }}
          />
          {error && (
            <span className="column-name-error" role="alert">
              {error}
            </span>
          )}
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
