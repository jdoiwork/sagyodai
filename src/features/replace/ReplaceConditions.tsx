import { useEffect, useRef, useState } from "react";
import type { Replacement, TableData } from "../../api/project";
import { useProject } from "../../app/ProjectContext";
import { Icon } from "../../components/Icon";
const empty: Replacement = {
  column: 0,
  regex: false,
  pattern: "",
  replacement: "",
  addColumn: false,
  columnName: "",
};
export function ReplaceConditions({
  table,
  source,
}: {
  table: TableData;
  source?: TableData;
}) {
  const { dispatch, pending } = useProject();
  const saved = table.replacement ?? empty;
  const [draft, setDraft] = useState(saved);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(saved);
  }, [saved]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const error = !draft.pattern
    ? "検索文字列を入力してください。"
    : [draft.pattern, draft.replacement].some(
          (v) => new TextEncoder().encode(v).length > 1000,
        )
      ? "検索・置換文字列は各1000バイト以内にしてください。"
      : source && draft.column >= source.columns.length
        ? "対象列を選び直してください。"
        : draft.addColumn && [...draft.columnName].length > 240
          ? "出力列名は240文字以内にしてください。"
          : draft.addColumn && source && source.columns.length >= 50
            ? "列数の上限（50列）のため、新しい列を追加できません。"
            : "";
  function update(patch: Partial<Replacement>) {
    editing.current = true;
    setDraft({ ...draft, ...patch });
  }
  return (
    <>
      {table.compact && (
        <span className="compact-condition">
          {source?.columns[saved.column] ?? "対象列未設定"} ·{" "}
          {saved.regex ? "正規表現" : "文字列"}置換
          {saved.addColumn ? " · 新しい列" : ""}
          {dirty ? " · 未適用" : ""}
        </span>
      )}
      <form
        className="replace-conditions"
        hidden={table.compact}
        onSubmit={(e) => {
          e.preventDefault();
          if (error || pending) return;
          dispatch(
            { type: "setReplacement", id: table.id, config: draft },
            (ok) => {
              if (ok) editing.current = false;
            },
          );
        }}
      >
        <label>
          対象列
          <select
            aria-label={`${table.title} 置換対象列`}
            value={draft.column}
            onChange={(e) => update({ column: Number(e.target.value) })}
          >
            {!source?.columns.length && (
              <option value={draft.column}>入力を接続してください</option>
            )}
            {source?.columns.map((name, c) => (
              <option key={c} value={c}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          方法
          <select
            aria-label={`${table.title} 置換方法`}
            value={draft.regex ? "regex" : "text"}
            onChange={(e) => update({ regex: e.target.value === "regex" })}
          >
            <option value="text">文字列置換</option>
            <option value="regex">正規表現置換</option>
          </select>
        </label>
        <label>
          検索
          <textarea
            aria-label={`${table.title} 検索文字列`}
            value={draft.pattern}
            onChange={(e) => update({ pattern: e.target.value })}
          />
        </label>
        <label>
          置換後
          <textarea
            aria-label={`${table.title} 置換後の文字列`}
            placeholder="空欄なら削除"
            value={draft.replacement}
            onChange={(e) => update({ replacement: e.target.value })}
          />
        </label>
        <label className="replace-add-column">
          <input
            type="checkbox"
            checked={draft.addColumn}
            onChange={(e) => update({ addColumn: e.target.checked })}
          />
          結果を新しい列に追加
        </label>
        {draft.addColumn && (
          <label>
            列名
            <input
              aria-label={`${table.title} 出力列名`}
              value={draft.columnName}
              placeholder={`置換（${source?.columns[draft.column] ?? "対象列"}）`}
              onChange={(e) => update({ columnName: e.target.value })}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  (e.nativeEvent.isComposing || e.keyCode === 229)
                )
                  e.preventDefault();
              }}
            />
          </label>
        )}
        <p className="sort-hint">
          各セルの一致箇所をすべて置換します。
          {draft.regex
            ? "グループ参照は ${1}・${name}、ドル記号は $$。先読み・後読みは使えません。"
            : "大文字・小文字を区別します。"}
        </p>
        {error && (
          <p role="alert" className="node-error">
            {error}
          </p>
        )}
        {dirty && (
          <span className="condition-dirty">未適用の変更があります</span>
        )}
        <button disabled={!!error || pending > 0} type="submit">
          <Icon name="check" />
          置換を適用
        </button>
      </form>
    </>
  );
}
