import type { ColumnFilters } from "./ColumnValueFilter";
// 検索は表示用の元行番号だけを返し、データや出力キャッシュを加工しない。
export function matchingRows(
  rows: string[][],
  query: string,
  filters: ColumnFilters = {},
): number[] {
  const needle = query.trim().toLowerCase();
  return rows.flatMap((row, index) =>
    (!needle || row.some((cell) => cell.toLowerCase().includes(needle))) &&
    Object.entries(filters).every(([col, values]) =>
      values.includes(row[Number(col)]),
    )
      ? [index]
      : [],
  );
}
