import { describe, expect, it } from "vitest";
import { formatTsv, parseTsv } from "./clipboard";
describe("表計算ソフトとの TSV 受け渡し", () => {
  it("日本語、空セル、CRLF、末尾改行を扱う", () => {
    expect(parseTsv("りんご\t3\t\r\nみかん\t5\t備考\r\n")).toEqual([
      ["りんご", "3", ""],
      ["みかん", "5", "備考"],
    ]);
  });
  it("セル内の改行・タブ・引用符を往復できる", () => {
    const rows = [
      ["一行目\n二行目", "a\tb", '"日本語"'],
      ["", "", ""],
    ];
    expect(parseTsv(formatTsv(rows))).toEqual(rows);
  });
  it("不正な引用符は切り捨てずエラーにする", () => {
    expect(() => parseTsv('"途中')).toThrow();
  });
});
