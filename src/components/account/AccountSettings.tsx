"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Avatar, PRESENCE, PRESENCE_CHOICES } from "@/components/Avatar";
import { Icon, type IconName } from "@/components/Icon";
import { toast } from "@/components/ui/overlay";
import { MediaPicker } from "@/components/MediaPicker";
import { db, type Profile, type ProfileLink, type WorkStatus } from "@/lib/local/db";
import { IDLE_AFTER, useShownPresence } from "@/lib/local/presence";
import { updateProfile } from "@/lib/local/rooms";
import { setNameHints, useNameHints } from "@/lib/name-hints";
import { setTheme, useTheme } from "@/lib/theme";
import { liveStatus, type StatusExpiry } from "@/lib/status";
import { AvatarCropper } from "./AvatarCropper";
import { MyAccountSection } from "./MyAccountSection";
import { ExpiryChoices, resolveExpiry } from "./StatusDialog";
import { BIO_MAX, LINKS_MAX, normalizeUrl, WORK_STATUS } from "./ProfileExtras";

export type SettingsSection = "account" | "profile" | "display";
const SECTIONS: { id: SettingsSection; label: string; icon: IconName }[] = [
  { id: "account", label: "マイアカウント", icon: "gear" },
  { id: "profile", label: "プロフィール", icon: "person" },
  { id: "display", label: "表示", icon: "palette" },
];

/**
 * アカウントの設定（Discord のユーザー設定と同じく、画面全体に出す）。
 * 左に項目の一覧、右にその中身。右上の「×」か Esc で閉じる
 */
export function AccountSettings({ me, initial = "account", onClose }: { me: Profile; initial?: SettingsSection; onClose: () => void }) {
  const [section, setSection] = useState<SettingsSection>(initial);

  useEffect(() => {
    // 中から開いた確認や入力のダイアログがあるときは、そちらを先に閉じる
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && document.querySelectorAll("[data-overlay]").length <= 1) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="アカウントの設定"
      data-overlay=""
      data-name="アカウントの設定"
      className="fixed inset-0 z-[56] flex flex-col bg-bg md:flex-row"
    >
      <nav
        data-name="設定の項目"
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-sidebar px-3 py-2 md:w-60 md:flex-col md:overflow-visible md:border-r md:border-b-0 md:py-8"
      >
        <p className="hidden px-3 pb-1 text-xs font-bold tracking-wide text-muted md:block">ユーザー設定</p>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-current={section === s.id ? "page" : undefined}
            onClick={() => setSection(s.id)}
            className={`flex min-h-[36px] shrink-0 items-center gap-2 rounded-[10px] px-3 py-1.5 text-left transition ${section === s.id ? "bg-accent font-bold text-accent-ink" : "hover:bg-tint"}`}
          >
            <Icon name={s.icon} size={18} />
            {s.label}
          </button>
        ))}
      </nav>

      <div className="relative min-h-0 flex-1 overflow-y-auto px-4 pt-6 pb-10 md:px-10 md:pt-8">
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          title="閉じる（Esc）"
          className="fixed top-3 right-3 z-10 grid h-10 w-10 place-items-center rounded-full border border-line bg-card text-muted hover:text-ink md:top-8 md:right-8"
        >
          <Icon name="x" size={20} />
        </button>
        <div className="max-w-2xl space-y-4">
          {section === "account" ? <MyAccountSection key={me.id} me={me} /> : section === "profile" ? <ProfileSection key={me.id} me={me} /> : <DisplaySection />}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ProfileSection({ me }: { me: Profile }) {
  const file = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(me.displayName);
  // 期限を過ぎたひとことは、無いものとして扱う
  const current = liveStatus(me) ? me.statusExpiresAt : undefined;
  const [status, setStatus] = useState(liveStatus(me) ?? "");
  const [expiry, setExpiry] = useState<StatusExpiry | "keep">(current ? "keep" : "never");
  // アイコンにする画像を選ぶ画面と、切り抜く画面（切り抜く元の画像）
  const [picking, setPicking] = useState(false);
  const [cropping, setCropping] = useState<Blob | null>(null);
  const presence = me.presence ?? "online";
  const shown = useShownPresence(me.id)(me);
  const dirty = name.trim() !== me.displayName || status.trim() !== (liveStatus(me) ?? "") || expiry !== (current ? "keep" : "never");

  const save = async () => {
    if (!name.trim()) return toast("表示名を入れてください");
    const t = status.trim();
    const at = t ? resolveExpiry(expiry, current) : undefined;
    await updateProfile(me.id, { displayName: name.trim(), statusText: t || undefined, statusExpiresAt: at });
    setExpiry(at ? "keep" : "never");
    toast("プロフィールを保存しました");
  };

  return (
    <>
      <h1 className="mb-5 text-[28px] font-bold">プロフィール</h1>

      <section data-name="アイコン" className="card">
        <h2 className="mb-3 font-bold">アイコン</h2>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={name || me.displayName} src={me.avatar} size={80} presence={shown} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn" onClick={() => file.current?.click()}>
              <Icon name="upload" size={18} />
              画像をアップロード
            </button>
            <button type="button" className="btn-sub" onClick={() => setPicking(true)}>
              <Icon name="folder" size={18} />
              マイメディアから選ぶ
            </button>
            {me.avatar && (
              <button type="button" className="btn-sub" onClick={() => updateProfile(me.id, { avatar: undefined })}>
                画像を外す
              </button>
            )}
          </div>
          <input
            ref={file}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) setCropping(f);
            }}
          />
        </div>
        <p className="mt-3 text-sm text-muted">選んだ画像は、丸の中に入る場所と大きさを決めてから使います。画像が無いときは、名前の最初の1文字を出します。</p>
      </section>
      {/* マイメディアから1枚選ぶ（ほかのボックスや共有されたボックスからは選ばない） */}
      {picking && (
        <div data-overlay="">
          <MediaPicker
            roomId=""
            userId={me.id}
            single
            mineOnly
            pickLabel="この画像を使う"
            onClose={() => setPicking(false)}
            onPick={async ([id]) => {
              setPicking(false);
              const blob = id ? (await db.mediaBlobs.get(id))?.original : undefined;
              if (blob) setCropping(blob);
              else toast("この画像は読み込めませんでした");
            }}
          />
        </div>
      )}
      {cropping && (
        <AvatarCropper
          source={cropping}
          onCancel={() => setCropping(null)}
          onDone={async (avatar) => {
            setCropping(null);
            await updateProfile(me.id, { avatar });
            toast("アイコンを変えました");
          }}
        />
      )}

      <form
        data-name="名前とひとこと"
        className="card space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="block">
          <span className="mb-1 block font-bold">表示名</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} className="field" />
        </label>
        <label className="block">
          <span className="mb-1 block font-bold">ひとこと</span>
          <span className="mb-1.5 block text-sm text-muted">左下の名前の下や、フレンドの一覧に出ます。</span>
          <input value={status} onChange={(e) => setStatus(e.target.value)} maxLength={60} placeholder="例：作業中・〇日まで返信が遅れます" className="field" />
        </label>
        {/* ひとことを自動で消すまで（ひとことがあるときだけ） */}
        {status.trim() && (
          <div>
            <p className="mb-1.5 text-sm font-bold">自動で消すまで</p>
            <ExpiryChoices value={expiry} onChange={setExpiry} current={current} />
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {dirty && (
            <button
              type="button"
              className="btn-sub"
              onClick={() => {
                setName(me.displayName);
                setStatus(liveStatus(me) ?? "");
                setExpiry(current ? "keep" : "never");
              }}
            >
              元に戻す
            </button>
          )}
          <button className="btn" disabled={!dirty}>
            保存
          </button>
        </div>
      </form>

      <WorkSection key={me.id} me={me} />

      <section data-name="状態" className="card">
        <h2 className="mb-3 font-bold">状態</h2>
        <div className="grid gap-1 sm:grid-cols-2" role="radiogroup" aria-label="状態">
          {PRESENCE_CHOICES.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={presence === p}
              onClick={() => updateProfile(me.id, { presence: p })}
              className={`flex min-h-[40px] items-center gap-2 rounded-[10px] border px-3 text-left transition ${presence === p ? "border-accent bg-tint font-bold" : "border-line hover:bg-tint"}`}
            >
              <span className={`h-3 w-3 shrink-0 rounded-full ${PRESENCE[p].dot}`} />
              {PRESENCE[p].label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-sm text-muted">
          サイトを開いている間だけ、この状態で見えます（閉じているときはオフライン）。「オンライン」のとき、{IDLE_AFTER / 60_000}分操作しないと自動で退席中になります。「取り込み中」の間は、未読の数を灰色にし、タブの題名にも出さず、通知を控えます。「オフライン表示」にすると、ほかの人にはオフラインに見えます。
        </p>
      </section>
    </>
  );
}

/** 自己紹介と仕事用の情報（受付状況・リンク）。ほかの人のプロフィールのカードに出る */
function WorkSection({ me }: { me: Profile }) {
  const [bio, setBio] = useState(me.bio ?? "");
  const [work, setWork] = useState<WorkStatus | undefined>(me.workStatus);
  // 入力中のリンク。空の行は保存しない
  const [links, setLinks] = useState<ProfileLink[]>(me.links?.length ? me.links : [{ url: "" }]);
  const filled = links.filter((l) => l.url.trim());
  const bad = filled.filter((l) => !normalizeUrl(l.url));
  const dirty =
    bio.trim() !== (me.bio ?? "") ||
    work !== me.workStatus ||
    JSON.stringify(filled.map((l) => [l.label?.trim() ?? "", l.url.trim()])) !== JSON.stringify((me.links ?? []).map((l) => [l.label ?? "", l.url]));
  const setLink = (i: number, patch: Partial<ProfileLink>) => setLinks((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const save = async () => {
    if (bad.length) return toast("リンクの URL を確かめてください（http:// か https:// で始まるもの）");
    const saved = filled.map((l) => ({ ...(l.label?.trim() ? { label: l.label.trim() } : {}), url: normalizeUrl(l.url)! }));
    await updateProfile(me.id, { bio: bio.trim() || undefined, workStatus: work, links: saved.length ? saved : undefined });
    setLinks(saved.length ? saved : [{ url: "" }]);
    toast("自己紹介と仕事の情報を保存しました");
  };

  return (
    <form
      data-name="自己紹介と仕事の情報"
      className="card space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div>
        <h2 className="mb-1 font-bold">依頼の受付状況</h2>
        <p className="mb-2 text-sm text-muted">プロフィールのカードの名前の下に出ます。</p>
        <div className="grid gap-1 sm:grid-cols-4" role="radiogroup" aria-label="依頼の受付状況">
          {[...(Object.keys(WORK_STATUS) as WorkStatus[]), undefined].map((w) => (
            <button
              key={w ?? "none"}
              type="button"
              role="radio"
              aria-checked={work === w}
              onClick={() => setWork(w)}
              className={`flex min-h-[40px] items-center gap-2 rounded-[10px] border px-3 text-left text-sm transition ${work === w ? "border-accent bg-tint font-bold" : "border-line hover:bg-tint"}`}
            >
              {w ? <span className={`h-3 w-3 shrink-0 rounded-full ${WORK_STATUS[w].dot}`} /> : <Icon name="eyeoff" size={14} className="shrink-0 text-muted" />}
              {w ? WORK_STATUS[w].label : "表示しない"}
            </button>
          ))}
        </div>
      </div>

      <label className="block">
        <span className="mb-1 flex items-baseline justify-between gap-2">
          <span className="font-bold">自己紹介</span>
          <span className={`text-xs ${bio.length > BIO_MAX * 0.9 ? "text-warn" : "text-muted"}`}>
            {bio.length} / {BIO_MAX}
          </span>
        </span>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={BIO_MAX}
          rows={5}
          placeholder={"例：キャラクターイラストを描いています。\n得意：厚塗り・デフォルメ\n納期の目安：ラフまで1週間"}
          className="field min-h-28 resize-y"
        />
      </label>

      <div>
        <h2 className="mb-1 font-bold">リンク</h2>
        <p className="mb-2 text-sm text-muted">ポートフォリオや SNS など（{LINKS_MAX}つまで）。名前を空にすると、サイトの名前を出します。</p>
        <ul className="space-y-2">
          {links.map((l, i) => {
            const wrong = !!l.url.trim() && !normalizeUrl(l.url);
            return (
              <li key={i} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                <input value={l.label ?? ""} onChange={(e) => setLink(i, { label: e.target.value })} maxLength={30} placeholder="名前（例：ポートフォリオ）" aria-label={`リンク${i + 1}の名前`} className="field w-full sm:w-44" />
                <input
                  value={l.url}
                  onChange={(e) => setLink(i, { url: e.target.value })}
                  inputMode="url"
                  placeholder="https://"
                  aria-label={`リンク${i + 1}の URL`}
                  aria-invalid={wrong}
                  className={`field min-w-0 flex-1 ${wrong ? "border-warn" : ""}`}
                />
                <button
                  type="button"
                  aria-label={`リンク${i + 1}を消す`}
                  title="消す"
                  onClick={() => setLinks((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [{ url: "" }]))}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted hover:bg-tint hover:text-ink"
                >
                  <Icon name="x" size={18} />
                </button>
              </li>
            );
          })}
        </ul>
        {bad.length > 0 && <p className="mt-1 text-sm text-warn">開けない URL があります。http:// か https:// で始まる URL を入れてください。</p>}
        {links.length < LINKS_MAX && (
          <button type="button" className="btn-sub mt-2" onClick={() => setLinks((ls) => [...ls, { url: "" }])}>
            <Icon name="add" size={16} />
            リンクを追加
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {dirty && (
          <button
            type="button"
            className="btn-sub"
            onClick={() => {
              setBio(me.bio ?? "");
              setWork(me.workStatus);
              setLinks(me.links?.length ? me.links : [{ url: "" }]);
            }}
          >
            元に戻す
          </button>
        )}
        <button className="btn" disabled={!dirty}>
          保存
        </button>
      </div>
    </form>
  );
}

/** この端末だけの設定（もとはルームの設定にあったもの） */
function DisplaySection() {
  const theme = useTheme();
  const nameHints = useNameHints();
  return (
    <>
      <h1 className="mb-5 text-[28px] font-bold">表示</h1>

      <section className="card">
        <h2 className="mb-1 font-bold">表示モード</h2>
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
    </>
  );
}
