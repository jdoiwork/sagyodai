import { useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import type { Snapshot, TableData } from "../../api/project";

type Axis = "row" | "column";
type Selection = {
  kind: Axis;
  indices: number[];
  anchor: number;
  signature: string;
};
export function useHeaderSelection(table: TableData, rowOrder?: number[]) {
  const [stored, setStored] = useState<Selection | null>(null);
  const [pending, setPending] = useState<
    (Selection & { sourceSignature: string; confirmed: boolean }) | null
  >(null);
  const generation = useRef(0);
  // 添字で選択する間は、他タブの編集や並べ替えで別のデータを選ばない。
  const signature = JSON.stringify([table.columns, table.rows]);
  const selection =
    pending?.confirmed && pending.signature === signature
      ? pending
      : stored?.signature === signature
        ? stored
        : null;
  useLayoutEffect(() => {
    if (pending?.confirmed && pending.signature === signature) {
      setStored(pending);
      setPending(null);
    } else if (
      pending &&
      signature !== pending.signature &&
      signature !== pending.sourceSignature
    ) {
      setPending(null);
    }
  }, [pending, signature]);
  function clear() {
    generation.current++;
    setPending(null);
    setStored(null);
  }
  function moving(
    indices: number[],
    to: number,
    source: TableData,
    kind: Axis = "column",
  ) {
    const token = ++generation.current;
    const order = (kind === "row" ? source.rows : source.columns)
      .map((_, i) => i)
      .filter((i) => !indices.includes(i));
    order.splice(to, 0, ...indices);
    const next = {
      confirmed: false,
      sourceSignature: JSON.stringify([source.columns, source.rows]),
      kind,
      indices: indices.map((_, i) => to + i),
      anchor: to,
      signature: JSON.stringify([
        kind === "row" ? source.columns : order.map((i) => source.columns[i]),
        kind === "row"
          ? order.map((i) => source.rows[i])
          : source.rows.map((row) => order.map((i) => row[i])),
      ]),
    };
    // 応答とキャンバスへの反映の順序に依存せず、実際の行・列順が一致した時点で選択を移す。
    setPending(next);
    return (succeeded: boolean) => {
      if (generation.current !== token) return;
      setPending((current) =>
        succeeded && current ? { ...current, confirmed: true } : null,
      );
    };
  }
  function inserting(kind: Axis, at: number, count: number, source: TableData) {
    const token = ++generation.current;
    setPending(null);
    // 列名などの生成規則は Rust に任せ、成功応答の実データと画面が一致してから選択する。
    return (succeeded: boolean, snapshot?: Snapshot) => {
      if (generation.current !== token || !succeeded) return;
      const next = snapshot?.tables.find((t) => t.id === source.id);
      if (!next) return;
      setPending({
        kind,
        anchor: at,
        indices: Array.from({ length: count }, (_, i) => at + i),
        confirmed: true,
        sourceSignature: JSON.stringify([source.columns, source.rows]),
        signature: JSON.stringify([next.columns, next.rows]),
      });
    };
  }
  function select(
    kind: Axis,
    index: number,
    event?: Pick<MouseEvent, "shiftKey" | "ctrlKey" | "metaKey">,
  ) {
    generation.current++;
    setPending(null);
    const previous = selection?.kind === kind ? selection : null;
    const anchor = event?.shiftKey && previous ? previous.anchor : index;
    let indices = [index];
    if (event?.shiftKey && previous) {
      indices = Array.from(
        { length: Math.abs(index - anchor) + 1 },
        (_, n) => Math.min(index, anchor) + n,
      );
      if (kind === "row" && rowOrder) {
        const a = rowOrder.indexOf(anchor),
          b = rowOrder.indexOf(index);
        indices =
          a >= 0 && b >= 0
            ? rowOrder.slice(Math.min(a, b), Math.max(a, b) + 1)
            : [index];
      }
      if (event.ctrlKey || event.metaKey)
        indices = [...new Set([...previous.indices, ...indices])];
    } else if ((event?.ctrlKey || event?.metaKey) && previous) {
      indices = previous.indices.includes(index)
        ? previous.indices.filter((n) => n !== index)
        : [...previous.indices, index];
    }
    setStored({
      kind,
      indices: indices.sort((a, b) => a - b),
      anchor,
      signature,
    });
  }
  return {
    selection,
    select,
    clear,
    moving,
    inserting,
    contains: (kind: Axis, index: number) =>
      selection?.kind === kind && selection.indices.includes(index),
  };
}
