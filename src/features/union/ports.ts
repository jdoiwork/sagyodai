import type { TableData } from "../../api/project";

// 入力元IDに紐付け、並べ替えても線の接続先が入れ替わらないようにする。
export const unionInputHandle = (source: string) => `union-in-${source}`;
export const unionPortTop = (index: number) => 32 + index * 36;
export const unionPortHeight = (table: TableData) =>
  table.kind === "union"
    ? unionPortTop(table.unionInputs?.length ?? 0) + 36
    : 0;
