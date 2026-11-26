import { swapItems } from "../../collections/reorder";
import { useEffect, useRef, useState } from "react";
import type { SortKey, TableData } from "../../api/project";
import { useProject } from "../../app/ProjectContext";
import { Icon } from "../../components/Icon";
const empty: SortKey[] = [];
export function SortConditions({
  table,
  source,
}: {
  table: TableData;
  source?: TableData;
}) {
  const { dispatch } = useProject();
  const saved = table.sortKeys ?? empty;
  const [keys, setKeys] = useState(saved);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setKeys(saved);
  }, [saved]);
  const dirty = JSON.stringify(keys) !== JSON.stringify(saved);
  const error =
    source && keys.some((k) => k.column >= source.columns.length)
      ? "対象列を選び直してください。"
      : "";
  function update(next: SortKey[]) {
    editing.current = true;
    setKeys(next);
  }
  function move(i: number, delta: number) {
    update(swapItems(keys, i, i + delta));
  }
  const available =
    source?.columns.findIndex((_, c) => !keys.some((k) => k.column === c)) ??
    -1;
  return (
    <>
      {table.compact && (
        <span
          className="compact-condition"
          title={saved
            .map(
              (k) =>
                `${source?.columns[k.column] ?? `列${k.column + 1}`} ${k.direction === "asc" ? "↑" : "↓"} ${k.mode === "number" ? "数値" : "テキスト"}`,
            )
            .join(" → ")}
        >
          {saved.length
            ? saved
                .map(
                  (k) =>
                    `${source?.columns[k.column] ?? `列${k.column + 1}`} ${k.direction === "asc" ? "↑" : "↓"}`,
                )
                .join(" → ")
            : "入力順を維持"}
          {dirty ? " · 未適用" : ""}
        </span>
      )}
      <form
        hidden={table.compact}
        onSubmit={(e) => {
          e.preventDefault();
          if (error) return;
          editing.current = false;
          dispatch({ type: "setSort", id: table.id, keys });
        }}
      >
        <div className="sort-key-list">
          {keys.map((key, i) => (
            <div className="sort-key-row" key={i}>
              <span>{i + 1}</span>
              <select
                aria-label={`${table.title} ソート列 ${i + 1}`}
                value={key.column}
                onChange={(e) =>
                  update(
                    keys.map((k, n) =>
                      n === i ? { ...k, column: Number(e.target.value) } : k,
                    ),
                  )
                }
              >
                {!source?.columns.length && (
                  <option value={key.column}>入力を接続してください</option>
                )}
                {source?.columns.map((name, c) => (
                  <option
                    key={c}
                    value={c}
                    disabled={keys.some((k, n) => n !== i && k.column === c)}
                  >
                    {name}
                  </option>
                ))}
              </select>
              <select
                aria-label={`${table.title} 順序 ${i + 1}`}
                value={key.direction}
                onChange={(e) =>
                  update(
                    keys.map((k, n) =>
                      n === i
                        ? {
                            ...k,
                            direction: e.target.value as SortKey["direction"],
                          }
                        : k,
                    ),
                  )
                }
              >
                <option value="asc">昇順</option>
                <option value="desc">降順</option>
              </select>
              <select
                aria-label={`${table.title} 比較方法 ${i + 1}`}
                disabled={
                  !!source?.columnSchema?.[key.column] &&
                  source.columnSchema[key.column].config.dataType !== "string"
                }
                value={
                  source?.columnSchema?.[key.column] &&
                  source.columnSchema[key.column].config.dataType !== "string"
                    ? "typed"
                    : key.mode
                }
                onChange={(e) =>
                  update(
                    keys.map((k, n) =>
                      n === i
                        ? { ...k, mode: e.target.value as SortKey["mode"] }
                        : k,
                    ),
                  )
                }
              >
                {source?.columnSchema?.[key.column] &&
                  source.columnSchema[key.column].config.dataType !==
                    "string" && <option value="typed">列の型で比較</option>}
                <option value="text">テキスト</option>
                <option value="number">数値</option>
              </select>
              <button
                type="button"
                aria-label={`${i + 1}番目の優先順位を上げる`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`${i + 1}番目の優先順位を下げる`}
                disabled={i === keys.length - 1}
                onClick={() => move(i, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                aria-label={`${i + 1}番目のソート列を削除`}
                onClick={() => update(keys.filter((_, n) => n !== i))}
              >
                <Icon name="trash" />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          disabled={available < 0}
          onClick={() =>
            update([
              ...keys,
              { column: available, direction: "asc", mode: "text" },
            ])
          }
        >
          <Icon name="plus" />
          ソート列を追加
        </button>
        <p className="sort-hint">
          上の列ほど優先 · 空欄・数値として読めない値は末尾
        </p>
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        <div className="condition-actions">
          <span className="condition-draft-status" role="status">
            {dirty ? "未適用の変更あり" : ""}
          </span>
          <button
            type="submit"
            disabled={!!error}
            className={dirty ? "action-pending" : "action-accent"}
          >
            <Icon name="check" />
            条件を適用
          </button>
        </div>
      </form>
    </>
  );
}
