import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
const sourceChoices = [
  { kind: "input", label: "表を追加", icon: "editableTable" },
  { kind: "csv", label: "CSV", icon: "folder" },
  { kind: "text", label: "テキスト", icon: "note" },
  { kind: "http", label: "HTTP", icon: "http" },
  { kind: "note", label: "メモ", icon: "note" },
] as const;
const processingChoices = [
  { kind: "script", label: "スクリプト", icon: "note" },
  { kind: "filter", label: "フィルタ", icon: "filter" },
  { kind: "sort", label: "ソート", icon: "sort" },
  { kind: "union", label: "結合", icon: "union" },
  { kind: "aggregate", label: "集計", icon: "aggregate" },
  { kind: "replace", label: "置換", icon: "replace" },
  { kind: "jsonSelect", label: "JSONキー抽出", icon: "jsonSelect" },
  { kind: "jsonTable", label: "JSONを表に変換", icon: "jsonTable" },
] as const;
const outputChoices = [
  { kind: "display", label: "結果表", icon: "table" },
  { kind: "textDisplay", label: "結果テキスト", icon: "note" },
  { kind: "treeDisplay", label: "結果ツリー", icon: "tree" },
] as const;
const categories = {
  source: { label: "入力", choices: sourceChoices },
  processing: { label: "加工", choices: processingChoices },
  output: { label: "出力", choices: outputChoices },
};
export function AddNodeMenu({
  category,
  disabled,
  onAdd,
}: {
  category: keyof typeof categories;
  disabled: boolean;
  onAdd: (
    kind:
      | (typeof sourceChoices)[number]["kind"]
      | (typeof processingChoices)[number]["kind"]
      | (typeof outputChoices)[number]["kind"],
  ) => void;
}) {
  const { choices, label } = categories[category];
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
      className="add-node"
      ref={root}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <button
        ref={trigger}
        className={category === "source" ? "primary" : undefined}
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
        {label}を追加
        <span aria-hidden="true">▾</span>
      </button>
      {open && !disabled && (
        <div
          ref={menu}
          className="add-node-menu"
          role="menu"
          aria-label={`${label}ノードを追加`}
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
