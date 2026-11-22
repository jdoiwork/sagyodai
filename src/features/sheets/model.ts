import type { Snapshot, TableData } from "../../api/project";
export const defaultSheets = [{ id: "sheet-1", title: "シート 1" }];
export const sheetsOf = (project: Snapshot | null) =>
  project?.sheets ?? defaultSheets;
export const sheetOf = (table: TableData) => table.sheetId ?? "sheet-1";
export function sourceLabel(project: Snapshot | null, table: TableData) {
  const sheet = sheetsOf(project).find((s) => s.id === sheetOf(table));
  return `${sheet?.title ?? "不明なシート"} / ${table.title}`;
}
