"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { confirmAction, promptText, toast } from "@/components/ui/overlay";
import { deleteChannelTemplate, renameChannelTemplate, useChannelTemplates } from "@/lib/local/channelTemplates";
import { useState } from "react";
import { addMember, deleteRoom, renameProfile, renameRoom, useAllProfiles, useMembers, useRoom } from "@/lib/local/rooms";
import { useCurrentUser } from "@/lib/local/session";
import { RoomMediaSettings } from "@/components/media/RoomMediaSettings";
import { setNameHints, useNameHints } from "@/lib/name-hints";
import { setTheme, useTheme } from "@/lib/theme";

function InlineEdit({ value, label, onSave }: { value: string; label: string; onSave: (v: string) => Promise<void> }) {
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!draft.trim()) return;
        await onSave(draft.trim());
        setSaved(true);
      }}
    >
      <input
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setSaved(false);
        }}
        required
        maxLength={60}
        aria-label={label}
        className="field min-w-0 flex-1"
      />
      <button className="btn" disabled={draft.trim() === value}>
        保存
      </button>
      {saved && <span className="text-sm text-muted">保存しました</span>}
    </form>
  );
}

export default function SettingsPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const me = useCurrentUser();
  const room = useRoom(roomId);
  const members = useMembers(roomId);
  const profiles = useAllProfiles();
  const [newName, setNewName] = useState("");
  const theme = useTheme();
  const nameHints = useNameHints();
  const router = useRouter();

  if (!me || !room || !members || !profiles) return null;
  const isHost = members.some((m) => m.userId === me.id && m.role === "host");
  const outsiders = profiles.filter((p) => !members.some((m) => m.userId === p.id));

  return (
    <div data-name="設定画面" className="max-w-2xl space-y-4">
      <h1 className="mb-5 text-[28px] font-bold">設定</h1>

      <section className="card">
        <h2 className="mb-1 font-bold">表示</h2>
        <p className="mb-3 text-sm text-muted">この端末だけの設定です。</p>
        <div className="grid grid-cols-3 gap-1 rounded-full bg-bg p-1" role="radiogroup" aria-label="表示モード">
          {(
            [
              ["system", "端末に合わせる"],
              ["light", "ホワイト"],
              ["dark", "ダーク"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              role="radio"
              aria-checked={theme === v}
              onClick={() => setTheme(v)}
              className={`min-h-[36px] rounded-full px-2 text-sm ${theme === v ? "bg-accent font-bold text-accent-ink" : "text-muted hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="mb-1 font-bold">名称表示</h2>
        <p className="mb-3 text-sm text-muted">
          カーソルをしばらく置くと、その場所やボタンの名前を「サイドバー › チャット一覧 › リンク「雑談」」のように表示します。改善の指示を出すときに、名前を確かめるのに使えます。この端末だけの設定です。
        </p>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={nameHints} onChange={(e) => setNameHints(e.target.checked)} className="h-5 w-5 accent-[var(--accent)]" />
          名称を表示する
        </label>
      </section>

      <h2 className="pt-4 text-lg font-bold">ルーム</h2>

      <TemplatesSection roomId={roomId} />

      <section className="card">
        <h2 className="mb-3 font-bold">ルーム名</h2>
        {isHost ? (
          <InlineEdit key={room.name} value={room.name} label="ルーム名" onSave={(v) => renameRoom(roomId, v)} />
        ) : (
          <p>{room.name}</p>
        )}
      </section>

      <section className="card">
        <h2 className="mb-3 font-bold">自分の表示名</h2>
        <InlineEdit key={me.id} value={me.displayName} label="表示名" onSave={(v) => renameProfile(me.id, v)} />
      </section>

      <RoomMediaSettings roomId={roomId} room={room} me={me} />

      <section className="card">
        <h2 className="mb-3 font-bold">メンバー</h2>
        <ul className="divide-y divide-line">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between py-2">
              <span>
                {m.displayName}
                {m.userId === me.id && <span className="ml-2 text-xs text-muted">（自分）</span>}
              </span>
              <span className="rounded-full bg-tint px-2 text-xs">{m.role === "host" ? "ホスト" : "メンバー"}</span>
            </li>
          ))}
        </ul>
      </section>

      {isHost && (
        <section className="card space-y-3">
          <div>
            <h2 className="mb-1 font-bold">メンバーを追加</h2>
            <p className="text-sm text-muted">サーバー版では招待リンクで参加します。ローカル版では、ここで人を追加します。</p>
          </div>
          {outsiders.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {outsiders.map((p) => (
                <button key={p.id} className="btn-sub" onClick={() => addMember(roomId, { userId: p.id })}>
                  ＋ {p.displayName}
                </button>
              ))}
            </div>
          )}
          <form
            className="flex flex-wrap gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newName.trim()) return;
              await addMember(roomId, { displayName: newName.trim() });
              setNewName("");
            }}
          >
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={30}
              placeholder="新しい人の名前"
              aria-label="新しい人の名前"
              className="field min-w-0 flex-1"
            />
            <button className="btn">追加</button>
          </form>
        </section>
      )}

      {isHost && (
        <section data-name="ルームの削除" className="card space-y-3 border-warn/50">
          <div>
            <h2 className="mb-1 font-bold text-warn">ルームを削除</h2>
            <p className="text-sm text-muted">チャンネル・ページ・メッセージなど、このルームの中身がすべて消えます。元に戻せません。メディアのボックスと画像は消えず、紐づけだけが外れます（メンバーが入れた画像は、それぞれのマイメディアに移ります）。</p>
          </div>
          <button
            className="btn-sub border-warn text-warn hover:bg-warn hover:text-white"
            onClick={async () => {
              const typed = await promptText(`削除するには、ルーム名「${room.name}」を入力してください`, "", room.name);
              if (typed === null) return;
              if (typed.trim() !== room.name) {
                toast("ルーム名が違うため、削除しませんでした");
                return;
              }
              if (!(await confirmAction(`ルーム「${room.name}」を削除します`, "削除", "元に戻せません。"))) return;
              // 消したルームの画面に残らないよう、先に移動してから消す
              router.replace("/");
              await deleteRoom(roomId);
              toast(`ルーム「${room.name}」を削除しました`);
            }}
          >
            <Icon name="del" />
            ルームを削除
          </button>
        </section>
      )}
    </div>
  );
}

/** ルームのテンプレート（ウィンドウ・ノートの「ソース」に選べるもの）：開いて直す・名前を変える・消す */
function TemplatesSection({ roomId }: { roomId: string }) {
  const templates = useChannelTemplates(roomId) ?? [];
  return (
    <section className="card" data-name="テンプレートの一覧">
      <h2 className="mb-1 font-bold">ウィンドウ・ノートのテンプレート</h2>
      <p className="mb-3 text-sm text-muted">
        サイドバーのウィンドウ・ノートを右クリック →「ソース」で選べます。テンプレートを直すと、使っているところ全部が変わります。
      </p>
      {templates.length ? (
        <ul className="divide-y divide-line">
          {templates.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2 py-2">
              <Icon name={t.kind === "window" ? "window" : "note"} size={16} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate font-bold">{t.name}</span>
              <span className="text-xs text-muted">{t.uses}個で使用中</span>
              <Link href={`/r/${roomId}/${t.kind}/${t.id}${t.kind === "window" ? "?edit=1" : ""}`} className="btn-sub h-8 min-h-0 px-3 text-sm">
                <Icon name="edit" size={14} />
                開いて直す
              </Link>
              <button
                className="btn-sub h-8 min-h-0 px-3 text-sm"
                onClick={async () => {
                  const name = await promptText("テンプレートの名前", t.name);
                  if (name) await renameChannelTemplate(t.kind, t.id, name);
                }}
              >
                名前を変更
              </button>
              <button
                className="btn-sub h-8 min-h-0 w-8 px-0 text-warn"
                aria-label={`テンプレート「${t.name}」を削除`}
                title="削除"
                onClick={async () => {
                  const body = t.uses ? `使っている${t.uses}個は、今の内容のままテンプレートから切り離されます（内容は消えません）。` : undefined;
                  if (await confirmAction(`テンプレート「${t.name}」を削除します`, "削除", body)) await deleteChannelTemplate(t.kind, t.id);
                }}
              >
                <Icon name="del" size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">まだありません。サイドバーのウィンドウ・ノートを右クリック →「ソース」→「今の内容から新しいテンプレートを作る」で作れます。</p>
      )}
    </section>
  );
}
