import { useEffect, useRef, useState } from "react";
import type { FilterConfig, TableData } from "../../api/project";
import { useProject } from "../../app/ProjectContext";
const operators: [FilterConfig["operator"], string][] = [
  ["equals", "文字列が一致"],
  ["notEquals", "文字列が不一致"],
  ["contains", "文字列を含む"],
  ["greater", "数値 >"],
  ["atLeast", "数値 ≥"],
  ["less", "数値 <"],
  ["atMost", "数値 ≤"],
];
export function NodeSettings({ table }: { table: TableData }) {
  const { project, dispatch } = useProject();
  const [draft, setDraft] = useState(table.filter);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(table.filter);
  }, [table.filter]);
  const source = project?.tables.find((t) => t.id === table.source);
  return (
    <div className="node-settings nodrag nopan nowheel">
      <label>
        入力元
        <select
          aria-label={`${table.title} 入力元`}
          value={table.source ?? ""}
          onChange={(e) =>
            dispatch({
              type: "connect",
              id: table.id,
              source: e.target.value || null,
            })
          }
        >
          <option value="">未接続</option>
          {project?.tables
            .filter((t) => t.id !== table.id && t.kind !== "display")
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
        </select>
      </label>
      {table.kind === "filter" && draft && (
        <form
          onFocusCapture={() => {
            editing.current = true;
          }}
          onSubmit={(e) => {
            e.preventDefault();
            editing.current = false;
            dispatch({
              type: "configure",
              id: table.id,
              filter: draft,
              manual: table.manual,
            });
          }}
        >
          <div className="condition-fields">
            <select
              aria-label={`${table.title} 対象列`}
              value={draft.column}
              onChange={(e) =>
                setDraft({ ...draft, column: Number(e.target.value) })
              }
            >
              {!source?.columns.length && (
                <option value={draft.column}>入力を接続してください</option>
              )}
              {source?.columns.map((name, i) => (
                <option key={i} value={i}>
                  {name}
                </option>
              ))}
            </select>
            <select
              aria-label={`${table.title} 比較方法`}
              value={draft.operator}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  operator: e.target.value as FilterConfig["operator"],
                })
              }
            >
              {operators.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <input
            aria-label={`${table.title} 比較値`}
            placeholder="比較する値"
            value={draft.value}
            onChange={(e) => setDraft({ ...draft, value: e.target.value })}
          />
          <button type="submit">条件を適用</button>
        </form>
      )}
      <div className="execution-controls">
        <label>
          <input
            type="checkbox"
            checked={table.manual}
            onChange={(e) =>
              dispatch({
                type: "configure",
                id: table.id,
                filter: table.filter,
                manual: e.target.checked,
              })
            }
          />
          手動更新
        </label>
        <button onClick={() => dispatch({ type: "run", id: table.id })}>
          今すぐ更新
        </button>
        <button
          title="このノードを削除（Undo で戻せます）"
          onClick={() => dispatch({ type: "removeNode", id: table.id })}
        >
          削除
        </button>
      </div>
      <div
        className={table.stale ? "node-status stale" : "node-status"}
        role="status"
      >
        {table.error ??
          (table.stale
            ? "更新待ち — 前回の結果を保持"
            : `${table.rows.length} 件 · ${table.manual ? "手動" : "自動"}`)}
      </div>
    </div>
  );
}
