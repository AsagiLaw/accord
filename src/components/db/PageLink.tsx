"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext } from "react";
import type { Database } from "@/lib/local/db";

/**
 * ページのポップアップ（Notion のセンターピーク・サイドピーク）。ビューの名前・帯・カードなどを押すと、ページを重ねて開く。
 * 右上の「拡大」でページの画面に移る。Ctrl（⌘）や Shift を押しながら・中ボタンで押したときは、ふつうのリンクと同じ（新しいタブなど）。
 * 開き方はビューの設定（ViewOpenContext）：真ん中に重ねる（peek）・右から出す（side）・ページの画面に移る（page）
 */
export type PeekMode = "peek" | "side";
export type Peek = (database: Pick<Database, "id" | "roomId">, pageId: string, mode?: PeekMode) => void;
export const PeekContext = createContext<Peek | null>(null);

/** ビューのページの開き方（ビューの中だけ。無いところはポップアップ） */
export const ViewOpenContext = createContext<"peek" | "side" | "page">("peek");

const hrefOf = (database: Pick<Database, "id" | "roomId">, pageId: string) => `/r/${database.roomId}/db/${database.id}/p/${pageId}`;

/** ページを開く。ビューの開き方に合わせて、ポップアップ・右から出す・ページの画面に移る（ポップアップが使えない場所では移る） */
export function usePeek(): (database: Pick<Database, "id" | "roomId">, pageId: string) => void {
  const peek = useContext(PeekContext);
  const mode = useContext(ViewOpenContext);
  const router = useRouter();
  return (database, pageId) => (peek && mode !== "page" ? peek(database, pageId, mode) : router.push(hrefOf(database, pageId)));
}

/** ページへのリンク。ふつうに押すと、ビューの開き方で開く */
export function PageLink({
  database,
  pageId,
  onClick,
  ...rest
}: Omit<React.ComponentProps<typeof Link>, "href"> & { database: Pick<Database, "id" | "roomId">; pageId: string }) {
  const peek = useContext(PeekContext);
  const mode = useContext(ViewOpenContext);
  return (
    <Link
      {...rest}
      href={hrefOf(database, pageId)}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || !peek || mode === "page" || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        peek(database, pageId, mode);
      }}
    />
  );
}
