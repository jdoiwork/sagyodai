import { z } from "zod";
export const paletteColorSchema = z.enum([
  "green",
  "blue",
  "purple",
  "pink",
  "red",
  "orange",
  "gray",
]);
export type PaletteColor = z.infer<typeof paletteColorSchema>;
export const filterSchema = z.object({
  column: z.number().int().nonnegative(),
  operator: z.enum([
    "in",
    "notIn",
    "equals",
    "notEquals",
    "contains",
    "greater",
    "less",
    "atLeast",
    "atMost",
    "numberEquals",
    "numberNotEquals",
  ]),
  value: z.string(),
  values: z.array(z.string()).optional(),
});
export type FilterConfig = z.infer<typeof filterSchema>;
export const columnViewSchema = z.object({
  schema: z.string(),
  values: z.record(z.string().regex(/^(0|[1-9][0-9]*)$/), z.array(z.string())),
  sort: z
    .object({
      column: z.number().int().nonnegative(),
      direction: z.enum(["asc", "desc"]),
    })
    .nullable(),
});
export const tableViewSchema = z.object({
  query: z.string(),
  columns: columnViewSchema,
});
export type ColumnView = z.infer<typeof columnViewSchema>;
export const emptyTableView = {
  query: "",
  columns: { schema: "", values: {}, sort: null },
};
const tableSchema = z.object({
  view: tableViewSchema.optional(),
  sheetId: z.string().optional(),
  edgeColor: paletteColorSchema.nullable().optional(),
  inputColor: paletteColorSchema.nullable().optional(),
  outputColor: paletteColorSchema.nullable().optional(),
  unionInputs: z
    .array(
      z.object({ source: z.string(), color: paletteColorSchema.nullable() }),
    )
    .optional(),
  unionDistinct: z.boolean().optional(),
  footer: z.array(z.boolean()).nullable().optional(),
  footerTotals: z.array(z.string().nullable()).optional(),
  id: z.string(),
  kind: z.enum(["input", "filter", "display", "union"]),
  source: z.string().nullable(),
  filter: filterSchema.nullable(),
  manual: z.boolean(),
  compact: z.boolean().default(false),
  stale: z.boolean(),
  error: z.string().nullable(),
  title: z.string(),
  columns: z.array(z.string()),
  columnWidths: z.array(z.number()).default([]),
  rows: z.array(z.array(z.string())),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
const snapshotSchema = z.object({
  sheets: z.array(z.object({ id: z.string(), title: z.string() })).optional(),
  revision: z.number(),
  tables: z.array(tableSchema),
  canUndo: z.boolean(),
  canRedo: z.boolean(),
});
export type TableData = z.infer<typeof tableSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Command =
  | { type: "setViewQuery"; id: string; query: string; expectedQuery: string }
  | {
      type: "setViewColumns";
      id: string;
      columns: ColumnView;
      expectedColumns: ColumnView;
    }
  | {
      type: "moveNodeToSheet";
      id: string;
      sheetId: string;
      expectedSheetId: string;
    }
  | { type: "addSheet" }
  | { type: "renameSheet"; id: string; title: string; expectedTitle: string }
  | { type: "addTable" | "undo" | "redo" }
  | {
      type: "addNode";
      sheetId?: string;
      kind: "input" | "filter" | "display" | "union";
      position?: { x: number; y: number };
    }
  | { type: "rename"; id: string; title: string; expectedTitle: string }
  | {
      type: "setColor";
      id: string;
      target: "edge" | "input" | "output";
      color: PaletteColor | null;
    }
  | {
      type: "setFooter";
      id: string;
      columns: boolean[] | null;
      expectedColumns: string[];
    }
  | {
      type: "setUnion";
      id: string;
      sources: string[];
      distinct: boolean;
      expectedSources: string[];
    }
  | {
      type: "setUnionEdgeColor";
      id: string;
      source: string;
      color: PaletteColor | null;
    }
  | { type: "setCompact"; id: string; compact: boolean }
  | { type: "connectFromPort"; id: string; source: string; fromInput: boolean }
  | { type: "connect"; id: string; source: string | null }
  | {
      type: "configure";
      id: string;
      filter: FilterConfig | null;
      manual: boolean;
    }
  | { type: "run" | "removeNode"; id: string }
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
  | {
      type: "removeRows";
      id: string;
      indices: number[];
      expectedRows: string[][];
    }
  | {
      type: "removeColumns";
      id: string;
      indices: number[];
      expectedRows: string[][];
      expectedColumns: string[];
    }
  | { type: "removeRow"; id: string; row: number; expectedRows: string[][] }
  | {
      type: "renameColumn";
      id: string;
      col: number;
      name: string;
      expectedColumns: string[];
    }
  | {
      type: "removeColumn";
      id: string;
      col: number;
      expectedColumns: string[];
      expectedRows: string[][];
    }
  | {
      type: "resizeColumn";
      id: string;
      col: number;
      width: number;
      expectedWidth: number;
      expectedColumns: string[];
    }
  | {
      type: "moveColumns" | "moveRows";
      id: string;
      indices: number[];
      to: number;
      expectedColumns: string[];
      expectedRows: string[][];
    }
  | {
      type: "moveColumn";
      id: string;
      from: number;
      to: number;
      expectedColumns: string[];
      expectedRows: string[][];
    }
  | {
      type: "insertRows" | "insertColumns";
      id: string;
      at: number;
      count: number;
      expectedColumns: string[];
      expectedRows: string[][];
    }
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
