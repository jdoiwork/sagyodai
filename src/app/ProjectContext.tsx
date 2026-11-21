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
  type Command,
  type Snapshot,
} from "../api/project";
type ProjectContextValue = {
  project: Snapshot | null;
  dispatch: (command: Command) => void;
  error: string;
  pending: number;
  dismissError: () => void;
};
const Context = createContext<ProjectContextValue | null>(null);
export function ProjectProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState<Snapshot | null>(null);
  const current = useRef<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(0);
  const queue = useRef(Promise.resolve());
  const failed = useRef(false);
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
  function dispatch(command: Command) {
    setPending((n) => n + 1);
    // 連続入力の順序を保ち、前の応答を待ってから次の revision を送る。
    queue.current = queue.current
      .then(async () => {
        if (failed.current || !current.current) return;
        try {
          const next = await sendCommand(current.current.revision, command);
          current.current = next;
          setProject(next);
        } catch (e) {
          failed.current = true;
          setError(
            `${e instanceof Error ? e.message : "通信に失敗しました。"} 未反映の操作を止めました。内容を確認して再読み込みしてください。`,
          );
        }
      })
      .finally(() => setPending((n) => n - 1));
  }
  return (
    <Context.Provider
      value={{
        project,
        dispatch,
        error,
        pending,
        dismissError: () => setError(""),
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
