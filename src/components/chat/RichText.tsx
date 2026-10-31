"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

// 発言の文章の書式（Discord と同じ書き方の一部）。HTML としては読まず、React の部品に組み立てる
// **太字**・*斜体*・__下線__・~~取り消し線~~・`コード`・```コードのかたまり```・> 引用・||ネタバレ||・URL のリンク・@名前（メンション）

/** メンションとして色を付ける名前と、自分の名前（自分へのメンションは強く出す） */
export type MentionNames = { names: string[]; me?: string };
const MentionContext = createContext<MentionNames>({ names: [] });
export const MentionProvider = MentionContext.Provider;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** その文章に、名前 name へのメンション（@名前）があるか */
export function mentions(text: string, name: string | undefined) {
  if (!name) return false;
  return new RegExp(`@${escapeRe(name)}(?![\\p{L}\\p{N}_])`, "u").test(text);
}

/** 書式の記号を外した文章（返信の引用や通知の短い中身に使う） */
export function plainText(text: string) {
  return text
    .replace(/```(?:[^\n`]*\n)?([\s\S]*?)```/g, "$1")
    .replace(/\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|~~([\s\S]+?)~~|\|\|([\s\S]+?)\|\||`([^`\n]+)`/g, (_, a, b, c, d, e) => a ?? b ?? c ?? (d !== undefined ? "■■■" : e))
    .replace(/^> /gm, "");
}

/** 絵文字だけの短い発言か（大きく出す。Discord・LINE と同じ） */
export function emojiOnly(text: string) {
  const t = text.trim();
  if (!t || t.length > 40 || !/\p{Extended_Pictographic}/u.test(t)) return false;
  if (!/^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\p{Emoji_Modifier}|‍|️|\s)+$/u.test(t)) return false;
  const count = [...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(t.replace(/\s/g, ""))].length;
  return count <= 3;
}

/** 発言の文章を書式つきで出す。tone は吹き出しの色（自分の発言はアクセント色の上に出すので、リンクなどの色を変える） */
export function RichText({ text, tone = "card" }: { text: string; tone?: "card" | "accent" }) {
  const mention = useContext(MentionContext);
  return <>{blocks(text, { tone, mention })}</>;
}

type Ctx = { tone: "card" | "accent"; mention: MentionNames };

/** コードのかたまりと引用を分けてから、残りを1行ずつの文字の書式で出す */
function blocks(text: string, ctx: Ctx): ReactNode[] {
  const out: ReactNode[] = [];
  const fence = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text))) {
    if (m.index > last) out.push(...quotes(text.slice(last, m.index), ctx, out.length));
    // 「```js」のように言葉が続くときは、言語の名前として扱う（出さない）。1行で閉じたときは、その言葉も中身
    const body = m[2] || (m[1] && !m[0].includes("\n") ? m[1] : "");
    out.push(
      <pre
        key={`c${out.length}`}
        // スマホの幅では横に流さず、折り返す
        className={`my-1 overflow-x-auto rounded-[8px] px-2.5 py-1.5 font-mono text-[13px] leading-relaxed whitespace-pre max-md:wrap-anywhere max-md:whitespace-pre-wrap ${ctx.tone === "accent" ? "bg-black/20" : "border border-line bg-bg"}`}
      >
        {body.replace(/\n$/, "")}
      </pre>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...quotes(text.slice(last), ctx, out.length));
  return out;
}

/** 「> 」で始まる行を引用にまとめる */
function quotes(text: string, ctx: Ctx, keyBase: number): ReactNode[] {
  const out: ReactNode[] = [];
  const lines = text.split("\n");
  let plain: string[] = [];
  let quote: string[] = [];
  const flushPlain = () => {
    if (!plain.length) return;
    const s = plain.join("\n");
    plain = [];
    out.push(<span key={`p${keyBase}-${out.length}`}>{inline(s, ctx, `${keyBase}-${out.length}`)}</span>);
  };
  const flushQuote = () => {
    if (!quote.length) return;
    const s = quote.join("\n");
    quote = [];
    out.push(
      <span key={`q${keyBase}-${out.length}`} className={`my-0.5 block border-l-4 pl-2 ${ctx.tone === "accent" ? "border-white/50" : "border-line"}`}>
        {inline(s, ctx, `q${keyBase}-${out.length}`)}
      </span>,
    );
  };
  lines.forEach((line, i) => {
    const q = /^> ?(.*)$/.exec(line);
    if (q && line.startsWith(">")) {
      flushPlain();
      quote.push(q[1]);
    } else {
      flushQuote();
      // 改行は、書式の行の間にだけ入れる（引用のかたまりの前後は、かたまりで改行される）
      plain.push(line);
    }
    if (i === lines.length - 1) {
      flushPlain();
      flushQuote();
    }
  });
  return out;
}

const URL_RE = String.raw`https?:\/\/[^\s<>"'「」『』（）]+[^\s<>"'「」『』（）.,:;!?、。)\]]`;

/** 1つの文字の書式。中の書式もたどる（コードの中はたどらない） */
function inline(text: string, ctx: Ctx, key: string): ReactNode[] {
  const names = [...ctx.mention.names].filter(Boolean).sort((a, b) => b.length - a.length);
  const mentionRe = names.length ? `|@(${names.map(escapeRe).join("|")})(?![\\p{L}\\p{N}_])` : "";
  const re = new RegExp(
    // \x60 はバッククォート（`コード`）
    String.raw`(\x60+)([^\x60]|[^\x60][\s\S]*?[^\x60])\1(?!\x60)|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|~~([\s\S]+?)~~|\|\|([\s\S]+?)\|\||\*([^\s*](?:[^*]*?[^\s*])?)\*|(${URL_RE})` + mentionRe,
    "gu",
  );
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[2] !== undefined)
      out.push(
        <code key={k} className={`rounded-[4px] px-1 py-px font-mono text-[0.88em] ${ctx.tone === "accent" ? "bg-black/20" : "border border-line bg-bg"}`}>
          {m[2]}
        </code>,
      );
    else if (m[3] !== undefined) out.push(<strong key={k}>{inline(m[3], ctx, k)}</strong>);
    else if (m[4] !== undefined) out.push(<u key={k}>{inline(m[4], ctx, k)}</u>);
    else if (m[5] !== undefined) out.push(<s key={k}>{inline(m[5], ctx, k)}</s>);
    else if (m[6] !== undefined) out.push(<Spoiler key={k}>{inline(m[6], ctx, k)}</Spoiler>);
    else if (m[7] !== undefined) out.push(<em key={k}>{inline(m[7], ctx, k)}</em>);
    else if (m[8] !== undefined)
      out.push(
        <a
          key={k}
          href={m[8]}
          target="_blank"
          rel="noopener noreferrer nofollow"
          onClick={(e) => e.stopPropagation()}
          className={`underline underline-offset-2 hover:opacity-80 ${ctx.tone === "accent" ? "" : "text-accent"}`}
        >
          {m[8]}
        </a>,
      );
    else if (m[9] !== undefined) {
      const self = m[9] === ctx.mention.me;
      out.push(
        <span
          key={k}
          className={`rounded-[4px] px-0.5 font-bold box-decoration-clone ${ctx.tone === "accent" ? "bg-white/25" : self ? "bg-yellow-400/35 text-ink" : "bg-accent/15 text-accent"}`}
        >
          @{m[9]}
        </span>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** ネタバレ（押すまで隠す） */
function Spoiler({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      role={open ? undefined : "button"}
      tabIndex={open ? undefined : 0}
      title={open ? undefined : "ネタバレ（押すと見える）"}
      onClick={(e) => {
        e.stopPropagation();
        setOpen(true);
      }}
      onKeyDown={(e) => e.key === "Enter" && setOpen(true)}
      className={`rounded-[4px] px-0.5 transition-colors ${open ? "bg-black/10" : "cursor-pointer bg-ink/80 text-transparent select-none [&_*]:invisible"}`}
    >
      {children}
    </span>
  );
}
