"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { db, type Library, type Media } from "@/lib/local/db";
import { renameMedia, setMadeAt } from "@/lib/local/media";
import { splitDate } from "@/lib/media/autoname";
import { aspectRatio, formatSize, readImageMeta, type ImageMeta } from "@/lib/media/image";
import { chain, descendants, PREVIEW_FIELDS, shownName, typeName, type PreviewField } from "@/lib/media/logic";
import { useMediaPrefs } from "@/lib/media/prefs";
import { useMediaState } from "./MediaContext";
import { DragOriginal, ThumbImage } from "./Thumb";

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

// 元の画像から読んだ解像度とカラープロファイル（一度読んだら使い回す。編集して中身が変わったら読み直す）
const metaCache = new Map<string, ImageMeta>();

/** 元の画像の解像度とカラープロファイル。読み終わるまでは undefined */
function useImageMeta(id: string | undefined, rev = 0): ImageMeta | undefined {
  const [loaded, setLoaded] = useState<{ key: string; meta: ImageMeta } | null>(null);
  const key = id ? `${id}:${rev}` : "";
  useEffect(() => {
    if (!id || metaCache.has(key)) return;
    let alive = true;
    db.mediaBlobs
      .get(id)
      // 一式が無ければ、表示用に元の画像だけを取ってきたもの（PSD は表示用の PNG しか無いので読まない）
      .then(async (row) => row?.original ?? (await db.blobCache.get(`${id}:${rev}:original`))?.blob)
      .then((file) => (file ? readImageMeta(file) : null))
      .then((meta) => {
        if (!meta) return;
        metaCache.set(key, meta);
        if (alive) setLoaded({ key, meta });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, rev, key]);
  if (!id) return undefined;
  return metaCache.get(key) ?? (loaded?.key === key ? loaded.meta : undefined);
}

/**
 * 詳細の中で、その場で書き換える欄。ふだんは文字のように見せ、カーソルを乗せると枠が出る。
 * 文字の位置をほかの行とそろえるため左にだけ少しはみ出す（右にはみ出すと、詳細の欄に横のスクロールができてしまう）
 */
const INLINE_INPUT =
  "-ml-1 w-[calc(100%+0.25rem)] min-w-0 rounded-[6px] border border-transparent bg-transparent px-1 outline-none hover:border-line focus:border-accent";

/** Enter で決める（日本語の変換を決める Enter は除く）・Esc でやめる */
const commitKeys = (cancel: () => void) => (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.nativeEvent.isComposing) return;
  if (e.key === "Enter") e.currentTarget.blur();
  if (e.key === "Escape") {
    e.stopPropagation();
    cancel();
    requestAnimationFrame(() => (document.activeElement as HTMLElement | null)?.blur());
  }
};

/** タイトルの欄（自動で名前を付けた画像だけ）。変えると名前も「20250101_タイトル」（同じものが2枚以上なら _01 から番号付き）の形で付け直す。空にしたら元のまま */
function TitleInput({ m }: { m: Media }) {
  const [draft, setDraft] = useState(m.title ?? "");
  const save = () => {
    const v = draft.trim();
    if (!v) setDraft(m.title ?? "");
    else if (v !== m.title) void renameMedia(m.id, v);
  };
  return (
    <input
      value={draft}
      aria-label="タイトル"
      placeholder="タイトルなし"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={commitKeys(() => setDraft(m.title ?? ""))}
      className={INLINE_INPUT}
    />
  );
}

/** 制作日の欄に出す日付「2025/01/01」（端末の時刻で） */
const dateText = (t: number | undefined) => (t === undefined ? "" : new Date(t).toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" }));

/**
 * 制作日の欄。打って直す（2025/01/01・20250101・2025年1月1日 など）か、横のカレンダーから選ぶ。
 * 時刻はそのままで日付だけ変える。自動の名前の画像は、名前の日付も変わる
 */
function MadeInput({ m }: { m: Media }) {
  const [draft, setDraft] = useState(dateText(m.madeAt));
  const picker = useRef<HTMLInputElement>(null);
  const commit = (y: number, mo: number, d: number) => {
    const t = new Date(m.madeAt ?? new Date(y, mo - 1, d).getTime());
    t.setFullYear(y, mo - 1, d);
    if (t.getTime() !== m.madeAt) void setMadeAt(m.id, t.getTime());
  };
  const save = () => {
    const { date } = splitDate(draft.trim());
    if (!date) return setDraft(dateText(m.madeAt));
    commit(date.y, date.m, date.d);
  };
  return (
    <span className="flex items-center gap-1">
      <input
        value={draft}
        aria-label="制作日"
        placeholder="記録なし"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={commitKeys(() => setDraft(dateText(m.madeAt)))}
        className={`${INLINE_INPUT} flex-1`}
      />
      {/* カレンダーは、見えない日付の欄の選ぶ画面を借りて出す */}
      {/* 見えない日付の欄の中身（日付の文字）が、ボタンの外へはみ出さないように切る */}
      <span className="relative shrink-0 overflow-hidden">
        <button
          type="button"
          title="カレンダーから選ぶ"
          aria-label="カレンダーから選ぶ"
          onClick={() => picker.current?.showPicker()}
          className="grid h-5 w-5 place-items-center rounded-[6px] text-muted hover:bg-tint hover:text-ink"
        >
          <Icon name="calendar" size={14} />
        </button>
        <input
          ref={picker}
          type="date"
          tabIndex={-1}
          aria-hidden
          value={m.madeAt === undefined ? "" : new Date(m.madeAt).toLocaleDateString("sv-SE")}
          onChange={(e) => {
            const g = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.target.value);
            if (g) commit(+g[1], +g[2], +g[3]);
          }}
          className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
        />
      </span>
    </span>
  );
}

/** プレビューの中身（選んだ画像の大きな表示と詳細） */
function PreviewBody() {
  const { selected, byId, libs, members, setViewing, canEdit } = useMediaState();
  const { showExt, previewRatio, previewFields } = useMediaPrefs();
  const id = selected.at(-1);
  const m = id ? byId.get(id) : undefined;
  const meta = useImageMeta(m?.id, m?.rev);
  // 解像度は、追加したときに読めなかった画像（Photoshop の JPEG など）も、元の画像から読み直す
  const dpi = meta?.dpi || m?.dpi;

  // 詳細の項目ごとの中身。出す項目と順番はメディアの設定で決める。null の項目は出さない
  const value = (f: PreviewField, m: Media): React.ReactNode => {
    switch (f) {
      // タイトルと制作日は、その場で書き換えられる（中身が変わったら欄を作り直す）
      case "title":
        if (m.title === undefined) return null;
        return canEdit ? <TitleInput key={`${m.id}:${m.title}`} m={m} /> : m.title || <span className="text-muted">なし</span>;
      case "made":
        if (canEdit) return <MadeInput key={`${m.id}:${m.madeAt}`} m={m} />;
        return m.madeAt ? new Date(m.madeAt).toLocaleDateString("ja-JP") : <span className="text-muted">記録なし</span>;
      case "fileName":
        return m.fileName;
      case "type":
        return typeName(m);
      case "dims":
        return `${m.width} × ${m.height} px`;
      case "dpi":
        return dpi ? `${dpi} dpi` : meta ? <span className="text-muted">記録なし</span> : "…";
      case "mm":
        // 実際の大きさ：ピクセル数 ÷ dpi × 25.4（解像度が分からなければ出せない）
        return dpi ? (
          `${((m.width / dpi) * 25.4).toFixed(1)} × ${((m.height / dpi) * 25.4).toFixed(1)} mm`
        ) : meta ? (
          <span className="text-muted">解像度の記録がないため不明</span>
        ) : (
          "…"
        );
      case "profile":
        return !meta ? "…" : meta.profile ?? <span className="text-muted">埋め込みなし</span>;
      case "pixels":
        return `${((m.width * m.height) / 1e6).toFixed(2)} メガピクセル`;
      case "ratio":
        return aspectRatio(m.width, m.height);
      case "size":
        return formatSize(m.size);
      case "date":
        return new Date(m.createdAt).toLocaleString("ja-JP");
      case "uploader":
        return members.find((x) => x.userId === m.uploadedBy)?.displayName ?? "—";
      case "libs":
        return libraryPaths(m, libs).length ? (
          libraryPaths(m, libs).map((p) => <div key={p}>{p}</div>)
        ) : (
          <span className="text-muted">未整理</span>
        );
    }
  };
  const rows: [string, React.ReactNode][] = m
    ? previewFields.flatMap((f) => {
        const name = PREVIEW_FIELDS.find((x) => x.id === f)?.name;
        const v = value(f, m);
        return name && v !== null ? [[name, v] as [string, React.ReactNode]] : [];
      })
    : [];

  // 枠の縦横比：メディアの設定で「1:1」なら正方形。「オリジナル」なら元の画像と同じ（分からなければ正方形）
  const square = previewRatio === "square";
  const ratio = !square && m && m.width && m.height ? m.width / m.height : 1;

  // 欄の上半分に画像、下半分に詳細（詳細が多いときは下半分の中でスクロール）
  return (
    <div className="flex h-full flex-col">
      <div data-name="プレビューの画像" className="flex min-h-0 flex-1 basis-0 flex-col p-4 pb-2">
        <h4 className="mb-2 shrink-0 text-sm font-bold">
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
          // 空いている所に、枠の縦横比のまま、入るだけ大きく出す（幅と高さの両方に収める）
          <div className="grid min-h-0 flex-1 place-items-center [container-type:size]">
            <button
              className="relative block overflow-hidden rounded-[10px]"
              style={{
                aspectRatio: `${ratio}`,
                width: `min(100cqw, ${ratio} * 100cqh)`,
              }}
              aria-label="大きく表示"
              onClick={() => setViewing(m.id)}
            >
              <ThumbImage id={m.id} alt={m.name} className={square ? "object-contain" : ""} />
              <DragOriginal m={m} multiSelected={selected.length > 1} />
            </button>
          </div>
        )}
      </div>
      {m && (
        // 横にはスクロールさせない（名前の文字を選んでドラッグしたときに、横や縦のスクロールバーが出ないように）
        <div data-name="プレビューの詳細" className="min-h-0 flex-1 basis-0 overflow-x-hidden overflow-y-auto border-t border-line p-4 pt-3">
          <p className="mb-2 font-bold break-all">{shownName(m, showExt)}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted">{k}</dt>
                <dd className="break-all">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
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
      {open && <div className="h-full">{<PreviewBody />}</div>}
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
