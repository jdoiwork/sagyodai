import type { TableData } from "../../api/project";
import { useProject } from "../../app/ProjectContext";

export function SummaryFooter({ table }: { table: TableData }) {
  const { dispatch } = useProject();
  if (!table.footer) return null;
  return (
    <tfoot className="summary-footer">
      <tr>
        <th scope="row" title="集計（データ行には含みません）">
          Σ
        </th>
        {table.columns.map((name, col) => (
          <td key={col}>
            <select
              aria-label={`${table.title} ${col + 1}列 ${name} の集計`}
              value={
                table.footer?.[col] === "mode"
                  ? "mode"
                  : table.footer?.[col]
                    ? "sum"
                    : ""
              }
              onChange={(event) =>
                dispatch({
                  type: "setFooter",
                  id: table.id,
                  expectedColumns: table.columns,
                  columns: table.columns.map((_, index) =>
                    index === col
                      ? event.target.value === "mode"
                        ? "mode"
                        : event.target.value === "sum"
                      : (table.footer?.[index] ?? false),
                  ),
                })
              }
            >
              <option value="">集計なし</option>
              <option value="sum">SUM</option>
              <option value="mode">最頻値</option>
            </select>
            {table.footer?.[col] && (
              <output
                aria-label={`${table.title} ${col + 1}列 ${table.footer?.[col] === "mode" ? "最頻値" : "合計"}`}
                title={
                  table.footer?.[col] === "mode"
                    ? "空欄・空白のみは対象外。同率は元の行順で最初の値。表示の絞り込み・並べ替えには影響されません"
                    : table.columnSchema?.[col]?.config.dataType === "integer"
                      ? "整数値を正確に集計。nullは除外し、入力の型エラーは表示します"
                      : "空欄と数値以外は集計対象外"
                }
              >
                {table.footerTotals?.[col] ?? "—"}
              </output>
            )}
          </td>
        ))}
      </tr>
    </tfoot>
  );
}
