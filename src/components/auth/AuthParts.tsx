"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { authMode } from "@/lib/auth/mode";
import { PASSWORD_MIN } from "@/lib/auth/validate";

/** ログイン・新規登録などの画面の入れ物：まんなかにアプリの名前と、白いカード */
export function AuthCard({ title, lead, children, footer }: { title: string; lead?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main data-name="ログインまわりの画面" className="grid min-h-dvh place-items-center bg-bg px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span aria-hidden className="grid h-12 w-12 place-items-center rounded-[16px] bg-accent text-accent-ink">
            <Icon name="note" size={26} />
          </span>
          <p className="text-sm font-bold text-muted">依頼ノート</p>
        </div>
        <section className="card space-y-4">
          <div>
            <h1 className="text-xl font-bold">{title}</h1>
            {lead && <p className="mt-1 text-sm text-muted">{lead}</p>}
          </div>
          {children}
        </section>
        {footer && <div className="mt-4 text-center text-sm">{footer}</div>}
        {authMode === "local" && (
          <p data-name="ローカル版の説明" className="mt-6 text-center text-xs text-muted">
            ローカル版：アカウントはこのブラウザの中だけに保存されます。Supabase につなぐと、同じ画面で本物のログインになります。
          </p>
        )}
      </div>
    </main>
  );
}

/** 入力欄と見出し */
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-bold">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

/** パスワードの入力欄。右の目のボタンで、入れた文字を見られる */
export function PasswordInput({
  value,
  onChange,
  autoComplete,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete: "current-password" | "new-password";
  placeholder?: string;
  label?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative block">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder ?? (autoComplete === "new-password" ? `${PASSWORD_MIN}文字以上` : undefined)}
        aria-label={label}
        required
        className="field pr-11"
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? "パスワードを隠す" : "パスワードを表示"}
        title={show ? "パスワードを隠す" : "パスワードを表示"}
        className="absolute inset-y-0 right-1 my-auto grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-tint hover:text-ink"
      >
        <Icon name={show ? "eyeoff" : "eye"} size={18} />
      </button>
    </span>
  );
}

/** うまくいかなかったときの言葉（読み上げにも伝える） */
export function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-[10px] border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
      {error}
    </p>
  );
}

/** うまくいったときの知らせ */
export function FormNotice({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="rounded-[10px] border border-accent/40 bg-tint px-3 py-2 text-sm">
      {children}
    </div>
  );
}

/** 「または」の区切り */
export function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-xs text-muted">
      <span className="h-px flex-1 bg-line" />
      または
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

/** Google でログイン（ローカル版では押せない。Supabase につなぐと使える） */
export function GoogleButton({ label, onClick, busy }: { label: string; onClick: () => void; busy?: boolean }) {
  const off = authMode === "local";
  return (
    <div>
      <button type="button" onClick={onClick} disabled={off || busy} className="btn-sub w-full disabled:opacity-50">
        <svg aria-hidden viewBox="0 0 24 24" width="18" height="18">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
        {label}
      </button>
      {off && <p className="mt-1 text-center text-xs text-muted">Google でのログインは、Supabase につなぐと使えます</p>}
    </div>
  );
}

/** 画面の下の、ほかの画面へのリンク */
export function AuthLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-bold text-accent hover:underline">
      {children}
    </Link>
  );
}
