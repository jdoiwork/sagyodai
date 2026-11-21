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
  | { type: "openProject"; document: unknown }
  | {
      type: "paste";
      id: string;
      row: number;
      col: number;
      values: string[][];
      expectedValues?: (string | null)[][];
    }
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
export class CommandError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function read(response: Response): Promise<Snapshot> {
  if (!response.ok) {
    const text = await response.text();
    try {
      const body = JSON.parse(text) as { error?: unknown };
      if (typeof body.error === "string")
        throw new CommandError(body.error, response.status);
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

export async function exportProject(): Promise<{
  blob: Blob;
  revision: number;
}> {
  const response = await fetch("/api/project/export");
  if (!response.ok) {
    await read(response);
    throw new Error("ファイルを書き出せませんでした。");
  }
  const revision = Number(response.headers.get("x-project-revision"));
  if (
    !Number.isSafeInteger(revision) ||
    response.headers.get("x-project-revision") === null
  )
    throw new Error("保存時の状態を確認できません。");
  return { blob: await response.blob(), revision };
}

export function subscribeProject(
  onChange: () => void,
  onConnection: (connected: boolean) => void,
) {
  const events = new EventSource("/api/project/events");
  events.onmessage = () => {
    onConnection(true);
    onChange();
  };
  events.onerror = () => onConnection(false);
  return () => events.close();
}
