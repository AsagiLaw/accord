"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthCard, AuthLink, Field, FormError, GoogleButton, OrDivider, PasswordInput } from "@/components/auth/AuthParts";
import { useTurnstile } from "@/components/auth/Turnstile";
import { Avatar } from "@/components/Avatar";
import { signIn, signInWithGoogle } from "@/lib/auth";
import { devSampleUsers } from "@/lib/auth/mode";
import { safeNext } from "@/lib/auth/validate";
import { localSignInSample, useSampleProfiles } from "@/lib/local/accounts";

/** リンクから戻ってきたときなどの知らせ */
const ERRORS: Record<string, string> = {
  link: "リンクの期限が切れているか、使えないリンクです。もう一度試してください",
  google: "Google でのログインがうまくいきませんでした。もう一度試してください",
};

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  // ログインしたまま、別のアカウントを足すとき（ローカル版のアカウントの切り替え）
  const adding = params.has("add");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(ERRORS[params.get("error") ?? ""] ?? null);
  const [busy, setBusy] = useState(false);
  const samples = useSampleProfiles();
  // ロボットよけ（Turnstile）
  const captcha = useTurnstile();
  const keep = new URLSearchParams({ ...(next !== "/" ? { next } : {}), ...(adding ? { add: "1" } : {}) }).toString();

  const done = () => router.replace(next);

  return (
    <AuthCard
      title={adding ? "アカウントを追加" : "ログイン"}
      lead={adding ? "別のアカウントでログインすると、左下のカードから切り替えられます。" : "おかえりなさい。"}
      footer={
        <>
          アカウントが無いときは <AuthLink href={`/signup${keep ? `?${keep}` : ""}`}>新規登録</AuthLink>
          {adding && (
            <p className="mt-2">
              <Link href={next} className="text-muted hover:underline">
                やめて戻る
              </Link>
            </p>
          )}
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const r = await signIn(email, password, captcha.token);
          // うまくいったら、次の画面に移るまでボタンは押せないまま
          if (r.ok) return done();
          setBusy(false);
          setError(r.error);
          // token は1回しか使えないので、出し直す
          captcha.reset();
        }}
      >
        <Field label="メールアドレス">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required className="field" />
        </Field>
        <Field label="パスワード">
          <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" label="パスワード" />
        </Field>
        <div className="text-right text-sm">
          <Link href={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ""}`} className="text-accent hover:underline">
            パスワードを忘れたとき
          </Link>
        </div>
        {captcha.element}
        <FormError error={error} />
        <button className="btn w-full" disabled={busy || !captcha.ready}>
          {busy ? "確かめています…" : "ログイン"}
        </button>
      </form>

      <OrDivider />
      <GoogleButton
        label="Google でログイン"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          const r = await signInWithGoogle(next);
          // うまくいけば Google の画面に移る
          if (!r.ok) {
            setBusy(false);
            setError(r.error);
          }
        }}
      />

      {/* 開発中のローカル版だけ：メールとパスワードを設定していない、開発の確かめ用の利用者で入る */}
      {devSampleUsers && !!samples?.length && (
        <div data-name="試し用の利用者" className="border-t border-line pt-4">
          <p className="mb-2 w-fit text-sm font-bold" title="ローカル版だけ。パスワードなしで入れます。アカウントの設定で、メールとパスワードを設定することもできます">
            試し用の利用者で入る
          </p>
          <ul className="space-y-1">
            {samples.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    const r = await localSignInSample(p.id);
                    if (r.ok) done();
                    else setError(r.error);
                  }}
                  className="flex min-h-[44px] w-full items-center gap-2.5 rounded-[10px] border border-line px-2.5 text-left hover:bg-tint"
                >
                  <Avatar name={p.displayName} src={p.avatar} size={30} />
                  <span className="min-w-0 flex-1 truncate font-bold">{p.displayName}</span>
                  <span className="text-xs text-muted">として入る</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </AuthCard>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
