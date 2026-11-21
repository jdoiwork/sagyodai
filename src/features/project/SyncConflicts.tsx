import { Icon } from "../../components/Icon";
import { useProject } from "../../app/ProjectContext";
export function SyncConflicts() {
  const { conflicts, resolveConflict } = useProject();
  if (!conflicts.length) return null;
  return (
    <aside className="conflict-panel nodrag nopan" aria-label="未反映の操作">
      <strong>未反映の操作（{conflicts.length}件）</strong>
      {conflicts.map((item) => (
        <div key={item.id}>
          <p>{item.message}</p>
          <pre>
            {item.command.type === "paste"
              ? item.command.values.map((row) => row.join("\t")).join("\n")
              : item.command.type === "rename"
                ? item.command.title
                : item.command.type === "removeRow"
                  ? `${item.command.row + 1}行の削除（表示を確認して削除し直してください）`
                  : item.command.type === "removeColumn"
                    ? `${item.command.col + 1}列の削除（表示を確認して削除し直してください）`
                    : item.command.type === "renameColumn"
                      ? `${item.command.col + 1}列の名前: ${item.command.name}`
                      : item.command.type === "moveColumn"
                        ? `列${item.command.from + 1}を列${item.command.to + 1}の位置へ移動`
                        : JSON.stringify(item.command)}
          </pre>
          <button onClick={() => resolveConflict(item.id, true)}>
            <Icon name="refresh" />
            現在の状態に再適用
          </button>
          <button onClick={() => resolveConflict(item.id, false)}>
            <Icon name="close" />
            この操作を破棄
          </button>
        </div>
      ))}
    </aside>
  );
}
