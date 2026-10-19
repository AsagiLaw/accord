"use client";

import { useEffect } from "react";
import { Icon } from "@/components/Icon";

/**
 * エラーの画面（error.tsx・global-error.tsx）の中身：もう一度試す・ホームへ戻るのボタンと、不具合を伝えるときに見るくわしい内容。
 * ホームへは、壊れた画面の状態を残さないように、ページごと読み込み直して移る
 */
export function ErrorDetails({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <>
      <div className="flex flex-col gap-2">
        <button type="button" className="btn w-full" onClick={() => retry()}>
          <Icon name="restore" />
          もう一度試す
        </button>
        {/* 壊れた画面の状態を残さないよう、Link ではなくページごと読み込み直す */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="btn-sub w-full">
          <Icon name="home" />
          ホームへ戻る
        </a>
      </div>
      {(error.message || error.digest) && (
        <details data-name="エラーのくわしい内容" className="text-xs text-muted">
          <summary className="cursor-pointer">くわしい内容（不具合を伝えるとき用）</summary>
          <p className="mt-2 break-all whitespace-pre-wrap">{error.message}</p>
          {error.digest && <p className="mt-1 break-all">エラーの番号：{error.digest}</p>}
        </details>
      )}
    </>
  );
}
