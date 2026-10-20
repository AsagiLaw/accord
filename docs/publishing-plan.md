# 公開の順番

2026-10-19 に決めた、Accord を公開するまでの順番。終わったら `[ ]` を `[x]` にする。

## 使うサービス

| サービス | 役割 | プラン |
|---|---|---|
| GitHub | コードをしまっておく | Free（リポジトリは Private） |
| Vercel | サイトを動かして、みんなに見せる | Hobby（非商用のみ。お金が動く前に Pro へ） |
| Supabase | ログインと、チャットなどのデータを保存する | 無料（必要になったら Pro） |
| Cloudflare R2 | 画像を保存する | 無料枠から |
| Cloudflare Turnstile | ログイン・新規登録のロボットよけ | 無料 |
| Resend など | 確認メール・パスワード再設定のメールを送る | 無料枠から |

どのアカウントも、長いパスワードと2段階認証をオンにする。秘密のキーは GitHub に上げない（`.env.local` は `.gitignore` で除外済み。キーは Vercel の画面に入れる）。

## 第1段階：まずサイトを開けるようにする（プログラミングなし）

- [x] GitHub：Private のリポジトリを作って、コードを push する（`AsagiLaw/accord`。手元のブランチ `irai-note-app` を GitHub の `main` に送る。`git push` だけで送れるよう設定済み）
- [x] Supabase：プロジェクトを作る（無料プランでは地域を選べないので Asia-Pacific）。`supabase/migrations` の SQL を流す（0001〜0009 済み）
- [x] Vercel：GitHub とつないで公開する。環境変数に `NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` を入れる（Production and Preview。公開先は https://accord-hazel-eta.vercel.app ）
- [x] Supabase → Authentication → URL Configuration：Site URL に公開先の URL、Redirect URLs に `https://公開先/auth/callback` を足す
- [x] 公開した URL で新規登録とログインができるのを確かめる（2026-10-19）

できるようになること：公開した URL でサイトが開け、メールとパスワードで新規登録・ログインができる。チャットや画像は、まだそれぞれのブラウザの中にしか保存されない。

## 第2段階：データを Supabase に移す（プログラミング）

今のブラウザのデータは移さず、Supabase で新しく始める（2026-10-20 に決めた）。5つに分けて、終わるたびに公開して確かめる。

- [ ] 2-1：プロフィール・ルーム・フレンド・招待（`0010` を Supabase で流し済み。手元で試し用の2人（test1・test2）で、申請・承認・ルーム作成・招待・参加まで確かめた。あとは公開して確かめる）
- [ ] 2-2：チャット・既読（DM の招待のカードも、ここで本物にする）
- [ ] 2-3：データベース・ノート・カテゴリー・ウィンドウなど
- [ ] 2-4：メディアボックス・ライブラリーの情報
- [ ] 2-5：オンライン表示
- [ ] 「誰が何を見てよいか」の決まり（RLS）を作る

できるようになること：ほかの人とチャットができる。スマホとパソコンで同じデータが見られる。いちばん大きな作業なので、少しずつ進める。

## 第3段階：画像を R2 に移す（プログラミング）

第2段階のデータベースの情報で「誰が見てよいか」を確かめるので、第2段階のあとにする。

- [ ] Cloudflare のアカウントを作り、R2 のバケットを用意する（非公開）
- [ ] 画像の保存先を、ブラウザの中から R2 に切り替える。サーバーで見る権利を確かめてから、期限付きの URL で配る
- [ ] 一覧では `thumb`、ふだんは `view` を出し、`original` は拡大やダウンロードのときだけ読み込む（転送量を減らす）

できるようになること：送った画像をほかの人も見られる。

## 第4段階：ほかの人に使ってもらう前の仕上げ

- [ ] メール送信（Resend など）を Supabase の SMTP に設定する（最初から付いているものは1時間に数通まで）
- [ ] Turnstile：Cloudflare でサイトを追加し、サイトキーを Vercel の `NEXT_PUBLIC_TURNSTILE_SITE_KEY` に、シークレットキーを Supabase の Attack Protection に入れる
- [ ] Google でのログイン（使うなら）：Google Cloud Console で OAuth クライアントを作り、Supabase に登録する
- [ ] 独自ドメイン（任意）
- [ ] お問い合わせ用のメールアドレスを作り、Vercel の `NEXT_PUBLIC_CONTACT_EMAIL` に入れる（利用規約・プライバシーポリシー・お問い合わせのページに出る。空のままだと「準備中」。運営者の名前は `src/lib/site.ts` に入れてある）
- [ ] 利用規約（`/terms`）とプライバシーポリシー（`/privacy`）を読み直す。有料の機能を始めるときは、特定商取引法の表示のページも足す

## 第5段階：お金が動き始める前に

- [ ] Vercel を Pro（月20ドル）に切り替える
- [ ] 必要なら Supabase も Pro（月25ドル）にする（無料プランは、しばらく使われないと一時停止される）

## 公開したあとの更新のしかた

1. コードを変えて、手元（`npm run dev`）で確かめる
2. コミットして GitHub に push する
3. Vercel が自動で作り直して公開する（1〜2分）。失敗したときは古い版のまま残る

- おかしくなったら：Vercel の Deployments から前の版を選んで Instant Rollback で戻す
- 本番の前に試したいとき：別のブランチに push すると、試し用の URL ができる
- `supabase/migrations` に SQL を足したとき：Supabase にもその SQL を流す
- 環境変数を変えたとき：Vercel の画面で値を変えて Redeploy する
