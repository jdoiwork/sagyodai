import type { TableData, PortSide } from "../../api/project";
import { useProject } from "../../app/ProjectContext";
const sides: [PortSide, string][] = [
  ["top", "上"],
  ["right", "右"],
  ["bottom", "下"],
  ["left", "左"],
];
export function PortSideMenu({
  table,
  onBack,
}: {
  table: TableData;
  onBack: () => void;
}) {
  const { dispatch, pending } = useProject();
  return (
    <>
      <button role="menuitem" onClick={onBack}>
        ← アクションに戻る
      </button>
      {[true, false]
        .filter((input) => !input || !["input", "csv"].includes(table.kind))
        .map((input) => (
          <div key={String(input)}>
            <div className="node-action-caption">
              {input ? "入力端子" : "出力端子"}
            </div>
            <div className="port-side-options">
              {sides.map(([side, label]) => (
                <button
                  key={side}
                  role="menuitemradio"
                  aria-label={`${input ? "入力" : "出力"}端子を${label}に配置`}
                  aria-checked={
                    (input
                      ? (table.inputSide ?? "left")
                      : (table.outputSide ?? "right")) === side
                  }
                  disabled={pending > 0}
                  onClick={() =>
                    dispatch({ type: "setPortSide", id: table.id, input, side })
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ))}
    </>
  );
}
