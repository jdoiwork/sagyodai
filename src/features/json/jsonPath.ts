export type Step = string | number;
const plain = (key: string) => /^[^.[\]"\\\s]+$/u.test(key);
export function parsePath(path: string): Step[] {
  if (!path) return [""];
  const steps: Step[] = [];
  let i = 0;
  while (i < path.length) {
    if (steps.length) {
      if (path[i] === ".") {
        i++;
        if (i === path.length || path[i] === "[")
          throw Error("ドットの後にキー名を指定してください。");
      } else if (path[i] !== "[")
        throw Error("キーの間には . または [ ] を使ってください。");
    }
    if (path[i] === "[") {
      i++;
      if (path[i] === '"') {
        const start = i++;
        while (i < path.length && path[i] !== '"') {
          if (path[i] === "\\") i++;
          i++;
        }
        if (i >= path.length) throw Error("引用符を閉じてください。");
        i++;
        try {
          steps.push(JSON.parse(path.slice(start, i)) as string);
        } catch {
          throw Error("キーの引用符・エスケープが不正です。");
        }
      } else {
        const start = i;
        while (i < path.length && /[0-9]/.test(path[i])) i++;
        const n = Number(path.slice(start, i));
        if (start === i || !Number.isSafeInteger(n))
          throw Error(
            "配列には0以上の安全な整数インデックスを指定してください。",
          );
        steps.push(n);
      }
      if (path[i] !== "]") throw Error("角括弧を ] で閉じてください。");
      i++;
    } else {
      const start = i;
      while (i < path.length && !".[".includes(path[i])) i++;
      const key = path.slice(start, i);
      if (!plain(key))
        throw Error('記号や空白を含むキーは ["キー名"] で指定してください。');
      steps.push(key);
    }
  }
  return steps;
}
export function pathError(path: string): string {
  if (new TextEncoder().encode(path).length > 1024)
    return "パスは1024バイト以内にしてください。";
  try {
    parsePath(path);
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : "パスが不正です。";
  }
}
export function resolvePath(root: unknown, path: string): unknown {
  let value = root;
  for (const step of parsePath(path)) {
    if (typeof step === "number") {
      if (!Array.isArray(value)) return undefined;
      value = value[step];
    } else {
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        !Object.hasOwn(value, step)
      )
        return undefined;
      value = (value as Record<string, unknown>)[step];
    }
  }
  return value;
}
const container = (value: unknown) =>
  value !== null && typeof value === "object";
export function isContainerPath(root: unknown, path: string): boolean {
  try {
    return container(resolvePath(root, path));
  } catch {
    return false;
  }
}
// 候補は完全なパスで返す。選択したコンテナの次の階層へ、そのまま進める。
export function pathSuggestions(root: unknown, path: string): string[] {
  if (!container(root)) return [];
  let parent: unknown = root,
    base = "",
    fragment = path,
    bracket = false;
  if (path && isContainerPath(root, path)) {
    parent = resolvePath(root, path);
    base = path;
    fragment = "";
  } else {
    let quoted = false,
      escaped = false,
      boundary = -1;
    for (let i = 0; i < path.length; i++) {
      const c = path[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === "." || c === "[") boundary = i;
    }
    if (boundary >= 0) {
      base = path.slice(0, boundary);
      bracket = path[boundary] === "[";
      fragment = path.slice(boundary + (bracket ? 0 : 1));
      try {
        parent = base ? resolvePath(root, base) : root;
      } catch {
        return [];
      }
    }
  }
  if (!container(parent)) return [];
  const result: string[] = [];
  const keys = Array.isArray(parent)
    ? parent.keys()
    : Object.keys(parent as object);
  for (const key of keys) {
    const suffix =
      typeof key === "number"
        ? `[${key}]`
        : bracket || !plain(key)
          ? `[${JSON.stringify(key)}]`
          : `${base ? "." : ""}${key}`;
    const candidate = base + suffix;
    const search = bracket ? suffix : typeof key === "number" ? suffix : key;
    if (search.toLocaleLowerCase().includes(fragment.toLocaleLowerCase()))
      result.push(candidate);
    if (result.length > 100) break;
  }
  return result;
}
