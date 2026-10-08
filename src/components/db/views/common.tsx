"use client";

import Link from "next/link";
import { DEFAULT_PAGE_ICON, IconMark } from "@/components/IconMark";
import { nameSuffixOf } from "@/lib/local/requests";
import type { CalEvent, Database, DbPage, DbView } from "@/lib/local/db";
import type { MemberWithProfile } from "@/lib/local/rooms";

export type ViewProps = {
  database: Database;
  view: DbView;
  /** ビューの絞り込み・並び替え・検索をかけた後のページ */
  pages: DbPage[];
  /** 絞り込み前のすべてのページ（集計で使う） */
  allPages: DbPage[];
  events: CalEvent[];
  members: MemberWithProfile[];
  /** 新しいページを作る人 */
  userId: string;
  /** ホームなど、狭い場所に置くとき */
  compact?: boolean;
  /** 場所（ウィンドウの区画、決めた高さ）いっぱいに伸ばして、その中に収める（カレンダーはマスの高さを合わせ、日付は減らさない。タイムラインは枠を伸ばす） */
  fit?: boolean;
};

export const pageHref = (database: Database, pageId: string) => `/r/${database.roomId}/db/${database.id}/p/${pageId}`;

/** ページのアイコン（絵文字・シンプルなアイコン・メディアの画像。付けていなければ標準のアイコン）と名前。名前が空なら「無題」。noIcon のときはアイコンを出さない */
export function PageName({ database, page, className, noIcon }: { database: Database; page: DbPage; className?: string; noIcon?: boolean }) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className ?? ""}`}>
      {!noIcon && (
        <span className="shrink-0">
          <IconMark icon={page.icon || DEFAULT_PAGE_ICON} />
        </span>
      )}
      <span className={`truncate ${page.title ? "" : "text-muted"}`}>
        {page.title || "無題"}
        {page.title && nameSuffixOf(database)}
      </span>
    </span>
  );
}

export function PageLink({ database, page, className }: { database: Database; page: DbPage; className?: string }) {
  return (
    <Link href={pageHref(database, page.id)} className={`hover:underline ${className ?? ""}`}>
      <PageName database={database} page={page} />
    </Link>
  );
}

export function Gauge({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line" role="meter" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label="進行">
      <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${v}%` }} />
    </div>
  );
}

/** サークル型のゲージ（真ん中に％） */
export function CircleGauge({ value, size = 72, label }: { value: number; size?: number; label?: string }) {
  const v = Math.max(0, Math.min(100, value || 0));
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }} role="meter" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? "進み具合"}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--line)" strokeWidth="10" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={v >= 100 ? "var(--accent)" : "var(--accent)"} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(c * v) / 100} ${c}`} />
      </svg>
      <span className="relative text-sm font-bold" style={{ fontSize: size / 4.5 }}>
        {v}%
      </span>
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-sm text-muted">{children}</p>;
}
