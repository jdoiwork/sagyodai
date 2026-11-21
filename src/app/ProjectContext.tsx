import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  loadProject,
  sendCommand,
  exportProject,
  type Command,
  type Snapshot,
} from "../api/project";
type ProjectContextValue = {
  project: Snapshot | null;
  dispatch: (command: Command) => void;
  error: string;
  pending: number;
  openProject: (document: unknown) => Promise<void>;
  prepareExport: () => Promise<{ blob: Blob; revision: number }>;
  markExported: (revision: number) => void;
  dirty: boolean;
};
const Context = createContext<ProjectContextValue | null>(null);
export function ProjectProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState<Snapshot | null>(null);
  const current = useRef<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(0);
  const [exportedRevision, setExportedRevision] = useState<number | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const failed = useRef(false);
  const dirty = !!project && project.revision !== exportedRevision;
  useEffect(() => {
    loadProject()
      .then((p) => {
        current.current = p;
        setProject(p);
      })
      .catch(() =>
        setError(
          "Rust コアに接続できません。npm run dev で起動してから再読み込みしてください。",
        ),
      );
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      const input = document.activeElement;
      const editing =
        input instanceof HTMLTextAreaElement &&
        input.value !== input.dataset.committedValue;
      if (dirty || editing) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function enqueue(
    command: Command,
    haltOnFailure: boolean,
  ): Promise<Snapshot> {
    setPending((n) => n + 1);
    const task = queue.current
      .then(async () => {
        if (failed.current || !current.current)
          throw new Error(
            "未反映の操作があります。必要な入力を控えてから再読み込みしてください。",
          );
        try {
          const next = await sendCommand(current.current.revision, command);
          current.current = next;
          setProject(next);
          setError("");
          return next;
        } catch (e) {
          if (haltOnFailure) {
            failed.current = true;
            setError(
              `${e instanceof Error ? e.message : "通信に失敗しました。"} 未反映の操作を止めました。内容を確認して再読み込みしてください。`,
            );
          }
          throw e;
        }
      })
      .finally(() => setPending((n) => n - 1));
    // 個別の呼び出し元へ失敗を返しつつ、次の要求へ rejected Promise を伝播させない。
    queue.current = task.catch(() => {});
    return task;
  }
  function dispatch(command: Command) {
    void enqueue(command, true).catch(() => {});
  }
  async function openProject(document: unknown) {
    const next = await enqueue({ type: "openProject", document }, false);
    setExportedRevision(next.revision);
  }
  async function prepareExport() {
    await queue.current;
    if (failed.current || !current.current)
      throw new Error(
        "未反映の操作があるため保存できません。エラーを確認してください。",
      );
    return exportProject();
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
