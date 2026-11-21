// 空白文字や数値を含む行は残す。全行が空なら編集用に先頭の1行を残す。
export function emptyRowIndices(rows: string[][]): number[] {
  const indices = rows.flatMap((row, index) =>
    row.every((value) => value === "") ? [index] : [],
  );
  return indices.length === rows.length ? indices.slice(1) : indices;
}
