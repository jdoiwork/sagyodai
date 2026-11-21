// Rust は前後の空白を除いたタイトルの UTF-8 バイト数を検証する。
export function nodeTitleError(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return "タイトルを入力してください。";
  if (new TextEncoder().encode(trimmed).length > 1024)
    return "タイトルは1024バイト以内で入力してください。";
  return "";
}
