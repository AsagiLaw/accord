import { isSupabaseConfigured } from "@/lib/supabase/env";

/**
 * ログインのしくみ。.env.local に Supabase のキーがあれば Supabase Auth、無ければブラウザの中だけのアカウント（ローカル版）。
 * 画面はどちらも同じものを使う
 */
export const authMode: "local" | "supabase" = isSupabaseConfigured ? "supabase" : "local";

/**
 * 公開したもの（npm run build）を Supabase につながないまま開いたとき、ローカル版で動かさずに「設定が必要」の画面だけを出す。
 * ローカル版のままだと、試し用の2人が自動で作られて誰でもパスワードなしで入れ、データもその人のブラウザの中だけになるため。
 * 試しにローカル版のまま公開したいときだけ、NEXT_PUBLIC_ALLOW_LOCAL_MODE=1 を入れてからビルドする（どれもビルドのときに決まる）
 */
export const localModeBlocked =
  authMode === "local" && process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_ALLOW_LOCAL_MODE !== "1";
