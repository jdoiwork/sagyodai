import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// 入力に今は存在しない選択値も残し、再出現したときに同じ条件で抽出する。
export function InValues({
  label,
  exclude = false,
  values,
  selected,
  onChange,
}: {
  label: string;
  exclude?: boolean;
  values: string[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const mode = exclude ? "NOT IN" : "IN";
  const action = exclude ? "除外する値" : "一致させる値";
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!position) return;
    menu.current?.focus();
    const close = (e: PointerEvent) => {
      if (
        !menu.current?.contains(e.target as Node) &&
        !trigger.current?.contains(e.target as Node)
      )
        setPosition(null);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [position]);
  const [query, setQuery] = useState("");
  const counts = new Map<string, number>();
  values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  selected.forEach((v) => {
    if (!counts.has(v)) counts.set(v, 0);
  });
  return (
    <div className="in-values">
      <button
        type="button"
        ref={trigger}
        aria-label={`${label} ${mode}の値を選択`}
        aria-expanded={!!position}
        onClick={() => {
          const r = trigger.current?.getBoundingClientRect();
          if (r) setPosition(position ? null : { x: r.left, y: r.bottom + 4 });
        }}
      >
        {selected.length} 個の値を選択（{mode}） ▾
      </button>
      {position &&
        createPortal(
          <div
            ref={menu}
            tabIndex={-1}
            role="dialog"
            aria-label={`${label} ${mode}の候補`}
            className="in-values-menu nodrag nopan nowheel"
            style={{
              left: Math.max(8, Math.min(position.x, window.innerWidth - 328)),
              top: Math.max(8, Math.min(position.y, window.innerHeight - 360)),
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                setPosition(null);
                trigger.current?.focus();
              }
              if (e.key === "Enter" && !e.nativeEvent.isComposing)
                e.preventDefault();
            }}
          >
            <strong>{action}を選択</strong>
            <input
              aria-label={`${label} 選択候補を検索`}
              placeholder="候補を検索"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="in-value-actions">
              <button
                type="button"
                onClick={() => onChange([...new Set(values)])}
              >
                すべて選択
              </button>
              <button type="button" onClick={() => onChange([])}>
                選択を解除
              </button>
              <button
                type="button"
                aria-label={`${mode}の候補を閉じる`}
                onClick={() => {
                  setPosition(null);
                  trigger.current?.focus();
                }}
              >
                閉じる
              </button>
            </div>
            <div
              className="in-value-options nowheel"
              aria-label={`${label} ${action}`}
            >
              {[...counts]
                .filter(([v]) =>
                  v
                    .toLocaleLowerCase()
                    .includes(query.trim().toLocaleLowerCase()),
                )
                .map(([value, count]) => (
                  <label key={value}>
                    <input
                      type="checkbox"
                      aria-label={`${value || "（空欄）"} ${count}`}
                      checked={selected.includes(value)}
                      onChange={(e) =>
                        onChange(
                          e.target.checked
                            ? [...selected, value]
                            : selected.filter((v) => v !== value),
                        )
                      }
                    />
                    <span>{value || "（空欄）"}</span>
                    <small>{count}</small>
                  </label>
                ))}
              {!counts.size && <span>入力元に値がありません</span>}
            </div>
            <small>
              文字列の完全一致 ·{" "}
              {exclude ? "選択した値を除外・未選択は全行" : "未選択は0件"} ·
              条件を適用すると出力に反映
            </small>
          </div>,
          document.body,
        )}
    </div>
  );
}
