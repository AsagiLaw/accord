"use client";

import { useState } from "react";
import { toast } from "@/components/ui/overlay";
import { RichText } from "./RichText";

/** これより長い発言は、はじめは途中までだけ出す */
const MAX_CHARS = 500;
const MAX_LINES = 15;

/** 発言の文章（書式つき）。長いときは途中で切って「続きを読む」を出す（切った後ろは画面に描かない。検索や編集では全文を使う） */
export function LongText({ text, className, children, tone }: { text: string; className?: string; children?: React.ReactNode; tone?: "card" | "accent" }) {
  const [open, setOpen] = useState(false);
  const cut = cutAt(text);
  const folded = cut !== null && !open;
  return (
    <div className={className}>
      {/* wrap-anywhere：URL など切れ目のない長い文字も、狭いチャットの中で折り返す */}
      <div className="wrap-anywhere whitespace-pre-wrap">
        <RichText text={folded ? `${text.slice(0, cut).trimEnd()}…` : text} tone={tone} />
        {children}
      </div>
      {cut !== null && (
        <button type="button" onClick={() => setOpen(!open)} className="mt-1 text-xs font-bold underline opacity-80 hover:opacity-100">
          {open ? "たたむ" : `続きを読む（全${text.length.toLocaleString()}文字）`}
        </button>
      )}
    </div>
  );
}

/** 発言の文章をコピーする（指で触る端末では、発言を長押しで選べないので、これでコピーする） */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast("コピーしました");
  } catch {
    toast("コピーできませんでした");
  }
}

/** どこで切るか。短ければ null（少しはみ出すくらいなら、切らずに全部出す） */
function cutAt(text: string): number | null {
  if (text.length > MAX_CHARS * 1.25) return lineCut(text) ?? MAX_CHARS;
  const total = text.split("\n").length;
  return total > MAX_LINES + 3 ? (lineCut(text) ?? MAX_CHARS) : null;
}

/** MAX_LINES 行目の終わり（MAX_CHARS までに無ければ null） */
function lineCut(text: string): number | null {
  let lines = 0;
  for (let i = 0; i < text.length && i < MAX_CHARS; i++) if (text[i] === "\n" && ++lines >= MAX_LINES) return i;
  return null;
}
