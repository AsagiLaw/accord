import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { LEGAL_LINKS, SITE } from "@/lib/site";

/**
 * 利用規約・プライバシーポリシー・お問い合わせのページの入れ物：上にアプリの印と3つのページの切り替え、白いカードに本文。
 * ログインしていなくても開ける（AuthGate の PUBLIC）
 */
export function LegalPage({ path, title, updated = true, children }: { path: string; title: string; updated?: boolean; children: React.ReactNode }) {
  return (
    <main data-name="規約などのページ" className="min-h-dvh bg-bg px-4 py-8 md:py-12">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2 font-bold">
            <BrandMark size={36} />
            {SITE.name}
          </Link>
          <nav data-name="規約などの切り替え" aria-label="規約など" className="flex flex-wrap gap-1 text-sm">
            {LEGAL_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                aria-current={path === l.href ? "page" : undefined}
                className={`rounded-full px-3 py-1.5 ${path === l.href ? "bg-accent font-bold text-accent-ink" : "text-muted hover:bg-tint hover:text-ink"}`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </header>
        <article className="card legal space-y-5">
          <div>
            <h1 className="text-2xl font-bold">{title}</h1>
            {updated && (
              <p className="mt-1 text-xs text-muted">
                制定：{SITE.legalEstablished}
                {SITE.legalUpdated !== SITE.legalEstablished && `　最終改定：${SITE.legalUpdated}`}
              </p>
            )}
          </div>
          {children}
        </article>
      </div>
    </main>
  );
}

/** 条の見出しと本文 */
export function Article({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-bold">{title}</h2>
      {children}
    </section>
  );
}

/** 運営者の名前（まだ入れていないときは「準備中」） */
export function OperatorName() {
  return <>{SITE.operator || "（準備中）"}</>;
}

/** お問い合わせのメールアドレス（まだ入れていないときは「準備中」） */
export function ContactEmail() {
  if (!SITE.contactEmail) return <>（準備中）</>;
  return (
    <a href={`mailto:${SITE.contactEmail}`} className="font-bold text-accent break-all hover:underline">
      {SITE.contactEmail}
    </a>
  );
}
