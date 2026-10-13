"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthCard, AuthLink, Field, FormError, FormNotice, PasswordInput } from "@/components/auth/AuthParts";
import { toast } from "@/components/ui/overlay";
import { authMode, resetPassword } from "@/lib/auth";
import { localResetTokenValid } from "@/lib/local/accounts";
import { useCurrentUserId } from "@/lib/local/session";

/**
 * 再設定のリンクから開く、新しいパスワードを決める画面。
 * ローカル版はリンクの token を確かめる。Supabase 版はリンクでログインした状態で来るので、そのまま変える
 */
function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const userId = useCurrentUserId();
  const localValid = useLiveQuery(async () => (authMode === "local" && token ? localResetTokenValid(token) : false), [token]);
  const usable = authMode === "local" ? localValid : userId === undefined ? undefined : !!userId;
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <AuthCard title="新しいパスワード" footer={<AuthLink href="/login">ログインに戻る</AuthLink>}>
      {usable === undefined ? (
        <p className="text-sm text-muted">確かめています…</p>
      ) : !usable ? (
        <FormNotice>
          <p className="mb-2">このリンクは期限が切れているか、もう使われています。</p>
          <AuthLink href="/forgot-password">もう一度、再設定のリンクを出す</AuthLink>
        </FormNotice>
      ) : (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const r = await resetPassword(password, token);
            setBusy(false);
            if (!r.ok) return setError(r.error);
            toast("パスワードを変えました");
            router.replace("/");
          }}
        >
          <Field label="新しいパスワード">
            <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" label="新しいパスワード" />
          </Field>
          <FormError error={error} />
          <button className="btn w-full" disabled={busy}>
            {busy ? "変えています…" : "パスワードを変えてログイン"}
          </button>
        </form>
      )}
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
