import type { DisplaySort } from "./displayOrder";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../components/Icon";
export type ColumnFilters = Record<number, string[]>;
export type ColumnFilterState = {
  schema: string;
  values: ColumnFilters;
  sort?: DisplaySort | null;
};
export function ColumnValueFilter({
  label,
  values,
  selected,
  onChange,
  sortDirection,
  onSort,
}: {
  sortDirection?: "asc" | "desc";
  onSort?: (direction: "asc" | "desc" | null) => void;
  label: string;
  values: string[];
  selected?: string[];
  onChange: (values: string[] | undefined) => void;
}) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const counts = new Map<string, number>();
  values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  selected?.forEach((v) => {
    if (!counts.has(v)) counts.set(v, 0);
  });
  useEffect(() => {
    if (!position) return;
    menu.current?.focus();
    const outside = (e: PointerEvent) => {
      if (
        !menu.current?.contains(e.target as Node) &&
        !trigger.current?.contains(e.target as Node)
      )
        setPosition(null);
    };
    const close = () => setPosition(null);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", close);
    };
  }, [position]);
  return (
    <>
      <button
        ref={trigger}
        className={`column-value-filter nodrag nopan${selected || sortDirection ? " active" : ""}`}
        aria-label={`${label} の表示を絞り込み`}
        aria-haspopup="dialog"
        aria-expanded={!!position}
        title={
          selected
            ? "表示を絞り込み中（出力には影響しません）"
            : "表示する値・昇順・降順を選択"
        }
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onDragStart={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          setPosition(position ? null : { x: r.left, y: r.bottom + 4 });
        }}
      >
        {sortDirection ? (
          <span aria-hidden="true">{sortDirection === "asc" ? "↑" : "↓"}</span>
        ) : (
          <Icon name="filter" />
        )}
      </button>
      {position &&
        createPortal(
          <div
            ref={menu}
            role="dialog"
            aria-label={`${label} 表示する値`}
            tabIndex={-1}
            className="column-filter-menu nodrag nopan nowheel"
            style={{
              left: Math.max(8, Math.min(position.x, window.innerWidth - 288)),
              top: Math.max(8, Math.min(position.y, window.innerHeight - 368)),
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            onCopy={(e) => e.stopPropagation()}
            onPaste={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                setPosition(null);
                trigger.current?.focus();
              }
            }}
          >
            <strong>{label}</strong>
            <span className="column-filter-hint">
              表示のみ · 複数選択できます
            </span>
            {onSort && (
              <div className="column-sort-actions" aria-label="表示順">
                <button
                  aria-pressed={sortDirection === "asc"}
                  onClick={() => onSort("asc")}
                >
                  ↑ 昇順
                </button>
                <button
                  aria-pressed={sortDirection === "desc"}
                  onClick={() => onSort("desc")}
                >
                  ↓ 降順
                </button>
                <button disabled={!sortDirection} onClick={() => onSort(null)}>
                  並べ替え解除
                </button>
              </div>
            )}
            <div className="column-filter-actions">
              <button onClick={() => onChange(undefined)}>すべて表示</button>
              <button onClick={() => onChange([])}>選択を解除</button>
              <button
                aria-label="値の絞り込みを閉じる"
                onClick={() => {
                  setPosition(null);
                  trigger.current?.focus();
                }}
              >
                <Icon name="close" />
              </button>
            </div>
            <div className="column-filter-values">
              {[...counts].map(([value, count]) => (
                <label key={value}>
                  <input
                    type="checkbox"
                    checked={selected === undefined || selected.includes(value)}
                    onChange={(e) => {
                      const current = selected ?? [...counts.keys()];
                      onChange(
                        e.target.checked
                          ? [...current, value]
                          : current.filter((v) => v !== value),
                      );
                    }}
                  />
                  <span>{value || "（空欄）"}</span>
                  <small>{count}</small>
                </label>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
