"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

// メディア画面の URL の土台（ルームの「メディア」は /r/（ルーム）/media、DM のボックスは /dm/media/（ボックス））
const SCREEN = /^\/(?:r\/[^/]+\/media|dm\/media\/[^/]+)(?=\/|$)/;

/**
 * 同じメディア画面の中の移動か（ホーム・一覧・ライブラリーの行き来）。
 * 中身はブラウザの中のデータから描くので、サーバーに問い合わせずに URL だけを変えれば、押したらすぐ切り替わる
 */
function inSameScreen(from: string, to: string) {
  const screen = from.match(SCREEN)?.[0];
  return !!screen && to.match(SCREEN)?.[0] === screen;
}

/** URL だけを変える（戻る・進むも効く）。同じ所を続けて押しても、履歴は1つだけ */
function pushUrl(href: string) {
  if (href !== window.location.pathname) window.history.pushState(null, "", href);
}

/** メディア画面の中の移動。同じメディア画面の中はすぐ切り替え、ほかの画面へは普通に移る */
export function useMediaRouter() {
  const router = useRouter();
  return {
    push: (href: string) => (inSameScreen(window.location.pathname, href) ? pushUrl(href) : router.push(href)),
  };
}

/** メディア画面の中のリンク。同じメディア画面の中なら、サーバーに問い合わせずにすぐ切り替える（先読みもしない） */
export function MediaLink({ href, onNavigate, ...props }: React.ComponentProps<typeof Link> & { href: string }) {
  const pathname = usePathname();
  const same = inSameScreen(pathname, href);
  return (
    <Link
      href={href}
      prefetch={same ? false : undefined}
      {...props}
      onNavigate={(e) => {
        onNavigate?.(e);
        if (!inSameScreen(window.location.pathname, href)) return;
        e.preventDefault();
        pushUrl(href);
      }}
    />
  );
}
