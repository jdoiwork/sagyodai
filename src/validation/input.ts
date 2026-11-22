import type { Command, FilterConfig, TableData } from "../api/project";
// backend/src/storage.rs の試作上限に合わせる。
export const MAX_ROWS = 5000;
export const MAX_COLUMNS = 50;
export const MAX_CELL_BYTES = 100_000;
export function cellInputError(value: string): string {
  return new TextEncoder().encode(value).length > MAX_CELL_BYTES
    ? "セルの内容は100000バイト以内で入力してください。"
    : "";
}
export function pasteInputError(
  row: number,
  col: number,
  values: string[][],
): string {
  if (!values.length || !values.some((r) => r.length))
    return "貼り付けるデータがありません。";
  if (
    row + values.length > MAX_ROWS ||
    values.some((r) => col + r.length > MAX_COLUMNS)
  )
    return "貼り付け先が上限の5000行・50列を超えます。範囲を小さくしてください。";
  return values.some((r) => r.some((v) => !!cellInputError(v)))
    ? "貼り付けるセルの内容は100000バイト以内にしてください。"
    : "";
}
export function filterInputError(filter: FilterConfig): string {
  if (filter.operator === "in" || filter.operator === "notIn")
    return (filter.values?.length ?? 0) > MAX_ROWS ||
      filter.values?.some((v) => cellInputError(v))
      ? "選択値は5000個以内、各100000バイト以内にしてください。"
      : "";
  if (cellInputError(filter.value))
    return "比較値は100000バイト以内で入力してください。";
  if (
    !["equals", "notEquals", "contains", "searchAll"].includes(filter.operator)
  ) {
    const text = filter.value.trim();
    // Number() が受け付ける空文字・16進数などは Rust の浮動小数点構文ではない。
    if (
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text) ||
      !Number.isFinite(Number(text))
    )
      return "比較値に有限の数値を入力してください。";
  }
  return "";
}
export function createsCycle(
  tables: TableData[],
  target: string,
  source: string,
): boolean {
  const seen = new Set<string>();
  const waiting = [source];
  while (waiting.length) {
    const current = waiting.pop()!;
    if (current === target) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    const table = tables.find((t) => t.id === current);
    if (table?.source) waiting.push(table.source);
    for (const input of table?.unionInputs ?? []) waiting.push(input.source);
  }
  return false;
}
// 再送しても変わらない入力そのものの不正だけを対象にする。
export function commandInputError(command: Command): string {
  if (command.type === "paste")
    return pasteInputError(command.row, command.col, command.values);
  if (command.type === "configure" && command.filter)
    return filterInputError(command.filter);
  return "";
}
