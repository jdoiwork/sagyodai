import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadSettings, request, settingsSchema, type Settings } from "./api";
import { PathField } from "./PathField";
export function AppSettings() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>設定</button>
      {open &&
        createPortal(
          <SettingsDialog onClose={() => setOpen(false)} />,
          document.body,
        )}
    </>
  );
}
function SettingsDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    ref.current?.showModal();
    let active = true;
    loadSettings()
      .then((v) => {
        if (active) setValue(v);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, []);
  function update(id: string, key: "name" | "program" | "cwd", text: string) {
    setValue(
      (v) =>
        v && {
          ...v,
          favorites: v.favorites.map((f) =>
            f.id === id ? { ...f, [key]: text } : f,
          ),
        },
    );
  }
  async function save() {
    if (!value) return;
    setBusy(true);
    setError("");
    try {
      await request("/api/settings", settingsSchema, value);
      window.dispatchEvent(new Event("sagyodai-settings"));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できません。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className="app-settings-dialog"
      aria-label="設定"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <h2>設定</h2>
      <h3>お気に入りの環境・プログラム</h3>
      <p>
        Python仮想環境などの実行プログラムを登録できます。選択した値はノードにコピーされ、あとから直接編集できます。
      </p>
      <p>
        作業フォルダは省略できます。お気に入りの変更・削除は、設定済みのノードには影響しません。
      </p>
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={busy || !value}>
        {value?.favorites.map((f) => (
          <section key={f.id} className="favorite-editor">
            <label>
              名前
              <input
                aria-label="お気に入りの名前"
                value={f.name}
                onChange={(e) => update(f.id, "name", e.target.value)}
              />
            </label>
            <PathField
              label="実行プログラム"
              value={f.program}
              onChange={(v) => update(f.id, "program", v)}
            />
            <PathField
              label="作業フォルダ"
              directory
              value={f.cwd}
              onChange={(v) => update(f.id, "cwd", v)}
            />
            <button
              onClick={() =>
                setValue(
                  (v) =>
                    v && {
                      ...v,
                      favorites: v.favorites.filter((x) => x.id !== f.id),
                    },
                )
              }
            >
              削除
            </button>
          </section>
        ))}
        <button
          disabled={!value || value.favorites.length >= 50}
          onClick={() =>
            setValue(
              (v) =>
                v && {
                  ...v,
                  favorites: [
                    ...v.favorites,
                    { id: crypto.randomUUID(), name: "", program: "", cwd: "" },
                  ],
                },
            )
          }
        >
          お気に入りを追加
        </button>
      </fieldset>
      <div className="dialog-actions">
        <button disabled={!value || busy} onClick={() => void save()}>
          保存
        </button>
        <button disabled={busy} onClick={onClose}>
          キャンセル
        </button>
      </div>
    </dialog>
  );
}
export function FavoritePicker({
  onSelect,
}: {
  onSelect: (favorite: Settings["favorites"][number]) => void;
}) {
  const [favorites, setFavorites] = useState<Settings["favorites"]>([]);
  const [error, setError] = useState("");
  async function refresh() {
    try {
      setFavorites((await loadSettings()).favorites);
      setError("");
    } catch {
      setError("お気に入りを取得できません。直接入力は利用できます。");
    }
  }
  // フォーカス時にも再取得し、別タブの変更を次の選択時に反映する。
  useEffect(() => {
    void refresh();
    const listener = () => void refresh();
    window.addEventListener("sagyodai-settings", listener);
    return () => window.removeEventListener("sagyodai-settings", listener);
  }, []);
  return (
    <>
      <label>
        お気に入りの環境・プログラム
        <select
          aria-label="お気に入りの環境・プログラム"
          value=""
          onFocus={() => void refresh()}
          onChange={(e) => {
            const favorite = favorites.find((f) => f.id === e.target.value);
            if (favorite) onSelect(favorite);
          }}
        >
          <option value="">直接入力 / お気に入りを選択</option>
          {favorites.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      {error && <small role="alert">{error}</small>}
    </>
  );
}
