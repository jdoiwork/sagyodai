import type { TableData } from "../../api/project";

export function acceptsInput(kind: TableData["kind"]): boolean {
  return !["input", "csv", "text", "http", "note"].includes(kind);
}
