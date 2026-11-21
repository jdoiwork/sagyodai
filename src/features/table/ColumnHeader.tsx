import type { TableData } from "../../api/project";
import { useProject } from "../../app/ProjectContext";
import { Icon } from "../../components/Icon";
import { Cell } from "./Cell";

export function ColumnHeader({
  table,
  col,
}: {
  table: TableData;
  col: number;
}) {
  const { dispatch } = useProject();
  return (
    <div className="column-heading">
      <Cell
        value={table.columns[col]}
        label={`${table.title} ${col + 1}列の名前`}
        selected={false}
        onSelect={() => {}}
        onNavigate={() => (document.activeElement as HTMLElement)?.blur()}
        onCommit={(name, original) =>
          dispatch({
            type: "renameColumn",
            id: table.id,
            col,
            name,
            expectedColumns: table.columns.map((value, i) =>
              i === col ? original : value,
            ),
          })
        }
      />
      <button
        className="action-danger column-delete"
        aria-label={`${table.title} ${col + 1}列を削除`}
        title="列を削除（Undo で戻せます）"
        disabled={table.columns.length <= 1}
        onClick={() =>
          dispatch({
            type: "removeColumn",
            id: table.id,
            col,
            expectedColumns: table.columns,
            expectedRows: table.rows,
          })
        }
      >
        <Icon name="trash" />
      </button>
    </div>
  );
}
