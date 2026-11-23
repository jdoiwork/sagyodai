import { z } from "zod";
export const runSchema = z.object({
  runId: z.number().int().nonnegative(),
  state: z.enum([
    "idle",
    "running",
    "succeeded",
    "failed",
    "canceled",
    "discarded",
  ]),
  message: z.string().nullable(),
  log: z.string(),
  logTruncated: z.boolean(),
  automaticAllowed: z.boolean(),
});
export type ScriptRun = z.infer<typeof runSchema>;
export async function scriptRequest<T>(
  action: string,
  body: unknown,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await fetch(`/api/script/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(value);
    throw new Error(
      error.success
        ? error.data.error
        : `操作に失敗しました (${response.status})`,
    );
  }
  return schema.parse(value);
}
