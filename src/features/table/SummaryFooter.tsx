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
              value={table.footer?.[col] ? "sum" : ""}
              onChange={(event) =>
                dispatch({
                  type: "setFooter",
                  id: table.id,
                  expectedColumns: table.columns,
                  columns: table.columns.map((_, index) =>
                    index === col
                      ? event.target.value === "sum"
                      : !!table.footer?.[index],
                  ),
                })
              }
            >
              <option value="">集計なし</option>
              <option value="sum">SUM</option>
            </select>
            {table.footer?.[col] && (
              <output
                aria-label={`${table.title} ${col + 1}列 合計`}
                title="空欄と数値以外は集計対象外"
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
