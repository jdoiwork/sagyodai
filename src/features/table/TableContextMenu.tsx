import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../components/Icon";

export function TableContextMenu({
  hideOnly = false,
  x,
  y,
  targetLabel,
  disabled,
  onPreview,
  onDelete,
  kind,
  count,
  insertDisabled,
  onInsert,
  onClose,
}: {
  hideOnly?: boolean;
  x: number;
  y: number;
  targetLabel: string;
  disabled: boolean;
  onPreview: (active: boolean) => void;
  onDelete: () => void;
  kind: "row" | "column";
  count: number;
  insertDisabled: boolean;
  onInsert: (after: boolean) => void;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    // 折り返した実寸で位置を補正し、画面下端でも項目を操作可能にする。
    const { width, height } = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
  }, [x, y, targetLabel, hideOnly, count]);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    const scroll = (e: Event) => {
      if (!(e.target instanceof Node) || !menu.current?.contains(e.target))
        onClose();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [onClose]);
  return createPortal(
    <div
      ref={menu}
      role="menu"
      aria-label={`${targetLabel}の操作`}
      className="table-context-menu nodrag nopan"
      style={{
        left: Math.max(0, Math.min(x, window.innerWidth - 200)),
        top: Math.max(0, Math.min(y, window.innerHeight - 144)),
      }}
      onContextMenu={(e) => e.preventDefault()}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) onClose();
      }}
    >
      {!hideOnly &&
        [false, true].map((after) => (
          <button
            key={String(after)}
            role="menuitem"
            disabled={insertDisabled}
            onMouseEnter={() => onPreview(false)}
            onClick={() => {
              onInsert(after);
              onClose();
            }}
          >
            <Icon name="plus" />
            {kind === "row" ? (after ? "下" : "上") : after ? "右" : "左"}に
            {count}
            {kind === "row" ? "行" : "列"}挿入
          </button>
        ))}
      <button
        autoFocus
        role="menuitem"
        className={hideOnly ? undefined : "action-danger"}
        disabled={disabled}
        onMouseEnter={() => onPreview(!disabled)}
        onMouseLeave={() => onPreview(false)}
        onClick={() => {
          onDelete();
          onClose();
        }}
      >
        <Icon name={hideOnly ? "minus" : "trash"} />
        <span className="table-context-menu-label">
          {targetLabel}を{hideOnly ? "非表示" : "削除"}
        </span>
      </button>
    </div>,
    document.body,
  );
}
