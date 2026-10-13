"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { AccountPanel } from "@/components/account/AccountPanel";
import { Icon } from "@/components/Icon";
import type { Profile } from "@/lib/local/db";

/**
 * ルームバーとサイドバーの入れ物。パソコンでは左に並べ、スマホでは左上のボタンで左から引き出す。
 * いちばん下には、Discord のように、ルームバーとサイドバーをまたいで自分のアカウントの欄を置く。
 * ページを移動したら閉じる
 */
export function SidebarShell({ me, children }: { me: Profile; children: React.ReactNode }) {
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
        className={`fixed inset-y-0 left-0 z-20 flex w-[min(368px,92vw)] flex-col transition-transform md:static md:w-auto md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-[104%]"}`}
      >
        <div className="flex min-h-0 flex-1">{children}</div>
        {/* 下の欄の後ろも、左はルームバー、右はサイドバーの色にして、2つの列が下まで続いて見えるようにする */}
        <div
          data-name="アカウントの欄の台"
          className="shrink-0 border-r border-line p-2 backdrop-blur-xl"
          style={{ background: "linear-gradient(to right, var(--rail) 68px, var(--sidebar) 68px)" }}
        >
          <AccountPanel me={me} />
        </div>
      </div>
    </>
  );
}
