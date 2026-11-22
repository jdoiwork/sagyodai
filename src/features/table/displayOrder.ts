export type DisplaySort = { column: number; direction: "asc" | "desc" };
const collator = new Intl.Collator("ja", {
  numeric: true,
  sensitivity: "base",
});
// 元の行番号を並べ替える。同値は元の順序、空欄は昇降順とも末尾。
export function sortDisplayRows(
  rows: string[][],
  indices: number[],
  sort?: DisplaySort | null,
): number[] {
  if (!sort) return indices;
  const values = rows
    .map((row) => row[sort.column]?.trim() ?? "")
    .filter(Boolean);
  const numeric =
    values.length > 0 &&
    values.every((value) => Number.isFinite(Number(value)));
  return [...indices].sort((a, b) => {
    const left = rows[a][sort.column] ?? "",
      right = rows[b][sort.column] ?? "";
    if (!left.trim() || !right.trim())
      return Number(!left.trim()) - Number(!right.trim()) || a - b;
    const comparison = numeric
      ? Number(left) - Number(right)
      : collator.compare(left, right);
    return (sort.direction === "asc" ? comparison : -comparison) || a - b;
  });
}
