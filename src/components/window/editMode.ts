"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** ウィンドウ（とウィンドウ型のページ）を編集モードで開く URL。サイドバーの右クリック「編集」から使う */
export const editHref = (href: string) => `${href}?edit=1`;

/** 編集モードかどうか（URL の ?edit=1）。「完了」で URL から外して、ふだんの表示に戻す */
export function useEditMode() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  return { editing: params.get("edit") === "1", finish: () => router.replace(pathname) };
}
