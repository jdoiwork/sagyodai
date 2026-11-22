import type { GroupConfig, GroupOutput } from "../../api/project";
export const functions = [
  ["sum", "合計"],
  ["average", "平均"],
  ["min", "最小値"],
  ["max", "最大値"],
  ["count", "件数"],
] as const;
export function outputColumns(config: GroupConfig): GroupOutput[] {
  if (config.outputs) return config.outputs;
  const outputs: GroupOutput[] = [];
  for (const [field, fn] of [
    ["sums", "sum"],
    ["averages", "average"],
    ["minima", "min"],
    ["maxima", "max"],
  ] as const) {
    for (const column of config[field] ?? [])
      outputs.push({ function: fn, column, name: "" });
  }
  if (config.count) outputs.push({ function: "count", column: null, name: "" });
  return outputs;
}
export function outputName(output: GroupOutput, columns: string[]) {
  if (output.function === "count") return "件数";
  return `${functions.find(([fn]) => fn === output.function)?.[1]}（${columns[output.column ?? -1] ?? "対象列"}）`;
}
