// 検索は表示用の元行番号だけを返し、データや出力キャッシュを加工しない。
export function matchingRows(rows: string[][], query: string): number[] {
  const needle = query.trim().toLowerCase();
  return rows.flatMap((row, index) =>
    !needle || row.some((cell) => cell.toLowerCase().includes(needle))
      ? [index]
      : [],
  );
}
