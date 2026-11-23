import { useEffect, useId, useMemo, useState } from "react";
import type { TableData } from "../../api/project";

export function JsonKeyInput({
  source,
  value,
  onChange,
  label,
  invalid,
}: {
  source?: TableData;
  value: string;
  onChange: (value: string) => void;
  label: string;
  invalid: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [composing, setComposing] = useState(false);
  const text =
    source && !source.stale && !source.error && source.columns.length === 1
      ? source.rows.map((row) => row[0]).join("\n")
      : "";
  // 同じ本文なら、他ノードの編集やキー入力のたびに大きなJSONを解析し直さない。
  const keys = useMemo(() => {
    try {
      const json: unknown = JSON.parse(text);
      return json !== null && typeof json === "object" && !Array.isArray(json)
        ? Object.keys(json)
        : [];
    } catch {
      return [];
    }
  }, [text]);
  const matches = keys.filter((key) =>
    key.toLocaleLowerCase().includes(value.toLocaleLowerCase()),
  );
  const candidates = matches.slice(0, 100);
  const visible = open && !composing && candidates.length > 0;
  const highlighted = active >= 0 && active < candidates.length ? active : -1;
  useEffect(() => {
    setActive(-1);
  }, [text, value]);
  useEffect(() => {
    if (visible && highlighted >= 0)
      document
        .getElementById(`${id}-${highlighted}`)
        ?.scrollIntoView?.({ block: "nearest" });
  }, [id, visible, highlighted]);
  function choose(key: string) {
    onChange(key);
    setOpen(false);
    setActive(-1);
  }
  return (
    <div className="json-key-input">
      <input
        role="combobox"
        aria-label={label}
        aria-invalid={invalid}
        aria-autocomplete="list"
        aria-expanded={visible}
        aria-controls={visible ? id : undefined}
        aria-activedescendant={
          visible && highlighted >= 0 ? `${id}-${highlighted}` : undefined
        }
        autoComplete="off"
        value={value}
        placeholder="chapters"
        onFocus={() => {
          setOpen(true);
          setActive(-1);
        }}
        onBlur={() => {
          setOpen(false);
          setActive(-1);
        }}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => {
          setComposing(false);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={(e) => {
          if (composing || e.nativeEvent.isComposing || e.keyCode === 229) {
            if (e.key === "Enter") e.preventDefault();
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            setActive(-1);
          } else if (
            (e.key === "ArrowDown" || e.key === "ArrowUp") &&
            candidates.length
          ) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
            setActive(
              e.key === "ArrowDown"
                ? (highlighted + 1) % candidates.length
                : (highlighted <= 0 ? candidates.length : highlighted) - 1,
            );
          } else if (e.key === "Enter" && visible && highlighted >= 0) {
            e.preventDefault();
            e.stopPropagation();
            choose(candidates[highlighted]);
          }
        }}
      />
      {visible && (
        <div className="json-key-popup nowheel">
          <div role="listbox" id={id} aria-label={`${label}の候補`}>
            {candidates.map((key, index) => (
              <div
                role="option"
                id={`${id}-${index}`}
                key={key}
                aria-selected={index === highlighted}
                className={index === highlighted ? "active" : ""}
                title={JSON.stringify(key)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(key)}
              >
                {key === "" ? "（空のキー）" : key}
              </div>
            ))}
          </div>
          {matches.length > 100 && (
            <small>先頭100件を表示 · 入力して絞り込めます</small>
          )}
        </div>
      )}
    </div>
  );
}
