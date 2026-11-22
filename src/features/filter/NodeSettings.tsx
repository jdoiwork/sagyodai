import { OutputColumns } from "../projection/OutputColumns";
import { GroupConditions } from "../group/GroupConditions";
import { SortConditions } from "../sort/SortConditions";
import { InValues } from "./InValues";
import { sourceLabel } from "../sheets/model";
import { filterInputError, createsCycle } from "../../validation/input";
import { Icon } from "../../components/Icon";
import { useEffect, useRef, useState } from "react";
import type { FilterConfig, TableData } from "../../api/project";
import { useProject } from "../../app/ProjectContext";
const operators: [FilterConfig["operator"], string][] = [
  ["equals", "文字列が一致"],
  ["in", "いずれかに一致（IN）"],
  ["notIn", "いずれにも一致しない（NOT IN）"],
  ["notEquals", "文字列が不一致"],
  ["contains", "文字列を含む"],
  ["numberEquals", "数値 ="],
  ["numberNotEquals", "数値 !="],
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
  const inputError = draft
    ? filterInputError(draft) ||
      (source && draft.column >= source.columns.length
        ? "対象列を選び直してください。"
        : "")
    : "";
  const hasUnappliedChanges =
    draft != null &&
    (draft.column !== table.filter?.column ||
      draft.operator !== table.filter?.operator ||
      draft.value !== table.filter?.value ||
      JSON.stringify(draft.values ?? []) !==
        JSON.stringify(table.filter?.values ?? []));
  return (
    <div
      className={`node-settings nodrag nopan${table.kind === "display" && !table.compact ? " display-settings" : ""}${table.kind === "filter" || table.kind === "sort" || table.kind === "aggregate" || table.compact ? "" : " nowheel"}${table.compact ? " node-settings-compact" : ""}`}
    >
      {table.compact && table.kind === "display" && (
        <div className="compact-condition">
          {table.columns.length} 列 · 読み取り専用
        </div>
      )}
      {table.compact && table.filter && (
        <div className="compact-condition" title="適用済みの条件">
          {source?.columns[table.filter.column] ??
            `列 ${table.filter.column + 1}`}{" "}
          {operators.find(([op]) => op === table.filter?.operator)?.[1]}{" "}
          {JSON.stringify(
            table.filter.operator === "in" || table.filter.operator === "notIn"
              ? (table.filter.values ?? [])
              : table.filter.value,
          )}
        </div>
      )}
      <label hidden={table.compact}>
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
            .filter((t) => t.id !== table.id)
            .map((t) => (
              <option
                key={t.id}
                value={t.id}
                disabled={createsCycle(project!.tables, table.id, t.id)}
              >
                {sourceLabel(project, t)}
                {createsCycle(project!.tables, table.id, t.id)
                  ? "（循環するため接続不可）"
                  : ""}
              </option>
            ))}
        </select>
      </label>
      {table.kind === "display" && (
        <OutputColumns table={table} source={source} />
      )}
      {table.kind === "aggregate" && (
        <GroupConditions table={table} source={source} />
      )}
      {table.kind === "sort" && (
        <SortConditions table={table} source={source} />
      )}
      {table.kind === "filter" && draft && (
        <form
          hidden={table.compact}
          onFocusCapture={() => {
            editing.current = true;
          }}
          onSubmit={(e) => {
            e.preventDefault();
            if (inputError) return;
            editing.current = false;
            dispatch({
              type: "configure",
              id: table.id,
              filter: draft,
              manual: table.manual,
            });
          }}
        >
          <div
            className={`condition-fields${draft.operator === "in" || draft.operator === "notIn" ? " condition-fields-in" : ""}`}
          >
            <select
              aria-label={`${table.title} 対象列`}
              value={draft.column}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  column: Number(e.target.value),
                  ...(draft.operator === "in" || draft.operator === "notIn"
                    ? { values: [] }
                    : {}),
                })
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
            {draft.operator !== "in" && draft.operator !== "notIn" && (
              <input
                aria-label={`${table.title} 比較値`}
                aria-invalid={!!inputError}
                title={inputError || undefined}
                placeholder="比較する値"
                value={draft.value}
                onChange={(e) => setDraft({ ...draft, value: e.target.value })}
              />
            )}
          </div>
          {(draft.operator === "in" || draft.operator === "notIn") && (
            <InValues
              exclude={draft.operator === "notIn"}
              label={table.title}
              values={source?.rows?.map((row) => row[draft.column] ?? "") ?? []}
              selected={draft.values ?? []}
              onChange={(values) => setDraft({ ...draft, values })}
            />
          )}
          {inputError && (
            <div className="inline-error" role="alert">
              {inputError}
            </div>
          )}
          <div className="condition-actions">
            <span className="condition-draft-status" role="status">
              {hasUnappliedChanges ? "未適用の変更あり" : ""}
            </span>
            <button
              type="submit"
              disabled={!!inputError}
              className={
                hasUnappliedChanges ? "action-pending" : "action-accent"
              }
            >
              <Icon name="check" />
              条件を適用
            </button>
          </div>
        </form>
      )}
      {table.compact && hasUnappliedChanges && (
        <div
          className="condition-draft-status"
          role="status"
          title="未適用の変更あり — 展開して適用"
        >
          未適用
        </div>
      )}
      <div className="execution-controls" hidden={table.compact}>
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
          <Icon name="refresh" />
          今すぐ更新
        </button>
        <button
          disabled={project?.tables.length === 1}
          className="action-danger"
          title="このノードを削除（Undo で戻せます）"
          onClick={() => dispatch({ type: "removeNode", id: table.id })}
        >
          <Icon name="trash" />
          削除
        </button>
      </div>
      <div
        className={table.stale ? "node-status stale" : "node-status"}
        role="status"
        title={
          table.error ??
          (table.stale ? "更新待ち — 前回の結果を保持" : undefined)
        }
      >
        {table.error ??
          (table.stale
            ? "更新待ち — 前回の結果を保持"
            : `${table.rows.length} 件 · ${table.manual ? "手動" : "自動"}`)}
      </div>
    </div>
  );
}
