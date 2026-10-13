"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthCard, AuthLink, Field, FormError, FormNotice, GoogleButton, OrDivider, PasswordInput } from "@/components/auth/AuthParts";
import { useTurnstile } from "@/components/auth/Turnstile";
import { signInWithGoogle, signUp } from "@/lib/auth";
import { safeNext } from "@/lib/auth/validate";

function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [name, setName] = useState("");
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
              const r = await signUp(name, email, password, next, captcha.token);
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
