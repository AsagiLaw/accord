"use client";

import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { MenuItem, Popover, usePopover } from "@/components/ui/Popover";
import { Spinner } from "@/components/ui/Spinner";
import { startMediaDrag, useOriginalState } from "@/lib/media/export";
import {
  arrange,
  coverOf,
  libraryView,
} from "@/lib/media/logic";
import { useMediaPrefs } from "@/lib/media/prefs";
import { useIsTouchDevice, useIsTouchPhone } from "@/lib/touch-device";
import { copyMediaFlow } from "./flows";
import { useMediaState } from "./MediaContext";
import { useMediaRouter } from "./MediaLink";
import { ThumbImage } from "./Thumb";
import { TouchStage } from "./TouchStage";
import { isBackdropClick } from "@/components/ui/backdrop";

/** 拡大の上限（画面に収めた大きさの何倍まで） */
const MAX_ZOOM = 8;
/** 画面に収めた大きさ（拡大していない） */
const FIT = { zoom: 1, x: 0, y: 0 };
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

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
 * 画像はホイール（トラックパッドのピンチも）で拡大・縮小し、拡大中はドラッグで動かす。
 * 指で触る端末では画面全体に出し（TouchStage）、ライブラリーは左上の小さなボタンにまとめる。隣の画像の並びはタブレットだけ。画像を押すと、上下の部品を隠す。
 */
export function Lightbox() {
  const { viewing, setViewing, byId, media, libs, base, setOrganizing, setEditing, canEdit } =
    useMediaState();
  const prefs = useMediaPrefs();
  const pathname = usePathname();
  const router = useMediaRouter();
  const touch = useIsTouchDevice();
  const phone = useIsTouchPhone();
  const libPop = usePopover();
  /** 指で触る端末で、上下の部品を出しているか */
  const [chrome, setChrome] = useState(true);
  const [ctxLib, setCtxLib] = useState<string | null>(null);
  const [box, setBox] = useState<{
    left: number;
    top: number;
    right: number;
  } | null>(null);
  // 拡大表示している間に、サイドバーなどで別のページへ移ったら、拡大表示を閉じる
  const openedAt = useRef(pathname);
  useEffect(() => {
    if (openedAt.current === pathname) return;
    openedAt.current = pathname;
    if (viewing) setViewing(null);
  }, [pathname, viewing, setViewing]);
  const strip = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const swipe = useRef<number | null>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevId = useRef<string | null>(null);

  const m = viewing ? byId.get(viewing.id) : undefined;

  // ---- 拡大・縮小 ----
  // zoom：画面に収めた大きさの何倍か。x・y：画像の真ん中を、真ん中からどれだけずらしているか（px）。
  // 別の画像に切り替えたら、全体の表示に戻す
  const stage = useRef<HTMLDivElement>(null);
  const [viewState, setViewState] = useState({ ...FIT, id: "" });
  const view = viewState.id === m?.id ? viewState : { ...FIT, id: m?.id ?? "" };
  const zoomed = view.zoom > 1;
  /** 画面からはみ出す分だけ動かせる（少しだけ余白も見えるようにする） */
  const clampView = (zoom: number, x: number, y: number) => {
    const s = stage.current;
    const el = img.current;
    if (!s || !el || zoom <= 1.01) return { ...FIT, id: m?.id ?? "" };
    const w = el.offsetWidth * zoom;
    const h = el.offsetHeight * zoom;
    const mx = w > s.clientWidth ? (w - s.clientWidth) / 2 + 40 : 0;
    const my = h > s.clientHeight ? (h - s.clientHeight) / 2 + 40 : 0;
    return { zoom, x: clamp(x, -mx, mx), y: clamp(y, -my, my), id: m?.id ?? "" };
  };
  /** (cx, cy)：画面の真ん中からの位置。そこにある所が動かないように拡大・縮小する */
  const zoomAt = (factor: number, cx: number, cy: number) =>
    setViewState((st) => {
      const v = st.id === m?.id ? st : FIT;
      const z = clamp(v.zoom * factor, 1, MAX_ZOOM);
      const r = z / v.zoom;
      return clampView(z, cx - (cx - v.x) * r, cy - (cy - v.y) * r);
    });
  const fitView = () => setViewState({ ...FIT, id: m?.id ?? "" });
  /** ドラッグで画像を動かしている所 */
  const pan = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const [panning, setPanning] = useState(false);
  // 名前付きの URL で表示する（ドラッグして他のアプリに渡したとき、その名前のファイルになる）
  const { url: original, loading: loadingOriginal } = useOriginalState(m);

  // 入っているライブラリー
  const related = m ? libs.filter((l) => m.libIds.includes(l.id)) : [];
  // 開いているライブラリー（ルームは /media/lib/…、DM のボックスは /media/ボックス/lib/…）
  const currentPageLib = pathname.match(/\/media\/(?:[^/]+\/)?lib\/([^/]+)/)?.[1] ?? null;
  // 下の並び：カードで選んだライブラリー → 開いているライブラリー → 開いた一覧（すべて・お気に入りなど）の順。
  // 画像が入っているライブラリーの並びにするのは、カードを押したときだけ
  const cur = ctxLib ?? currentPageLib ?? null;

  const list = !viewing
    ? []
    : cur &&
        !(cur === currentPageLib && !ctxLib) &&
        libs.some((l) => l.id === cur)
      ? // ライブラリーの並びは、一覧と同じ（直接入っている画像だけ）
        arrange(libraryView(media, cur), prefs).map((x) => x.id)
      : viewing.list.filter((id) => byId.has(id));
  const stripId = m?.id;
  const i = stripId ? list.indexOf(stripId) : -1;
  const go = (step: number) => {
    const next = list[i + step];
    if (next) setViewing(next, viewing!.list);
  };
  // 下の並びで前後にある画像。今の画像が並びに無ければ、前後は無い
  const prevInList = i > 0 ? list[i - 1] : undefined;
  const nextInList = i >= 0 ? list[i + 1] : undefined;

  // メイン画面のうち、上の細いバー（場所と操作）より下を覆う（右のプレビュー欄も、この後ろのぼかしに透けて見える）
  useLayoutEffect(() => {
    const place = () => {
      const main = document
        .querySelector('main[data-name="メイン画面"]')
        ?.getBoundingClientRect();
      const bar = document
        .querySelector('header[data-name="上部バー"]')
        ?.getBoundingClientRect();
      if (!main) return setBox({ left: 0, top: 0, right: 0 });
      setBox({
        left: main.left,
        top: bar ? Math.max(main.top, bar.bottom) : main.top,
        right: window.innerWidth - main.right,
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, []);

  useEffect(() => {
    if (!m) return;
    const onKey = (e: KeyboardEvent) => {
      if (
        document.querySelector(
          '[role="dialog"][aria-modal="true"]:not([data-lightbox])',
        ) ||
        /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName)
      )
        return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
      if (e.key === "Escape") setViewing(null);
      // Ctrl+C：表示している画像をコピー（Discord などに Ctrl+V で貼れる）
      if ((e.ctrlKey || e.metaKey) && e.key === "c" && !window.getSelection()?.toString()) {
        e.preventDefault();
        void copyMediaFlow(m.boxId, [m]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // スクロールで拡大・縮小（トラックパッドのピンチも）。後ろの一覧がスクロールしないよう、自分で受け取る
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // 元の画像を取ってくる間（小さい画像を出している間）は拡大しない
      if (!img.current) return;
      const dy =
        e.deltaMode === 1
          ? e.deltaY * 16
          : e.deltaMode === 2
            ? e.deltaY * el.clientHeight
            : e.deltaY;
      const r = el.getBoundingClientRect();
      zoomAt(
        Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)),
        e.clientX - r.left - r.width / 2,
        e.clientY - r.top - r.height / 2,
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  // 今の画像がフィルムストリップの真ん中に来るように。
  // 並びが変わったとき（子ライブラリー⇔親など）は、画面に出す前に一気に合わせる（横に流れてから戻る動きを出さない）。
  // 同じ並びの中で画像を切り替えたときだけ、なめらかに動かす。
  // 開いた最初は、位置を測るまで（box が決まるまで）何も出していないので、出したときにもう一度合わせる
  const prevCur = useRef<string | null | undefined>(undefined);
  const placed = !!box;
  useLayoutEffect(() => {
    const s = strip.current;
    const it = s?.querySelector<HTMLElement>('[aria-current="true"]');
    const listChanged = prevCur.current !== cur;
    prevCur.current = cur;
    if (!s || !it) return;
    const left =
      s.scrollLeft +
      (it.getBoundingClientRect().left - s.getBoundingClientRect().left) -
      (s.clientWidth - it.offsetWidth) / 2;
    s.scrollTo({
      left,
      behavior: listChanged || !prevId.current ? "auto" : "smooth",
    });
  }, [m?.id, cur, placed]);

  // 開いたとき：サムネイルの位置から拡大して出てくる。切り替えたとき：ふわっと出る
  const animateIn = (el: HTMLImageElement | null = img.current) => {
    if (!el || !el.animate) return;
    const r = el.getBoundingClientRect();
    if (!prevId.current && opened.from && r.width) {
      const f = opened.from;
      el.animate(
        [
          {
            transform: `translate(${f.left + f.width / 2 - r.left - r.width / 2}px, ${f.top + f.height / 2 - r.top - r.height / 2}px) scale(${f.width / r.width})`,
          },
          { transform: "none" },
        ],
        { duration: 480, easing: "cubic-bezier(.3,1.25,.5,1)" },
      );
    } else if (!touch && prevId.current && prevId.current !== m?.id) {
      // 指で触る端末では、なぞった動きのまま切り替わるので、ふわっと出さない
      el.animate(
        [
          { opacity: 0, transform: "scale(.97)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 280, easing: "cubic-bezier(.2,.8,.2,1)" },
      );
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
      // 拡大した画像より手前に出す
      className={`absolute top-1/2 z-10 ${side === "l" ? "left-0" : "right-0"} grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-line text-ink backdrop-blur-md disabled:opacity-30`}
      style={{ background: "color-mix(in srgb, var(--bg) 70%, transparent)" }}
    >
      <Icon name={side} size={22} />
    </button>
  );
  const stripItems = (
    <>
      <span className="w-[calc(50%-40px)] shrink-0" />
      {list.map((id) => (
        <button
          key={id}
          aria-current={id === stripId}
          aria-label={byId.get(id)?.name}
          onClick={() => setViewing(id, viewing.list)}
          className={`h-16 w-16 shrink-0 overflow-hidden rounded-[12px] border border-line bg-card transition hover:-translate-y-0.5 ${id === stripId ? "outline-[3px] -outline-offset-1 outline-accent" : ""}`}
        >
          <ThumbImage id={id} alt="" />
        </button>
      ))}
      <span className="w-[calc(50%-40px)] shrink-0" />
    </>
  );

  if (touch) {
    const shownLib = related.find((l) => l.id === cur) ?? related[0];
    const miniCover = (id: string | undefined) => (
      <span className="block h-7 w-7 shrink-0 overflow-hidden rounded-[7px] bg-white/15 [&_[role=status]]:hidden">{id && <ThumbImage id={id} alt="" />}</span>
    );
    const onDark = "bg-black/45 backdrop-blur-md";
    return (
      <div
        role="dialog"
        aria-modal="true"
        data-lightbox
        aria-label={m.name}
        data-name="画像の大きな表示"
        className="fixed inset-0 z-[35] animate-[fade_.3s] bg-black text-white"
      >
        <TouchStage
          id={m.id}
          alt={m.name}
          url={original}
          loading={loadingOriginal}
          prevId={prevInList}
          nextId={nextInList}
          onGo={go}
          onImageTap={() => setChrome((c) => !c)}
          onBackdropTap={close}
          onImageLoad={animateIn}
        />
        <div
          data-name="画像の上の部品"
          // 押せるのはボタンだけにして、間をなぞっても画像が動くようにする。隠している間はボタンも押せない
          className={`pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 pt-[calc(env(safe-area-inset-top,0px)+8px)] pr-[max(12px,env(safe-area-inset-right,0px))] pb-2 pl-[max(12px,env(safe-area-inset-left,0px))] transition-opacity duration-200 ${chrome ? "[&_button]:pointer-events-auto" : "opacity-0"}`}
        >
          <button
            type="button"
            data-name="入っているライブラリー"
            aria-label="入っているライブラリー"
            aria-expanded={!!libPop.anchor}
            onClick={libPop.toggle}
            className={`flex h-10 max-w-[55vw] min-w-0 items-center gap-1.5 rounded-full py-1 pr-2.5 pl-1.5 text-sm font-bold ${onDark}`}
          >
            {miniCover(shownLib ? coverOf(media, libs, shownLib)[0]?.id : undefined)}
            <span className="min-w-0 truncate">{shownLib?.name ?? "未整理"}</span>
            {related.length > 1 && <span className="shrink-0 text-xs font-normal text-white/70">+{related.length - 1}</span>}
          </button>
          {list.length > 1 && i >= 0 && (
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs tabular-nums ${onDark}`}>
              {i + 1} / {list.length}
            </span>
          )}
          <span className="flex-1" />
          {!m.trashed && canEdit && !phone && (
            <button type="button" onClick={() => setEditing(m.id)} className={`flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm ${onDark}`}>
              <Icon name="tune" size={16} />
              編集
            </button>
          )}
          <button type="button" aria-label="閉じる" onClick={close} className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${onDark}`}>
            <Icon name="x" />
          </button>
        </div>
        {!phone && (
          <div
            ref={strip}
            data-name="フィルムストリップ"
            className={`absolute inset-x-0 bottom-0 flex items-center gap-2 overflow-x-auto pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+8px)] transition-opacity duration-200 [scrollbar-width:none] ${chrome ? "" : "pointer-events-none opacity-0"}`}
          >
            {stripItems}
          </div>
        )}
        {libPop.anchor && (
          <Popover anchor={libPop.anchor} onClose={libPop.close} width={280} label="入っているライブラリー">
            {related.map((l) => (
              <div key={l.id} className={`flex items-center gap-1 rounded-[8px] ${l.id === cur ? "bg-tint" : ""}`}>
                {/* 押すと、左右に移る画像の並びをこのライブラリーにする。「›」でライブラリーへ移動 */}
                <button
                  type="button"
                  aria-pressed={l.id === cur}
                  onClick={() => {
                    setCtxLib(l.id);
                    libPop.close();
                  }}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-2 text-left"
                >
                  {miniCover(coverOf(media, libs, l)[0]?.id)}
                  <span className="min-w-0 truncate">{l.name}</span>
                </button>
                <button
                  type="button"
                  aria-label={`${l.name}を開く`}
                  onClick={() => {
                    libPop.close();
                    close();
                    router.push(`${base}/lib/${l.id}`);
                  }}
                  className="grid h-11 w-11 shrink-0 place-items-center text-muted"
                >
                  <Icon name="r" size={18} />
                </button>
              </div>
            ))}
            {canEdit && (
              <MenuItem
                icon={<Icon name="add" size={16} />}
                onClick={() => {
                  libPop.close();
                  setOrganizing([m.id]);
                }}
              >
                ライブラリーに整理
              </MenuItem>
            )}
            {!related.length && !canEdit && <p className="px-2 py-1 text-muted">未整理</p>}
          </Popover>
        )}
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-lightbox
      aria-label={m.name}
      data-name="画像の大きな表示"
      onClick={(e) => isBackdropClick(e) && close()}
      className="fixed bottom-0 z-[22] flex animate-[fade_.3s] flex-col items-center gap-3.5 overflow-hidden px-5 pt-14"
      style={{
        left: box.left,
        right: box.right,
        top: box.top,
        background: "color-mix(in srgb, var(--bg) 55%, transparent)",
        backdropFilter: "blur(11px)",
        WebkitBackdropFilter: "blur(11px)",
      }}
    >
      <div className="absolute top-3 right-4 flex gap-2">
        {zoomed && (
          <button
            onClick={fitView}
            title="画面に合わせる"
            className="btn-sub px-4 tabular-nums backdrop-blur-md"
            style={{ background: "color-mix(in srgb, var(--bg) 70%, transparent)" }}
          >
            {Math.round(view.zoom * 100)}%
          </button>
        )}
        {!m.trashed && canEdit && (
          <button
            onClick={() => setEditing(m.id)}
            title="画像を編集（調整・フィルタ・切り取り）"
            className="btn-sub px-4 backdrop-blur-md"
            style={{ background: "color-mix(in srgb, var(--bg) 70%, transparent)" }}
          >
            <Icon name="tune" size={16} />
            編集
          </button>
        )}
        <button
          aria-label="閉じる"
          onClick={close}
          className="btn-sub w-10 px-0 backdrop-blur-md"
          style={{ background: "color-mix(in srgb, var(--bg) 70%, transparent)" }}
        >
          <Icon name="x" />
        </button>
      </div>

      <div
        ref={stage}
        // 拡大したら、はみ出した所を下のフィルムストリップなどに重ねない
        className={`relative flex min-h-0 w-full flex-1 touch-pan-y items-center justify-center px-14 ${zoomed ? "overflow-hidden" : ""}`}
        onClick={(e) => isBackdropClick(e) && !zoomed && close()}
        // 拡大中のドラッグは画像を動かす（前後の画像へのスワイプにしない）
        onPointerDown={(e) => (swipe.current = zoomed ? null : e.clientX)}
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
            // 他のアプリ（デスクトップ・Photoshop など）へドラッグすると、元の画像のファイルとして渡す。
            // 拡大中は、ドラッグで画像を動かす
            draggable={!zoomed}
            onDragStart={(e) => {
              swipe.current = null;
              startMediaDrag(e, m);
            }}
            onPointerDown={(e) => {
              if (!zoomed) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              pan.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
              setPanning(true);
            }}
            onPointerMove={(e) => {
              const p = pan.current;
              if (!p) return;
              setViewState(clampView(view.zoom, p.ox + e.clientX - p.sx, p.oy + e.clientY - p.sy));
            }}
            onPointerUp={() => {
              pan.current = null;
              setPanning(false);
            }}
            onPointerCancel={() => {
              pan.current = null;
              setPanning(false);
            }}
            onLoad={() => animateIn()}
            className={`block max-h-full max-w-full rounded-[14px] object-contain shadow-[0_20px_60px_#0007] ${zoomed ? `touch-none select-none ${panning ? "cursor-grabbing" : "cursor-grab"}` : ""}`}
            style={{
              transform: zoomed ? `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` : undefined,
              transition: panning ? "none" : "transform 120ms ease-out",
            }}
          />
        ) : (
          // 元の画像を取ってくる間は、小さい画像を薄く出し、その上にくるくるを出す（小さい画像の側のくるくるは重ねない）
          <div className="relative aspect-square h-1/2">
            <div className="h-full w-full overflow-hidden rounded-[14px] opacity-70 [&_[role=status]]:hidden">
              <ThumbImage id={m.id} alt={m.name} className="object-contain" />
            </div>
            {loadingOriginal && <Spinner onImage />}
          </div>
        )}
        {navBtn("r", i < 0 || i >= list.length - 1, () => go(1))}
      </div>

      <div
        ref={strip}
        data-name="フィルムストリップ"
        // 拡大画像の影（下に広がる）より手前に出す。影がサムネイルにかかって暗くならないように
        className="relative z-10 flex h-[72px] w-full shrink-0 items-center gap-2 overflow-hidden"
        onClick={(e) => isBackdropClick(e) && close()}
      >
        {stripItems}
      </div>

      <div
        data-name="入っているライブラリー"
        className="-mx-5 flex max-h-[34dvh] w-[calc(100%+40px)] shrink-0 flex-wrap gap-2 overflow-y-auto border-t border-line px-5 pt-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))]"
        style={{
          background: "color-mix(in srgb, var(--bg) 85%, transparent)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
        }}
      >
        {canEdit && (
          <button
            aria-label="ライブラリーに整理"
            title="ライブラリーに整理"
            onClick={() => setOrganizing([m.id])}
            className="grid h-[88px] w-[88px] shrink-0 place-items-center rounded-[16px] border-2 border-dashed border-line bg-tint text-ink"
          >
            <Icon name="add" size={28} />
          </button>
        )}
        {related.map((l) => {
          const covers = coverOf(media, libs, l);
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
                router.push(`${base}/lib/${l.id}`);
              }}
              className={`relative aspect-[3/2] h-[88px] shrink-0 overflow-hidden rounded-[16px] border border-line bg-card ${l.id === cur ? "outline-[3px] -outline-offset-1 outline-accent" : ""}`}
            >
              <span className="absolute inset-0 grid grid-cols-3 grid-rows-2 gap-px">
                {[0, 1, 2].map((k) => (
                  <span
                    key={k}
                    className={`block min-h-0 min-w-0 bg-line ${k === 0 ? "col-span-2 row-span-2" : ""}`}
                  >
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
        {!related.length && (
          <span className="self-center text-sm text-muted">未整理</span>
        )}
      </div>
    </div>
  );
}
