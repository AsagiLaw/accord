"use client";

import { useEffect, useRef } from "react";
import { Icon } from "@/components/Icon";

/**
 * 上のバーの検索欄。今いる場所（ホームではボックス全体）の画像を、名前・ファイル名・形式・追加した人で絞り込む。
 * スマホでは虫めがねのボタンだけを出し、押すと場所の表示の代わりに入力欄が広がる（expanded）
 */
export function MediaSearch({
  query,
  onQuery,
  expanded,
  onExpand,
}: {
  query: string;
  onQuery: (q: string) => void;
  expanded: boolean;
  onExpand: (v: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  // スマホで虫めがねを押したら、そのまま打てるようにする
  useEffect(() => {
    if (expanded) input.current?.focus();
  }, [expanded]);
  const hint = "名前・ファイル名・形式・追加した人で探す（空白で区切ると、すべてを含むもの）";
  return (
    <>
      {!expanded && (
        <button
          type="button"
          aria-label="メディアを検索"
          title={hint}
          onClick={() => onExpand(true)}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-muted hover:bg-tint hover:text-ink md:hidden"
        >
          <Icon name="search" size={18} />
        </button>
      )}
      <label
        data-name="メディアの検索"
        title={hint}
        className={`${expanded ? "flex min-w-0 flex-1" : "hidden"} h-7 items-center gap-1 rounded-[8px] border border-line bg-card px-2 focus-within:border-accent md:flex md:w-52 md:flex-none`}
      >
        <Icon name="search" size={15} className="shrink-0 text-muted" />
        <input
          ref={input}
          type="search"
          value={query}
          aria-label="メディアを検索"
          placeholder="メディアを検索"
          onChange={(e) => onQuery(e.target.value)}
          // 何も入れずに離れたら、スマホでは場所の表示に戻す
          onBlur={() => !query && onExpand(false)}
          onKeyDown={(e) => {
            if (e.key !== "Escape" || e.nativeEvent.isComposing) return;
            e.stopPropagation();
            // 1回目で言葉を消し、空なら入力欄から離れる
            if (query) onQuery("");
            else e.currentTarget.blur();
          }}
          // 打っている間は外の枠の色が変わるので、入力欄そのものの線（全体の :focus-visible）は出さない
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none! placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            aria-label="検索をやめる"
            title="検索をやめる"
            // 入力欄から離れないようにする（押したあとも続けて打てる）
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onQuery("")}
            className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-muted hover:bg-tint hover:text-ink"
          >
            <Icon name="x" size={14} />
          </button>
        )}
      </label>
    </>
  );
}
