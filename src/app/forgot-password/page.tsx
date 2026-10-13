"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthCard, AuthLink, Field, FormError, FormNotice } from "@/components/auth/AuthParts";
import { useTurnstile } from "@/components/auth/Turnstile";
import { authMode, requestPasswordReset } from "@/lib/auth";

function ForgotForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ link?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // ロボットよけ（Turnstile）。送ったあとは画面が替わるので、出し直すのはうまくいかなかったときだけ
  const captcha = useTurnstile(!result);

  return (
    <AuthCard
      title="パスワードの再設定"
      lead="登録したメールアドレスに、新しいパスワードを決めるためのリンクを送ります。"
      footer={<AuthLink href="/login">ログインに戻る</AuthLink>}
    >
      {result ? (
        authMode === "local" ? (
          // ローカル版はメールを送れないので、メールに入るはずのリンクをここに出す
          result.link ? (
            <FormNotice>
              <p className="mb-2">ローカル版なのでメールは送りません。メールに入るはずのリンクはこちらです（1時間だけ使えます）。</p>
              <Link href={result.link} className="btn w-full">
                パスワードを再設定する
              </Link>
            </FormNotice>
          ) : (
            <FormNotice>このメールアドレスの登録はありません（ローカル版だけ、わかりやすくお知らせしています）。</FormNotice>
          )
        ) : (
          <FormNotice>登録があれば、再設定のリンクを送りました。メールが届かないときは、迷惑メールのフォルダも確かめてください。</FormNotice>
        )
      ) : (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const r = await requestPasswordReset(email, captcha.token);
            setBusy(false);
            if (r.ok) return setResult({ link: r.link });
            setError(r.error);
            captcha.reset();
          }}
        >
          <Field label="メールアドレス">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required className="field" />
          </Field>
          {captcha.element}
          <FormError error={error} />
          <button className="btn w-full" disabled={busy || !captcha.ready}>
            {busy ? "送っています…" : "再設定のリンクを送る"}
          </button>
        </form>
      )}
    </AuthCard>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotForm />
    </Suspense>
  );
}
