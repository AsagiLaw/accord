"use client";

import { useEffect, useRef, useState } from "react";
import { useNameHints } from "@/lib/name-hints";

/**
 * 「名称表示」がオンのとき、カーソルを止めた場所の名前を出す。
 * 外側の区画から順に「サイドバー › チャット一覧 › リンク「雑談」」のように並べる。
 *
 * 名前の決め方：
 * - 区画：data-name 属性。ダイアログは aria-label、見出し付きの section は見出しの文字
 * - ボタン・リンク・入力欄：aria-label → title → 表示されている文字 → placeholder
 * - ノートのブロック：ブロックの種類
 */

const DELAY = 600;

const BLOCK_NAMES: Record<string, string> = {
  paragraph: "段落ブロック",
  heading: "見出しブロック",
  bulletListItem: "箇条書きブロック",
  numberedListItem: "番号付きリストブロック",
  checkListItem: "チェックリストブロック",
  toggleListItem: "トグルブロック",
  quote: "引用ブロック",
  codeBlock: "コードブロック",
  table: "表ブロック",
  divider: "区切り線ブロック",
  mediaImage: "画像ブロック（メディアから）",
  dbView: "オールビューブロック",
  singleView: "シングルビューブロック",
  chatBlock: "チャットブロック",
  imageChatBlock: "イメージチャットブロック",
  pageTitle: "ページのタイトルブロック",
  pageProps: "ページの項目ブロック",
  pageChat: "ページのチャットブロック",
  tabs: "タブブロック",
  todoBlock: "ToDoブロック",
  addButton: "追加ボタンブロック",
};

const clean = (s: string | null | undefined, max = 24) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
};

function leafName(el: Element): string | null {
  const tag = el.tagName;
  const label = clean(el.getAttribute("aria-label")) || clean(el.getAttribute("title"));
  if (tag === "BUTTON" || el.getAttribute("role") === "button" || el.getAttribute("role") === "tab" || el.getAttribute("role") === "radio") {
    const kind = el.getAttribute("role") === "tab" ? "タブ" : el.getAttribute("role") === "radio" ? "選択肢" : "ボタン";
    return `${kind}「${label || clean((el as HTMLElement).innerText) || "（名前なし）"}」`;
  }
  if (tag === "A") return `リンク「${label || clean((el as HTMLElement).innerText) || "（名前なし）"}」`;
  if (tag === "SELECT") return `選択欄「${label || clean((el as HTMLSelectElement).selectedOptions[0]?.text)}」`;
  if (tag === "TEXTAREA" || (tag === "INPUT" && !["checkbox", "radio", "range", "file"].includes((el as HTMLInputElement).type))) {
    return `入力欄「${label || clean(el.getAttribute("placeholder")) || clean(el.closest("label")?.querySelector("span")?.textContent) || "（名前なし）"}」`;
  }
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    const word = type === "checkbox" ? "チェックボックス" : type === "range" ? "スライダー" : type === "file" ? "ファイル選択" : "選択肢";
    return `${word}「${label || clean(el.closest("label")?.textContent) || "（名前なし）"}」`;
  }
  return null;
}

function regionName(el: Element): string | null {
  const named = el.getAttribute("data-name");
  if (named) return named;
  const type = el.getAttribute("data-content-type");
  if (type && BLOCK_NAMES[type]) return BLOCK_NAMES[type];
  if (el.getAttribute("role") === "dialog") return `${clean(el.getAttribute("aria-label")) || "ダイアログ"}（ダイアログ）`;
  if (el.getAttribute("role") === "tablist") return `${clean(el.getAttribute("aria-label")) || ""}タブの並び`;
  if (el.tagName === "SECTION") {
    const h = el.querySelector(":scope > h2, :scope > h3, :scope > h4, :scope > div > h2");
    if (h) return `「${clean(h.textContent)}」の欄`;
  }
  return null;
}

export function describe(target: Element): string[] {
  const parts: string[] = [];
  let leaf: string | null = null;
  // 一番内側の、ボタンなどの操作できる部品
  const interactive = target.closest("button, a, select, textarea, input, [role=button], [role=tab], [role=radio]");
  if (interactive) leaf = leafName(interactive);
  for (let el: Element | null = target; el && el !== document.body; el = el.parentElement) {
    if (el === interactive) continue;
    const name = regionName(el);
    if (name && parts[0] !== name) parts.unshift(name);
  }
  if (leaf) parts.push(leaf);
  return parts;
}

export function NameInspector() {
  const on = useNameHints();
  const [hint, setHint] = useState<{ x: number; y: number; parts: string[] } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!on) return;
    const clear = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      // 少し動いただけなら出したままにする
      if (Math.hypot(e.clientX - last.current.x, e.clientY - last.current.y) < 4) return;
      last.current = { x: e.clientX, y: e.clientY };
      setHint(null);
      clear();
      timer.current = setTimeout(() => {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el || el.closest("[data-name-hint]")) return;
        const parts = describe(el);
        if (parts.length) setHint({ x: e.clientX, y: e.clientY, parts });
      }, DELAY);
    };
    const hide = () => {
      clear();
      setHint(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", hide);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("keydown", hide);
    return () => {
      clear();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", hide);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("keydown", hide);
    };
  }, [on]);

  if (!on || !hint) return null;
  // 画面の右端・下端ではみ出さないよう、カーソルの反対側に出す
  const right = typeof window !== "undefined" && hint.x > window.innerWidth - 460;
  const bottom = typeof window !== "undefined" && hint.y > window.innerHeight - 80;
  return (
    <div
      data-name-hint
      role="status"
      className="pointer-events-none fixed z-[100] max-w-[min(520px,90vw)] rounded-[10px] bg-ink px-3 py-1.5 text-[13px] leading-snug text-bg shadow-lg"
      style={{
        left: right ? undefined : hint.x + 14,
        right: right ? window.innerWidth - hint.x + 14 : undefined,
        top: bottom ? undefined : hint.y + 18,
        bottom: bottom ? window.innerHeight - hint.y + 12 : undefined,
      }}
    >
      {hint.parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="mx-1 opacity-50">›</span>}
          <span className={i === hint.parts.length - 1 ? "font-bold" : ""}>{p}</span>
        </span>
      ))}
    </div>
  );
}
