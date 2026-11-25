import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TableData, TypeConfig } from "../../api/project";
import { useProject } from "../../app/ProjectContext";
const labels = { string: "文字列", integer: "整数", boolean: "真偽値" };
function initial(dataType: TypeConfig["dataType"]): TypeConfig {
  return {
    dataType,
    nullable: false,
    empty: {
      mode: "value",
      value:
        dataType === "integer" ? "0" : dataType === "boolean" ? "false" : "",
    },
  };
}
export function TypeFields({
  config,
  onChange,
}: {
  config: TypeConfig;
  onChange: (c: TypeConfig) => void;
}) {
  return (
    <div className="type-fields">
      <label>
        型
        <select
          aria-label="列の型"
          value={config.dataType}
          onChange={(e) =>
            onChange(initial(e.target.value as TypeConfig["dataType"]))
          }
        >
          {Object.entries(labels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={config.nullable}
          onChange={(e) =>
            onChange({
              ...config,
              nullable: e.target.checked,
              empty:
                !e.target.checked && config.empty.mode === "null"
                  ? initial(config.dataType).empty
                  : config.empty,
            })
          }
        />
        nullを許容する
      </label>
      <label>
        空欄の扱い
        <select
          aria-label="空欄の扱い"
          value={config.empty.mode}
          onChange={(e) =>
            onChange({
              ...config,
              empty:
                e.target.value === "value"
                  ? initial(config.dataType).empty
                  : { mode: e.target.value as "null" | "error" },
            })
          }
        >
          <option value="value">指定した値にする</option>
          <option value="error">入力エラーにする</option>
          <option value="null" disabled={!config.nullable}>
            nullにする
          </option>
        </select>
      </label>
      {config.empty.mode === "value" && (
        <label>
          空欄の代替値
          <input
            aria-label="空欄の代替値"
            value={config.empty.value}
            onChange={(e) =>
              onChange({
                ...config,
                empty: { mode: "value", value: e.target.value },
              })
            }
          />
        </label>
      )}
      <small>
        {config.dataType === "integer"
          ? "符号付き64ビット整数。小数・指数表記は不可。"
          : config.dataType === "boolean"
            ? "true / false を入力します。"
            : "文字列の空文字や空白をそのまま保持します。"}{" "}
        空欄は長さ0の入力です。
      </small>
    </div>
  );
}
function configError(config: TypeConfig): string {
  if (config.empty.mode === "null" && !config.nullable)
    return "null許容をオンにしてください。";
  if (config.empty.mode !== "value") return "";
  const value = config.empty.value.trim();
  if (new TextEncoder().encode(config.empty.value).length > 100000)
    return "代替値が長すぎます。";
  if (config.dataType === "integer") {
    if (!/^[+-]?[0-9]+$/.test(value))
      return "代替値には整数を指定してください。";
    const n = BigInt(value);
    if (n < -9223372036854775808n || n > 9223372036854775807n)
      return "代替値が64ビット整数の範囲を超えています。";
  }
  if (config.dataType === "boolean" && value !== "true" && value !== "false")
    return "代替値はtrueまたはfalseです。";
  return "";
}
function TypeDialog({
  name,
  config,
  onApply,
  onClose,
}: {
  name: string;
  config: TypeConfig;
  onApply: (c: TypeConfig) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(config);
  const error = configError(draft);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    form.current?.querySelector("select")?.focus();
    return () => previous?.focus();
  }, []);
  return createPortal(
    <div
      className="type-dialog-backdrop nodrag nopan"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        ref={form}
        role="dialog"
        aria-modal="true"
        aria-label={`${name}の型設定`}
        className="type-dialog"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onClose();
          if (
            e.key === "Enter" &&
            (e.nativeEvent.isComposing || e.keyCode === 229)
          )
            e.preventDefault();
          if (e.key === "Tab") {
            const fields = Array.from(
              e.currentTarget.querySelectorAll<HTMLElement>(
                "input:not(:disabled),select:not(:disabled),button:not(:disabled)",
              ),
            );
            const first = fields[0],
              last = fields.at(-1);
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!error) onApply(draft);
        }}
      >
        <h3>{name}の型設定</h3>
        <TypeFields config={draft} onChange={setDraft} />
        <p>入力原文は保持します。変換できないセルはエラーになります。</p>
        {error && <p role="alert">{error}</p>}
        <div>
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" disabled={!!error}>
            適用
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
export function ColumnTypeSettings({
  table,
  col,
}: {
  table: TableData;
  col: number;
}) {
  const { dispatch } = useProject();
  const [draft, setDraft] = useState<{
    name: string;
    id: string;
    config: TypeConfig;
  } | null>(null);
  const column = table.columnSchema?.[col];
  if (!column) return null;
  return (
    <>
      <button
        type="button"
        className="column-type nodrag nopan"
        title={`${labels[column.config.dataType]}・null${column.config.nullable ? "許容" : "不可"}`}
        aria-label={`${column.name}の型設定`}
        disabled={table.kind !== "input"}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setDraft(column);
        }}
      >
        {labels[column.config.dataType]}
      </button>
      {draft && (
        <TypeDialog
          name={draft.name}
          config={draft.config}
          onClose={() => setDraft(null)}
          onApply={(config) =>
            dispatch(
              {
                type: "setColumnType",
                id: table.id,
                columnId: draft.id,
                config,
                expectedConfig: draft.config,
              },
              () => {
                setDraft(null);
              },
            )
          }
        />
      )}
    </>
  );
}
export function TypeConversion({
  table,
  source,
}: {
  table: TableData;
  source?: TableData;
}) {
  const { dispatch } = useProject();
  const [editing, setEditing] = useState<{
    id: string;
    name: string;
    config: TypeConfig;
    expectedColumns: Record<string, TypeConfig>;
  } | null>(null);
  return (
    <div className="type-conversion">
      <p>列を選び、型と空欄の扱いを指定します。</p>
      {!!Object.keys(table.typeConversion ?? {}).length && (
        <button
          type="button"
          onClick={() =>
            dispatch({
              type: "setTypeConversion",
              id: table.id,
              columns: {},
              expectedColumns: table.typeConversion ?? {},
            })
          }
        >
          型指定をすべて解除
        </button>
      )}
      {source?.columnSchema?.map((col) => (
        <div key={col.id}>
          <button
            type="button"
            onClick={() =>
              setEditing({
                ...col,
                expectedColumns: table.typeConversion ?? {},
                config: table.typeConversion?.[col.id] ?? col.config,
              })
            }
          >
            {col.name}:{" "}
            {labels[(table.typeConversion?.[col.id] ?? col.config).dataType]}
          </button>
          {table.typeConversion?.[col.id] && (
            <button
              onClick={() => {
                const columns = { ...table.typeConversion };
                delete columns[col.id];
                dispatch({
                  type: "setTypeConversion",
                  id: table.id,
                  columns,
                  expectedColumns: table.typeConversion ?? {},
                });
              }}
            >
              指定を解除
            </button>
          )}
        </div>
      ))}
      {editing && (
        <TypeDialog
          name={editing.name}
          config={editing.config}
          onClose={() => setEditing(null)}
          onApply={(config) =>
            dispatch(
              {
                type: "setTypeConversion",
                id: table.id,
                columns: { ...editing.expectedColumns, [editing.id]: config },
                expectedColumns: editing.expectedColumns,
              },
              () => {
                setEditing(null);
              },
            )
          }
        />
      )}
    </div>
  );
}
