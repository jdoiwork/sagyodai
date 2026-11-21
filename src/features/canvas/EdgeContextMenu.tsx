import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { PaletteColor } from "../../api/project";
import { palette } from "./colors";
import { Icon } from "../../components/Icon";

export function EdgeContextMenu({
  x,
  y,
  onDisconnect,
  label = "接続線の操作",
  color,
  onColor,
  onClose,
}: {
  x: number;
  y: number;
  onDisconnect?: () => void;
  label?: string;
  color?: PaletteColor | null;
  onColor?: (color: PaletteColor | null) => void;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
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
      aria-label={label}
      className="table-context-menu nodrag nopan"
      style={{
        left: Math.max(0, Math.min(x, window.innerWidth - 200)),
        top: Math.max(
          0,
          Math.min(
            y,
            window.innerHeight - (onColor ? (onDisconnect ? 230 : 190) : 56),
          ),
        ),
      }}
      onContextMenu={(e) => e.preventDefault()}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) onClose();
      }}
    >
      {onColor && (
        <div className="connection-colors">
          <span>色を変更</span>
          <div className="connection-swatches">
            {Object.entries(palette).map(([key, entry], index) => (
              <button
                key={key}
                autoFocus={index === 0}
                role="menuitemradio"
                aria-label={entry.label}
                aria-checked={color === key}
                title={entry.label}
                style={{ background: entry.hex }}
                onClick={() => {
                  onColor(key as PaletteColor);
                  onClose();
                }}
              >
                {color === key ? "✓" : ""}
              </button>
            ))}
          </div>
          <button
            role="menuitemradio"
            aria-checked={!color}
            onClick={() => {
              onColor(null);
              onClose();
            }}
          >
            標準色に戻す
          </button>
        </div>
      )}
      {onDisconnect && (
        <button
          autoFocus={!onColor}
          role="menuitem"
          className="action-danger"
          onClick={() => {
            onDisconnect();
            onClose();
          }}
        >
          <Icon name="close" />
          接続を解除
        </button>
      )}
    </div>,
    document.body,
  );
}
