"use client";

import { ErrorDetails } from "@/components/app/ErrorDetails";
import { NoticeScreen } from "@/components/app/NoticeScreen";
import "./globals.css";

/**
 * いちばん外のレイアウト（layout.tsx）でエラーが起きたときの画面。レイアウトの代わりになるので、html と body から自分で持つ。
 * 書体とテーマの設定（data-theme）は届かないので、端末の書体と、端末のライト・ダークに合わせて出す
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="ja">
      <body>
        <title>エラー | Accord</title>
        <NoticeScreen title="うまく表示できませんでした" lead="一時的な不具合かもしれません。もう一度試しても直らないときは、ページを読み込み直してください。">
          <ErrorDetails error={error} retry={retry} />
        </NoticeScreen>
      </body>
    </html>
  );
}
