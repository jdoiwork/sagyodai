import { useEffect, useRef, useState } from "react";
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
  const [menu, setMenu] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const target = sheets.find((s) => s.id === menu);
  const removed =
    project?.tables?.filter((t) => (t.sheetId ?? "sheet-1") === menu) ?? [];
  useEffect(() => {
    if (!menu) return;
    function close(e: PointerEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null);
    }
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") setMenu(null);
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
    };
  }, [menu]);
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
            draggable={!!project && !pending && !editing}
            className={
              drop?.id === sheet.id
                ? drop.after
                  ? "sheet-drop-after"
                  : "sheet-drop-before"
                : ""
            }
            onDragStart={(e) => {
              setDragging(sheet.id);
              setMenu(null);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", sheet.id);
            }}
            onDragOver={(e) => {
              if (!dragging || dragging === sheet.id) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              const rect = e.currentTarget.getBoundingClientRect();
              setDrop({
                id: sheet.id,
                after: e.clientX > rect.left + rect.width / 2,
              });
              e.currentTarget.scrollIntoView?.({
                block: "nearest",
                inline: "nearest",
              });
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (
                dragging &&
                drop?.id === sheet.id &&
                dragging !== sheet.id &&
                !pending
              )
                dispatch({
                  type: "moveSheet",
                  id: dragging,
                  target: sheet.id,
                  after: drop.after,
                });
              setDragging(null);
              setDrop(null);
            }}
            onDragEnd={() => {
              setDragging(null);
              setDrop(null);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(sheet.id);
              setEditing(null);
            }}

            aria-selected={active === sheet.id}
            onClick={() => onSelect(sheet.id)}
            onDoubleClick={() =>
              setEditing({
                id: sheet.id,
                original: sheet.title,
                value: sheet.title,
              })
            }
            title="ドラッグで並べ替え・右クリックで削除・ダブルクリックで名前を編集"
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
      {target && (
        <div
          className="sheet-rename sheet-delete"
          ref={menuRef}
          role="dialog"
          aria-label="シートの削除"
        >
          <strong>「{target.title}」を削除</strong>
          <p>
            {removed.length}
            個のノードと、その接続も削除します。元に戻すで復元できます。
          </p>
          {sheets.length === 1 && <p>最後のシートは削除できません。</p>}
          <button
            disabled={sheets.length === 1 || pending > 0}
            onClick={() => {
              const index = sheets.findIndex((s) => s.id === target.id);
              const nextId = sheets[index + 1]?.id ?? sheets[index - 1]?.id;
              dispatch(
                {
                  type: "removeSheet",
                  id: target.id,
                  expectedNodes: removed.map((t) => t.id),
                },
                (ok) => {
                  if (ok) {
                    setMenu(null);
                    if (active === target.id && nextId) onSelect(nextId);
                  }
                },
              );
            }}
          >
            <Icon name="trash" />
            シートを削除
          </button>
          <button onClick={() => setMenu(null)}>キャンセル</button>
        </div>
      )}
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
