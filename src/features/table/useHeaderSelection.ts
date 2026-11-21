import { useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import type { TableData } from "../../api/project";

type Axis = "row" | "column";
type Selection = {
  kind: Axis;
  indices: number[];
  anchor: number;
  signature: string;
};
export function useHeaderSelection(table: TableData) {
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
  function moving(indices: number[], to: number, source: TableData) {
    const token = ++generation.current;
    const order = source.columns
      .map((_, i) => i)
      .filter((i) => !indices.includes(i));
    order.splice(to, 0, ...indices);
    const next = {
      confirmed: false,
      sourceSignature: JSON.stringify([source.columns, source.rows]),
      kind: "column" as const,
      indices: indices.map((_, i) => to + i),
      anchor: to,
      signature: JSON.stringify([
        order.map((i) => source.columns[i]),
        source.rows.map((row) => order.map((i) => row[i])),
      ]),
    };
    // 応答とキャンバスへの反映の順序に依存せず、実際の列順が一致した時点で選択を移す。
    setPending(next);
    return (succeeded: boolean) => {
      if (generation.current !== token) return;
      setPending((current) =>
        succeeded && current ? { ...current, confirmed: true } : null,
      );
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
    contains: (kind: Axis, index: number) =>
      selection?.kind === kind && selection.indices.includes(index),
  };
}
