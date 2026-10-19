"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { MenuItem, Popover, usePopover } from "@/components/ui/Popover";
import { choose, confirmAction, toast } from "@/components/ui/overlay";
import type { Profile } from "@/lib/local/db";
import { openDm } from "@/lib/local/dm";
import { inviteFriend, roomsToInvite } from "@/lib/local/invites";
import { acceptFriend, removeFriendship, requestFriendByUsername, useFriendships, type FriendRow } from "@/lib/local/friends";
import { useAllProfiles } from "@/lib/local/rooms";
import { useNow, useShownPresence, type ShownPresence } from "@/lib/local/presence";
import { liveStatus } from "@/lib/status";
import { useCurrentUser } from "@/lib/local/session";
import { UserCardButton } from "@/components/account/UserCard";
import { Avatar } from "@/components/Avatar";
import { badgeTone, useDoNotDisturb } from "@/lib/local/dnd";
import { authMode } from "@/lib/auth/mode";
import { checkUsername, normalizeUsername, USERNAME_MAX } from "@/lib/username";

type Tab = "all" | "pending" | "add";

/** 何も無いときの案内 */
function Empty({ icon, title, body, children }: { icon: IconName; title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="grid place-items-center gap-2 py-16 text-center">
      <span className="mb-1 grid h-16 w-16 place-items-center rounded-full bg-tint text-accent">
        <Icon name={icon} size={32} />
      </span>
      <p className="font-bold">{title}</p>
      <p className="text-sm text-muted">{body}</p>
      {children}
    </div>
  );
}

/** 人の1行：左にアイコンと名前、右に操作 */
function PersonRow({ person, note, presence, children }: { person: Profile; note?: string; presence?: ShownPresence; children: React.ReactNode }) {
  const name = person.displayName;
  return (
    <li data-name={`人（${name}）`} className="flex items-center gap-3 border-t border-line px-2 py-2 first:border-t-0">
      {/* フレンドには状態の印を付ける（オフライン表示の人は灰色＝オフラインに見える）。押すとプロフィールのカード */}
      <UserCardButton userId={person.id} label={name} className="-my-1 -ml-1 flex min-w-0 flex-1 items-center gap-3 rounded-[10px] p-1 text-left hover:bg-tint">
        <Avatar name={name} src={person.avatar} presence={presence} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold">{name}</span>
          {note && <span className="block truncate text-xs text-muted">{note}</span>}
        </span>
      </UserCardButton>
      <span className="flex shrink-0 items-center gap-1">{children}</span>
    </li>
  );
}

const roundBtn = "grid h-9 w-9 place-items-center rounded-full border border-line bg-card text-muted transition hover:bg-tint hover:text-ink";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-1 text-xs font-bold tracking-wide text-muted">{children}</h2>;
}

function NoneBox({ children }: { children: React.ReactNode }) {
  return <p className="rounded-[10px] border border-dashed border-line px-3 py-4 text-center text-sm text-muted">{children}</p>;
}

/** フレンドの行の操作：DM を開く・その他（解除） */
function FriendActions({ me, row }: { me: Profile; row: FriendRow }) {
  const router = useRouter();
  const menu = usePopover();
  return (
    <>
      <button
        className={roundBtn}
        aria-label={`${row.other.displayName}さんにメッセージ`}
        title="メッセージ"
        onClick={async () => router.push(`/dm/${await openDm(me.id, row.other.id)}`)}
      >
        <Icon name="chat" size={18} />
      </button>
      <button className={roundBtn} aria-label="その他" title="その他" aria-haspopup="menu" aria-expanded={!!menu.anchor} onClick={menu.toggle}>
        <Icon name="dots" size={18} />
      </button>
      <Popover anchor={menu.anchor} onClose={menu.close} width={200} label="フレンドのメニュー">
        {/* 自分が招待できるルームから選んで、招待のカードを DM に送る */}
        <MenuItem
          icon={<Icon name="add" size={16} />}
          onClick={async () => {
            menu.close();
            const rooms = await roomsToInvite(me.id, row.other.id);
            if (!rooms.length) return toast("招待できるルームがありません（もう参加しているか、ホストだけが招待できるルームです）");
            const i = await choose(`${row.other.displayName}さんをルームに招待`, rooms.map((r) => ({ label: r.name })), "招待は、このDMにカードで届きます。");
            if (i === null) return;
            const r = await inviteFriend(rooms[i].id, me.id, row.other.id);
            toast(r === "sent" ? `ルーム「${rooms[i].name}」に招待しました` : r === "invited" ? "もう招待を送っています" : "招待を送れませんでした");
          }}
        >
          ルームに招待
        </MenuItem>
        <MenuItem
          icon={<Icon name="x" size={16} />}
          danger
          onClick={async () => {
            menu.close();
            if (await confirmAction(`${row.other.displayName}さんとのフレンドを解除します`, "解除", "DMのやり取りは残りますが、新しいメッセージは送れなくなります。")) {
              await removeFriendship(row.friendship.id);
            }
          }}
        >
          フレンドを解除
        </MenuItem>
      </Popover>
    </>
  );
}

/** 相手の ID を入れて申請を送る（Discord と同じく、名前では探さない） */
function AddFriend({ me }: { me: Profile }) {
  const profiles = useAllProfiles();
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async () => {
    const id = normalizeUsername(text);
    if (!id) return;
    const bad = checkUsername(id);
    if (bad) return setResult({ ok: false, text: bad });
    const { result: r, other } = await requestFriendByUsername(me.id, id);
    if (r === "notFound" || !other) return setResult({ ok: false, text: `ID が「${id}」の人は見つかりません。ID を確かめてください。` });
    const name = other.displayName;
    const message = {
      sent: `${name}さん（${other.username}）に申請を送りました。承認されるとフレンドになります。`,
      accepted: `${name}さんからも申請が届いていたので、フレンドになりました。`,
      already: `${name}さんとは、もうフレンドです。`,
      pending: `${name}さんには、もう申請を送っています。`,
      self: "自分の ID です。自分には申請を送れません。",
    }[r];
    setResult({ ok: r === "sent" || r === "accepted", text: message });
    if (r === "sent" || r === "accepted") setText("");
  };

  const others = profiles?.filter((p) => p.id !== me.id) ?? [];
  return (
    <section className="card">
      <h2 className="w-fit font-bold" title="相手の ID で申請を送ります。相手が承認すると、フレンドになります">
        フレンドを追加
      </h2>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResult(null);
          }}
          placeholder="相手の ID（例：illust_taro）"
          aria-label="相手の ID"
          maxLength={USERNAME_MAX + 8}
          autoCapitalize="none"
          spellCheck={false}
          className="field min-w-0 flex-1"
        />
        <button className="btn" disabled={!normalizeUsername(text)}>
          申請を送る
        </button>
      </form>
      {result && <p className={`mt-2 text-sm ${result.ok ? "text-accent" : "text-warn"}`}>{result.text}</p>}
      <p className="mt-2 text-xs text-muted">
        自分の ID は <b className="text-ink">{me.username}</b> です（左下の歯車 → マイアカウントで変えられます）。
      </p>
      {/* ローカル版だけ：登録されている人を押すと、その人の ID が入力欄に入る（サーバー版では、ほかの人の ID は相手から教えてもらう） */}
      {authMode === "local" && others.length > 0 && (
        <div data-name="登録されている人（ローカル版のみ）" className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-line pt-3 text-sm">
          <span className="text-xs text-muted">登録されている人（ローカル版のみ）：</span>
          {others.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setText(p.username);
                setResult(null);
              }}
              className="rounded-full border border-line px-2.5 py-0.5 hover:bg-tint"
            >
              {p.displayName}
              <span className="ml-1 text-xs text-muted">{p.username}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * フレンドの画面（DM を開いたときの最初の画面）。
 * 「すべて」はフレンドの一覧、「申請中」は届いた申請と送った申請、「フレンドを追加」は名前で申請を送る
 */
export default function FriendsPage() {
  const me = useCurrentUser();
  const data = useFriendships(me?.id);
  const [tab, setTab] = useState<Tab>("all");
  const quiet = useDoNotDisturb();
  // フレンドの状態（サイトを開いていなければオフライン）
  const shown = useShownPresence(me?.id);
  const now = useNow();

  if (!me || !data) return <p className="loading text-muted">読み込み中…</p>;
  const { friends, incoming, outgoing } = data;
  const tabs: { id: Exclude<Tab, "add">; label: string; badge?: number }[] = [
    { id: "all", label: `すべて（${friends.length}）` },
    { id: "pending", label: "申請中", badge: incoming.length },
  ];

  return (
    <div data-name="フレンド" className="mx-auto max-w-3xl">
      <div role="tablist" aria-label="フレンドの表示" className="mb-4 flex flex-wrap items-center gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition ${tab === t.id ? "bg-tint font-bold text-ink" : "text-muted hover:bg-tint hover:text-ink"}`}
          >
            {t.label}
            {!!t.badge && <span className={`rounded-full px-1.5 text-xs leading-5 font-bold ${badgeTone(quiet)}`}>{t.badge}</span>}
          </button>
        ))}
        {/* Discord と同じく、追加だけは目立つ色。開いている間は色を抜いて文字だけ色を付ける */}
        <button
          role="tab"
          aria-selected={tab === "add"}
          onClick={() => setTab("add")}
          className={`rounded-full px-3 py-1 text-sm font-bold transition ${tab === "add" ? "bg-tint text-accent" : "bg-accent text-accent-ink hover:opacity-90"}`}
        >
          フレンドを追加
        </button>
      </div>

      {tab === "all" &&
        (friends.length ? (
          <ul className="card p-1.5">
            {friends.map((row) => (
              <PersonRow key={row.friendship.id} person={row.other} note={liveStatus(row.other, now)} presence={shown(row.other)}>
                <FriendActions me={me} row={row} />
              </PersonRow>
            ))}
          </ul>
        ) : (
          <Empty icon="ppl" title="フレンドはまだいません" body="フレンドになると、DMを送ったり、メディアのボックスを共有したりできます。">
            <button className="btn mt-2" onClick={() => setTab("add")}>
              フレンドを追加
            </button>
          </Empty>
        ))}

      {tab === "pending" && (
        <div className="space-y-6">
          <section>
            <SectionTitle>届いた申請（{incoming.length}）</SectionTitle>
            {incoming.length ? (
              <ul className="card p-1.5">
                {incoming.map((row) => (
                  <PersonRow key={row.friendship.id} person={row.other} note={`${row.other.username}・${new Date(row.friendship.createdAt).toLocaleDateString("ja-JP")} に届きました`}>
                    <button
                      className="btn min-h-[34px] px-3 text-sm"
                      onClick={async () => {
                        await acceptFriend(row.friendship.id);
                        toast(`${row.other.displayName}さんとフレンドになりました`);
                      }}
                    >
                      <Icon name="ok" size={16} />
                      承認
                    </button>
                    <button className="btn-sub min-h-[34px] px-3 text-sm" onClick={() => removeFriendship(row.friendship.id)}>
                      断る
                    </button>
                  </PersonRow>
                ))}
              </ul>
            ) : (
              <NoneBox>ありません</NoneBox>
            )}
          </section>
          <section>
            <SectionTitle>送った申請（{outgoing.length}）</SectionTitle>
            {outgoing.length ? (
              <ul className="card p-1.5">
                {outgoing.map((row) => (
                  <PersonRow key={row.friendship.id} person={row.other} note={`${row.other.username}・承認を待っています`}>
                    <button className="btn-sub min-h-[34px] px-3 text-sm" onClick={() => removeFriendship(row.friendship.id)}>
                      取り消す
                    </button>
                  </PersonRow>
                ))}
              </ul>
            ) : (
              <NoneBox>ありません</NoneBox>
            )}
          </section>
        </div>
      )}

      {/* 利用者を切り替えたら、前の人の入力と結果を消す */}
      {tab === "add" && <AddFriend key={me.id} me={me} />}
    </div>
  );
}
