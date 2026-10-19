import { NoticeScreen } from "@/components/app/NoticeScreen";

/** 公開したものが Supabase につながっていないときに、ローカル版の代わりに出す画面（src/lib/auth/mode.ts の localModeBlocked） */
export function LocalModeBlocked() {
  return (
    <NoticeScreen title="まだ使える状態ではありません" lead="サーバー（Supabase）につながっていないため、ログインやデータの保存ができません。">
      <div data-name="公開の設定の手順" className="space-y-2 text-sm">
        <p>公開した人は、公開先の環境変数に次の2つを入れてから、もう一度ビルドしてください。</p>
        <ul className="space-y-1 rounded-[10px] border border-line bg-bg px-3 py-2 font-mono text-xs break-all">
          <li>NEXT_PUBLIC_SUPABASE_URL</li>
          <li>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</li>
        </ul>
        <p className="text-xs text-muted">試しにローカル版（データはそれぞれのブラウザの中だけ）のまま公開するときは、NEXT_PUBLIC_ALLOW_LOCAL_MODE=1 を入れます。</p>
      </div>
    </NoticeScreen>
  );
}
