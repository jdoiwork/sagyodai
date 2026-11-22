import { useState } from "react";
import { useProject } from "../../app/ProjectContext";
import { Icon } from "../../components/Icon";
import { sheetsOf } from "./model";
import { nodeTitleError } from "../canvas/nodeTitleValidation";

export function SheetBar({
  active,
  onSelect,
}: {
  active: string;
  onSelect: (id: string) => void;
}) {
  const { project, dispatch, pending } = useProject();
  const sheets = sheetsOf(project);
  const [editing, setEditing] = useState<{
    id: string;
    original: string;
    value: string;
  } | null>(null);
  const error = editing ? nodeTitleError(editing.value) : "";
  return (
    <nav className="sheet-bar" aria-label="シート">
      <div
        className="sheet-tabs"
        role="tablist"
        aria-label="キャンバスのシート"
      >
        {sheets.map((sheet) => (
          <button
            key={sheet.id}
            role="tab"
            aria-selected={active === sheet.id}
            onClick={() => onSelect(sheet.id)}
            onDoubleClick={() =>
              setEditing({
                id: sheet.id,
                original: sheet.title,
                value: sheet.title,
              })
            }
            title="ダブルクリックでシート名を編集"
          >
            {sheet.title}
          </button>
        ))}
      </div>
      <button
        disabled={!project || pending > 0 || sheets.length >= 20}
        aria-label="シートを追加"
        onClick={() => {
          const ids = new Set(sheets.map((s) => s.id));
          dispatch({ type: "addSheet" }, (ok, next) => {
            const added = next?.sheets?.find((s) => !ids.has(s.id));
            if (ok && added) onSelect(added.id);
          });
        }}
      >
        <Icon name="plus" />
        シート
      </button>
      {editing && (
        <form
          className="sheet-rename"
          onSubmit={(e) => {
            e.preventDefault();
            if (error || pending) return;
            dispatch(
              {
                type: "renameSheet",
                id: editing.id,
                title: editing.value.trim(),
                expectedTitle: editing.original,
              },
              (ok) => {
                if (ok) setEditing(null);
              },
            );
          }}
        >
          <input
            autoFocus
            aria-label="シート名"
            aria-invalid={!!error}
            value={editing.value}
            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(null);
              if (e.key === "Enter" && e.nativeEvent.isComposing)
                e.preventDefault();
            }}
          />
          <button disabled={!!error || pending > 0}>適用</button>
          <button type="button" onClick={() => setEditing(null)}>
            キャンセル
          </button>
          {error && (
            <span role="alert">{error.replace("タイトル", "シート名")}</span>
          )}
        </form>
      )}
    </nav>
  );
}
