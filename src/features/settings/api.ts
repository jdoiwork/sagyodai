import { z } from "zod";
export const settingsSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  favorites: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      program: z.string(),
      cwd: z.string(),
    }),
  ),
});
export type Settings = z.infer<typeof settingsSchema>;
export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
): Promise<T> {
  const response = await fetch(
    path,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const value: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(value);
    throw new Error(error.success ? error.data.error : "操作に失敗しました。");
  }
  return schema.parse(value);
}
export const loadSettings = () => request("/api/settings", settingsSchema);
