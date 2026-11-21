import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../components/Icon";

export function TableContextMenu({
  x,
  y,
  targetLabel,
  disabled,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  targetLabel: string;
  disabled: boolean;
  onDelete: () => void;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
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
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
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
        top: Math.max(0, Math.min(y, window.innerHeight - 56)),
      }}
      onContextMenu={(e) => e.preventDefault()}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) onClose();
      }}
    >
      <button
        autoFocus
        role="menuitem"
        className="action-danger"
        disabled={disabled}
        onClick={() => {
          onDelete();
          onClose();
        }}
      >
        <Icon name="trash" />
        {targetLabel}を削除
      </button>
    </div>,
    document.body,
  );
}
