"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Checkbox } from "@/components/ui/Checkbox";
import { confirmAction, promptText, toast } from "@/components/ui/overlay";
import { deleteChannelTemplate, renameChannelTemplate, useChannelTemplates } from "@/lib/local/channelTemplates";
import { useState } from "react";
import { deleteRoom, renameRoom, useMembers, useRoom } from "@/lib/local/rooms";
import { canInviteTo, setMembersCanInvite } from "@/lib/local/invites";
import { InviteFriendsDialog } from "@/components/InviteFriendsDialog";
import { useCurrentUser } from "@/lib/local/session";
import { RoomMediaSettings } from "@/components/media/RoomMediaSettings";

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
  const [inviting, setInviting] = useState(false);
  const router = useRouter();

  if (!me || !room || !members) return null;
  const myRole = members.find((m) => m.userId === me.id)?.role;
  const isHost = myRole === "host";
  const canInvite = canInviteTo(room, myRole);

  return (
    <div data-name="設定画面" className="max-w-2xl space-y-4">
      <h1 className="mb-5 w-fit text-[28px] font-bold" title="自分の表示名やアイコン、表示モードは、左下の歯車（アカウントの設定）で変えられます">
        ルームの設定
      </h1>
      {/* 自分の表示名・アイコンや、表示モードなどの端末の設定は、左下のアカウントの欄の歯車から開く */}

      <TemplatesSection roomId={roomId} />

      <section className="card">
        <h2 className="mb-3 font-bold">ルーム名</h2>
        {isHost ? (
          <InlineEdit key={room.name} value={room.name} label="ルーム名" onSave={(v) => renameRoom(roomId, v)} />
        ) : (
          <p>{room.name}</p>
        )}
      </section>

      <RoomMediaSettings roomId={roomId} room={room} me={me} />

      <section data-name="メンバー" className="card">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 flex-1 font-bold">メンバー</h2>
          {canInvite && (
            <button type="button" className="btn-sub h-9 min-h-0 px-3 text-sm" onClick={() => setInviting(true)}>
              <Icon name="add" size={16} />
              フレンドを招待
            </button>
          )}
        </div>
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
        {!canInvite && <p className="mt-2 text-xs text-muted">このルームにフレンドを招待できるのは、ホストだけです。</p>}
        {inviting && <InviteFriendsDialog room={room} me={me} onClose={() => setInviting(false)} />}
      </section>

      {/* だれが招待できるか（ホストだけが変えられる） */}
      {isHost && (
        <section data-name="招待できる人" className="card">
          <h2 className="mb-3 w-fit font-bold" title="フレンドとのDMに招待のカードを送り、相手が「参加する」を押すとメンバーになります。ホストはいつでも招待できます">
            招待できる人
          </h2>
          <label className="flex w-fit items-center gap-2" title="オフにすると、招待できるのはホストだけになります（送ってあった招待は、そのまま使えます）">
            <Checkbox checked={!!room.membersCanInvite} onChange={(on) => void setMembersCanInvite(roomId, me.id, on)} />
            メンバーもフレンドを招待できる
          </label>
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
      <h2 className="mb-3 w-fit font-bold" title="サイドバーのウィンドウ・ノートを右クリック →「ソース」で選べます。テンプレートを直すと、使っているところ全部が変わります">
        ウィンドウ・ノートのテンプレート
      </h2>
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
