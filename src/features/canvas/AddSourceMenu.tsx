import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
const choices = [
  { kind: "input", label: "表を追加", icon: "editableTable" },
  { kind: "csv", label: "CSV", icon: "folder" },
  { kind: "note", label: "メモ", icon: "note" },
] as const;
export function AddSourceMenu({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (kind: "input" | "csv" | "note") => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return (
    <div
      className="add-source"
      ref={root}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <button
        ref={trigger}
        className="primary"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open && !disabled}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Icon name="plus" />
        入力を追加<span aria-hidden="true">▾</span>
      </button>
      {open && !disabled && (
        <div
          ref={menu}
          className="add-source-menu"
          role="menu"
          aria-label="入力ノードを追加"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
              trigger.current?.focus();
            }
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
              e.preventDefault();
              const items = Array.from(
                menu.current?.querySelectorAll<HTMLButtonElement>("button") ??
                  [],
              );
              const current = items.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const next =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? items.length - 1
                    : (current +
                        (e.key === "ArrowDown" ? 1 : -1) +
                        items.length) %
                      items.length;
              items[next]?.focus();
            }
          }}
        >
          {choices.map(({ kind, label, icon }) => (
            <button
              key={kind}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
                onAdd(kind);
              }}
            >
              <Icon name={icon} />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
