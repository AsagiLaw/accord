"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import type { Library, Media } from "@/lib/local/db";
import { aspectRatio, formatSize } from "@/lib/media/image";
import { chain, descendants } from "@/lib/media/logic";
import { useMediaState } from "./MediaContext";
import { ThumbImage } from "./Thumb";

/** 画像が入っているライブラリーを「親 › 子」の形で、一番深いものだけ並べる */
export function libraryPaths(m: Media, libs: Library[]): string[] {
  const inLibs = libs.filter((l) => m.libIds.includes(l.id));
  const leaves = inLibs.filter(
    (l) =>
      !inLibs.some((o) => o !== l && descendants(libs, l.id).includes(o.id)),
  );
  return leaves.map((l) =>
    chain(libs, l.id)
      .map((x) => x.name)
      .join(" › "),
  );
}

/** プレビューの中身（選んだ画像の大きな表示と詳細） */
function PreviewBody() {
  const { selected, byId, libs, members, setViewing } = useMediaState();
  const id = selected.at(-1);
  const m = id ? byId.get(id) : undefined;

  const rows: [string, React.ReactNode][] = m
    ? [
        ["ファイル名", m.fileName],
        ["形式", (m.mime.replace("image/", "") || "不明").toUpperCase()],
        ["画像サイズ", `${m.width} × ${m.height} px`],
        ["解像度", m.dpi ? `${m.dpi} dpi` : "不明"],
        ["画素数", `${((m.width * m.height) / 1e6).toFixed(2)} メガピクセル`],
        ["縦横比", aspectRatio(m.width, m.height)],
        ["ファイル容量", formatSize(m.size)],
        ["追加日時", new Date(m.createdAt).toLocaleString("ja-JP")],
        [
          "追加した人",
          members.find((x) => x.userId === m.uploadedBy)?.displayName ?? "—",
        ],
        [
          "ライブラリー",
          libraryPaths(m, libs).length ? (
            libraryPaths(m, libs).map((p) => <div key={p}>{p}</div>)
          ) : (
            <span className="text-muted">未整理</span>
          ),
        ],
      ]
    : [];

  return (
    <div className="p-4">
      <h4 className="mb-2 text-sm font-bold">
        プレビュー
        {selected.length > 1 && (
          <span className="ml-1 font-normal text-muted">
            （他{selected.length - 1}枚も選択中）
          </span>
        )}
      </h4>
      {!m ? (
        <p className="text-sm text-muted">画像を選ぶと、ここに詳細が出ます。</p>
      ) : (
        <>
          <button
            className="mb-3 block aspect-square w-full overflow-hidden rounded-[10px]"
            aria-label="大きく表示"
            onClick={() => setViewing(m.id)}
          >
            <ThumbImage id={m.id} alt={m.name} className="object-contain" />
          </button>
          <p className="mb-2 font-bold break-all">{m.name}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted">{k}</dt>
                <dd className="break-all">{v}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </div>
  );
}

const WIDTH_KEY = "irai-note:media-preview-width";
const MIN_W = 220;
const MAX_W = 640;

/** プレビュー欄の幅（つまみで変えたもの）。端末ごとに覚える */
export function usePreviewWidth() {
  const [width, setWidth] = useState(() => {
    try {
      const v = Number(localStorage.getItem(WIDTH_KEY));
      return v >= MIN_W && v <= MAX_W ? v : 288;
    } catch {
      return 288;
    }
  });
  const save = (w: number) => {
    setWidth(w);
    try {
      localStorage.setItem(WIDTH_KEY, String(w));
    } catch {
      // 覚えられなくても、このページの間は効く
    }
  };
  return [width, save] as const;
}

/**
 * メイン画面の右にぴったり付くプレビュー欄：上は上部バーの下、下はメイン画面の下、右はメイン画面の右の枠まで。
 * 一覧はこの幅だけ左に詰める（onReserve で、空けてほしい幅を知らせる）。
 * 左の端のつまみをドラッグすると幅が変わり、押すだけなら開け閉めする。閉じているときは、つまみだけ右の端に出る。
 * 画像を拡大している間も出しておく（拡大表示の後ろのぼかしに透けて見える）
 */
export function PreviewPanel({
  open,
  onToggle,
  width,
  onWidth,
  onReserve,
}: {
  open: boolean;
  onToggle: () => void;
  width: number;
  onWidth: (w: number) => void;
  onReserve: (px: number) => void;
}) {
  const [box, setBox] = useState<{
    top: number;
    bottom: number;
    right: number;
    pad: number;
  } | null>(null);
  const drag = useRef<{ x: number; moved: boolean } | null>(null);

  // メイン画面の中身（スクロールする所）の位置に合わせる。画面に出す前に測る（ページを切り替えたときに一覧の幅が揺れないように）
  useLayoutEffect(() => {
    const scroller = document.querySelector<HTMLElement>(
      '[data-name="メイン画面の中身"]',
    );
    if (!scroller) return;
    const place = () => {
      const r = scroller.getBoundingClientRect();
      setBox({
        top: r.top,
        bottom: window.innerHeight - r.bottom,
        // 右はメイン画面の右の枠まで（スクロールバー用に空けてある所も含めて、右端にぴったり付ける）
        right: window.innerWidth - r.right,
        // 欄の下に入る、中身の右の余白（スクロールバー用の場所を含む）
        pad:
          (parseFloat(getComputedStyle(scroller).paddingRight) || 0) +
          (r.width - scroller.clientWidth),
      });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(scroller);
    window.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
    };
  }, []);

  // サイドバーがしまわれる幅（md 未満：スマホなど）では、プレビュー欄もつまみも出さない
  const wide = useWide();
  const shown = open && wide;
  // 一覧の右に空ける幅：欄の幅から中身の右の余白を引き、少し間をあける（これも画面に出す前に知らせる）
  useLayoutEffect(() => {
    // まだ位置を測っていないうちは知らせない（前のページの幅のまま待つ）
    if (!box) return;
    onReserve(shown ? Math.max(0, width - box.pad + 16) : 0);
  }, [shown, box, width, onReserve]);

  if (!box || !wide) return null;

  const handle = (
    <button
      type="button"
      data-name="プレビューのつまみ"
      aria-label={
        open ? "プレビューをしまう（ドラッグで幅を変える）" : "プレビューを出す"
      }
      aria-expanded={open}
      title={open ? "押すとしまう・ドラッグで幅を変える" : "プレビューを出す"}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || !open) return;
        if (!d.moved && Math.abs(e.clientX - d.x) < 4) return;
        d.moved = true;
        const right = window.innerWidth - box.right;
        onWidth(
          Math.round(Math.min(MAX_W, Math.max(MIN_W, right - e.clientX))),
        );
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved) onToggle();
      }}
      className={`absolute top-1/2 grid h-16 w-5 -translate-y-1/2 touch-none place-items-center border border-line bg-card text-muted shadow-sm hover:text-ink ${
        open
          ? "-left-2.5 cursor-col-resize rounded-[10px]"
          : "right-0 rounded-l-[10px] border-r-0"
      }`}
    >
      <Icon name={open ? "r" : "l"} size={16} />
    </button>
  );

  return (
    <aside
      data-name="プレビュー欄"
      aria-label="プレビュー"
      className={`fixed z-20 ${open ? "border-l border-line bg-card" : "w-5"}`}
      style={{
        top: box.top,
        bottom: box.bottom,
        right: box.right,
        width: open ? width : undefined,
      }}
    >
      {open && <div className="h-full overflow-y-auto">{<PreviewBody />}</div>}
      {handle}
    </aside>
  );
}

/** サイドバーが出ている幅（md 以上、768px〜）か */
function useWide() {
  const [wide, setWide] = useState(
    () =>
      typeof window === "undefined" ||
      window.matchMedia("(min-width: 768px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}
