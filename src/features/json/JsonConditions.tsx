import { useEffect, useRef, useState } from "react";
import type { TableData } from "../../api/project";
import { useProject } from "../../app/ProjectContext";
import { Icon } from "../../components/Icon";
export function JsonConditions({ table }: { table: TableData }) {
  const { dispatch, pending } = useProject();
  const saved = table.jsonKey ?? "";
  const [key, setKey] = useState(saved);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setKey(saved);
  }, [saved]);
  const dirty = key !== saved;
  const error =
    new TextEncoder().encode(key).length > 1024
      ? "キー名は1024バイト以内にしてください。"
      : "";
  if (table.kind === "jsonTable")
    return (
      <p className={table.compact ? "compact-condition" : "sort-hint"}>
        JSON配列 → 表
        {!table.compact && " · オブジェクトのキーが列、各要素が行になります。"}
      </p>
    );
  return (
    <>
      {table.compact && (
        <span className="compact-condition">
          キー: {JSON.stringify(saved)}
          {dirty && " · 未適用"}
        </span>
      )}
      <form
        className="replace-conditions"
        hidden={table.compact}
        onSubmit={(e) => {
          e.preventDefault();
          if (error || pending) return;
          dispatch({ type: "setJsonKey", id: table.id, key }, (ok) => {
            if (ok) editing.current = false;
          });
        }}
      >
        <label>
          キー名
          <input
            aria-label={`${table.title} キー名`}
            aria-invalid={!!error}
            value={key}
            placeholder="chapters"
            onChange={(e) => {
              editing.current = true;
              setKey(e.target.value);
            }}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                (e.nativeEvent.isComposing || e.keyCode === 229)
              )
                e.preventDefault();
            }}
          />
        </label>
        <p className="sort-hint">
          直下のキー名をそのまま指定します。入れ子は抽出ノードをつないで取り出せます。
        </p>
        {error && (
          <p className="node-error" role="alert">
            {error}
          </p>
        )}
        {dirty && (
          <span className="condition-dirty">未適用の変更があります</span>
        )}
        <button type="submit" disabled={!!error || pending > 0}>
          <Icon name="check" />
          キーを適用
        </button>
      </form>
    </>
  );
}
