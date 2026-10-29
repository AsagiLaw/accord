"use client";

import { defaultProps } from "@blocknote/core";
import { createReactBlockSpec, createReactInlineContentSpec, useEditorChange, type DefaultReactSuggestionItem } from "@blocknote/react";
import { useRouter } from "next/navigation";
import { useContext, useState } from "react";
import { NoteContext } from "@/components/embeds";
import { Icon } from "@/components/Icon";
import { IconMark } from "@/components/IconMark";
import { IconPicker } from "@/components/IconPicker";
import { usePopover } from "@/components/ui/Popover";
import { db } from "@/lib/local/db";
import { useNote } from "@/lib/local/notes";
import { addDays, daysBetween, isDate, today } from "@/lib/requests/logic";

// Notion にあるブロック（コールアウト・目次）と、文の中に入れるメンション（@：メンバー・日付・ノート）

type Loose = { id: string; type: string; props?: Record<string, unknown>; content?: unknown; children?: Loose[] };

/** ブロックの文（リンク・メンションも含めた見えている文字） */
export function plainText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c: { type?: string; text?: string; content?: unknown; props?: { label?: string } }) =>
      c.type === "mention" ? `@${c.props?.label ?? ""}` : c.type === "link" ? plainText(c.content) : (c.text ?? ""),
    )
    .join("");
}

/** 見出しのブロックへ移って、少しのあいだ光らせる（目次・ブロックへのリンクから） */
export function jumpToBlock(root: ParentNode, id: string) {
  const el = root.querySelector<HTMLElement>(`.bn-block-outer[data-id="${CSS.escape(id)}"]`);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  // エディタの中の要素は、class を変えてもエディタが元に戻すので、アニメーションで光らせる（チャットの検索の msg-flash と同じ動き）
  el.querySelector<HTMLElement>(":scope > .bn-block > .bn-block-content, :scope > .bn-block > .react-renderer > .bn-block-content")?.animate(
    [
      { background: "color-mix(in srgb, var(--accent) 22%, transparent)", borderRadius: "6px" },
      { background: "color-mix(in srgb, var(--accent) 22%, transparent)", borderRadius: "6px", offset: 0.6 },
      { background: "transparent", borderRadius: "6px" },
    ],
    { duration: 1800, easing: "ease-out" },
  );
  return true;
}

// ---- コールアウト ----

const CALLOUT_ICON = "💡";

/** コールアウト：左にアイコン、色のついた面。色は「⋮⋮」の「カラー」で変えられる（はじめは薄い灰色） */
export const CalloutBlock = createReactBlockSpec(
  {
    type: "callout",
    propSchema: { textColor: defaultProps.textColor, backgroundColor: defaultProps.backgroundColor, icon: { default: CALLOUT_ICON } },
    content: "inline",
  },
  {
    render: ({ block, editor, contentRef }) => (
      <CalloutView icon={block.props.icon} editable={editor.isEditable} onIcon={(icon) => editor.updateBlock(block, { props: { icon } })} contentRef={contentRef} />
    ),
  },
);

function CalloutView({ icon, editable, onIcon, contentRef }: { icon: string; editable: boolean; onIcon: (icon: string) => void; contentRef: (el: HTMLElement | null) => void }) {
  const ctx = useContext(NoteContext);
  const pop = usePopover();
  return (
    <div className="note-callout" data-name="コールアウト">
      <button
        type="button"
        contentEditable={false}
        disabled={!editable || !ctx}
        // 押したときに、エディタのカーソルが動かないようにする
        onMouseDown={(e) => e.preventDefault()}
        onClick={pop.toggle}
        aria-label="アイコンを変える"
        title={editable ? "アイコンを変える" : undefined}
        className="note-callout-icon"
      >
        <IconMark icon={icon} fallback={CALLOUT_ICON} />
      </button>
      {pop.anchor && ctx && (
        <IconPicker anchor={pop.anchor} roomId={ctx.roomId} hasIcon={icon !== CALLOUT_ICON} removeLabel={`${CALLOUT_ICON} に戻す`} onPick={(i) => onIcon(i ?? CALLOUT_ICON)} onClose={pop.close} />
      )}
      <div ref={contentRef} className="min-w-0 flex-1" />
    </div>
  );
}

// ---- 目次 ----

type Head = { id: string; level: number; text: string };

function headingsOf(blocks: Loose[], out: Head[] = []): Head[] {
  for (const b of blocks) {
    if (b.type === "heading") out.push({ id: b.id, level: Number(b.props?.level ?? 1), text: plainText(b.content) });
    if (b.children?.length) headingsOf(b.children, out);
  }
  return out;
}

/** 目次：このページの見出しを並べる。押すとその見出しへ移る */
export const TocBlock = createReactBlockSpec({ type: "toc", propSchema: {}, content: "none" }, { render: ({ editor }) => <TocView editor={editor as unknown as TocEditor} /> });

type TocEditor = { document: unknown[]; domElement?: HTMLElement };

function TocView({ editor }: { editor: TocEditor }) {
  const [heads, setHeads] = useState(() => headingsOf(editor.document as Loose[]));
  useEditorChange(() => {
    const next = headingsOf(editor.document as Loose[]);
    setHeads((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, editor as never);
  if (!heads.length)
    return (
      <p contentEditable={false} className="note-toc-empty">
        見出しを足すと、ここに目次が出ます
      </p>
    );
  const top = Math.min(...heads.map((h) => h.level));
  return (
    <nav contentEditable={false} aria-label="目次" className="note-toc" data-name="目次">
      {heads.map((h) => (
        <a
          key={h.id}
          href={`#block-${h.id}`}
          onClick={(e) => {
            e.preventDefault();
            if (editor.domElement) jumpToBlock(editor.domElement, h.id);
          }}
          style={{ paddingLeft: Math.min(h.level - top, 3) * 24 }}
        >
          {h.text || "見出し"}
        </a>
      ))}
    </nav>
  );
}

// ---- メンション（@） ----

const WEEK = "日月火水木金土";

/** 日付のメンションの文字：今日・明日・昨日は言葉で、ほかは「10月31日（金）」（今年でなければ年も） */
export function mentionDate(ymd: string) {
  if (!isDate(ymd)) return ymd;
  const diff = daysBetween(today(), ymd);
  if (diff === 0) return "今日";
  if (diff === 1) return "明日";
  if (diff === -1) return "昨日";
  const [y, m, d] = ymd.split("-").map(Number);
  const w = WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y === new Date().getFullYear() ? "" : `${y}年`}${m}月${d}日（${w}）`;
}

/**
 * 文の中に入れるメンション。kind：user（メンバー）・date（日付）・note（ルームのノート）。value はその ID（日付は YYYY-MM-DD）。
 * 項目の名前を id にすると data-id になり、BlockNote がブロックと間違えるので value にする
 */
export const MentionInline = createReactInlineContentSpec(
  {
    type: "mention",
    propSchema: { kind: { default: "user", values: ["user", "date", "note"] as const }, value: { default: "" }, label: { default: "" } },
    content: "none",
  },
  { render: ({ inlineContent }) => <MentionChip kind={inlineContent.props.kind} id={inlineContent.props.value} label={inlineContent.props.label} /> },
);

function MentionChip({ kind, id, label }: { kind: "user" | "date" | "note"; id: string; label: string }) {
  const ctx = useContext(NoteContext);
  if (kind === "note") return <NoteMention id={id} label={label} />;
  if (kind === "date")
    return (
      <span className="note-mention" data-kind="date">
        @{mentionDate(id)}
      </span>
    );
  const m = ctx?.members.find((x) => x.userId === id);
  return (
    <span className="note-mention" data-kind="user" data-me={id && id === ctx?.userId ? "" : undefined}>
      @{m?.displayName ?? label}
    </span>
  );
}

/** ノートへのリンク。名前とアイコンは、いまのノートのものを出す（消したノートは薄く） */
function NoteMention({ id, label }: { id: string; label: string }) {
  const note = useNote(id);
  const router = useRouter();
  if (note === null)
    return (
      <span className="note-mention" data-kind="gone" title="削除されたノート">
        {label}
      </span>
    );
  const href = note ? `/r/${note.roomId}/note/${note.id}` : undefined;
  return (
    <a
      href={href}
      className="note-page-link"
      onClick={(e) => {
        e.preventDefault();
        if (href) router.push(href);
      }}
    >
      <span className="note-page-link-icon">
        <IconMark icon={note?.icon} fallback={<Icon name="note" size={14} />} />
      </span>
      <span className="note-page-link-text">{note?.title || label || "無題"}</span>
    </a>
  );
}

type MentionEditor = { insertInlineContent: (content: never) => void };
type Ctx = { roomId: string; members: { userId: string; displayName: string }[] } | null;

/** 「10/31」「10月31日」「2026-11-03」などを日付にする */
function parseDate(q: string): string | null {
  const s = q.trim().replace(/[０-９／]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const full = s.match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?$/);
  const short = s.match(/^(\d{1,2})[/月](\d{1,2})日?$/);
  const [y, m, d] = full ? [+full[1], +full[2], +full[3]] : short ? [new Date().getFullYear(), +short[1], +short[2]] : [];
  if (!y || !m || !d || m > 12 || d > 31) return null;
  const ymd = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isDate(ymd) ? ymd : null;
}

/** 「@」のメニュー：日付・メンバー・ルームのノート */
export async function mentionItems(editor: MentionEditor, ctx: Ctx, query: string): Promise<DefaultReactSuggestionItem[]> {
  const insert = (kind: "user" | "date" | "note", id: string, label: string) => () =>
    editor.insertInlineContent([{ type: "mention", props: { kind, value: id, label } }, " "] as never);
  const q = query.trim().toLowerCase();
  const hit = (...words: string[]) => !q || words.some((w) => w.toLowerCase().includes(q));
  const items: DefaultReactSuggestionItem[] = [];
  const t = today();
  const dates: [string, string, string[]][] = [
    ["今日", t, ["today", "kyou", "きょう"]],
    ["明日", addDays(t, 1), ["tomorrow", "ashita", "あした"]],
    ["昨日", addDays(t, -1), ["yesterday", "kinou", "きのう"]],
  ];
  const parsed = parseDate(query);
  if (parsed) items.push({ title: mentionDate(parsed), group: "日付", icon: <Icon name="calendar" size={16} />, onItemClick: insert("date", parsed, mentionDate(parsed)) });
  for (const [label, ymd, aliases] of dates)
    if (hit(label, ...aliases)) items.push({ title: label, group: "日付", icon: <Icon name="calendar" size={16} />, onItemClick: insert("date", ymd, mentionDate(ymd)) });
  for (const m of ctx?.members ?? [])
    if (hit(m.displayName)) items.push({ title: m.displayName, group: "メンバー", icon: <Icon name="person" size={16} />, onItemClick: insert("user", m.userId, m.displayName) });
  if (ctx?.roomId) {
    const notes = (await db.notes.where("roomId").equals(ctx.roomId).filter((n) => !n.pageId && !n.template && !n.inner).toArray()).sort((a, b) => b.updatedAt - a.updatedAt);
    for (const n of notes.filter((n) => hit(n.title || "無題")).slice(0, 8))
      items.push({
        title: n.title || "無題",
        group: "ノート",
        icon: (
          <span className="text-base leading-none">
            <IconMark icon={n.icon} fallback={<Icon name="note" size={16} />} />
          </span>
        ),
        onItemClick: insert("note", n.id, n.title || "無題"),
      });
  }
  return items;
}
