"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AuthCard, AuthLink, Field, FormError, FormNotice, GoogleButton, OrDivider, PasswordInput } from "@/components/auth/AuthParts";
import { useTurnstile } from "@/components/auth/Turnstile";
import { checkUsernameFree, signInWithGoogle, signUp } from "@/lib/auth";
import { safeNext } from "@/lib/auth/validate";
import { normalizeUsername, USERNAME_MAX, USERNAME_RULE } from "@/lib/username";

/** ID の入力欄の下に出す、使えるかどうか（入れ終わって少したってから確かめる） */
function useUsernameCheck(username: string) {
  const [result, setResult] = useState<{ for: string; error: string | null } | null>(null);
  const id = normalizeUsername(username);
  useEffect(() => {
    if (!id) return;
    let live = true;
    const t = setTimeout(async () => {
      const error = await checkUsernameFree(id);
      if (live) setResult({ for: id, error });
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [id]);
  return id && result?.for === id ? result : null;
}

function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const usernameCheck = useUsernameCheck(username);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  // 確認のメールを送ったとき（Supabase 版で、メールの確認が要る設定のとき）
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keep = params.toString();
  // ロボットよけ（Turnstile）
  const captcha = useTurnstile();

  return (
    <AuthCard
      title="新規登録"
      lead="依頼ノートのアカウントを作ります。"
      footer={
        <>
          アカウントがあるときは <AuthLink href={`/login${keep ? `?${keep}` : ""}`}>ログイン</AuthLink>
        </>
      }
    >
      {sent ? (
        <FormNotice>{sent}</FormNotice>
      ) : (
        <>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const r = await signUp(name, username, email, password, next, captcha.token);
              setBusy(false);
              if (!r.ok) {
                setError(r.error);
                // token は1回しか使えないので、出し直す
                return captcha.reset();
              }
              if (r.message) setSent(r.message);
              else router.replace(next);
            }}
          >
            <Field label="表示名" hint="ほかの人に見える名前です。あとで変えられます。">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="nickname" required className="field" />
            </Field>
            {/* Discord のユーザー名と同じ。フレンドの申請はこの ID で送る */}
            <Field label="ID" hint={`フレンドの申請に使う、ほかの人と重ならない名前です。${USERNAME_RULE}。あとで変えられます。`}>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                // 全角の文字や大文字・頭の「@」は、そろえてから数える
                maxLength={USERNAME_MAX + 8}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="例：illust_taro"
                required
                aria-describedby="signup-username-check"
                className="field"
              />
              <span id="signup-username-check" role="status" className={`mt-1 block text-xs ${usernameCheck?.error ? "text-warn" : "text-accent"}`}>
                {usernameCheck && (usernameCheck.error ?? `「${normalizeUsername(username)}」は使えます`)}
              </span>
            </Field>
            <Field label="メールアドレス">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required className="field" />
            </Field>
            <Field label="パスワード">
              <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" label="パスワード" />
            </Field>
            {captcha.element}
            <FormError error={error} />
            <button className="btn w-full" disabled={busy || !captcha.ready}>
              {busy ? "登録しています…" : "登録する"}
            </button>
          </form>
          <OrDivider />
          <GoogleButton
            label="Google で登録"
            busy={busy}
            onClick={async () => {
              setBusy(true);
              const r = await signInWithGoogle(next);
              if (!r.ok) {
                setBusy(false);
                setError(r.error);
              }
            }}
          />
        </>
      )}
    </AuthCard>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
