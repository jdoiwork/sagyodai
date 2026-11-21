// 表計算ソフトの TSV を扱う。引用符内のタブ・改行と二重引用符も保持する。
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"' && (quoted || cell === "")) {
      if (quoted && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && (c === "\t" || c === "\n")) {
      row.push(cell);
      cell = "";
      if (c === "\n") {
        rows.push(row);
        row = [];
      }
    } else {
      cell += c;
    }
  }
  if (quoted) throw new Error("貼り付けデータの引用符が閉じていません。");
  if (cell !== "" || row.length || !source.endsWith("\n")) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
export function formatTsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) =>
          /[\t\n\r"]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell,
        )
        .join("\t"),
    )
    .join("\n");
}
