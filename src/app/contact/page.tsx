import type { Metadata } from "next";
import Link from "next/link";
import { Article, ContactEmail, LegalPage, OperatorName } from "@/components/legal/LegalPage";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: `お問い合わせ | ${SITE.name}` };

export default function ContactPage() {
  return (
    <LegalPage path="/contact" title="お問い合わせ" updated={false}>
      <p>{SITE.name}についてのご質問・不具合のご報告・ご要望・権利の侵害のご連絡は、下のメールアドレスまでお送りください。</p>

      <div className="rounded-[10px] border border-line bg-bg px-4 py-3">
        <p className="text-xs text-muted">メールアドレス</p>
        <p className="mt-1 text-base">
          <ContactEmail />
        </p>
        <p className="mt-3 text-xs text-muted">運営者</p>
        <p className="mt-1">
          <OperatorName />
        </p>
      </div>

      <Article title="書いていただきたいこと">
        <ul>
          <li>登録しているメールアドレスと ID（アカウントについてのお問い合わせのとき）</li>
          <li>不具合のときは、起きたこと・そのときの操作・使っている端末とブラウザ・画面の写真</li>
          <li>権利の侵害のご連絡のときは、対象の場所（ルームや画像など）と、侵害されている権利の内容・あなたが権利者であること</li>
        </ul>
      </Article>

      <Article title="お返事について">
        <ul>
          <li>個人で運営しているため、お返事までに数日いただくことがあります。内容によっては、お返事できないこともあります。</li>
          <li>利用者どうしの依頼・取引の争いには、運営者は立ち入れません（利用規約の第4条）。</li>
          <li>パスワードを忘れたときは、ログインの画面の「パスワードを忘れたとき」から再設定できます。</li>
        </ul>
      </Article>

      <p className="text-muted">
        いただいた情報は、
        <Link href="/privacy" className="font-bold text-accent hover:underline">
          プライバシーポリシー
        </Link>
        に従って扱います。
      </p>
    </LegalPage>
  );
}
