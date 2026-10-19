import { isSupabaseConfigured } from "@/lib/supabase/env";

/**
 * ログインのしくみ。.env.local に Supabase のキーがあれば Supabase Auth、無ければブラウザの中だけのアカウント（ローカル版）。
 * 画面はどちらも同じものを使う
 */
export const authMode: "local" | "supabase" = isSupabaseConfigured ? "supabase" : "local";

/**
 * 公開したもの（npm run build）を Supabase につながないまま開いたとき、ローカル版で動かさずに「設定が必要」の画面だけを出す。
 * ローカル版のままだと、データがその人のブラウザの中だけになるため。
 * 試しにローカル版のまま公開したいときだけ、NEXT_PUBLIC_ALLOW_LOCAL_MODE=1 を入れてからビルドする（どれもビルドのときに決まる）
 */
export const localModeBlocked =
  authMode === "local" && process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_ALLOW_LOCAL_MODE !== "1";

/**
 * 開発の確かめ用の2人（マネージャー・イラストレーター）と、2人だけのルーム「依頼管理」を使えるか。
 * 開発中（npm run dev）のローカル版だけ。公開したもの（ローカル版のまま公開したときも）や Supabase につないだときは、
 * 2人もルームも作らず、ログインの画面にも出さず、パスワードなしでは入れない
 */
export const devSampleUsers = authMode === "local" && process.env.NODE_ENV === "development";
