import { Icon } from "@/components/Icon";

/**
 * ページが見つからない・エラー・設定が必要のときに出す画面：まんなかにアプリの印と名前、白いカード（ログインの画面と同じ形）。
 * global-error でも使うので、"use client" もデータの読み込みも持たない
 */
export function NoticeScreen({ title, lead, children }: { title: string; lead: string; children?: React.ReactNode }) {
  return (
    <main data-name="お知らせの画面" className="grid min-h-dvh place-items-center bg-bg px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span aria-hidden className="grid h-12 w-12 place-items-center rounded-[16px] bg-accent text-accent-ink">
            <Icon name="note" size={26} />
          </span>
          <p className="text-sm font-bold text-muted">依頼ノート</p>
        </div>
        <section className="card space-y-4">
          <div>
            <h1 className="text-xl font-bold">{title}</h1>
            <p className="mt-1 text-sm text-muted">{lead}</p>
          </div>
          {children}
        </section>
      </div>
    </main>
  );
}
