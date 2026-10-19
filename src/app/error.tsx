"use client";

import { ErrorDetails } from "@/components/app/ErrorDetails";
import { NoticeScreen } from "@/components/app/NoticeScreen";

/** 画面の途中で思わぬエラーが起きたときの画面（Next.js の英語の画面の代わり）。いちばん外のレイアウトのエラーは global-error.tsx */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <NoticeScreen title="うまく表示できませんでした" lead="一時的な不具合かもしれません。もう一度試しても直らないときは、ホームへ戻ってください。">
      <ErrorDetails error={error} retry={retry} />
    </NoticeScreen>
  );
}
