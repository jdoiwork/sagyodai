import { useLayoutEffect, useRef, type RefObject } from "react";
import type { TableData } from "../../api/project";

type Deletion = { kind: "row" | "column"; index: number };
const same = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, i) => value === b[i]);

// Undo・貼り付け・同時編集を削除と誤認しないよう、単一の削除だけを検出する。
export function findDeletion(
  before: TableData,
  after: TableData,
): Deletion | null {
  if (before.id !== after.id) return null;
  if (
    same(before.columns, after.columns) &&
    before.rows.length === after.rows.length + 1
  ) {
    let index = 0;
    while (
      index < after.rows.length &&
      same(before.rows[index], after.rows[index])
    )
      index++;
    if (
      after.rows
        .slice(index)
        .every((row, i) => same(row, before.rows[index + i + 1]))
    )
      return { kind: "row", index };
  }
  if (
    before.columns.length === after.columns.length + 1 &&
    before.rows.length === after.rows.length
  ) {
    for (let index = 0; index < before.columns.length; index++) {
      if (
        same(
          before.columns.filter((_, c) => c !== index),
          after.columns,
        ) &&
        before.rows.every((row, r) =>
          same(
            row.filter((_, c) => c !== index),
            after.rows[r],
          ),
        )
      )
        return { kind: "column", index };
    }
  }
  return null;
}

type Position = { x: number; y: number };
export function useDeletionAnimation(
  viewport: RefObject<HTMLDivElement | null>,
  table: TableData,
) {
  const previous = useRef<{
    table: TableData;
    positions: Map<string, Position>;
  } | null>(null);
  const animations = useRef<Animation[]>([]);
  useLayoutEffect(() => {
    const root = viewport.current;
    if (!root) return;
    const rows = [...root.querySelectorAll<HTMLElement>("tr[data-row]")];
    const cells = [
      ...root.querySelectorAll<HTMLElement>("[data-column], td[data-col]"),
    ];
    const key = (el: HTMLElement) =>
      el.hasAttribute("data-column")
        ? `header:${el.dataset.column}`
        : el.hasAttribute("data-col")
          ? `cell:${el.closest<HTMLElement>("[data-row]")?.dataset.row}:${el.dataset.col}`
          : `row:${el.dataset.row}`;
    const positions = new Map(
      [...rows, ...cells].map((el) => [
        key(el),
        { x: el.offsetLeft, y: el.offsetTop },
      ]),
    );
    const old = previous.current;
    previous.current = { table, positions };
    // 操作応答と SSE が同じ状態を二度届けても、再生中の動きを中断しない。
    if (
      old &&
      old.table.width === table.width &&
      old.table.height === table.height &&
      same(old.table.columns, table.columns) &&
      old.table.rows.length === table.rows.length &&
      old.table.rows.every((row, r) => same(row, table.rows[r]))
    )
      return;
    animations.current.forEach((animation) => animation.cancel());
    animations.current = [];
    const deletion = old && findDeletion(old.table, table);
    if (
      !old ||
      !deletion ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    )
      return;
    for (const el of deletion.kind === "row" ? rows : cells) {
      const index = Number(
        deletion.kind === "row"
          ? el.dataset.row
          : (el.dataset.column ?? el.dataset.col),
      );
      const oldIndex = index >= deletion.index ? index + 1 : index;
      const oldKey = key(el).replace(/\d+$/, String(oldIndex));
      const from = old.positions.get(oldKey),
        to = positions.get(key(el));
      if (!from || !to || typeof el.animate !== "function") continue;
      const dx = deletion.kind === "column" ? from.x - to.x : 0;
      const dy = deletion.kind === "row" ? from.y - to.y : 0;
      if (!dx && !dy) continue;
      // offset 座標はキャンバスのズーム前の単位なので、拡大率に依存しない。
      animations.current.push(
        el.animate(
          [
            { transform: `translate(${dx}px, ${dy}px)` },
            { transform: "translate(0, 0)" },
          ],
          { duration: 220, easing: "cubic-bezier(0.2, 0, 0.2, 1)" },
        ),
      );
    }
  });
  useLayoutEffect(
    () => () => animations.current.forEach((animation) => animation.cancel()),
    [],
  );
}
