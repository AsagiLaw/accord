"use client";

import { createContext, useContext } from "react";
import { DEFAULT_PAGE_ICON, IconMark } from "@/components/IconMark";
import { nameSuffixOf } from "@/lib/local/requests";
import type { CalEvent, Database, DbPage, DbView } from "@/lib/local/db";
import type { MemberWithProfile } from "@/lib/local/rooms";
import { dueStatus, dueText, type DueState } from "@/lib/requests/due";
import { Tag } from "../meta";
import { PageLink as PeekLink } from "../PageLink";

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

/** 納期の印（3日超過・今日まで・あと2日）。過ぎた・今日は赤、近いはオレンジ */
export function DueBadge({ state }: { state: DueState }) {
  return (
    // 狭い場所では、名前と一緒に縮む（どちらも少しずつ見えるように）
    <span className="flex min-w-0 text-xs font-bold" title={`納期：${state.date.replaceAll("-", "/")}`} data-name="納期の印">
      <Tag color={state.tone === "soon" ? "orange" : "red"}>{dueText(state)}</Tag>
    </span>
  );
}

/**
 * ページのアイコン（絵文字・シンプルなアイコン・メディアの画像。付けていなければ標準のアイコン）と名前。名前が空なら「無題」。noIcon のときはアイコンを出さない。
 * 納期が近い・過ぎたページは、名前の横に納期の印を出す（noDue のときは出さない）
 */
export function PageName({ database, page, className, noIcon, noDue }: { database: Database; page: DbPage; className?: string; noIcon?: boolean; noDue?: boolean }) {
  const due = noDue ? null : dueStatus(database, page);
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
      {due && <DueBadge state={due} />}
    </span>
  );
}

export function PageLink({ database, page, className }: { database: Database; page: DbPage; className?: string }) {
  return (
    <PeekLink database={database} pageId={page.id} className={`hover:underline ${className ?? ""}`}>
      <PageName database={database} page={page} />
    </PeekLink>
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

/** 何も出ないときに出す、次の一手（条件を外す・追加する など）。データベースの画面が決める */
export const EmptyHint = createContext<React.ReactNode>(null);

export function Empty({ children }: { children: React.ReactNode }) {
  const hint = useContext(EmptyHint);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-4 text-sm text-muted">
      <p>{children}</p>
      {hint}
    </div>
  );
}
