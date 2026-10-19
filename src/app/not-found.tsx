import Link from "next/link";
import { NoticeScreen } from "@/components/app/NoticeScreen";
import { Icon } from "@/components/Icon";

/** 無い URL を開いたときの画面（Next.js の英語の画面の代わり） */
export default function NotFound() {
  return (
    <NoticeScreen title="ページが見つかりません" lead="URL が違うか、ページが消された可能性があります。">
      <Link href="/" className="btn w-full">
        <Icon name="home" />
        ホームへ戻る
      </Link>
    </NoticeScreen>
  );
}
