import { commandInputError } from "../../validation/input";
import { nodeTitleError } from "../canvas/nodeTitleValidation";
import { columnNameError } from "../table/columnName";
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
            {item.command.type === "insertRows" ||
            item.command.type === "insertColumns"
              ? `${item.command.count}${item.command.type === "insertRows" ? "行" : "列"}の挿入（表示を確認して挿入し直してください）`
              : item.command.type === "paste"
                ? item.command.values.map((row) => row.join("\t")).join("\n")
                : item.command.type === "removeRows" ||
                    item.command.type === "removeColumns"
                  ? `選択した${item.command.indices.length}${item.command.type === "removeRows" ? "行" : "列"}の削除（表示を確認して選択し直してください）`
                  : item.command.type === "rename" ||
                      item.command.type === "renameSheet"
                    ? item.command.title
                    : item.command.type === "removeRow"
                      ? `${item.command.row + 1}行の削除（表示を確認して削除し直してください）`
                      : item.command.type === "removeColumn"
                        ? `${item.command.col + 1}列の削除（表示を確認して削除し直してください）`
                        : item.command.type === "renameColumn"
                          ? `${item.command.col + 1}列の名前: ${item.command.name}`
                          : item.command.type === "moveColumns" ||
                              item.command.type === "moveRows"
                            ? `選択した${item.command.indices.length}${item.command.type === "moveRows" ? "行" : "列"}の移動（表示を確認して選択し直してください）`
                            : item.command.type === "moveColumn"
                              ? `列${item.command.from + 1}を列${item.command.to + 1}の位置へ移動`
                              : JSON.stringify(item.command)}
          </pre>
          {item.command.type === "renameColumn" &&
            columnNameError(item.command.name) && (
              <p>
                この入力は再適用できません。操作を破棄して列名を入力し直してください。
              </p>
            )}
          {(item.command.type === "rename" ||
            item.command.type === "renameSheet") &&
            nodeTitleError(item.command.title) && (
              <p>
                この入力は再適用できません。操作を破棄してタイトルを入力し直してください。
              </p>
            )}
          {commandInputError(item.command) && (
            <p>
              {commandInputError(item.command)}{" "}
              操作を破棄して入力を修正してください。
            </p>
          )}
          <button
            disabled={
              !!commandInputError(item.command) ||
              (item.command.type === "renameColumn" &&
                !!columnNameError(item.command.name)) ||
              ((item.command.type === "rename" ||
                item.command.type === "renameSheet") &&
                !!nodeTitleError(item.command.title))
            }
            onClick={() => resolveConflict(item.id, true)}
          >
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
