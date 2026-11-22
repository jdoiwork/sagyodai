import { useMemo, useState } from "react";

type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
function Branch({
  name,
  value,
  root = false,
}: {
  name: string;
  value: JsonValue;
  root?: boolean;
}) {
  const [open, setOpen] = useState(root);
  const [limit, setLimit] = useState(100);
  const container = value !== null && typeof value === "object";
  if (!container)
    return (
      <div className="json-tree-leaf">
        <span className="json-tree-key">{name}: </span>
        <span className={`json-tree-${value === null ? "null" : typeof value}`}>
          {JSON.stringify(value)}
        </span>
      </div>
    );
  const entries = Object.entries(value);
  const label = `${name}: ${Array.isArray(value) ? "配列" : "オブジェクト"} (${entries.length})`;
  return (
    <div className="json-tree-branch">
      <button
        className="json-tree-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span> {label}
      </button>
      {open && (
        <div className="json-tree-children">
          {entries.slice(0, limit).map(([key, child]) => (
            <Branch
              key={key}
              name={Array.isArray(value) ? `[${key}]` : JSON.stringify(key)}
              value={child}
            />
          ))}
          {limit < entries.length && (
            <button onClick={() => setLimit(limit + 100)}>
              さらに表示（残り {entries.length - limit} 件）
            </button>
          )}
        </div>
      )}
    </div>
  );
}
export function JsonTree({ text }: { text: string }) {
  const parsed = useMemo(() => {
    try {
      return { value: JSON.parse(text) as JsonValue };
    } catch {
      return {
        error: "JSONとして読み取れません。入力の構文を確認してください。",
      };
    }
  }, [text]);
  if (!text) return <p className="note-empty">表示するJSONはありません。</p>;
  if (parsed.error)
    return (
      <p className="node-error" role="alert">
        {parsed.error}
      </p>
    );
  // 入力が変わったら開閉状態をリセットし、別のデータの展開状態を持ち越さない。
  return (
    <div className="json-tree">
      <Branch key={text} name="$" value={parsed.value!} root />
    </div>
  );
}
