"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { toast } from "@/components/ui/overlay";
import { newId } from "@/lib/id";
import { db } from "@/lib/local/db";
import { decodeImage } from "@/lib/media/image";
import {
  ADJUST_TOOLS,
  FILTERS,
  FULL,
  LINE_HEIGHT,
  autoAdjust,
  contrastOf,
  cropForAspect,
  defaultEdit,
  flipEdit,
  groupBounds,
  hitMark,
  isGeoDefault,
  markBounds,
  markFont,
  moveMark,
  orientedSize,
  renderEdit,
  rotateEditLeft,
  scaleMark,
  strokePath,
  type AdjustKey,
  type ImageEdit,
  type Mark,
  type Rect,
  type StrokeMark,
  type TextMark,
  type TextStyle,
} from "@/lib/media/edit";
import { revertEditNow, saveCopyFlow, saveEditFlow } from "./flows";
import { useMediaState } from "./MediaContext";

// 画像の編集画面（iPhone の「写真」の編集と同じ作り）。
// 下で「調整」「フィルタ」「切り取り」「マークアップ」（ペン・文字入れ）を切り替える。
// 左上は「キャンセル」（×）、真ん中は取り消し・やり直し、右上は「完了」（✓）。
// 編集してある画像を開いて、まだ何も変えていない間は、右上が「元に戻す」（オリジナルに戻す）になる（iPhone と同じ）。
// 調整・フィルタでは、画像を押し続けている間（0.3秒たってから）、何も編集していないオリジナルの画像を見せる。
// 編集してある画像は「元に戻す」でオリジナルに戻せる。
// スクロールで拡大・縮小し、中ボタンかスペース＋ドラッグ（調整・フィルタではそのままドラッグ）で動かす

type Mode = "adjust" | "filter" | "crop" | "markup";

/** マークアップの道具と、次に描く線・文字の色や太さ */
type MarkTool = "grab" | "pen" | "marker" | "eraser" | "text";
type Ink = {
  tool: MarkTool;
  color: string;
  /** PEN_WIDTHS の番号 */
  width: number;
  /** TEXT_SIZES の番号 */
  textSize: number;
  textStyle: TextStyle;
};

const COLORS = [
  "#000000",
  "#ffffff",
  "#ff3b30",
  "#ff9500",
  "#ffcc00",
  "#34c759",
  "#007aff",
  "#af52de",
];
/** 線の太さ（枠の長い辺に対する割合）。マーカーはこの3倍 */
const PEN_WIDTHS = [0.003, 0.007, 0.014];
/** 文字の大きさ（枠の長い辺に対する割合） */
const TEXT_SIZES = [0.035, 0.055, 0.085];

/** 編集中に見せる画像の大きさ（長い辺）。保存するときは元の大きさで作り直す */
const PREVIEW_MAX = 1600;
/** 拡大できる大きさ（画面に収めた大きさの何倍まで） */
const MAX_ZOOM = 8;
const YELLOW = "#ffd60a";
const RED = "#ff453a";

const ASPECTS: { label: string; ratio: number | "original" | null }[] = [
  { label: "自由形式", ratio: null },
  { label: "オリジナル", ratio: "original" },
  { label: "正方形", ratio: 1 },
  { label: "16:9", ratio: 16 / 9 },
  { label: "5:4", ratio: 5 / 4 },
  { label: "7:5", ratio: 7 / 5 },
  { label: "4:3", ratio: 4 / 3 },
  { label: "5:3", ratio: 5 / 3 },
  { label: "3:2", ratio: 3 / 2 },
];

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const same = (a: number, b: number) => Math.abs(a - b) < 1e-3;

/**
 * 押したポインターを要素につかまえておく（ドラッグで画面の外へ出ても追いかける）。
 * ポインターがもう無い（離された後など）ときは、つかまえずにそのまま続ける
 */
const capture = (e: React.PointerEvent<Element>) => {
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {
    // つかまえられなくても、ドラッグの処理はそのまま続ける
  }
};

/** 小さくした画像（編集中の表示・フィルタの見本用） */
function downscale(
  src: CanvasImageSource & { width: number; height: number },
  max: number,
) {
  const s = Math.min(1, max / Math.max(src.width, src.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(src.width * s));
  c.height = Math.max(1, Math.round(src.height * s));
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export function ImageEditor({ id }: { id: string }) {
  const { byId, setEditing, me } = useMediaState();
  const m = byId.get(id);
  const [preview, setPreview] = useState<HTMLCanvasElement | null>(null);
  const [start, setStart] = useState<ImageEdit | null>(null);
  const [mode, setMode] = useState<Mode>("adjust");
  const [tool, setTool] = useState<AdjustKey | "auto">("exposure");
  const [showOriginal, setShowOriginal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ink, setInk] = useState<Ink>({
    tool: "pen",
    color: COLORS[0],
    width: 1,
    textSize: 1,
    textStyle: "plain",
  });
  /** 書き換えている文字（マークアップ） */
  const [editingText, setEditingText] = useState<string | null>(null);
  /** 「つかむ」で選んでいる線や文字（Shift+クリックや囲んで、いくつも選べる） */
  const [selectedMarks, setSelectedMarks] = useState<string[]>([]);
  /** 元の大きさの画像（拡大したときに細かく描き直す） */
  const [detailSrc, setDetailSrc] = useState<ImageBitmap | null>(null);
  /** スペースを押している間は、ドラッグで画像を動かす */
  const [spaceDown, setSpaceDown] = useState(false);

  // ---- 取り消し・やり直し ----
  // base：ダイヤルや切り取りの枠をドラッグし始めたときの状態（離したときに、1回の操作としてまとめる）
  const [hist, setHist] = useState<{
    past: ImageEdit[];
    now: ImageEdit;
    future: ImageEdit[];
    base?: ImageEdit;
  } | null>(null);
  const edit = hist?.now ?? null;
  // 変えた後の状態か、今の状態から作る関数を渡す（続けて呼んでも、前の変更を取りこぼさない）
  const next = (n: EditChange, now: ImageEdit) =>
    typeof n === "function" ? n(now) : n;
  /** 履歴に残さずに変える（ドラッグの途中） */
  const set = (n: EditChange) =>
    setHist((h) => h && { ...h, now: next(n, h.now) });
  /** 1回の操作として変える（取り消せる） */
  const apply = (n: EditChange) =>
    setHist(
      (h) => h && { past: [...h.past, h.now], now: next(n, h.now), future: [] },
    );
  const begin = () => setHist((h) => h && { ...h, base: h.now });
  const end = () =>
    setHist((h) => {
      if (!h?.base) return h;
      // 始める前と同じ（文字を足して空のまま消したなど）なら、履歴に残さない
      if (h.base === h.now || JSON.stringify(h.base) === JSON.stringify(h.now))
        return { ...h, base: undefined };
      return { past: [...h.past, h.base], now: h.now, future: [] };
    });
  // 文字の入力の途中なら、そこまでを1回の操作として確定してから取り消す
  const undo = () => {
    finishText();
    undoStep();
  };
  const redo = () => {
    finishText();
    redoStep();
  };
  const undoStep = () =>
    setHist((h) =>
      h && h.past.length
        ? {
            past: h.past.slice(0, -1),
            now: h.past.at(-1)!,
            future: [h.now, ...h.future],
          }
        : h,
    );
  const redoStep = () =>
    setHist((h) =>
      h && h.future.length
        ? {
            past: [...h.past, h.now],
            now: h.future[0],
            future: h.future.slice(1),
          }
        : h,
    );

  // ---- 文字入れ：書き始めてから書き終わるまでを、1回の操作として取り消せるようにまとめる ----
  const withoutMark = (e: ImageEdit, id: string) => ({
    ...e,
    marks: (e.marks ?? []).filter((x) => x.id !== id),
  });
  const startText = (id: string, created?: TextMark) => {
    begin();
    if (created) set((e) => ({ ...e, marks: [...(e.marks ?? []), created] }));
    setEditingText(id);
  };
  /** 書き終える。何も書いていなければ、その文字は消す */
  const finishText = () => {
    if (!editingText) return;
    const id = editingText;
    set((e) => {
      const t = e.marks?.find((x) => x.id === id);
      return t?.kind === "text" && !t.text.trim() ? withoutMark(e, id) : e;
    });
    end();
    setEditingText(null);
  };
  const deleteText = () => {
    if (!editingText) return;
    const id = editingText;
    set((e) => withoutMark(e, id));
    end();
    setEditingText(null);
  };
  const switchMode = (k: Mode) => {
    finishText();
    setSelectedMarks([]);
    setMode(k);
  };
  /** 道具を変える。書いている文字は書き終え、「つかむ」から離れたら選んでいたものを外す */
  const changeInk = (i: Ink) => {
    if (i.tool !== ink.tool) {
      finishText();
      if (i.tool !== "grab") setSelectedMarks([]);
    }
    setInk(i);
  };

  // ---- つかむ：選んだ線や文字（いくつでも）の色・見た目をまとめて変える、消す ----
  const changeMarks = (ids: string[], patch: Partial<TextMark>) =>
    apply((e) => ({
      ...e,
      marks: (e.marks ?? []).map((x) =>
        ids.includes(x.id) ? ({ ...x, ...patch } as Mark) : x,
      ),
    }));
  const deleteMarks = (ids: string[]) => {
    apply((e) => ({
      ...e,
      marks: (e.marks ?? []).filter((x) => !ids.includes(x.id)),
    }));
    setSelectedMarks([]);
  };
  /** つかんでいる文字を書き直す（テキストの道具に切り替える） */
  const editTextMark = (id: string) => {
    setSelectedMarks([]);
    setInk((i) => ({ ...i, tool: "text" }));
    startText(id);
  };

  // 元の画像（編集前）と、前に保存した編集の内容を読む
  useEffect(() => {
    let alive = true;
    (async () => {
      const row = await db.mediaBlobs.get(id);
      if (!row) throw new Error("not found");
      const full = await decodeImage(row.source ?? row.view ?? row.original);
      const small = downscale(full, PREVIEW_MAX);
      if (!alive) return full.close();
      const initial = row.edit ?? defaultEdit();
      setPreview(small);
      // 元の大きさの画像は、拡大したときに細かく描き直すために持っておく（編集用の画像と同じ大きさなら要らない）
      if (full.width > small.width) setDetailSrc(full);
      else full.close();
      setStart(initial);
      setHist({ past: [], now: initial, future: [] });
    })().catch(() => {
      if (!alive) return;
      toast("この画像は編集できません");
      setEditing(null);
    });
    return () => {
      alive = false;
    };
  }, [id, setEditing]);

  useEffect(() => () => detailSrc?.close(), [detailSrc]);

  const auto = useMemo(() => (preview ? autoAdjust(preview) : null), [preview]);
  const dirty =
    !!edit && !!start && JSON.stringify(edit) !== JSON.stringify(start);

  const close = () => setEditing(null);

  // ---- 確かめる小さな画面：押したボタンのすぐ下に出す（iPhone と同じ） ----
  const cancelRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const [ask, setAsk] = useState<{
    rect: DOMRect;
    message: string;
    ok: string;
    resolve: (v: boolean) => void;
  } | null>(null);
  const askAt = (el: HTMLElement | null, message: string, ok: string) =>
    new Promise<boolean>((resolve) =>
      setAsk({
        rect:
          el?.getBoundingClientRect() ??
          new DOMRect(window.innerWidth / 2, 56, 0, 0),
        message,
        ok,
        resolve,
      }),
    );
  const answer = (v: boolean) => {
    ask?.resolve(v);
    setAsk(null);
  };

  /** キャンセル（×）：変えていれば、破棄してよいか確かめてから閉じる */
  const cancel = async () => {
    if (saving) return;
    finishText();
    if (
      dirty &&
      !(await askAt(
        cancelRef.current,
        "この画像に加えた変更は保存されません。",
        "変更内容を破棄",
      ))
    )
      return;
    close();
  };
  /** 保存する（「保存中」を画面に出してから、重い処理を始める）。何も書いていない文字は保存しない */
  const saveWith = async (save: (e: ImageEdit) => Promise<boolean>) => {
    if (!edit || saving) return;
    setSaving(true);
    await new Promise((r) => setTimeout(r, 30));
    const clean = {
      ...edit,
      marks: edit.marks?.filter((x) => x.kind !== "text" || x.text.trim()),
    };
    if (await save(clean)) close();
    else setSaving(false);
  };
  const finish = () => {
    if (edit && !dirty) return close();
    return saveWith((e) => saveEditFlow(id, e));
  };
  /** 編集を新しい画像として保存する（元の画像はそのまま） */
  const saveCopy = () => saveWith((e) => saveCopyFlow(id, e, me.id));
  /** 元に戻す：編集をすべて取り除いて、オリジナルに戻す（確かめてから） */
  const revert = async () => {
    if (!m || saving) return;
    const ok = await askAt(
      doneRef.current,
      "この画像に加えた編集をすべて取り除きます。",
      "オリジナルに戻す",
    );
    if (!ok) return;
    await revertEditNow(m);
    close();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 確認の画面などが上に出ている間は、キーを使わない（後ろにある拡大表示は除く）
      if (
        document.querySelector(
          '[role="dialog"][aria-modal="true"]:not([data-editor]):not([data-lightbox])',
        )
      )
        return;
      // 確かめる画面を出している間は、Esc で閉じる（ほかのキーは使わない）
      if (ask) {
        if (e.key === "Escape") {
          e.preventDefault();
          answer(false);
        }
        return;
      }
      // 文字を書いている間は、Esc で書き終える。ほかのキー（Ctrl+Z など）は文字の入力に使う
      if (editingText) {
        if (e.key === "Escape") {
          e.preventDefault();
          finishText();
          return;
        }
        if ((e.target as HTMLElement).isContentEditable) return;
      }
      // スペースを押している間は、ドラッグで画像を動かす（ボタンが押されないようにする）
      if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) setSpaceDown(true);
        return;
      }
      // つかむ：Ctrl+A ですべて選ぶ。選んでいる間は、Esc で離し、Delete でまとめて消す
      if (mode === "markup" && ink.tool === "grab" && edit) {
        const all = (edit.marks ?? []).map((x) => x.id);
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
          e.preventDefault();
          setSelectedMarks(all);
          return;
        }
        const live = selectedMarks.filter((x) => all.includes(x));
        if (live.length && e.key === "Escape") {
          e.preventDefault();
          setSelectedMarks([]);
          return;
        }
        if (live.length && (e.key === "Delete" || e.key === "Backspace")) {
          e.preventDefault();
          deleteMarks(live);
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // スペースを離したら（ほかのウィンドウへ移ったときも）、動かすのをやめる
  useEffect(() => {
    const up = (e: KeyboardEvent) => e.code === "Space" && setSpaceDown(false);
    const blur = () => setSpaceDown(false);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // ---- 表示 ----
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setBox({ w: el.clientWidth, h: el.clientHeight }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 押し続けている間に見せる「オリジナル」：切り取り・回転・調整・フィルタ・マークアップのどれもかけない
  const originalEdit = useMemo(() => defaultEdit(), []);
  const shownEdit = edit && showOriginal ? originalEdit : edit;

  useEffect(() => {
    if (!preview || !shownEdit) return;
    const raf = requestAnimationFrame(() => {
      const c = canvasRef.current;
      if (!c) return;
      renderEdit(
        preview,
        shownEdit,
        mode === "crop",
        c,
        showOriginal ? null : editingText,
      );
      setDims((d) =>
        d && d.w === c.width && d.h === c.height
          ? d
          : { w: c.width, h: c.height },
      );
    });
    return () => cancelAnimationFrame(raf);
  }, [preview, shownEdit, mode, showOriginal, editingText]);

  // フィルタの見本（今の調整と切り取りをあてた小さい画像）
  const [samples, setSamples] = useState<Record<string, string>>({});
  const adjust = edit?.adjust;
  const geo = edit?.geo;
  useEffect(() => {
    if (mode !== "filter" || !preview || !adjust || !geo) return;
    const t = setTimeout(() => {
      const small = downscale(preview, 200);
      const out: Record<string, string> = {};
      for (const f of FILTERS)
        out[f.id] = renderEdit(small, {
          ...defaultEdit(),
          adjust,
          geo,
          filter: f.id,
          filterAmount: 100,
        }).toDataURL("image/jpeg", 0.8);
      setSamples(out);
    }, 120);
    return () => clearTimeout(t);
  }, [mode, preview, adjust, geo]);

  const pad = mode === "crop" ? 28 : 8;
  const scale =
    dims && box
      ? Math.max(
          0.01,
          Math.min((box.w - pad * 2) / dims.w, (box.h - pad * 2) / dims.h),
        )
      : 0;
  const frame =
    preview && edit
      ? orientedSize(preview.width, preview.height, edit.geo.quarter)
      : null;

  // ---- 拡大・縮小 ----
  // zoom：画面に収めた大きさの何倍か。x・y：画像の真ん中を、画面の真ん中からどれだけずらしているか（px）。
  // 見せる範囲の形が変わったら（切り取りのタブとほかのタブ、回したとき）、全体の表示に戻す
  const viewKey =
    frame && edit
      ? mode === "crop"
        ? `f${frame.w}x${frame.h}`
        : `c${Math.round(edit.geo.crop.w * frame.w)}x${Math.round(edit.geo.crop.h * frame.h)}`
      : "";
  const [viewState, setViewState] = useState({ zoom: 1, x: 0, y: 0, key: "" });
  const view =
    viewState.key === viewKey
      ? viewState
      : { zoom: 1, x: 0, y: 0, key: viewKey };
  const fitW = dims ? dims.w * scale : 0;
  const fitH = dims ? dims.h * scale : 0;
  const dispW = fitW * view.zoom;
  const dispH = fitH * view.zoom;
  /** 画面からはみ出す分だけ動かせる（少しだけ余白も見えるようにする） */
  const clampView = (zoom: number, x: number, y: number) => {
    if (!box || zoom <= 1.01) return { zoom: 1, x: 0, y: 0, key: viewKey };
    const mx = fitW * zoom > box.w ? (fitW * zoom - box.w) / 2 + 40 : 0;
    const my = fitH * zoom > box.h ? (fitH * zoom - box.h) / 2 + 40 : 0;
    return {
      zoom,
      x: clamp(x, -mx, mx),
      y: clamp(y, -my, my),
      key: viewKey,
    };
  };
  /** (cx, cy)：画面の真ん中からの位置。そこにある所が動かないように拡大・縮小する */
  const zoomAt = (factor: number, cx: number, cy: number) => {
    const z = clamp(view.zoom * factor, 1, MAX_ZOOM);
    const r = z / view.zoom;
    setViewState(clampView(z, cx - (cx - view.x) * r, cy - (cy - view.y) * r));
  };
  const fitView = () => setViewState({ zoom: 1, x: 0, y: 0, key: viewKey });

  // スクロールで拡大・縮小（トラックパッドのピンチも）。ページがスクロールしないよう、自分で受け取る
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!dims || !box) return;
      e.preventDefault();
      const dy =
        e.deltaMode === 1
          ? e.deltaY * 16
          : e.deltaMode === 2
            ? e.deltaY * box.h
            : e.deltaY;
      const r = el.getBoundingClientRect();
      zoomAt(
        Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)),
        e.clientX - r.left - box.w / 2,
        e.clientY - r.top - box.h / 2,
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  /** ドラッグで画像を動かしている所。maybe：押したときに編集前を見せていて、まだ動かしていない */
  const pan = useRef<{
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    maybe: boolean;
  } | null>(null);
  const [panning, setPanning] = useState(false);
  const startPan = (e: React.PointerEvent<HTMLDivElement>, maybe: boolean) => {
    capture(e);
    pan.current = {
      sx: e.clientX,
      sy: e.clientY,
      ox: view.x,
      oy: view.y,
      maybe,
    };
    if (!maybe) setPanning(true);
  };
  // オリジナルは、0.3秒押し続けたときだけ見せる（ふつうのクリックで切り替わらないように）
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    setShowOriginal(false);
  };
  const stopPan = () => {
    pan.current = null;
    setPanning(false);
    stopHold();
  };

  // 拡大しているときは、見えている所だけを元の大きさの画像から細かく描き直す（止まってから少し待って）
  const detailRef = useRef<HTMLCanvasElement>(null);
  const [detail, setDetail] = useState<{
    sig: string;
    edit: ImageEdit;
    left: number;
    top: number;
    w: number;
    h: number;
  } | null>(null);
  const detailSig = JSON.stringify([view, box, mode, editingText, fitW, fitH]);
  useEffect(() => {
    const src = detailSrc ?? preview;
    if (!src || !edit || !shownEdit || !box || view.zoom <= 1.05) return;
    const t = setTimeout(() => {
      const c = detailRef.current;
      if (!c) return;
      // 画面に見えている範囲（画像の左上からの px）
      const L = box.w / 2 + view.x - dispW / 2;
      const T = box.h / 2 + view.y - dispH / 2;
      const x0 = Math.max(0, -L);
      const y0 = Math.max(0, -T);
      const x1 = Math.min(dispW, box.w - L);
      const y1 = Math.min(dispH, box.h - T);
      if (x1 - x0 < 2 || y1 - y0 < 2) return;
      // 今出している画像（オリジナルを見せているなら、切り取る前の全体）の範囲
      const R = mode === "crop" ? FULL : shownEdit.geo.crop;
      const rect = {
        x: R.x + (x0 / dispW) * R.w,
        y: R.y + (y0 / dispH) * R.h,
        w: ((x1 - x0) / dispW) * R.w,
        h: ((y1 - y0) / dispH) * R.h,
      };
      const W = orientedSize(src.width, src.height, shownEdit.geo.quarter).w;
      const dpr = window.devicePixelRatio || 1;
      renderEdit(
        src,
        shownEdit,
        mode === "crop",
        c,
        showOriginal ? null : editingText,
        {
          rect,
          scale: ((x1 - x0) * dpr) / (rect.w * W),
        },
      );
      setDetail({
        sig: detailSig,
        edit: shownEdit,
        left: x0,
        top: y0,
        w: x1 - x0,
        h: y1 - y0,
      });
    }, 150);
    return () => clearTimeout(t);
  }, [
    detailSig,
    detailSrc,
    preview,
    edit,
    shownEdit,
    box,
    view.zoom,
    view.x,
    view.y,
    showOriginal,
    mode,
    editingText,
    dispW,
    dispH,
  ]);
  const showDetail =
    !!detail &&
    detail.sig === detailSig &&
    detail.edit === shownEdit &&
    view.zoom > 1.05;

  if (!m) return null;

  // 編集してある画像を開いて、まだ何も変えていない間は、右上のボタンが「元に戻す」になる
  const showRevert = !!m.edited && !!edit && !dirty;
  const holdOriginal = mode === "adjust" || mode === "filter";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`「${m.name}」を編集`}
      data-editor
      data-name="画像の編集"
      className="fixed inset-0 z-[57] flex animate-[fade_.2s] flex-col bg-black text-white select-none"
      style={{ colorScheme: "dark" }}
    >
      {/* 左・真ん中・右の3つに分け、右のボタンが増えたり減ったりしても、真ん中の取り消し・やり直しが動かないようにする */}
      <header className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 pt-[calc(env(safe-area-inset-top,0px)+8px)] pb-2">
        <div className="flex justify-start">
          <button
            ref={cancelRef}
            onClick={cancel}
            disabled={saving}
            aria-label="キャンセル"
            title="キャンセル（Esc）"
            className="grid h-9 w-9 place-items-center rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-50"
          >
            <Icon name="x" size={20} />
          </button>
        </div>
        <div className="flex items-center justify-center gap-1">
          <HeadIcon
            label="取り消す（Ctrl+Z）"
            disabled={!hist?.past.length || saving}
            onClick={undo}
          >
            <Icon name="undo" size={20} />
          </HeadIcon>
          <HeadIcon
            label="やり直す（Ctrl+Shift+Z）"
            disabled={!hist?.future.length || saving}
            onClick={redo}
          >
            <Icon name="redo" size={20} />
          </HeadIcon>
        </div>
        <div className="flex items-center justify-end gap-2">
          {/* 複製として保存は、この画面で何か変えたときか、前に編集して保存してある画像のときに出す */}
          {(dirty || !!m.edited) && (
            <button
              onClick={saveCopy}
              disabled={!edit || saving}
              title="元の画像はそのままにして、編集した画像を新しい画像として保存する"
              className="rounded-full px-3 py-1.5 font-bold hover:bg-white/10 disabled:opacity-50"
              style={{ color: YELLOW }}
            >
              {/* 画面が狭いときは短く */}
              <span className="sm:hidden">複製</span>
              <span className="hidden sm:inline">複製として保存</span>
            </button>
          )}
          {/* 完了（✓）と元に戻す は同じ場所。何か変えると「完了」になる */}
          <button
            ref={doneRef}
            onClick={showRevert ? revert : finish}
            disabled={!edit || saving}
            aria-label={showRevert ? "元に戻す" : "完了"}
            title={
              showRevert
                ? "元に戻す（編集をすべて取り除いて、オリジナルに戻す）"
                : "完了"
            }
            className="grid h-9 w-9 place-items-center rounded-full disabled:opacity-50"
            style={
              showRevert
                ? { background: "rgba(255,69,58,.18)", color: RED }
                : { background: YELLOW, color: "#000" }
            }
          >
            <Icon name={showRevert ? "restore" : "ok"} size={20} />
          </button>
        </div>
      </header>

      <div
        ref={stageRef}
        data-name="編集中の画像"
        title={
          holdOriginal
            ? "押し続けている間は、オリジナルの画像を表示します。スクロールで拡大・縮小します"
            : "スクロールで拡大・縮小します。中ボタンかスペースを押しながらドラッグで動かします"
        }
        className="relative grid min-h-0 flex-1 place-items-center overflow-hidden"
        style={{
          cursor: panning
            ? "grabbing"
            : view.zoom > 1 && (spaceDown || holdOriginal)
              ? "grab"
              : undefined,
        }}
        // 中ボタンか、スペースを押しながらのドラッグは、どのタブでも画像を動かす（描く・切り取るより先に受け取る）
        onPointerDownCapture={(e) => {
          if (e.button !== 1 && !(e.button === 0 && spaceDown)) return;
          e.preventDefault();
          e.stopPropagation();
          if (view.zoom > 1) startPan(e, false);
        }}
        // 中ボタンを押したときの、ブラウザの自動スクロールを出さない
        onMouseDown={(e) => e.button === 1 && e.preventDefault()}
        onPointerDown={(e) => {
          if (!holdOriginal || e.button !== 0) return;
          if (holdTimer.current) clearTimeout(holdTimer.current);
          holdTimer.current = setTimeout(() => setShowOriginal(true), 300);
          // 拡大しているときは、ドラッグしたら画像を動かす（動かしたら、オリジナルの表示はやめる）
          if (view.zoom > 1) startPan(e, true);
        }}
        onPointerMove={(e) => {
          const p = pan.current;
          if (!p) return;
          const dx = e.clientX - p.sx;
          const dy = e.clientY - p.sy;
          if (p.maybe) {
            if (Math.hypot(dx, dy) < 4) return;
            p.maybe = false;
            stopHold();
            setPanning(true);
          }
          setViewState(clampView(view.zoom, p.ox + dx, p.oy + dy));
        }}
        onPointerUp={stopPan}
        onPointerLeave={() => !pan.current && stopHold()}
        onPointerCancel={stopPan}
      >
        {!preview && <p className="loading text-white/60">読み込み中…</p>}
        <div
          className="absolute"
          style={{
            left: (box?.w ?? 0) / 2 + view.x - dispW / 2,
            top: (box?.h ?? 0) / 2 + view.y - dispH / 2,
            width: dispW,
            height: dispH,
            visibility: dims ? "visible" : "hidden",
          }}
        >
          <canvas ref={canvasRef} className="block h-full w-full" />
          {/* 拡大したときの、見えている所だけの細かい画像 */}
          <canvas
            ref={detailRef}
            className="pointer-events-none absolute"
            style={
              showDetail && detail
                ? {
                    left: detail.left,
                    top: detail.top,
                    width: detail.w,
                    height: detail.h,
                  }
                : { display: "none" }
            }
          />
          {mode === "crop" && edit && frame && !showOriginal && (
            <CropOverlay
              rect={edit.geo.crop}
              w={dispW}
              h={dispH}
              rn={
                edit.geo.aspect ? (edit.geo.aspect * frame.h) / frame.w : null
              }
              onBegin={begin}
              onChange={(crop) => set({ ...edit, geo: { ...edit.geo, crop } })}
              onEnd={end}
            />
          )}
          {mode === "markup" && edit && frame && dims && (
            <MarkupLayer
              edit={edit}
              frame={frame}
              w={dispW}
              h={dispH}
              ink={ink}
              editingText={editingText}
              selected={selectedMarks}
              setSelected={setSelectedMarks}
              set={set}
              apply={apply}
              begin={begin}
              end={end}
              startText={startText}
              finishText={finishText}
              editTextMark={editTextMark}
            />
          )}
        </div>
        {/* スペースを押している間は、上に覆いをかけて、描く・選ぶの代わりに画像を動かす */}
        {spaceDown && <div className="absolute inset-0 z-20" />}
        {view.zoom > 1.01 && (
          <button
            onClick={fitView}
            onPointerDown={(e) => e.stopPropagation()}
            title="全体を表示する"
            className="absolute top-2 left-2 z-30 rounded-full bg-black/65 px-2.5 py-0.5 text-xs font-bold tabular-nums hover:bg-black/85"
          >
            {Math.round(view.zoom * 100)}%
          </button>
        )}
        {showOriginal && (
          <span className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-0.5 text-xs font-bold">
            オリジナル
          </span>
        )}
        {saving && (
          <div className="absolute inset-0 grid place-items-center bg-black/50">
            <p className="rounded-full bg-black/70 px-4 py-1.5 font-bold">
              保存中…
            </p>
          </div>
        )}
      </div>

      {edit && preview && frame && (
        <div className="mx-auto w-full max-w-[720px] shrink-0 px-3">
          {mode === "adjust" && (
            <AdjustPanel
              edit={edit}
              tool={tool}
              setTool={setTool}
              auto={auto}
              apply={apply}
              set={set}
              begin={begin}
              end={end}
            />
          )}
          {mode === "filter" && (
            <FilterPanel
              edit={edit}
              samples={samples}
              apply={apply}
              set={set}
              begin={begin}
              end={end}
            />
          )}
          {mode === "markup" && (
            <MarkupPanel
              ink={ink}
              setInk={changeInk}
              editingText={editingText}
              set={set}
              deleteText={deleteText}
              selected={(edit.marks ?? []).filter((x) =>
                selectedMarks.includes(x.id),
              )}
              changeMarks={changeMarks}
              deleteMarks={deleteMarks}
            />
          )}
          {mode === "crop" && (
            <CropPanel
              edit={edit}
              frame={frame}
              apply={apply}
              set={set}
              begin={begin}
              end={end}
            />
          )}
        </div>
      )}

      {ask && <AskPopover {...ask} onAnswer={answer} />}

      <nav
        data-name="編集の種類"
        className="flex shrink-0 justify-center gap-2 px-3 pt-1 pb-[calc(env(safe-area-inset-bottom,0px)+10px)]"
      >
        {(
          [
            ["adjust", "調整", <Icon key="i" name="tune" size={22} />],
            ["filter", "フィルタ", <FilterGlyph key="i" />],
            ["crop", "切り取り", <Icon key="i" name="crop" size={22} />],
            ["markup", "マークアップ", <Icon key="i" name="edit" size={22} />],
          ] as const
        ).map(([k, label, icon]) => (
          <button
            key={k}
            aria-pressed={mode === k}
            onClick={() => switchMode(k)}
            className={`flex w-20 flex-col items-center gap-0.5 rounded-[12px] py-1 text-[11px] font-bold ${mode === k ? "" : "text-white/55 hover:text-white/80"}`}
            style={mode === k ? { color: YELLOW } : undefined}
          >
            {icon}
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

/** 変えた後の状態か、今の状態から変えた後の状態を作る関数 */
type EditChange = ImageEdit | ((e: ImageEdit) => ImageEdit);

type PanelProps = {
  edit: ImageEdit;
  apply: (e: EditChange) => void;
  set: (e: EditChange) => void;
  begin: () => void;
  end: () => void;
};

// ---- 調整 ----

function AdjustPanel({
  edit,
  tool,
  setTool,
  auto,
  apply,
  set,
  begin,
  end,
}: PanelProps & {
  tool: AdjustKey | "auto";
  setTool: (t: AdjustKey | "auto") => void;
  auto: Partial<Record<AdjustKey, number>> | null;
}) {
  const autoOn =
    !!auto &&
    Object.entries(auto).every(([k, v]) => edit.adjust[k as AdjustKey] === v);
  const toggleAuto = () => {
    if (!auto) return;
    const next = { ...edit.adjust };
    for (const [k, v] of Object.entries(auto))
      next[k as AdjustKey] = autoOn ? 0 : (v ?? 0);
    apply({ ...edit, adjust: next });
  };
  const t = ADJUST_TOOLS.find((x) => x.key === tool);

  return (
    <div data-name="調整">
      <div className="flex h-6 items-center justify-center gap-2 text-sm font-bold">
        {t ? (
          <>
            <span>{t.label}</span>
            <span
              className="w-9 text-center tabular-nums"
              style={{ color: edit.adjust[t.key] ? YELLOW : undefined }}
            >
              {edit.adjust[t.key]}
            </span>
          </>
        ) : (
          <span>{autoOn ? "自動：オン" : "自動：オフ"}</span>
        )}
      </div>
      {t ? (
        <Dial
          label={t.label}
          value={edit.adjust[t.key]}
          min={t.min}
          max={100}
          step={1}
          ppu={3}
          minor={5}
          major={25}
          onBegin={begin}
          onEnd={end}
          onChange={(v) =>
            set({ ...edit, adjust: { ...edit.adjust, [t.key]: v } })
          }
        />
      ) : (
        <div className="h-12" title="写真に合わせて、明るさや色を自動で整えます" />
      )}
      <CenterRow selected={tool} className="gap-2.5">
        <ToolButton
          label="自動"
          value={autoOn ? 100 : 0}
          min={0}
          selected={tool === "auto"}
          onClick={() => (tool === "auto" ? toggleAuto() : setTool("auto"))}
        >
          <Icon name="bolt" size={20} />
        </ToolButton>
        {ADJUST_TOOLS.map((x) => (
          <ToolButton
            key={x.key}
            label={x.label}
            value={edit.adjust[x.key]}
            min={x.min}
            selected={tool === x.key}
            onClick={() => {
              // 2回押すと、その調整を0に戻す（もう一度押すと戻せるよう、取り消しの履歴に残す）
              if (tool === x.key && edit.adjust[x.key])
                apply({ ...edit, adjust: { ...edit.adjust, [x.key]: 0 } });
              setTool(x.key);
            }}
          >
            <ToolGlyph k={x.key} />
          </ToolButton>
        ))}
      </CenterRow>
    </div>
  );
}

function ToolButton({
  label,
  value,
  min,
  selected,
  onClick,
  children,
}: {
  label: string;
  value: number;
  min: number;
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const C = 2 * Math.PI * 20;
  const part = Math.abs(value) / 100;
  return (
    <button
      aria-label={label}
      aria-pressed={selected}
      title={label}
      onClick={onClick}
      className={`relative grid h-11 w-11 shrink-0 place-items-center rounded-full ${selected ? "text-white" : "text-white/60"}`}
    >
      <svg
        width="44"
        height="44"
        viewBox="0 0 44 44"
        className="absolute inset-0"
        aria-hidden="true"
      >
        <circle
          cx="22"
          cy="22"
          r="20"
          fill="none"
          stroke={selected ? "#fff" : "rgba(255,255,255,.28)"}
          strokeWidth={selected ? 2 : 1.5}
        />
        {value !== 0 && (
          <circle
            cx="22"
            cy="22"
            r="20"
            fill="none"
            stroke={YELLOW}
            strokeWidth="2.5"
            strokeDasharray={`${part * C} ${C}`}
            // 0 から上を起点に、＋は右回り、－は左回り
            transform={
              value < 0 && min < 0
                ? "translate(44 0) scale(-1 1) rotate(-90 22 22)"
                : "rotate(-90 22 22)"
            }
          />
        )}
      </svg>
      {selected && value !== 0 && label !== "自動" ? (
        <span className="text-xs font-bold tabular-nums">{value}</span>
      ) : (
        children
      )}
    </button>
  );
}

/** 調整の種類ごとの小さな絵 */
function ToolGlyph({ k }: { k: AdjustKey }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    "aria-hidden": true,
  } as const;
  switch (k) {
    case "exposure":
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="7" />
          <path d="M10 3a7 7 0 0 0 0 14z" fill="currentColor" />
          <path d="M5.5 10h2.5M6.75 8.75v2.5M12 10h2.5" />
        </svg>
      );
    case "brilliance":
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="7" />
          <path d="M10 3a7 7 0 0 1 0 14" strokeDasharray="1.5 1.5" />
          <circle cx="10" cy="10" r="2.5" fill="currentColor" />
        </svg>
      );
    case "highlights":
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="7" />
          <path d="M3 10a7 7 0 0 1 14 0z" fill="currentColor" />
        </svg>
      );
    case "shadows":
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="7" />
          <path d="M3 10a7 7 0 0 0 14 0z" fill="currentColor" />
        </svg>
      );
    case "contrast":
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="7" />
          <path d="M10 3a7 7 0 0 1 0 14z" fill="currentColor" />
        </svg>
      );
    case "brightness":
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="3.5" fill="currentColor" />
          <path d="M10 1.5v2.5M10 16v2.5M1.5 10H4M16 10h2.5M4 4l1.7 1.7M14.3 14.3 16 16M4 16l1.7-1.7M14.3 5.7 16 4" />
        </svg>
      );
    case "blackPoint":
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="6.5" fill="currentColor" />
        </svg>
      );
    case "saturation":
      return (
        <svg {...common}>
          <circle cx="10" cy="7" r="4" />
          <circle cx="7" cy="12" r="4" />
          <circle cx="13" cy="12" r="4" />
        </svg>
      );
    case "vibrance":
      return (
        <svg {...common}>
          <path d="M10 2.5 17.5 10 10 17.5 2.5 10z" />
          <path d="M10 6 14 10 10 14 6 10z" fill="currentColor" />
        </svg>
      );
    case "warmth":
      return (
        <svg {...common}>
          <path d="M8 4a2 2 0 0 1 4 0v7.2a3.8 3.8 0 1 1-4 0z" />
          <circle cx="10" cy="14.2" r="1.8" fill="currentColor" />
        </svg>
      );
    case "tint":
      return (
        <svg {...common}>
          <path d="M10 2.5S4.5 8.5 4.5 12.5a5.5 5.5 0 0 0 11 0C15.5 8.5 10 2.5 10 2.5z" />
          <path d="M10 18a5.5 5.5 0 0 0 5.5-5.5H10z" fill="currentColor" />
        </svg>
      );
    case "sharpness":
      return (
        <svg {...common}>
          <path d="M10 2.5 17.5 16.5h-15z" />
        </svg>
      );
    case "definition":
      return (
        <svg {...common}>
          <path d="M10 2.5 17.5 16.5h-15z" />
          <path d="M10 2.5v14h7.5z" fill="currentColor" />
        </svg>
      );
    case "noise":
      return (
        <svg {...common} stroke="none" fill="currentColor">
          {[4, 8, 12, 16].flatMap((x) =>
            [4, 8, 12, 16].map((y) => (
              <circle
                key={`${x}-${y}`}
                cx={x}
                cy={y}
                r={(x + y) % 8 ? 1.1 : 1.6}
              />
            )),
          )}
        </svg>
      );
    case "vignette":
      return (
        <svg {...common}>
          <rect
            x="2.5"
            y="4"
            width="15"
            height="12"
            rx="2"
            fill="currentColor"
          />
          <ellipse cx="10" cy="10" rx="5" ry="3.8" fill="#000" stroke="none" />
        </svg>
      );
  }
}

function FilterGlyph() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <circle cx="11" cy="7.5" r="5" />
      <circle cx="7.5" cy="13.5" r="5" />
      <circle cx="14.5" cy="13.5" r="5" />
    </svg>
  );
}

// ---- フィルタ ----

function FilterPanel({
  edit,
  samples,
  apply,
  set,
  begin,
  end,
}: PanelProps & { samples: Record<string, string> }) {
  const current = FILTERS.find((f) => f.id === edit.filter) ?? FILTERS[0];
  return (
    <div data-name="フィルタ">
      <div className="flex h-6 items-center justify-center gap-2 text-sm font-bold">
        <span>{current.label}</span>
        {edit.filter !== "none" && (
          <span
            className="w-9 text-center tabular-nums"
            style={{ color: YELLOW }}
          >
            {edit.filterAmount}
          </span>
        )}
      </div>
      {edit.filter !== "none" ? (
        <Dial
          label="フィルタの強さ"
          value={edit.filterAmount}
          min={0}
          max={100}
          step={1}
          ppu={3}
          minor={5}
          major={25}
          zero={100}
          onBegin={begin}
          onEnd={end}
          onChange={(v) => set({ ...edit, filterAmount: v })}
        />
      ) : (
        <div className="h-12" />
      )}
      <CenterRow selected={edit.filter} className="gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            title={f.label}
            aria-pressed={edit.filter === f.id}
            onClick={() => {
              if (edit.filter !== f.id)
                apply({ ...edit, filter: f.id, filterAmount: 100 });
            }}
            className="flex w-[76px] shrink-0 flex-col items-center gap-1"
          >
            <span
              className="block h-[68px] w-[68px] overflow-hidden rounded-[8px] bg-white/10"
              style={
                edit.filter === f.id
                  ? { outline: `2px solid ${YELLOW}`, outlineOffset: 2 }
                  : undefined
              }
            >
              {samples[f.id] && (
                // eslint-disable-next-line @next/next/no-img-element -- その場で作った見本の画像
                <img
                  src={samples[f.id]}
                  alt=""
                  className="h-full w-full object-cover"
                  draggable={false}
                />
              )}
            </span>
            <span
              className={`w-full truncate text-center text-[11px] ${edit.filter === f.id ? "font-bold text-white" : "text-white/60"}`}
            >
              {f.label}
            </span>
          </button>
        ))}
      </CenterRow>
    </div>
  );
}

// ---- 切り取り ----

function CropPanel({
  edit,
  frame,
  apply,
  set,
  begin,
  end,
}: PanelProps & { frame: { w: number; h: number } }) {
  const g = edit.geo;
  const original = frame.w / frame.h;
  // 選んでいる比が縦長か（正方形・自由形式のときは、画像の向きに合わせる）
  const portrait = g.aspect ? g.aspect < 1 : frame.h > frame.w;
  const ratioOf = (r: number | "original" | null) => {
    if (r === null) return null;
    if (r === "original") return original;
    return portrait ? 1 / r : r;
  };
  const chosen = ASPECTS.findIndex((a) => {
    const r = ratioOf(a.ratio);
    return r === null
      ? g.aspect === null
      : g.aspect !== null && same(r, g.aspect);
  });
  const pick = (r: number | null) =>
    apply({
      ...edit,
      geo: {
        ...g,
        aspect: r,
        crop: r ? cropForAspect(g.crop, r, frame.w, frame.h) : g.crop,
      },
    });
  const flipOrientation = () => {
    if (!g.aspect || same(g.aspect, 1)) return;
    pick(1 / g.aspect);
  };
  const label = (a: (typeof ASPECTS)[number]) => {
    if (typeof a.ratio !== "number" || a.ratio === 1 || !portrait)
      return a.label;
    const [x, y] = a.label.split(":");
    return `${y}:${x}`;
  };

  return (
    <div data-name="切り取り">
      <div className="flex h-6 items-center justify-center gap-2 text-sm font-bold">
        <span>傾き</span>
        <span
          className="w-12 text-center tabular-nums"
          style={{ color: g.angle ? YELLOW : undefined }}
        >
          {Number(g.angle.toFixed(1))}°
        </span>
      </div>
      <Dial
        label="傾き"
        value={g.angle}
        min={-45}
        max={45}
        step={0.5}
        ppu={8}
        minor={1}
        major={5}
        onBegin={begin}
        onEnd={end}
        onChange={(v) => set({ ...edit, geo: { ...g, angle: v } })}
      />
      <div className="flex items-center gap-1 pt-1">
        <HeadIcon
          label="左に90°回転"
          onClick={() => apply(rotateEditLeft(edit))}
        >
          <Icon name="rotateLeft" size={22} />
        </HeadIcon>
        <HeadIcon label="左右反転" onClick={() => apply(flipEdit(edit))}>
          <Icon name="flip" size={22} />
        </HeadIcon>
        <HeadIcon
          label={portrait ? "横長の比にする" : "縦長の比にする"}
          disabled={!g.aspect || same(g.aspect, 1)}
          onClick={flipOrientation}
        >
          <span className="relative">
            <Icon
              name="aspect"
              size={22}
              className={portrait ? "rotate-90" : ""}
            />
          </span>
        </HeadIcon>
        <span className="flex-1" />
        <button
          disabled={isGeoDefault(g) && g.aspect === null}
          onClick={() => apply({ ...edit, geo: defaultEdit().geo })}
          className="shrink-0 rounded-full px-3 py-1 text-xs font-bold disabled:opacity-30"
          style={{ color: YELLOW }}
        >
          リセット
        </button>
      </div>
      {/* 比は調整・フィルタと同じ幅いっぱいの並びにして、押したものが同じ真ん中に来るようにする */}
      <CenterRow selected={String(chosen)} className="gap-1.5">
        {ASPECTS.map((a, i) => (
          <button
            key={a.label}
            aria-pressed={chosen === i}
            onClick={() => pick(ratioOf(a.ratio))}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${chosen === i ? "bg-white/90 text-black" : "bg-white/10 text-white/75 hover:bg-white/20"}`}
          >
            {label(a)}
          </button>
        ))}
      </CenterRow>
    </div>
  );
}

/** 切り取りの枠。角と辺をドラッグで大きさを変え、中をドラッグで動かす */
function CropOverlay({
  rect,
  w,
  h,
  rn,
  onBegin,
  onChange,
  onEnd,
}: {
  rect: Rect;
  w: number;
  h: number;
  /** 0〜1 の範囲での縦横比（固定しないなら null） */
  rn: number | null;
  onBegin: () => void;
  onChange: (r: Rect) => void;
  onEnd: () => void;
}) {
  const drag = useRef<{ h: string; x: number; y: number; r: Rect } | null>(
    null,
  );
  const [active, setActive] = useState(false);
  const px = {
    left: rect.x * w,
    top: rect.y * h,
    width: rect.w * w,
    height: rect.h * h,
  };
  const stop = () => {
    if (!drag.current) return;
    drag.current = null;
    setActive(false);
    onEnd();
  };
  const corner = "absolute h-7 w-7 border-white";
  return (
    <div
      data-name="切り取りの枠"
      className="absolute inset-0 touch-none"
      onPointerDown={(e) => {
        const handle = (e.target as HTMLElement).closest<HTMLElement>(
          "[data-h]",
        )?.dataset.h;
        if (!handle || e.button !== 0) return;
        e.preventDefault();
        capture(e);
        drag.current = { h: handle, x: e.clientX, y: e.clientY, r: rect };
        setActive(true);
        onBegin();
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || !w || !h) return;
        onChange(
          dragRect(d.r, d.h, (e.clientX - d.x) / w, (e.clientY - d.y) / h, rn),
        );
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute"
          style={{
            ...px,
            boxShadow: `0 0 0 9999px rgba(0,0,0,${active ? 0.45 : 0.62})`,
          }}
        />
      </div>
      <div
        data-h="move"
        className="absolute cursor-move border border-white/90"
        style={px}
      >
        <div
          className="pointer-events-none absolute inset-0 transition-opacity"
          style={{ opacity: active ? 0.7 : 0.25 }}
        >
          <span className="absolute inset-y-0 left-1/3 w-px bg-white" />
          <span className="absolute inset-y-0 left-2/3 w-px bg-white" />
          <span className="absolute inset-x-0 top-1/3 h-px bg-white" />
          <span className="absolute inset-x-0 top-2/3 h-px bg-white" />
        </div>
        <span
          data-h="n"
          className="absolute -top-2 right-6 left-6 h-4 cursor-ns-resize"
        />
        <span
          data-h="s"
          className="absolute right-6 -bottom-2 left-6 h-4 cursor-ns-resize"
        />
        <span
          data-h="w"
          className="absolute top-6 bottom-6 -left-2 w-4 cursor-ew-resize"
        />
        <span
          data-h="e"
          className="absolute top-6 -right-2 bottom-6 w-4 cursor-ew-resize"
        />
        <span
          data-h="nw"
          className={`${corner} -top-[4px] -left-[4px] cursor-nwse-resize border-t-[4px] border-l-[4px]`}
        />
        <span
          data-h="ne"
          className={`${corner} -top-[4px] -right-[4px] cursor-nesw-resize border-t-[4px] border-r-[4px]`}
        />
        <span
          data-h="sw"
          className={`${corner} -bottom-[4px] -left-[4px] cursor-nesw-resize border-b-[4px] border-l-[4px]`}
        />
        <span
          data-h="se"
          className={`${corner} -right-[4px] -bottom-[4px] cursor-nwse-resize border-r-[4px] border-b-[4px]`}
        />
      </div>
    </div>
  );
}

/** 枠をドラッグしたあとの範囲。縦横比を固定しているときは、反対側（辺なら真ん中）を動かさずに大きさを合わせる */
function dragRect(
  r: Rect,
  hd: string,
  dx: number,
  dy: number,
  rn: number | null,
): Rect {
  const MIN = 0.05;
  if (hd === "move")
    return {
      ...r,
      x: clamp(r.x + dx, 0, 1 - r.w),
      y: clamp(r.y + dy, 0, 1 - r.h),
    };
  let { x, y, w, h } = r;
  const right = x + w;
  const bottom = y + h;
  const W = hd.includes("w");
  const E = hd.includes("e");
  const N = hd.includes("n");
  const S = hd.includes("s");
  if (W) {
    x = clamp(x + dx, 0, right - MIN);
    w = right - x;
  }
  if (E) w = clamp(w + dx, MIN, 1 - x);
  if (N) {
    y = clamp(y + dy, 0, bottom - MIN);
    h = bottom - y;
  }
  if (S) h = clamp(h + dy, MIN, 1 - y);
  if (rn) {
    const horizontal = W || E;
    const vertical = N || S;
    const byWidth =
      horizontal && !vertical
        ? true
        : vertical && !horizontal
          ? false
          : Math.abs(w - r.w) >= Math.abs(h - r.h) * rn;
    if (byWidth) h = w / rn;
    else w = h * rn;
    const ax = W ? right : E ? r.x : r.x + r.w / 2;
    const ay = N ? bottom : S ? r.y : r.y + r.h / 2;
    const maxW = W ? ax : E ? 1 - ax : 2 * Math.min(ax, 1 - ax);
    const maxH = N ? ay : S ? 1 - ay : 2 * Math.min(ay, 1 - ay);
    const k = Math.min(1, maxW / w, maxH / h);
    w *= k;
    h *= k;
    x = W ? ax - w : E ? ax : ax - w / 2;
    y = N ? ay - h : S ? ay : ay - h / 2;
  }
  return { x, y, w, h };
}

// ---- マークアップ（ペン・マーカー・消しゴム・文字入れ） ----

const MARK_TOOLS: { k: MarkTool; label: string }[] = [
  { k: "grab", label: "つかむ" },
  { k: "pen", label: "ペン" },
  { k: "marker", label: "マーカー" },
  { k: "eraser", label: "消しゴム" },
  { k: "text", label: "テキスト" },
];

function MarkToolGlyph({ k }: { k: MarkTool }) {
  if (k === "grab") return <Icon name="hand" size={18} />;
  if (k === "pen") return <Icon name="edit" size={20} />;
  if (k === "marker") return <Icon name="brush" size={20} />;
  if (k === "text") return <Icon name="title" size={20} />;
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d="M3.5 13.5 11 6l5 5-6.5 6.5H6z" />
      <path d="M7.5 10 12.5 15" />
      <path d="M10 17.5h7" />
    </svg>
  );
}

function MarkupPanel({
  ink,
  setInk,
  editingText,
  set,
  deleteText,
  selected,
  changeMarks,
  deleteMarks,
}: {
  ink: Ink;
  setInk: (i: Ink) => void;
  editingText: string | null;
  set: (e: EditChange) => void;
  deleteText: () => void;
  /** 「つかむ」で選んでいる線や文字 */
  selected: Mark[];
  changeMarks: (ids: string[], patch: Partial<TextMark>) => void;
  deleteMarks: (ids: string[]) => void;
}) {
  // 文字を書いている間に色・大きさ・見た目を変えたら、その文字も変える
  const change = (patch: Partial<Ink>, mark: Partial<TextMark>) => {
    setInk({ ...ink, ...patch });
    if (editingText)
      set((e) => ({
        ...e,
        marks: (e.marks ?? []).map((x) =>
          x.id === editingText && x.kind === "text" ? { ...x, ...mark } : x,
        ),
      }));
  };
  const pill = (on: boolean) =>
    `shrink-0 rounded-full px-3 py-1 text-xs font-bold ${on ? "bg-white/90 text-black" : "bg-white/10 text-white/75 hover:bg-white/20"}`;
  const isText = ink.tool === "text";
  const ids = selected.map((x) => x.id);
  const texts = selected.filter((x): x is TextMark => x.kind === "text");
  const swatch = (c: string, on: boolean, onClick: () => void) => (
    <button
      key={c}
      aria-label={`色 ${c}`}
      aria-pressed={on}
      onClick={onClick}
      className="h-6 w-6 shrink-0 rounded-full border border-white/30"
      style={{
        background: c,
        outline: on ? `2px solid ${YELLOW}` : undefined,
        outlineOffset: 2,
      }}
    />
  );
  const styleButtons = (
    current: TextStyle | null,
    onPick: (s: TextStyle) => void,
  ) => (
    <div className="flex shrink-0 gap-1">
      {(
        [
          ["plain", "文字"],
          ["outline", "縁取り"],
          ["box", "背景"],
        ] as const
      ).map(([k, l]) => (
        <button
          key={k}
          aria-pressed={current === k}
          onClick={() => onPick(k)}
          className={pill(current === k)}
        >
          {l}
        </button>
      ))}
    </div>
  );
  return (
    <div
      data-name="マークアップ"
      // ボタンを押しても、書いている文字から入力の場所が外れないようにする
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex justify-center gap-1 pt-1">
        {MARK_TOOLS.map((t) => (
          <button
            key={t.k}
            aria-pressed={ink.tool === t.k}
            onClick={() => setInk({ ...ink, tool: t.k })}
            className={`flex w-16 flex-col items-center gap-0.5 rounded-[12px] py-1 text-[11px] font-bold ${ink.tool === t.k ? "bg-white/10" : "text-white/55 hover:text-white/80"}`}
            style={ink.tool === t.k ? { color: YELLOW } : undefined}
          >
            <MarkToolGlyph k={t.k} />
            {t.label}
          </button>
        ))}
      </div>
      {ink.tool === "grab" ? (
        selected.length ? (
          // つかんでいる線や文字（いくつでも）の色・見た目をまとめて変える、消す
          <div className="flex h-[52px] items-center justify-center gap-3 overflow-x-auto [scrollbar-width:none]">
            {selected.length > 1 && (
              <span className="shrink-0 text-xs font-bold text-white/70">
                {selected.length}個
              </span>
            )}
            <div className="flex shrink-0 gap-1.5">
              {COLORS.map((c) =>
                swatch(
                  c,
                  selected.every((x) => x.color === c),
                  () => changeMarks(ids, { color: c }),
                ),
              )}
            </div>
            {texts.length === selected.length && (
              <>
                <span className="h-6 w-px shrink-0 bg-white/20" />
                {styleButtons(
                  texts.every((x) => x.style === texts[0].style)
                    ? texts[0].style
                    : null,
                  (st) => changeMarks(ids, { style: st }),
                )}
              </>
            )}
            <button
              onClick={() => deleteMarks(ids)}
              className="shrink-0 rounded-full px-3 py-1 text-xs font-bold text-[#ff453a] hover:bg-white/10"
            >
              削除
            </button>
          </div>
        ) : (
          <div className="h-[52px]" title="線や文字を押してつかみます。Shift+クリックや、何もない所からドラッグして囲むと、いくつも選べます" />
        )
      ) : ink.tool === "eraser" ? (
        <div className="h-[52px]" title="なぞった線や文字を消します" />
      ) : (
        <div className="flex h-[52px] items-center justify-center gap-3 overflow-x-auto [scrollbar-width:none]">
          <div className="flex shrink-0 gap-1.5">
            {COLORS.map((c) =>
              swatch(c, ink.color === c, () =>
                change({ color: c }, { color: c }),
              ),
            )}
          </div>
          <span className="h-6 w-px shrink-0 bg-white/20" />
          {isText ? (
            <>
              <div className="flex shrink-0 gap-1">
                {["小", "中", "大"].map((l, i) => (
                  <button
                    key={l}
                    aria-pressed={ink.textSize === i}
                    onClick={() =>
                      change({ textSize: i }, { size: TEXT_SIZES[i] })
                    }
                    className={pill(ink.textSize === i)}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {styleButtons(ink.textStyle, (st) =>
                change({ textStyle: st }, { style: st }),
              )}
              {editingText && (
                <button
                  onClick={deleteText}
                  className="shrink-0 rounded-full px-3 py-1 text-xs font-bold text-[#ff453a] hover:bg-white/10"
                >
                  削除
                </button>
              )}
            </>
          ) : (
            <div className="flex shrink-0 items-center gap-1">
              {PEN_WIDTHS.map((w, i) => (
                <button
                  key={w}
                  aria-label={["細い", "ふつう", "太い"][i]}
                  title={["細い", "ふつう", "太い"][i]}
                  aria-pressed={ink.width === i}
                  onClick={() => setInk({ ...ink, width: i })}
                  className={`grid h-8 w-8 place-items-center rounded-full ${ink.width === i ? "bg-white/15" : "hover:bg-white/10"}`}
                >
                  <span
                    className="block rounded-full"
                    style={{
                      width: 4 + i * 5,
                      height: 4 + i * 5,
                      background: ink.color,
                      opacity: ink.tool === "marker" ? 0.6 : 1,
                      boxShadow: "0 0 0 1px rgba(255,255,255,.35)",
                    }}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type MarkDrag =
  | { type: "stroke"; points: number[] }
  | { type: "erase" }
  /**
   * つかんで動かす（選んでいるものをまとめて）。sx・sy は押した所（枠の上の px）。
   * clicked：押した線や文字。動かさずに離したら、それだけを選び直す
   */
  | {
      type: "grab";
      origs: Mark[];
      sx: number;
      sy: number;
      clicked: string | null;
      cx: number;
      cy: number;
      moved: boolean;
    }
  /** 四隅のつまみで大きさを変える（まとめて）。(ax, ay) は動かさない角、d0 は押した所での長さ（枠の上の px） */
  | {
      type: "scale";
      origs: Mark[];
      ax: number;
      ay: number;
      vx: number;
      vy: number;
      d0: number;
    }
  /** 何もない所からドラッグして囲んで選ぶ。base：前から選んでいたもの（Shift のとき） */
  | { type: "marquee"; sx: number; sy: number; base: string[] }
  | {
      type: "move";
      id: string;
      sx: number;
      sy: number;
      ox: number;
      oy: number;
      px: number;
      py: number;
      moved: boolean;
    };

/**
 * 画像の上で描く・消す・文字を置く層。
 * 位置はすべて「枠の中の位置（0〜1）」で覚える（あとから切り取りを変えても、絵と一緒に動く）
 */
function MarkupLayer({
  edit,
  frame,
  w,
  h,
  ink,
  editingText,
  selected,
  setSelected,
  set,
  apply,
  begin,
  end,
  startText,
  finishText,
  editTextMark,
}: {
  edit: ImageEdit;
  /** 編集中の画像での枠の大きさ（px） */
  frame: { w: number; h: number };
  /** 画面に出している大きさ（px） */
  w: number;
  h: number;
  ink: Ink;
  editingText: string | null;
  set: (e: EditChange) => void;
  apply: (e: EditChange) => void;
  begin: () => void;
  end: () => void;
  startText: (id: string, created?: TextMark) => void;
  finishText: () => void;
  /** 「つかむ」で選んでいる線や文字 */
  selected: string[];
  setSelected: (ids: string[]) => void;
  /** つかんでいる文字を書き直す */
  editTextMark: (id: string) => void;
}) {
  const crop = edit.geo.crop;
  const marks = edit.marks;
  const unit = Math.max(frame.w, frame.h);
  // 編集中の画像の 1px が、画面で何 px か
  const k = w / (crop.w * frame.w);
  const layer = useRef<HTMLDivElement>(null);
  const live = useRef<HTMLCanvasElement>(null);
  const drag = useRef<MarkDrag | null>(null);
  /** 囲んで選んでいる範囲（枠の上の px） */
  const [marquee, setMarquee] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  // 編集画面は押してから開くので、いつもブラウザの中で作られる
  const [dpr] = useState(() => window.devicePixelRatio || 1);
  // 描いている途中の線の層の細かさ。拡大していると大きくなりすぎるので、長い辺 4096px までにする
  const liveScale = Math.min(dpr, 4096 / Math.max(w, h, 1));

  // 描いている途中の線は、上の薄い層に描く。確定して下の画像に描き直されたら（同じ画面の更新で）消す
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const c = live.current;
      c?.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    });
    return () => cancelAnimationFrame(id);
  }, [marks]);

  const toPoint = (e: { clientX: number; clientY: number }) => {
    const r = layer.current!.getBoundingClientRect();
    return {
      u: crop.x + ((e.clientX - r.left) / r.width) * crop.w,
      v: crop.y + ((e.clientY - r.top) / r.height) * crop.h,
    };
  };

  const stroke = (points: number[]): Omit<StrokeMark, "id"> => ({
    kind: ink.tool === "marker" ? "marker" : "pen",
    color: ink.color,
    width: PEN_WIDTHS[ink.width] * (ink.tool === "marker" ? 3 : 1),
    points,
  });

  const drawLive = (points: number[]) => {
    const c = live.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const FW = frame.w * k * liveScale;
    const FH = frame.h * k * liveScale;
    ctx.translate(-crop.x * FW, -crop.y * FH);
    strokePath(ctx, stroke(points), FW, FH);
  };

  /** (u, v) にある、いちばん上の線や文字。reach：画面で何 px 離れていても当たりにするか */
  const markAt = (u: number, v: number, reach: number, only?: Mark["kind"]) =>
    [...(marks ?? [])]
      .reverse()
      .find(
        (m) =>
          (!only || m.kind === only) &&
          hitMark(m, u * frame.w, v * frame.h, frame.w, frame.h, reach / k),
      );
  const textAt = (u: number, v: number) =>
    markAt(u, v, 0, "text") as TextMark | undefined;

  /** 押した所に当たる線や文字を、まるごと消す */
  const eraseAt = (u: number, v: number) => {
    const px = u * frame.w;
    const py = v * frame.h;
    set((e) => ({
      ...e,
      marks: (e.marks ?? []).filter(
        (m) => !hitMark(m, px, py, frame.w, frame.h, 12 / k),
      ),
    }));
  };

  const replaceMarks = (list: Mark[]) => {
    const byId = new Map(list.map((m) => [m.id, m]));
    set((e) => ({
      ...e,
      marks: (e.marks ?? []).map((x) => byId.get(x.id) ?? x),
    }));
  };
  const marksOf = (ids: string[]) =>
    (marks ?? []).filter((m) => ids.includes(m.id));
  const picked = marksOf(selected);

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const { u, v } = toPoint(e);
    if (ink.tool === "grab") {
      const px = u * frame.w;
      const py = v * frame.h;
      const handle = (e.target as HTMLElement).closest<HTMLElement>("[data-h]")
        ?.dataset.h;
      capture(e);
      const grab = (ids: string[], clicked: string | null) => {
        drag.current = {
          type: "grab",
          origs: marksOf(ids),
          sx: px,
          sy: py,
          clicked,
          cx: e.clientX,
          cy: e.clientY,
          moved: false,
        };
        begin();
      };
      if (picked.length && handle && handle !== "move" && !e.shiftKey) {
        // 四隅のつまみ：反対の角を動かさずに、選んでいるものをまとめて大きくする・小さくする
        const b = groupBounds(picked, frame.w, frame.h);
        const ax = handle.includes("w") ? b.x1 : b.x0;
        const ay = handle.includes("n") ? b.y1 : b.y0;
        const vx = (handle.includes("w") ? b.x0 : b.x1) - ax;
        const vy = (handle.includes("n") ? b.y0 : b.y1) - ay;
        const d0 = (px - ax) * vx + (py - ay) * vy;
        if (d0 <= 0) return;
        drag.current = { type: "scale", origs: picked, ax, ay, vx, vy, d0 };
        begin();
        return;
      }
      const hit = markAt(u, v, 8);
      if (e.shiftKey) {
        // Shift+クリック：選ぶものに足す・外す。何もない所からは、囲んで足す
        if (!hit) {
          drag.current = { type: "marquee", sx: px, sy: py, base: selected };
          return;
        }
        const next = selected.includes(hit.id)
          ? selected.filter((x) => x !== hit.id)
          : [...selected, hit.id];
        setSelected(next);
        if (next.includes(hit.id)) grab(next, null);
        return;
      }
      if (hit) {
        // 選んでいるものを押したら、まとめて動かす。ほかを押したら、それだけを選ぶ
        const ids = selected.includes(hit.id) ? selected : [hit.id];
        setSelected(ids);
        grab(ids, hit.id);
      } else if (handle === "move" && picked.length) grab(selected, null);
      else {
        setSelected([]);
        drag.current = { type: "marquee", sx: px, sy: py, base: [] };
      }
      return;
    }
    if (ink.tool === "text") {
      const hit = textAt(u, v);
      if (hit) {
        if (editingText && editingText !== hit.id) finishText();
        capture(e);
        drag.current = {
          type: "move",
          id: hit.id,
          sx: u,
          sy: v,
          ox: hit.x,
          oy: hit.y,
          px: e.clientX,
          py: e.clientY,
          moved: false,
        };
        begin();
      } else if (editingText) finishText();
      else {
        // 押した所に新しい文字を置いて、書き始める
        const id = newId();
        startText(id, {
          id,
          kind: "text",
          text: "",
          color: ink.color,
          size: TEXT_SIZES[ink.textSize],
          style: ink.textStyle,
          x: u,
          y: v,
          rot: 0,
        });
      }
      return;
    }
    capture(e);
    if (ink.tool === "eraser") {
      drag.current = { type: "erase" };
      begin();
      eraseAt(u, v);
      return;
    }
    drag.current = { type: "stroke", points: [u, v] };
    drawLive([u, v]);
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const { u, v } = toPoint(e);
    if (d.type === "stroke") {
      d.points.push(u, v);
      drawLive(d.points);
    } else if (d.type === "erase") eraseAt(u, v);
    else if (d.type === "grab") {
      if (!d.moved && Math.hypot(e.clientX - d.cx, e.clientY - d.cy) < 3)
        return;
      d.moved = true;
      const du = (u * frame.w - d.sx) / frame.w;
      const dv = (v * frame.h - d.sy) / frame.h;
      replaceMarks(d.origs.map((m) => moveMark(m, du, dv)));
    } else if (d.type === "scale") {
      // 押した所からの長さの比で、大きさを決める（画面で 16px より小さくはしない）
      const len = Math.max(Math.abs(d.vx), Math.abs(d.vy));
      const s = Math.max(
        16 / (k * len),
        ((u * frame.w - d.ax) * d.vx + (v * frame.h - d.ay) * d.vy) / d.d0,
      );
      replaceMarks(
        d.origs.map((m) => scaleMark(m, d.ax, d.ay, s, frame.w, frame.h)),
      );
    } else if (d.type === "marquee") {
      // 囲んだ範囲に少しでもかかる線や文字を選ぶ
      const r = {
        x0: Math.min(d.sx, u * frame.w),
        y0: Math.min(d.sy, v * frame.h),
        x1: Math.max(d.sx, u * frame.w),
        y1: Math.max(d.sy, v * frame.h),
      };
      setMarquee(r);
      const hits = (marks ?? [])
        .filter((m) => {
          const b = markBounds(m, frame.w, frame.h);
          return b.x0 <= r.x1 && b.x1 >= r.x0 && b.y0 <= r.y1 && b.y1 >= r.y0;
        })
        .map((m) => m.id);
      setSelected([...new Set([...d.base, ...hits])]);
    } else {
      if (!d.moved && Math.hypot(e.clientX - d.px, e.clientY - d.py) < 4)
        return;
      d.moved = true;
      set((ed) => ({
        ...ed,
        marks: (ed.marks ?? []).map((m) =>
          m.id === d.id && m.kind === "text"
            ? { ...m, x: d.ox + (u - d.sx), y: d.oy + (v - d.sy) }
            : m,
        ),
      }));
    }
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.type === "stroke") {
      const mark: StrokeMark = { id: newId(), ...stroke(d.points) };
      apply((ed) => ({ ...ed, marks: [...(ed.marks ?? []), mark] }));
    } else if (d.type === "erase" || d.type === "scale") end();
    else if (d.type === "grab") {
      end();
      // いくつか選んでいるときに、1つを押して動かさずに離したら、それだけを選び直す
      if (!d.moved && d.clicked && selected.length > 1)
        setSelected([d.clicked]);
    } else if (d.type === "marquee") setMarquee(null);
    else {
      end();
      // 動かさずに押しただけなら、その文字を書き換える
      if (!d.moved) startText(d.id);
    }
  };

  const editing = marks?.find(
    (m): m is TextMark => m.id === editingText && m.kind === "text",
  );

  return (
    <div
      ref={layer}
      data-name="マークアップの層"
      className="absolute inset-0 touch-none"
      style={{
        cursor:
          ink.tool === "text"
            ? "text"
            : ink.tool === "grab"
              ? "default"
              : "crosshair",
      }}
      onPointerDown={onDown}
      onDoubleClick={(e) => {
        // つかむ：文字をダブルクリックすると書き直す
        if (ink.tool !== "grab") return;
        const { u, v } = toPoint(e);
        const hit = textAt(u, v);
        if (hit) editTextMark(hit.id);
      }}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <canvas
        ref={live}
        width={Math.max(1, Math.round(w * liveScale))}
        height={Math.max(1, Math.round(h * liveScale))}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      {ink.tool === "grab" &&
        picked.length > 1 &&
        !editingText &&
        // いくつか選んでいるときは、1つずつの範囲も薄く出す
        picked.map((m) => {
          const b = markBounds(m, frame.w, frame.h);
          return (
            <span
              key={m.id}
              className="pointer-events-none absolute rounded-[3px] border border-white/60"
              style={{
                left: (b.x0 - crop.x * frame.w) * k,
                top: (b.y0 - crop.y * frame.h) * k,
                width: (b.x1 - b.x0) * k,
                height: (b.y1 - b.y0) * k,
              }}
            />
          );
        })}
      {ink.tool === "grab" && picked.length > 0 && !editingText && (
        <SelectionBox
          bounds={groupBounds(picked, frame.w, frame.h)}
          offsetX={crop.x * frame.w}
          offsetY={crop.y * frame.h}
          k={k}
        />
      )}
      {marquee && (
        <span
          data-name="囲んで選ぶ範囲"
          className="pointer-events-none absolute border border-[#0a84ff]"
          style={{
            left: (marquee.x0 - crop.x * frame.w) * k,
            top: (marquee.y0 - crop.y * frame.h) * k,
            width: (marquee.x1 - marquee.x0) * k,
            height: (marquee.y1 - marquee.y0) * k,
            background: "rgba(10,132,255,.15)",
          }}
        />
      )}
      {editing && (
        <TextEditBox
          key={editing.id}
          mark={editing}
          left={((editing.x - crop.x) / crop.w) * w}
          top={((editing.y - crop.y) / crop.h) * h}
          fontPx={editing.size * unit * k}
          onText={(text) =>
            set((ed) => ({
              ...ed,
              marks: (ed.marks ?? []).map((m) =>
                m.id === editing.id && m.kind === "text" ? { ...m, text } : m,
              ),
            }))
          }
        />
      )}
    </div>
  );
}

/** つかんでいる線や文字の枠。中をドラッグで移動、四隅のつまみで大きさを変える */
function SelectionBox({
  bounds,
  offsetX,
  offsetY,
  k,
}: {
  /** 枠の上の px */
  bounds: { x0: number; y0: number; x1: number; y1: number };
  /** 画面に出している範囲の左上（枠の上の px） */
  offsetX: number;
  offsetY: number;
  /** 枠の 1px が画面で何 px か */
  k: number;
}) {
  const pad = 6;
  return (
    <div
      data-h="move"
      data-name="つかんでいるもの"
      className="absolute cursor-move rounded-[4px] border-[1.5px] border-dashed border-white"
      style={{
        left: (bounds.x0 - offsetX) * k - pad,
        top: (bounds.y0 - offsetY) * k - pad,
        width: (bounds.x1 - bounds.x0) * k + pad * 2,
        height: (bounds.y1 - bounds.y0) * k + pad * 2,
        boxShadow: "0 0 0 1px rgba(0,0,0,.45), inset 0 0 0 1px rgba(0,0,0,.45)",
      }}
    >
      {(["nw", "ne", "sw", "se"] as const).map((c) => (
        <span
          key={c}
          data-h={c}
          aria-label="大きさを変える"
          className="absolute grid h-7 w-7 place-items-center"
          style={{
            left: c.includes("w") ? -14 : undefined,
            right: c.includes("e") ? -14 : undefined,
            top: c.includes("n") ? -14 : undefined,
            bottom: c.includes("s") ? -14 : undefined,
            cursor: c === "nw" || c === "se" ? "nwse-resize" : "nesw-resize",
          }}
        >
          <span
            className="pointer-events-none block h-3.5 w-3.5 rounded-full border-2 border-white shadow"
            style={{ background: "#0a84ff" }}
          />
        </span>
      ))}
    </div>
  );
}

/** 書いている文字の入力欄。画像に描くときと同じ見た目で、その場に出す */
function TextEditBox({
  mark,
  left,
  top,
  fontPx,
  onText,
}: {
  mark: TextMark;
  left: number;
  top: number;
  fontPx: number;
  onText: (t: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // 中身は最初に一度だけ入れる（入力のたびに入れ直すと、入力の場所がずれる）
  const initial = useRef(mark.text);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerText = initial.current;
    el.focus();
    const sel = window.getSelection();
    sel?.selectAllChildren(el);
    sel?.collapseToEnd();
  }, []);
  const box = mark.style === "box";
  const contrast = contrastOf(mark.color);
  return (
    <div
      className="absolute"
      style={{
        left,
        top,
        transform: `translate(-50%, -50%) rotate(${mark.rot}rad)`,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        ref={ref}
        role="textbox"
        aria-label="文字"
        aria-multiline="true"
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        onInput={(e) => onText(e.currentTarget.innerText.replace(/\n$/, ""))}
        className="cursor-text text-center whitespace-pre outline-none select-text"
        style={{
          // font でまとめて指定すると、大きさを変えたときに lineHeight とぶつかるので、分けて指定する
          fontWeight: "bold",
          fontSize: fontPx,
          fontFamily: markFont(),
          lineHeight: LINE_HEIGHT,
          minWidth: fontPx * 0.5,
          // 書いている印は白い枠で出すので、アプリのフォーカスの枠は出さない
          outline: "none",
          color: box ? contrast : mark.color,
          background: box ? mark.color : undefined,
          padding: fontPx * (box ? 0.4 : 0.15),
          borderRadius: box ? fontPx * 0.3 : 4,
          WebkitTextStroke:
            mark.style === "outline"
              ? `${fontPx * 0.18}px ${contrast}`
              : undefined,
          paintOrder: "stroke fill",
          boxShadow:
            "0 0 0 1.5px rgba(255,255,255,.85), 0 0 0 3px rgba(0,0,0,.35)",
        }}
      />
    </div>
  );
}

// ---- 共通の部品 ----

/**
 * 確かめる小さな画面。押したボタン（rect）のすぐ下に出す。
 * 赤いボタンで実行、外を押すか Esc でやめる（iPhone の確認と同じ）
 */
function AskPopover({
  rect,
  message,
  ok,
  onAnswer,
}: {
  rect: DOMRect;
  message: string;
  ok: string;
  onAnswer: (v: boolean) => void;
}) {
  const width = 280;
  const left = clamp(
    rect.left + rect.width / 2 - width / 2,
    8,
    window.innerWidth - width - 8,
  );
  // ボタンの真下を指す小さな三角
  const arrow = clamp(rect.left + rect.width / 2 - left, 16, width - 16);
  return (
    <>
      {/* 外を押したらやめる */}
      <div
        className="fixed inset-0 z-[58]"
        onPointerDown={(e) => {
          e.preventDefault();
          onAnswer(false);
        }}
      />
      <div
        role="alertdialog"
        aria-label={ok}
        data-name="確認"
        className="fixed z-[59] animate-[fade_.15s] rounded-[14px] bg-[#2c2c2e] p-1.5 text-white shadow-[0_12px_40px_#000a]"
        style={{ left, top: rect.bottom + 10, width }}
      >
        <span
          className="absolute -top-1.5 h-3 w-3 rotate-45 bg-[#2c2c2e]"
          style={{ left: arrow - 6 }}
        />
        <p className="relative px-3 pt-2 pb-1.5 text-center text-[13px] leading-snug text-balance text-white/70">
          {message}
        </p>
        <button
          autoFocus
          onClick={() => onAnswer(true)}
          className="relative w-full rounded-[10px] px-3 py-2.5 font-bold hover:bg-white/10 focus-visible:bg-white/10"
          style={{ color: RED }}
        >
          {ok}
        </button>
      </div>
    </>
  );
}

/**
 * 横に並べて、選んでいるもの（aria-pressed="true"）をいつも並びの真ん中に出す（調整・フィルタ・切り取りの比で共通）。
 * 開いたときはすぐ、選ぶものが変わったら（押した・取り消したなど）なめらかに寄せる。
 * 両端に半分の幅の余白を入れて、端のものも真ん中まで寄せられるようにする
 */
function CenterRow({
  selected,
  className = "",
  children,
}: {
  selected: string;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRef(false);
  useLayoutEffect(() => {
    const row = ref.current;
    const it = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!row || !it) return;
    row.scrollTo({
      left: it.offsetLeft - (row.clientWidth - it.offsetWidth) / 2,
      behavior: shown.current ? "smooth" : "auto",
    });
    shown.current = true;
  }, [selected]);
  return (
    <div
      ref={ref}
      className={`relative flex overflow-x-auto py-2 [scrollbar-width:none] ${className}`}
    >
      <span className="w-1/2 shrink-0" />
      {children}
      <span className="w-1/2 shrink-0" />
    </div>
  );
}

function HeadIcon({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

/**
 * iPhone の目盛りのダイヤル。左右にドラッグして値を変える（矢印キーでも変えられる）。ダブルクリックで zero に戻す。
 * ppu：1 あたりの幅（px）。minor・major：目盛りを打つ間隔
 */
function Dial({
  label,
  value,
  min,
  max,
  step,
  ppu,
  minor,
  major,
  zero = 0,
  onChange,
  onBegin,
  onEnd,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  ppu: number;
  minor: number;
  major: number;
  zero?: number;
  onChange: (v: number) => void;
  onBegin: () => void;
  onEnd: () => void;
}) {
  const drag = useRef<{ x: number; v: number } | null>(null);
  const snap = (v: number) =>
    clamp(Number((Math.round(v / step) * step).toFixed(2)), min, max);
  const width = (max - min) * ppu;
  const offset = `calc(50% - ${(value - min) * ppu}px)`;
  const stop = () => {
    if (!drag.current) return;
    drag.current = null;
    onEnd();
  };
  const fade =
    "linear-gradient(to right, transparent, #000 22%, #000 78%, transparent)";
  return (
    <div
      role="slider"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      className="relative h-12 w-full cursor-ew-resize touch-none overflow-hidden rounded-[6px]"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        capture(e);
        drag.current = { x: e.clientX, v: value };
        onBegin();
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) onChange(snap(d.v - (e.clientX - d.x) / ppu));
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={() => {
        onBegin();
        onChange(zero);
        onEnd();
      }}
      onKeyDown={(e) => {
        const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        onBegin();
        onChange(snap(value + dir * step * (e.shiftKey ? 10 : 1)));
        onEnd();
      }}
    >
      <div
        className="absolute inset-0"
        style={{ maskImage: fade, WebkitMaskImage: fade }}
      >
        <div
          className="absolute top-1/2 h-3 -translate-y-1/2"
          style={{
            left: offset,
            width: width + 1,
            background: `repeating-linear-gradient(to right, rgba(255,255,255,.45) 0 1px, transparent 1px ${minor * ppu}px)`,
          }}
        />
        <div
          className="absolute top-1/2 h-5 -translate-y-1/2"
          style={{
            left: offset,
            width: width + 1,
            background: `repeating-linear-gradient(to right, rgba(255,255,255,.85) 0 1.5px, transparent 1.5px ${major * ppu}px)`,
          }}
        />
        {zero >= min && zero <= max && (
          <span
            className="absolute top-1 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-white"
            style={{ left: `calc(50% - ${(value - zero) * ppu}px)` }}
          />
        )}
      </div>
      <span
        className="pointer-events-none absolute top-1.5 bottom-1.5 left-1/2 w-[2px] -translate-x-1/2 rounded-full"
        style={{ background: YELLOW }}
      />
    </div>
  );
}
