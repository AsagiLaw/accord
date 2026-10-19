"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, FormError, FormNotice, PasswordInput } from "@/components/auth/AuthParts";
import { useTurnstile } from "@/components/auth/Turnstile";
import { Icon } from "@/components/Icon";
import { Checkbox } from "@/components/ui/Checkbox";
import { PopupDialog } from "@/components/ui/Dialog";
import { toast } from "@/components/ui/overlay";
import { authMode, changeEmail, changePassword, deleteAccount, signOut, useAccountInfo, type AccountInfo } from "@/lib/auth";
import type { AuthResult } from "@/lib/auth/validate";
import type { Profile } from "@/lib/local/db";
import { changeUsername } from "@/lib/local/profiles";
import { useSignedInIds } from "@/lib/local/session";
import { normalizeUsername, USERNAME_MAX, USERNAME_RULE } from "@/lib/username";

const KIND_LABEL: Record<AccountInfo["kind"], string> = {
  password: "メールアドレスとパスワード",
  google: "Google",
  sample: "試し用の利用者（ローカル版。パスワードなし）",
};

/** ログアウトしたあと：ローカル版でほかにもログインしているアカウントがあれば、そちらに替わる。無ければログインの画面へ */
export function useLogout(me: Profile) {
  const router = useRouter();
  const signedIn = useSignedInIds();
  return async () => {
    const others = signedIn.filter((id) => id !== me.id);
    await signOut(me.id);
    if (authMode === "local" && others.length) toast(`${me.displayName}さんのアカウントからログアウトしました。ログインしているほかのアカウントに替わりました`);
    else router.replace("/login");
  };
}

/** 開け閉めできる、変えるためのフォーム */
function EditCard({ title, value, open, onOpen, children }: { title: string; value: React.ReactNode; open: boolean; onOpen: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-muted">{title}</h2>
          <div className="mt-0.5 break-all">{value}</div>
        </div>
        <button type="button" className="btn-sub" onClick={() => onOpen(!open)}>
          {open ? "やめる" : "変える"}
        </button>
      </div>
      {open && <div className="mt-4 border-t border-line pt-4">{children}</div>}
    </section>
  );
}

/** 送って、結果を出すフォーム（成功したら閉じる）。うまくいかなかったら onFail（ロボットよけの出し直しなど） */
function useSubmit(run: () => Promise<AuthResult>, onDone: () => void, onFail?: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await run();
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return onFail?.();
    }
    setError(null);
    if (r.message) toast(r.message);
    onDone();
  };
  return { error, busy, submit };
}

function EmailEditor({ me, info, onDone }: { me: Profile; info: AccountInfo; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Supabase 版で、ロボットよけをオンにしていると、パスワードの確かめに token が要る
  const captcha = useTurnstile(authMode === "supabase" && info.hasPassword);
  const f = useSubmit(() => changeEmail(me.id, info, email, password, captcha.token), onDone, captcha.reset);
  return (
    <form className="space-y-3" onSubmit={f.submit}>
      <Field label="新しいメールアドレス">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required className="field" />
      </Field>
      {info.hasPassword && (
        <Field label="今のパスワード" hint="本人か確かめるために入れてください。">
          <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" label="今のパスワード" />
        </Field>
      )}
      {captcha.element}
      <FormError error={f.error} />
      <div className="flex justify-end">
        <button className="btn" disabled={f.busy || !captcha.ready}>
          メールアドレスを変える
        </button>
      </div>
    </form>
  );
}

function PasswordEditor({ me, info, onDone }: { me: Profile; info: AccountInfo; onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [email, setEmail] = useState("");
  const captcha = useTurnstile(authMode === "supabase" && info.hasPassword);
  const f = useSubmit(() => changePassword(me.id, info, current, next, email, captcha.token), onDone, captcha.reset);
  return (
    <form className="space-y-3" onSubmit={f.submit}>
      {info.kind === "sample" && (
        <Field label="メールアドレス" hint="次からは、このメールアドレスとパスワードでログインします。">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required className="field" />
        </Field>
      )}
      {info.hasPassword && (
        <Field label="今のパスワード">
          <PasswordInput value={current} onChange={setCurrent} autoComplete="current-password" label="今のパスワード" />
        </Field>
      )}
      <Field label="新しいパスワード">
        <PasswordInput value={next} onChange={setNext} autoComplete="new-password" label="新しいパスワード" />
      </Field>
      {captcha.element}
      <FormError error={f.error} />
      <div className="flex justify-end">
        <button className="btn" disabled={f.busy || !captcha.ready}>
          {info.hasPassword ? "パスワードを変える" : "設定する"}
        </button>
      </div>
    </form>
  );
}

/** ID（フレンドの申請に使う、ほかの人と重ならない名前）を変える */
function UsernameEditor({ me, onDone }: { me: Profile; onDone: () => void }) {
  const [draft, setDraft] = useState(me.username);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await changeUsername(me.id, draft);
        setBusy(false);
        if (!r.ok) return setError(r.error);
        toast(`ID を「${r.username}」にしました`);
        onDone();
      }}
    >
      <Field label="新しい ID" hint={`${USERNAME_RULE}。前の ID では、フレンドの申請を受けられなくなります。`}>
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          maxLength={USERNAME_MAX + 8}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          className="field"
        />
      </Field>
      <FormError error={error} />
      <div className="flex justify-end">
        <button className="btn" disabled={busy || normalizeUsername(draft) === me.username}>
          ID を変える
        </button>
      </div>
    </form>
  );
}

/** アカウントの削除の確かめ。パスワードがある人はパスワード、無い人は「わかりました」の印 */
function DeleteDialog({ me, info, onClose }: { me: Profile; info: AccountInfo; onClose: () => void }) {
  const router = useRouter();
  const signedIn = useSignedInIds();
  const [password, setPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const captcha = useTurnstile(authMode === "supabase" && info.hasPassword);
  return (
    <PopupDialog title="アカウントの削除" onClose={onClose} width="max-w-md">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const others = signedIn.filter((id) => id !== me.id);
          const r = await deleteAccount(me.id, info, password, captcha.token);
          setBusy(false);
          if (!r.ok) {
            setError(r.error);
            return captcha.reset();
          }
          toast("アカウントを削除しました");
          router.replace(authMode === "local" && others.length ? "/" : "/login");
        }}
      >
        <div className="space-y-2 text-sm">
          <p>
            <b>{me.displayName}</b>さんのアカウントを削除します。<b className="text-warn">元に戻せません。</b>
          </p>
          <ul className="list-disc space-y-1 pl-5 text-muted">
            <li>消えるもの：プロフィール、フレンド、ルームへの参加、マイメディアの画像、自分のボックス</li>
            <li>自分のボックスに、ほかの人が入れた画像は、その人のマイメディアに移ります</li>
            <li>送ったメッセージは残り、「削除された人」と表示されます</li>
            <li>ホストになっているルームがあるときは、先にルームを削除してください</li>
          </ul>
        </div>
        {info.hasPassword ? (
          <Field label="パスワード" hint="本人か確かめるために入れてください。">
            <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" label="パスワード" />
          </Field>
        ) : (
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={agree} onChange={setAgree} danger className="mt-0.5" />
            元に戻せないことをわかったうえで、削除します
          </label>
        )}
        {captcha.element}
        <FormError error={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-sub" onClick={onClose}>
            キャンセル
          </button>
          <button className="btn bg-warn text-white" disabled={busy || !captcha.ready || (!info.hasPassword && !agree) || (info.hasPassword && !password)}>
            {busy ? "削除しています…" : "アカウントを削除する"}
          </button>
        </div>
      </form>
    </PopupDialog>
  );
}

/** アカウントの設定の「マイアカウント」：ログインの方法・メールアドレス・パスワード・ログアウト・アカウントの削除 */
export function MyAccountSection({ me }: { me: Profile }) {
  const info = useAccountInfo(me.id);
  const logout = useLogout(me);
  const [open, setOpen] = useState<"username" | "email" | "password" | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (!info) return <p className="loading text-muted">読み込み中…</p>;
  return (
    <>
      <h1 className="mb-5 text-[28px] font-bold">マイアカウント</h1>

      {authMode === "local" && (
        <FormNotice>ローカル版：アカウントはこのブラウザの中だけにあります。メールは送らず、変更はすぐに反映されます。</FormNotice>
      )}

      {/* Discord のユーザー名と同じ。フレンドはこの ID で申請を送る */}
      <EditCard
        title="ID"
        value={
          <>
            <span className="font-bold" title="フレンドになりたい人に、この ID を伝えてください。「フレンドを追加」で、この ID を入れると申請が届きます">
              {me.username}
            </span>
          </>
        }
        open={open === "username"}
        onOpen={(v) => setOpen(v ? "username" : null)}
      >
        <UsernameEditor me={me} onDone={() => setOpen(null)} />
      </EditCard>

      <section data-name="ログインの方法" className="card">
        <h2 className="text-sm font-bold text-muted">ログインの方法</h2>
        <p className="mt-0.5">{KIND_LABEL[info.kind]}</p>
      </section>

      {info.kind !== "sample" && (
        <EditCard
          title="メールアドレス"
          value={
            <>
              {info.email ?? "未設定"}
              {info.pendingEmail && <span className="mt-1 block text-xs text-muted">「{info.pendingEmail}」への変更の確認待ちです（届いたメールのリンクを開くと替わります）</span>}
            </>
          }
          open={open === "email"}
          onOpen={(v) => setOpen(v ? "email" : null)}
        >
          <EmailEditor me={me} info={info} onDone={() => setOpen(null)} />
        </EditCard>
      )}

      <EditCard
        title={info.kind === "sample" ? "メールアドレスとパスワード" : "パスワード"}
        value={
          info.hasPassword ? (
            "••••••••"
          ) : (
            <span className="text-sm text-muted">
              {info.kind === "sample" ? "まだありません。設定すると、ログインの画面からメールアドレスとパスワードで入れます。" : "まだありません。設定すると、メールアドレスとパスワードでもログインできます。"}
            </span>
          )
        }
        open={open === "password"}
        onOpen={(v) => setOpen(v ? "password" : null)}
      >
        <PasswordEditor me={me} info={info} onDone={() => setOpen(null)} />
      </EditCard>

      <section data-name="ログアウト" className="card flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-bold">ログアウト</h2>
          <p className="text-sm text-muted">
            {authMode === "local" ? "このブラウザでログインしているほかのアカウントは、そのままです。" : "この端末からログアウトします。"}
          </p>
        </div>
        <button type="button" className="btn-sub" onClick={logout}>
          <Icon name="out" size={18} />
          ログアウト
        </button>
      </section>

      <section data-name="アカウントの削除" className="card border-warn/50">
        <h2 className="font-bold text-warn">アカウントの削除</h2>
        <p className="mt-1 mb-3 text-sm text-muted">プロフィールやマイメディアの画像が消え、元に戻せません。</p>
        <button type="button" className="btn-sub border-warn/60 text-warn hover:bg-warn/10" onClick={() => setDeleting(true)}>
          <Icon name="del" size={18} />
          アカウントを削除する
        </button>
      </section>
      {deleting && <DeleteDialog me={me} info={info} onClose={() => setDeleting(false)} />}
    </>
  );
}
