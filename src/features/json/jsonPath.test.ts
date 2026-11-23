// @vitest-environment jsdom
import { expect, it } from "vitest";
import { parsePath, pathError, pathSuggestions, resolvePath } from "./jsonPath";
const root = { chapters: [{ title: "日本語", "a.b": { "": null } }], "a.b": 7 };
it("階層・配列・記号付きキーを区別して解決する", () => {
  expect(resolvePath(root, "chapters[0].title")).toBe("日本語");
  expect(resolvePath(root, 'chapters[0]["a.b"][""]')).toBeNull();
  expect(resolvePath(root, '["a.b"]')).toBe(7);
  expect(resolvePath([1], "[0]")).toBe(1);
  expect(resolvePath({}, "__proto__")).toBeUndefined();
  expect(resolvePath(JSON.parse('{"__proto__":true}'), "__proto__")).toBe(true);
  expect(resolvePath(root, "chapters[100]")).toBeUndefined();
  for (const path of [
    "a.",
    "a..b",
    "a.[0]",
    "a[-1]",
    "a[1.2]",
    "a[]",
    "a[0]b",
    "a[9007199254740992]",
    "a[",
    "a]",
  ]) {
    expect(() => parsePath(path), path).toThrow();
    expect(pathError(path)).not.toBe("");
  }
});
it("入力中の階層と断片に応じて補完する", () => {
  expect(pathSuggestions(root, "cha")).toEqual(["chapters"]);
  expect(pathSuggestions(root, "chapters")).toEqual(["chapters[0]"]);
  expect(pathSuggestions(root, "chapters[")).toEqual(["chapters[0]"]);
  expect(pathSuggestions(root, "chapters[0].ti")).toEqual([
    "chapters[0].title",
  ]);
  expect(pathSuggestions(root, 'chapters[0]["a.')).toEqual([
    'chapters[0]["a.b"]',
  ]);
  expect(pathSuggestions(root, 'chapters[0]["a.b"]')).toEqual([
    'chapters[0]["a.b"][""]',
  ]);
  expect(pathSuggestions([{}, {}], "[")).toEqual(["[0]", "[1]"]);
  expect(pathSuggestions(root, "missing.")).toEqual([]);
  expect(pathSuggestions(Array(200).fill(1), "")).toHaveLength(101);
});
