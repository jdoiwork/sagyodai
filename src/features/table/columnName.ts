// Rust の列名制約と合わせる。文字数ではなく UTF-8 のバイト数で判定する。
export function columnNameError(name: string): string {
  if (!name.trim()) return "列名を入力してください。";
  if (new TextEncoder().encode(name).length > 1024)
    return "列名は1024バイト以内で入力してください。";
  return "";
}
