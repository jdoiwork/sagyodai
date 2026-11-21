import { nodeTitleError } from "./nodeTitleValidation";
import { useId, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import type { TableData } from "../../api/project";
import { useProject } from "../../app/ProjectContext";

export function NodeTitle({ table }: { table: TableData }) {
  const { dispatch } = useProject();
  const [error, setError] = useState("");
  const errorId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(table.title);
  const original = useRef(table.title);
  const cancelled = useRef(false);
  const composing = useRef(false);
  const endedAt = useRef(-Infinity);
  function start() {
    original.current = table.title;
    cancelled.current = false;
    setError("");
    setDraft(table.title);
    setEditing(true);
  }
  return (
    <div className="node-title">
      {editing ? (
        <div className="node-title-editor">
          <input
            autoFocus
            className="node-title-input nodrag nopan"
            aria-label="ノードタイトル"
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            data-committed-value={original.current}
            value={draft}
            onFocus={(e) => e.target.select()}
            onChange={(e) => {
              setError("");
              setDraft(e.target.value);
            }}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
              endedAt.current = performance.now();
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (
                composing.current ||
                e.nativeEvent.isComposing ||
                e.keyCode === 229 ||
                performance.now() - endedAt.current < 60
              )
                return;
              if (e.key === "Escape") {
                cancelled.current = true;
                e.preventDefault();
                e.currentTarget.blur();
              }
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            onBlur={() => {
              if (!cancelled.current) {
                const message = nodeTitleError(draft);
                if (message) {
                  setError(message);
                  return;
                }
              }
              setError("");
              setEditing(false);
              if (!cancelled.current && draft !== original.current)
                dispatch({
                  type: "rename",
                  id: table.id,
                  title: draft,
                  expectedTitle: original.current,
                });
            }}
          />
          {error && (
            <span id={errorId} className="node-title-error" role="alert">
              {error}
            </span>
          )}
        </div>
      ) : (
        <>
          <h2 title={table.title} onDoubleClick={start}>
            {table.title}
          </h2>
          <button
            className="title-edit nodrag nopan"
            aria-label={`${table.title} のタイトルを編集`}
            title="タイトルを編集"
            onClick={start}
          >
            <Icon name="edit" />
          </button>
        </>
      )}
    </div>
  );
}
