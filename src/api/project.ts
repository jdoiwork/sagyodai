import { z } from "zod";
const tableSchema = z.object({
  id: z.string(),
  title: z.string(),
  columns: z.array(z.string()),
  rows: z.array(z.array(z.string())),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
const snapshotSchema = z.object({
  revision: z.number(),
  tables: z.array(tableSchema),
  canUndo: z.boolean(),
  canRedo: z.boolean(),
});
export type TableData = z.infer<typeof tableSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Command =
  | { type: "addTable" | "undo" | "redo" }
  | { type: "paste"; id: string; row: number; col: number; values: string[][] }
  | { type: "addRows"; id: string; count: number }
  | { type: "addColumn"; id: string }
  | {
      type: "place";
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
    };
async function read(response: Response): Promise<Snapshot> {
  if (!response.ok) {
    const text = await response.text();
    try {
      const body = JSON.parse(text) as { error?: unknown };
      if (typeof body.error === "string") throw new Error(body.error);
    } catch (e) {
      if (e instanceof Error && !(e instanceof SyntaxError)) throw e;
    }
    throw new Error(`操作に失敗しました (${response.status})`);
  }
  return snapshotSchema.parse(await response.json());
}
export const loadProject = () => fetch("/api/project").then(read);
export const sendCommand = (expectedRevision: number, command: Command) =>
  fetch("/api/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedRevision, command }),
  }).then(read);
