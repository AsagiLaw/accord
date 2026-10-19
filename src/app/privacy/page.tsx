import type { Metadata } from "next";
import Link from "next/link";
import { Article, ContactEmail, LegalPage, OperatorName } from "@/components/legal/LegalPage";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: `プライバシーポリシー | ${SITE.name}` };

/** 預けている外部のサービス（どれもアメリカの会社。データを置く地域はサービスごとに違う） */
const PROCESSORS = [
  { name: "Supabase", company: "Supabase, Inc.（アメリカ）", use: "アカウント・ログインの情報と、チャット・ルームなどのデータの保存" },
  { name: "Vercel", company: "Vercel Inc.（アメリカ）", use: "本サービスの画面の配信と、アクセスの記録" },
  { name: "Cloudflare R2", company: "Cloudflare, Inc.（アメリカ）", use: "画像・ファイルの保存と配信" },
  { name: "Cloudflare Turnstile", company: "Cloudflare, Inc.（アメリカ）", use: "ログイン・新規登録のときのロボットよけ" },
  { name: "Resend", company: "Resend, Inc.（アメリカ）", use: "確認メール・パスワードの再設定メールの送信" },
  { name: "Google", company: "Google LLC（アメリカ）", use: "Google でのログイン（使った場合のみ）" },
];

export default function PrivacyPage() {
  return (
    <LegalPage path="/privacy" title="プライバシーポリシー">
      <p>
        <OperatorName />
        （以下「運営者」）は、「{SITE.name}」（以下「本サービス」）での利用者の個人情報を、個人情報の保護に関する法律（以下「個人情報保護法」）その他の法令に従い、次のとおり扱います。
      </p>

      <Article title="1. 集める情報">
        <ol>
          <li>
            登録のときに入れてもらう情報
            <ul>
              <li>メールアドレス、パスワード（そのままではなく、元に戻せない形にして保存します）</li>
              <li>表示名、ID</li>
              <li>Google でログインしたときは、Google から受け取るメールアドレス・名前・プロフィール画像</li>
            </ul>
          </li>
          <li>
            利用者が入れたり、送ったりした情報
            <ul>
              <li>アイコンの画像、ひとこと、自己紹介、リンク、受付の状況などのプロフィール</li>
              <li>チャットのメッセージ、ノート、データベースのページ、画像・ファイル、フレンドやルームの情報</li>
              <li>お問い合わせの内容</li>
            </ul>
          </li>
          <li>
            利用にともなって自動で記録される情報
            <ul>
              <li>IP アドレス、ブラウザや端末の種類、アクセスした日時などのアクセスの記録</li>
              <li>ログインの状態を保つためのクッキー、オンライン・既読などの利用の状況</li>
            </ul>
          </li>
        </ol>
      </Article>

      <Article title="2. 使う目的">
        <ol>
          <li>本サービスを提供するため（ログイン、データの保存と表示、ほかの利用者とのやり取り、通知など）</li>
          <li>本人の確認、パスワードの再設定などのメールを送るため</li>
          <li>不正な利用・ロボットによる登録を防ぎ、本サービスの安全を守るため</li>
          <li>利用規約に違反する行為に対応するため</li>
          <li>お問い合わせに答えるため</li>
          <li>障害を調べたり、本サービスを改善したりするため</li>
          <li>本サービスの変更・停止など、大切なお知らせをするため</li>
        </ol>
      </Article>

      <Article title="3. ほかの利用者に見える情報">
        <p>
          表示名、ID、アイコン、ひとこと、自己紹介、リンク、オンラインの状態などのプロフィールは、フレンドや同じルームの人など、ほかの利用者に見えます。ルームやメディアボックスで共有したメッセージ・画像なども、共有した相手に見えます。メールアドレスは、ほかの利用者には見せません。
        </p>
      </Article>

      <Article title="4. 第三者に渡すこと">
        <p>運営者は、次の場合を除き、本人の同意なく個人情報を第三者に渡しません。</p>
        <ol>
          <li>法令にもとづくとき</li>
          <li>人の命・体・財産を守るために必要で、本人の同意を得るのが難しいとき</li>
          <li>公衆衛生の向上や子どもの健全な育成のために特に必要で、本人の同意を得るのが難しいとき</li>
          <li>国や地方公共団体などの法令にもとづく仕事に協力する必要があり、本人の同意を得るとその仕事に支障が出るおそれがあるとき</li>
          <li>次の「5. 外部のサービスに預けること」のとおり、使う目的の範囲で扱いを預けるとき</li>
        </ol>
      </Article>

      <Article title="5. 外部のサービスに預けること（外国にある第三者への提供）">
        <p>運営者は、本サービスを動かすために、次の外部のサービスに個人情報の扱いを預けています。</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-muted">
                <th className="py-2 pr-3 font-bold">サービス</th>
                <th className="py-2 pr-3 font-bold">提供する会社（国）</th>
                <th className="py-2 font-bold">預ける目的</th>
              </tr>
            </thead>
            <tbody>
              {PROCESSORS.map((p) => (
                <tr key={p.name} className="border-b border-line align-top">
                  <td className="py-2 pr-3 font-bold whitespace-nowrap">{p.name}</td>
                  <td className="py-2 pr-3">{p.company}</td>
                  <td className="py-2">{p.use}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          これらの会社はアメリカにあり、データは日本の外のサーバーで扱われることがあります。アメリカには、日本の個人情報保護法と同じ水準の、個人情報を保護する包括的な法律はありません（州ごとの法律や分野ごとの法律があります）。運営者は、これらの会社が、個人情報の安全を守る措置をとっていることを、それぞれの利用規約・プライバシーポリシーなどで確かめたうえで使っています。
        </p>
      </Article>

      <Article title="6. クッキーとブラウザへの保存">
        <ol>
          <li>本サービスは、ログインの状態を保つためにクッキーを使います。クッキーを止めると、ログインできません。</li>
          <li>表示モード・通知のオンオフなど、その端末だけの設定は、ブラウザの中（localStorage など）に保存します。これらは運営者のサーバーには送りません。</li>
          <li>本サービスは、広告のためのクッキーや、アクセス解析のサービスを使っていません。使い始めるときは、このポリシーを改定して知らせます。</li>
        </ol>
      </Article>

      <Article title="7. 安全を守るための措置">
        <p>
          運営者は、個人情報が漏れたり、なくなったり、壊れたりしないよう、通信の暗号化、データを見られる人を限る仕組み（利用者ごとのアクセス権の確認）、パスワードを元に戻せない形で保存すること、運営者のアカウントの2段階認証など、必要で適切な措置をとります。
        </p>
      </Article>

      <Article title="8. 保存する期間と、退会したとき">
        <ol>
          <li>個人情報は、使う目的のために必要な間、保存します。</li>
          <li>
            利用者が退会すると、アカウントとプロフィールの情報は削除します。ほかの利用者と共有しているルームなどに送ったメッセージや画像は、ほかの利用者のやり取りを保つため、送り主の分からない形で残ることがあります。
          </li>
          <li>アクセスの記録は、障害の調査や不正の防止のため、外部のサービスの決まりに従って一定の期間保存したのち削除します。</li>
        </ol>
      </Article>

      <Article title="9. 開示・訂正・利用停止などの請求">
        <p>
          利用者は、運営者が持っている自分の個人情報について、個人情報保護法の定めに従い、開示・訂正・追加・削除・利用の停止・第三者への提供の停止などを求めることができます。プロフィールの多くは、アカウントの設定から自分で直せます。それ以外は、下のお問い合わせ先までご連絡ください。ご本人であることを確かめたうえで、法令に従って対応します。
        </p>
      </Article>

      <Article title="10. 13歳未満の方">
        <p>本サービスは、13歳未満の方の利用を想定していません。13歳未満の方の個人情報を集めていたと分かったときは、削除します。</p>
      </Article>

      <Article title="11. このポリシーの改定">
        <p>運営者は、法令の変更や本サービスの変更に合わせて、このポリシーを改定することがあります。大切な変更のときは、本サービス上で知らせます。改定した後のポリシーは、このページに載せた時から効力を持ちます。</p>
      </Article>

      <Article title="12. お問い合わせ先">
        <p>
          運営者：
          <OperatorName />
          <br />
          メールアドレス：
          <ContactEmail />
          <br />
          運営者の住所は、請求があったときに遅れなくお知らせします。くわしくは
          <Link href="/contact" className="font-bold text-accent hover:underline">
            お問い合わせ
          </Link>
          のページをご覧ください。
        </p>
      </Article>

      <p className="pt-2 text-right">以上</p>
    </LegalPage>
  );
}
