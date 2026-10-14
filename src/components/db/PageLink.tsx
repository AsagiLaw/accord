"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext } from "react";
import { Icon } from "@/components/Icon";
import type { Database, DbPage } from "@/lib/local/db";

/**
 * ページのポップアップ（Notion のセンターピーク・サイドピーク）。ビューの名前・帯・カードなどを押すと、ページを重ねて開く。
 * 右上の「拡大」でページの画面に移る。Ctrl（⌘）や Shift を押しながら・中ボタンで押したときは、ふつうのリンクと同じ（新しいタブなど）。
 * 開き方はビューの設定（ViewOpenContext）：真ん中に重ねる（peek）・右から出す（side）・ページの画面に移る（page）
 */
export type PeekMode = "peek" | "side";
export type Peek = (database: Pick<Database, "id" | "roomId">, pageId: string, mode?: PeekMode) => void;
export const PeekContext = createContext<Peek | null>(null);

/** 「ページ」の項目の別ページを、ポップアップで開く（ボタンのブロック・表のセルなどから） */
export type SubPageTarget = { roomId: string; dbId: string; pageId: string; propId: string };
export const SubPeekContext = createContext<((target: SubPageTarget) => void) | null>(null);

/** ボタンのブロックの中のページ（ノート・ウィンドウ）を、ポップアップで開く。page はボタンを置いたページ（中のブロックの「このページ」） */
export type InnerPageTarget = { roomId: string; noteId: string; title: string; page?: { dbId: string; pageId?: string } };
export const InnerPeekContext = createContext<((target: InnerPageTarget) => void) | null>(null);

/** ページの、その項目の別ページ（ページの ID などが分からないとき・テンプレートの初期値などでは無し） */
export function subTargetOf(page: Partial<Pick<DbPage, "id" | "dbId" | "roomId">> | undefined, propId: string): SubPageTarget | undefined {
  return page?.id && page.dbId && page.roomId ? { roomId: page.roomId, dbId: page.dbId, pageId: page.id, propId } : undefined;
}

/**
 * 「ページ」の項目の値：押すと、別ページをポップアップで開く（表のセルやカードを押したことにはしない）。
 * 表のセル・カードはそれ自体がボタンなので、中に入れるときは inline（ボタンにせず、押せる印だけ）
 */
export function SubPageChip({ target, name, inline }: { target?: SubPageTarget; name: string; inline?: boolean }) {
  const open = useContext(SubPeekContext);
  const can = !!target && !!open;
  const Tag = inline ? "span" : "button";
  return (
    <Tag
      {...(inline ? { role: "button", "aria-disabled": !can || undefined } : { type: "button" as const, disabled: !can })}
      title={can ? `「${name}」をポップアップで開く` : "ページを作ると開けます"}
      onClick={(e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (can) open?.(target);
      }}
      className={`inline-flex max-w-full items-center gap-1 rounded-[6px] border border-line bg-card px-1.5 py-0.5 text-xs whitespace-nowrap ${can ? "cursor-pointer hover:bg-tint" : "opacity-50"}`}
      data-name="別ページを開く"
    >
      <Icon name="note" size={12} className="shrink-0 text-muted" />
      <span className="truncate">{name}</span>
    </Tag>
  );
}

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
