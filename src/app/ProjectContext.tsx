import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  emptyTableView,
  loadProject,
  sendCommand,
  exportProject,
  subscribeProject,
  CommandError,
  type Command,
  type Snapshot,
} from "../api/project";
type ProjectContextValue = {
  project: Snapshot | null;
  dispatch: (
    command: Command,
    onSettled?: (succeeded: boolean, snapshot?: Snapshot) => void,
  ) => void;
  error: string;
  pending: number;
  openProject: (document: unknown) => Promise<void>;
  prepareExport: () => Promise<{ blob: Blob; revision: number }>;
  markExported: (revision: number) => void;
  dirty: boolean;
  connected: boolean;
  conflicts: { id: number; command: Command; message: string }[];
  resolveConflict: (id: number, retry: boolean) => void;
};
const Context = createContext<ProjectContextValue | null>(null);
export function ProjectProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState<Snapshot | null>(null);
  const current = useRef<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(0);
  const [exportedRevision, setExportedRevision] = useState<number | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [connected, setConnected] = useState(false);
  const [conflicts, setConflicts] = useState<
    { id: number; command: Command; message: string }[]
  >([]);
  const conflictId = useRef(0);
  const unresolved = useRef(0);
  const editing = useRef(false);
  const alive = useRef(true);
  function accept(next: Snapshot) {
    if (
      !alive.current ||
      (current.current && next.revision < current.current.revision)
    )
      return;
    current.current = next;
    if (!editing.current) setProject(next);
  }
  const dirty = !!project && project.revision !== exportedRevision;
  useEffect(() => {
    alive.current = true;
    let refreshing = false,
      again = false;
    async function refresh() {
      if (refreshing) {
        again = true;
        return;
      }
      refreshing = true;
      do {
        again = false;
        try {
          accept(await loadProject());
          if (alive.current) setError("");
        } catch {
          if (alive.current) {
            setConnected(false);
            setError(
              "コアに接続できません。自動的に再接続します。未反映の入力は保存前に確認してください。",
            );
          }
        }
      } while (again && alive.current);
      refreshing = false;
    }
    void refresh();
    const unsubscribe = subscribeProject(() => void refresh(), setConnected);
    const focus = (event: FocusEvent) => {
      editing.current =
        event.target instanceof HTMLElement &&
        event.target.matches("textarea.cell, input.node-title-input");
    };
    const blur = () => {
      // React の onBlur が入力を操作キューへ渡した後に、保留した画面更新を反映する。
      queueMicrotask(() => {
        editing.current =
          document.activeElement instanceof HTMLElement &&
          document.activeElement.matches(
            "textarea.cell, input.node-title-input",
          );
        if (!editing.current && current.current && alive.current)
          setProject(current.current);
      });
    };
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", blur);
    return () => {
      alive.current = false;
      unsubscribe();
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", blur);
    };
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      const input = document.activeElement;
      const editing =
        (input instanceof HTMLTextAreaElement ||
          input instanceof HTMLInputElement) &&
        input.value !== input.dataset.committedValue;
      if (
        current.current?.revision !== exportedRevision ||
        editing ||
        unresolved.current > 0
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [exportedRevision]);
  function enqueue(
    command: Command,
    retainOnFailure: boolean,
  ): Promise<Snapshot> {
    setPending((n) => n + 1);
    const task = queue.current
      .then(async () => {
        if (!current.current)
          throw new Error(
            "未反映の操作があります。必要な入力を控えてから再読み込みしてください。",
          );
        try {
          let next: Snapshot;
          try {
            next = await sendCommand(current.current.revision, command);
          } catch (e) {
            // 変更前の値の比較条件があれば、無関係な変更との revision 競合だけを安全に再試行できる。
            if (
              !(e instanceof CommandError) ||
              e.status !== 409 ||
              !(
                (command.type === "paste" && command.expectedValues) ||
                command.type === "setViewQuery" ||
                command.type === "setViewColumns"
              )
            )
              throw e;
            const latest = await loadProject();
            accept(latest);
            next = await sendCommand(latest.revision, command);
          }
          accept(next);
          setError("");
          return next;
        } catch (e) {
          if (retainOnFailure) {
            unresolved.current++;
            setConflicts((old) => [
              ...old,
              {
                id: ++conflictId.current,
                command,
                message:
                  e instanceof Error ? e.message : "通信に失敗しました。",
              },
            ]);
            try {
              accept(await loadProject());
            } catch {
              setConnected(false);
            }
          }
          throw e;
        }
      })
      .finally(() => setPending((n) => n - 1));
    // 個別の呼び出し元へ失敗を返しつつ、次の要求へ rejected Promise を伝播させない。
    queue.current = task.catch(() => {});
    return task;
  }
  function dispatch(
    command: Command,
    onSettled?: (succeeded: boolean, snapshot?: Snapshot) => void,
  ) {
    void enqueue(command, true).then(
      (snapshot) => onSettled?.(true, snapshot),
      () => onSettled?.(false),
    );
  }
  async function openProject(document: unknown) {
    const next = await enqueue({ type: "openProject", document }, false);
    setExportedRevision(next.revision);
  }
  async function prepareExport() {
    await queue.current;
    if (!current.current || unresolved.current)
      throw new Error(
        "未反映の操作があります。再適用または破棄してから保存してください。",
      );
    return exportProject();
  }
  function resolveConflict(id: number, retry: boolean) {
    const conflict = conflicts.find((item) => item.id === id);
    if (!conflict) return;
    unresolved.current--;
    setConflicts((old) => old.filter((item) => item.id !== id));
    if (retry) {
      const command = conflict.command;
      // 明示的な再適用でも、確認後に届いた変更を無条件に上書きしない。
      if (command.type === "paste") {
        const table = current.current?.tables.find((t) => t.id === command.id);
        dispatch({
          ...command,
          expectedValues: command.values.map((cells, r) =>
            cells.map(
              (_, c) => table?.rows[command.row + r]?.[command.col + c] ?? null,
            ),
          ),
        });
      } else if (
        command.type === "setViewQuery" ||
        command.type === "setViewColumns"
      ) {
        const view =
          current.current?.tables.find((t) => t.id === command.id)?.view ??
          emptyTableView;
        dispatch(
          command.type === "setViewQuery"
            ? { ...command, expectedQuery: view.query }
            : { ...command, expectedColumns: view.columns },
        );
      } else if (command.type === "moveNodeToSheet") {
        const table = current.current?.tables.find((t) => t.id === command.id);
        dispatch({
          ...command,
          expectedSheetId: table?.sheetId ?? command.expectedSheetId,
        });
      } else if (command.type === "renameSheet") {
        const title = current.current?.sheets?.find(
          (s) => s.id === command.id,
        )?.title;
        dispatch({ ...command, expectedTitle: title ?? command.expectedTitle });
      } else if (command.type === "rename") {
        const title = current.current?.tables.find(
          (t) => t.id === command.id,
        )?.title;
        dispatch({ ...command, expectedTitle: title ?? command.expectedTitle });
      } else dispatch(command);
    }
  }
  return (
    <Context.Provider
      value={{
        project,
        dispatch,
        error,
        pending,
        openProject,
        prepareExport,
        markExported: setExportedRevision,
        dirty,
        connected,
        conflicts,
        resolveConflict,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useProject() {
  const value = useContext(Context);
  if (!value) throw new Error("ProjectProvider が必要です");
  return value;
}
