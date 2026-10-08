"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { useBlobUrl } from "@/lib/media/blob-url";
import { arrange, chain, coverOf, descendants, libraryView } from "@/lib/media/logic";
import { useMediaPrefs } from "@/lib/media/prefs";
import { useMediaState } from "./MediaContext";
import { ThumbImage } from "./Thumb";

/** 一覧のサムネイルを押した位置（拡大して出てくる動きの始まり） */
const opened: { from: DOMRect | null } = { from: null };
export function rememberOpenedFrom(el: Element | null) {
  opened.from = el?.getBoundingClientRect() ?? null;
}

/**
 * 画像を大きく表示する（試作「依頼ノート」と同じデザイン）。
 * サイドバーと上の操作バーは見えたまま、下の画面をぼかして画像を出す。
 * 下にフィルムストリップと、画像が入っているライブラリーのカード。
 * カードを押すとフィルムストリップがそのライブラリーの並びに、ダブルクリックでそのライブラリーを開く。
 */
export function Lightbox() {
  const { viewing, setViewing, byId, media, libs, roomId, setOrganizing } = useMediaState();
  const prefs = useMediaPrefs();
  const pathname = usePathname();
  const router = useRouter();
  const [ctxLib, setCtxLib] = useState<string | null>(null);
  const [box, setBox] = useState<{ left: number; top: number; right: number } | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const swipe = useRef<number | null>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevId = useRef<string | null>(null);

  const m = viewing ? byId.get(viewing.id) : undefined;
  const original = useBlobUrl(m?.id, "original");
  const inLibPage = pathname.includes("/media/lib/");

  // 入っているライブラリー（一番深いものと、その親たち）
  const inLibs = m ? libs.filter((l) => m.libIds.includes(l.id)) : [];
  const leaves = inLibs.filter((l) => !inLibs.some((o) => o !== l && descendants(libs, l.id).includes(o.id)));
  const related = [...new Map(leaves.flatMap((l) => chain(libs, l.id)).map((l) => [l.id, l])).values()];
  // 最初の並び：ライブラリーを開いているならその並び、そうでなければ画像が入っているライブラリー
  const currentPageLib = inLibPage ? pathname.split("/media/lib/")[1] : null;
  const cur = ctxLib ?? currentPageLib ?? leaves[0]?.id ?? null;

  const list = !viewing
    ? []
    : cur && !(cur === currentPageLib && !ctxLib) && libs.some((l) => l.id === cur)
      ? arrange(libraryView(media, libs, cur, "all"), prefs).map((x) => x.id)
      : viewing.list.filter((id) => byId.has(id));
  const i = m ? list.indexOf(m.id) : -1;
  const go = (step: number) => {
    const next = list[i + step];
    if (next) setViewing(next, viewing!.list);
  };

  // メイン画面のうち、上の細いバー（場所と操作）より下を覆う
  useLayoutEffect(() => {
    const place = () => {
      const main = document.querySelector('main[data-name="メイン画面"]')?.getBoundingClientRect();
      const bar = document.querySelector('header[data-name="上部バー"]')?.getBoundingClientRect();
      if (!main) return setBox({ left: 0, top: 0, right: 0 });
      setBox({ left: main.left, top: bar ? Math.max(main.top, bar.bottom) : main.top, right: window.innerWidth - main.right });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, []);

  useEffect(() => {
    if (!m) return;
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]:not([data-lightbox])') || /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName)) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
      if (e.key === "Escape") setViewing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // 今の画像がフィルムストリップの真ん中に来るように
  useEffect(() => {
    strip.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ inline: "center", block: "nearest", behavior: prevId.current ? "smooth" : "auto" });
  }, [m?.id, cur]);

  // 開いたとき：サムネイルの位置から拡大して出てくる。切り替えたとき：ふわっと出る
  const animateIn = () => {
    const el = img.current;
    if (!el || !el.animate) return;
    const r = el.getBoundingClientRect();
    if (!prevId.current && opened.from && r.width) {
      const f = opened.from;
      el.animate(
        [{ transform: `translate(${f.left + f.width / 2 - r.left - r.width / 2}px, ${f.top + f.height / 2 - r.top - r.height / 2}px) scale(${f.width / r.width})` }, { transform: "none" }],
        { duration: 480, easing: "cubic-bezier(.3,1.25,.5,1)" },
      );
    } else if (prevId.current && prevId.current !== m?.id) {
      el.animate([{ opacity: 0, transform: "scale(.97)" }, { opacity: 1, transform: "none" }], { duration: 280, easing: "cubic-bezier(.2,.8,.2,1)" });
    }
    opened.from = null;
    prevId.current = m?.id ?? null;
  };

  if (!m || !viewing || !box) return null;

  const close = () => setViewing(null);
  const navBtn = (side: "l" | "r", disabled: boolean, onClick: () => void) => (
    <button
      aria-label={side === "l" ? "前の画像" : "次の画像"}
      disabled={disabled}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      className={`absolute top-1/2 ${side === "l" ? "left-0" : "right-0"} grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-line text-ink backdrop-blur-md disabled:opacity-30`}
      style={{ background: "color-mix(in srgb, var(--bg) 70%, transparent)" }}
    >
      <Icon name={side} size={22} />
    </button>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-lightbox
      aria-label={m.name}
      data-name="画像の大きな表示"
      onClick={(e) => e.target === e.currentTarget && close()}
      className="fixed bottom-0 z-[22] flex animate-[fade_.3s] flex-col items-center gap-3.5 overflow-hidden px-5 pt-14"
      style={{ left: box.left, right: box.right, top: box.top, background: "color-mix(in srgb, var(--bg) 55%, transparent)", backdropFilter: "blur(11px)", WebkitBackdropFilter: "blur(11px)" }}
    >
      <button
        aria-label="閉じる"
        onClick={close}
        className="btn-sub absolute top-3 right-4 w-10 px-0 backdrop-blur-md"
        style={{ background: "color-mix(in srgb, var(--bg) 70%, transparent)" }}
      >
        <Icon name="x" />
      </button>

      <div
        className="relative flex min-h-0 w-full flex-1 touch-pan-y items-center justify-center px-14"
        onClick={(e) => e.target === e.currentTarget && close()}
        onPointerDown={(e) => (swipe.current = e.clientX)}
        onPointerUp={(e) => {
          if (swipe.current === null) return;
          const dx = e.clientX - swipe.current;
          swipe.current = null;
          if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
        }}
      >
        {navBtn("l", i <= 0, () => go(-1))}
        {original ? (
          // eslint-disable-next-line @next/next/no-img-element -- ブラウザ内の Blob なので next/image は使えない
          <img
            ref={img}
            key={m.id}
            src={original}
            alt={m.name}
            draggable={false}
            onLoad={animateIn}
            className="block max-h-full max-w-full rounded-[14px] object-contain shadow-[0_20px_60px_#0007]"
          />
        ) : (
          <div className="aspect-square h-1/2 overflow-hidden rounded-[14px] opacity-70">
            <ThumbImage id={m.id} alt={m.name} className="object-contain" />
          </div>
        )}
        {navBtn("r", i < 0 || i >= list.length - 1, () => go(1))}
      </div>

      <div ref={strip} data-name="フィルムストリップ" className="flex h-[72px] w-full shrink-0 items-center gap-2 overflow-hidden" onClick={(e) => e.target === e.currentTarget && close()}>
        <span className="w-[calc(50%-40px)] shrink-0" />
        {list.map((id) => (
          <button
            key={id}
            aria-current={id === m.id}
            aria-label={byId.get(id)?.name}
            onClick={() => setViewing(id, viewing.list)}
            className={`h-16 w-16 shrink-0 overflow-hidden rounded-[12px] border border-line bg-card transition hover:-translate-y-0.5 ${id === m.id ? "outline-[3px] -outline-offset-1 outline-accent" : ""}`}
          >
            <ThumbImage id={id} alt="" />
          </button>
        ))}
        <span className="w-[calc(50%-40px)] shrink-0" />
      </div>

      <div
        data-name="入っているライブラリー"
        className="-mx-5 flex w-[calc(100%+40px)] shrink-0 gap-2 overflow-x-auto border-t border-line px-5 pt-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))]"
        style={{ background: "color-mix(in srgb, var(--bg) 85%, transparent)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}
      >
        <button
          aria-label="ライブラリーに整理"
          title="ライブラリーに整理"
          onClick={() => setOrganizing([m.id])}
          className="grid h-[88px] w-[88px] shrink-0 place-items-center rounded-[16px] border-2 border-dashed border-line bg-tint text-ink"
        >
          <Icon name="add" size={28} />
        </button>
        {related.map((l) => {
          const covers = coverOf(media, l);
          return (
            <button
              key={l.id}
              aria-pressed={l.id === cur}
              title={`${l.name}：クリックで下の並びを切り替え／ダブルクリックでライブラリーへ移動`}
              onClick={() => {
                // ダブルクリックと区別するため、少し待ってから切り替える
                if (clickTimer.current) clearTimeout(clickTimer.current);
                clickTimer.current = setTimeout(() => setCtxLib(l.id), 250);
              }}
              onDoubleClick={() => {
                if (clickTimer.current) clearTimeout(clickTimer.current);
                close();
                router.push(`/r/${roomId}/media/lib/${l.id}`);
              }}
              className={`relative aspect-[3/2] h-[88px] shrink-0 overflow-hidden rounded-[16px] border border-line bg-card ${l.id === cur ? "outline-[3px] -outline-offset-1 outline-accent" : ""}`}
            >
              <span className="absolute inset-0 grid grid-cols-3 grid-rows-2 gap-px">
                {[0, 1, 2].map((k) => (
                  <span key={k} className={`block min-h-0 min-w-0 bg-line ${k === 0 ? "col-span-2 row-span-2" : ""}`}>
                    {covers[k] && <ThumbImage id={covers[k].id} alt="" />}
                  </span>
                ))}
              </span>
              <span className="absolute bottom-2 left-2 max-w-[calc(100%-16px)] truncate rounded-[10px] bg-black/25 px-2.5 py-px text-[11px] font-bold text-white backdrop-blur-md [text-shadow:0_1px_3px_#000,0_0_8px_#000a]">
                {l.name}
              </span>
            </button>
          );
        })}
        {!related.length && <span className="self-center text-sm text-muted">未整理</span>}
      </div>
    </div>
  );
}
