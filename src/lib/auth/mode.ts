import { isSupabaseConfigured } from "@/lib/supabase/env";

/**
 * ログインのしくみ。.env.local に Supabase のキーがあれば Supabase Auth、無ければブラウザの中だけのアカウント（ローカル版）。
 * 画面はどちらも同じものを使う
 */
export const authMode: "local" | "supabase" = isSupabaseConfigured ? "supabase" : "local";
