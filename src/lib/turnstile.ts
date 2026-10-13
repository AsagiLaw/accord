// Cloudflare Turnstile（ロボットよけ）の設定。ログイン・新規登録・パスワードの再設定の画面に、確認の欄を出す。
// サイトキーが無いときは出さない。開発中（npm run dev）は、Cloudflare の試し用のキー（どんな入力でも通る）を使う

/** Cloudflare が用意している試し用のサイトキー（いつも通る・確認の欄は見える） */
export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";

const dev = process.env.NODE_ENV !== "production";

export const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || (dev ? TURNSTILE_TEST_SITE_KEY : "");
export const turnstileEnabled = !!turnstileSiteKey;
/** 試し用のキーで動いているか（画面に「試し用」と出す） */
export const turnstileIsTest = turnstileSiteKey === TURNSTILE_TEST_SITE_KEY;
