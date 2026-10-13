"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import type { Profile } from "@/lib/local/db";
import { useAllProfiles } from "@/lib/local/rooms";
import { setCurrentUser } from "@/lib/local/session";

/**
 * ルームバーとサイドバーの入れ物。パソコンでは左に並べ、スマホでは左上のボタンで左から引き出す。
 * ページを移動したら閉じる
 */
export function SidebarShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // スマホで開いたときのページを覚えておき、ページを移動したら閉じた扱いにする
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const setOpen = (v: boolean) => setOpenAt(v ? pathname : null);

  return (
    <>
      <button
        className="btn-sub fixed top-2 left-2 z-30 w-11 bg-card px-0 md:hidden"
        aria-label="メニュー"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="menu" size={22} />
      </button>
      {open && (
        <div
          className="fixed inset-0 z-10 bg-black/40 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* スマホでは、ルームバーとサイドバーをまとめて左から出す */}
      <div
        className={`fixed inset-y-0 left-0 z-20 flex w-[min(368px,92vw)] transition-transform md:static md:w-auto md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-[104%]"}`}
      >
        {children}
      </div>
    </>
  );
}

/** ローカル版だけの機能：2人分の動きを1台で試すための利用者切り替え（サイドバーの下に置く） */
export function UserSwitch({ me }: { me: Profile }) {
  const profiles = useAllProfiles();
  return (
    <label
      data-name="利用者の切り替え（ローカル版のみ）"
      className="flex min-h-[38px] items-center gap-2 rounded-[10px] px-3"
    >
      <Icon name="ppl" />
      <span className="shrink-0 text-sm text-muted">利用者</span>
      <select
        className="min-w-0 flex-1 bg-transparent font-bold"
        value={me.id}
        onChange={(e) => setCurrentUser(e.target.value)}
      >
        {profiles?.map((p) => (
          <option key={p.id} value={p.id}>
            {p.displayName}
          </option>
        ))}
      </select>
    </label>
  );
}
