"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { safeNext } from "@/lib/auth/validate";
import { useCurrentUser } from "@/lib/local/session";

/** ログインしていなくても開ける画面 */
const PUBLIC = ["/login", "/signup", "/forgot-password", "/reset-password", "/auth", "/terms", "/privacy", "/contact"];
/** ログインしているときは開かない画面（ログイン・新規登録）。?add=1 のときは、アカウントを足すので開く */
const GUEST_ONLY = ["/login", "/signup"];

const matches = (list: string[], path: string) => list.some((p) => path === p || path.startsWith(`${p}/`));

/**
 * ログインしていないときに、アプリの画面を開いたらログインの画面へ移す（ログインしたら、開こうとしていた画面に戻る）。
 * ログインしているときにログインの画面を開いたら、アプリへ移す
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const me = useCurrentUser();
  const isPublic = matches(PUBLIC, pathname);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    if (!isPublic && me === null) router.replace(`/login?next=${encodeURIComponent(pathname + window.location.search)}`);
    else if (me && matches(GUEST_ONLY, pathname) && !search.has("add")) router.replace(safeNext(search.get("next")));
  }, [isPublic, me, pathname, router]);

  if (!isPublic && !me) return <p className="p-8 text-muted">{me === null ? "ログインの画面へ移っています…" : "読み込み中…"}</p>;
  return children;
}
