import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TableData } from "../../api/project";
import { useProject } from "../../app/ProjectContext";
import { Icon } from "../../components/Icon";
import { sheetOf, sheetsOf } from "../sheets/model";

export const NodeNavigation = createContext({
  activeSheet: "sheet-1",
  onMoved: (_table: TableData) => {},
});
export function NodeActions({ table }: { table: TableData }) {
  const { project, dispatch, pending } = useProject();
  const { activeSheet, onMoved } = useContext(NodeNavigation);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<{
    x: number;
    y: number;
    move: boolean;
    revision: number | undefined;
    sheet: string;
  } | null>(null);
  const visible =
    open && open.revision === project?.revision && open.sheet === activeSheet;
  const candidates = sheetsOf(project).filter((s) => s.id !== sheetOf(table));
  useEffect(() => {
    if (!visible) return;
    menu.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
    const outside = (event: PointerEvent) => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        setOpen(null);
    };
    const close = () => setOpen(null);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", close);
    };
  }, [visible, open?.move]);
  return (
    <>
      <button
        ref={trigger}
        className="node-action-trigger nodrag nopan"
        aria-label={`${table.title} のアクション`}
        title="ノードのアクション"
        aria-haspopup="menu"
        aria-expanded={!!visible}
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          setOpen(
            visible
              ? null
              : {
                  x: r.right - 240,
                  y: r.bottom + 6,
                  move: false,
                  revision: project?.revision,
                  sheet: activeSheet,
                },
          );
        }}
      >
        <Icon name="more" />
      </button>
      {visible &&
        createPortal(
          <div
            ref={menu}
            className="table-context-menu node-action-menu nodrag nopan nowheel"
            role="menu"
            aria-label={
              open.move
                ? `${table.title} の移動先シート`
                : `${table.title} のアクションメニュー`
            }
            style={{
              left: Math.max(8, Math.min(open.x, window.innerWidth - 248)),
              top: Math.max(8, Math.min(open.y, window.innerHeight - 300)),
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) setOpen(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setOpen(null);
                trigger.current?.focus();
              }
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                const items = Array.from(
                  e.currentTarget.querySelectorAll<HTMLButtonElement>(
                    "button:not(:disabled)",
                  ),
                );
                const index = items.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                const next =
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? items.length - 1
                      : (index +
                          (e.key === "ArrowDown" ? 1 : -1) +
                          items.length) %
                        items.length;
                items[next]?.focus();
              }
            }}
          >
            {open.move ? (
              <>
                <button
                  role="menuitem"
                  onClick={() => setOpen({ ...open, move: false })}
                >
                  ← アクションに戻る
                </button>
                <div className="node-action-caption">移動先のシート</div>
                {candidates.map((sheet) => (
                  <button
                    key={sheet.id}
                    role="menuitem"
                    disabled={pending > 0}
                    onClick={() => {
                      if (pending) return;
                      setOpen(null);
                      dispatch(
                        {
                          type: "moveNodeToSheet",
                          id: table.id,
                          sheetId: sheet.id,
                          expectedSheetId: sheetOf(table),
                        },
                        (ok, next) => {
                          const moved = next?.tables.find(
                            (t) => t.id === table.id,
                          );
                          if (ok && moved) onMoved(moved);
                        },
                      );
                    }}
                  >
                    <Icon name="moveSheet" />
                    {sheet.title}
                  </button>
                ))}
              </>
            ) : (
              <>
                <button
                  role="menuitem"
                  aria-haspopup="menu"
                  disabled={pending > 0 || !candidates.length}
                  onClick={() => setOpen({ ...open, move: true })}
                >
                  <Icon name="moveSheet" />
                  別のシートへ移動<span aria-hidden="true"> ›</span>
                </button>
                {!candidates.length && (
                  <div className="node-action-caption">
                    先に「＋ シート」で移動先を追加してください。
                  </div>
                )}
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
