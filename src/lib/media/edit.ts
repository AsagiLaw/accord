// 画像の編集（iPhone の「写真」の編集と同じ考え方）。
// 元の画像は消さずに残し、編集の内容（調整・フィルタ・切り取り）だけを覚えておく。
// 表示・書き出し用の画像は、元の画像に編集の内容をあてて作り直す。だから何度でも編集し直せて、いつでも元に戻せる

export type AdjustKey =
  | "exposure"
  | "brilliance"
  | "highlights"
  | "shadows"
  | "contrast"
  | "brightness"
  | "blackPoint"
  | "saturation"
  | "vibrance"
  | "warmth"
  | "tint"
  | "sharpness"
  | "definition"
  | "noise"
  | "vignette";

/** 調整の値。どれも -100〜100（シャープネスとノイズ除去は 0〜100）。0 なら何もしない */
export type Adjust = Record<AdjustKey, number>;

export type FilterId =
  | "none"
  | "vivid"
  | "vividWarm"
  | "vividCool"
  | "dramatic"
  | "dramaticWarm"
  | "dramaticCool"
  | "mono"
  | "silvertone"
  | "noir";

/** 切り取りの範囲。向きを変えて傾きを直した画像（枠）の中での位置と大きさ（0〜1） */
export type Rect = { x: number; y: number; w: number; h: number };

export type Geometry = {
  /** 左回りに 90° 回した回数（0〜3） */
  quarter: number;
  /** 左右反転 */
  flip: boolean;
  /** 傾きの補正（度。-45〜45）。傾けた分、すき間が出ないように拡大する */
  angle: number;
  crop: Rect;
  /** 切り取りの縦横比（幅÷高さ）。null なら自由 */
  aspect: number | null;
};

/** マークアップの線（ペン・マーカー）。points は枠の中の位置（0〜1）を x, y の順に並べたもの。width は枠の長い辺に対する割合 */
export type StrokeMark = {
  id: string;
  kind: "pen" | "marker";
  color: string;
  width: number;
  points: number[];
};

/** 文字の見た目：文字だけ・縁取り・背景付き */
export type TextStyle = "plain" | "outline" | "box";

/** マークアップの文字。x, y は文字の真ん中（枠の中の位置 0〜1）。size は枠の長い辺に対する割合。rot は回転（ラジアン） */
export type TextMark = {
  id: string;
  kind: "text";
  text: string;
  color: string;
  size: number;
  style: TextStyle;
  x: number;
  y: number;
  rot: number;
};

export type Mark = StrokeMark | TextMark;

export type ImageEdit = {
  adjust: Adjust;
  filter: FilterId;
  /** フィルタの強さ（0〜100） */
  filterAmount: number;
  geo: Geometry;
  /** マークアップ（ペン・文字）。色の調整やフィルタはかからない。前に保存した編集には無いことがある */
  marks?: Mark[];
};

export const ADJUST_TOOLS: { key: AdjustKey; label: string; min: number }[] = [
  { key: "exposure", label: "露出", min: -100 },
  { key: "brilliance", label: "ブリリアンス", min: -100 },
  { key: "highlights", label: "ハイライト", min: -100 },
  { key: "shadows", label: "シャドウ", min: -100 },
  { key: "contrast", label: "コントラスト", min: -100 },
  { key: "brightness", label: "明るさ", min: -100 },
  { key: "blackPoint", label: "ブラックポイント", min: -100 },
  { key: "saturation", label: "彩度", min: -100 },
  { key: "vibrance", label: "自然な彩度", min: -100 },
  { key: "warmth", label: "暖かみ", min: -100 },
  { key: "tint", label: "色合い", min: -100 },
  { key: "sharpness", label: "シャープネス", min: 0 },
  { key: "definition", label: "精細度", min: -100 },
  { key: "noise", label: "ノイズ除去", min: 0 },
  { key: "vignette", label: "ビネット", min: -100 },
];

const ZERO_ADJUST = Object.fromEntries(
  ADJUST_TOOLS.map((t) => [t.key, 0]),
) as Adjust;

/** フィルタ。調整の値を足す形で表す（強さに合わせて足す量を変える） */
export const FILTERS: {
  id: FilterId;
  label: string;
  preset: Partial<Adjust>;
}[] = [
  { id: "none", label: "オリジナル", preset: {} },
  {
    id: "vivid",
    label: "ビビッド",
    preset: { saturation: 30, vibrance: 25, contrast: 15 },
  },
  {
    id: "vividWarm",
    label: "ビビッド（暖かい）",
    preset: { saturation: 30, vibrance: 25, contrast: 15, warmth: 35 },
  },
  {
    id: "vividCool",
    label: "ビビッド（冷たい）",
    preset: { saturation: 30, vibrance: 25, contrast: 15, warmth: -35 },
  },
  {
    id: "dramatic",
    label: "ドラマチック",
    preset: {
      contrast: 40,
      saturation: -25,
      highlights: -35,
      shadows: -10,
      blackPoint: 10,
    },
  },
  {
    id: "dramaticWarm",
    label: "ドラマチック（暖かい）",
    preset: {
      contrast: 40,
      saturation: -20,
      highlights: -35,
      shadows: -10,
      blackPoint: 10,
      warmth: 40,
    },
  },
  {
    id: "dramaticCool",
    label: "ドラマチック（冷たい）",
    preset: {
      contrast: 40,
      saturation: -20,
      highlights: -35,
      shadows: -10,
      blackPoint: 10,
      warmth: -40,
    },
  },
  { id: "mono", label: "モノ", preset: { saturation: -100 } },
  {
    id: "silvertone",
    label: "シルバートーン",
    preset: {
      saturation: -100,
      contrast: -15,
      brightness: 15,
      highlights: -25,
      shadows: 15,
    },
  },
  {
    id: "noir",
    label: "ノアール",
    preset: {
      saturation: -100,
      contrast: 60,
      blackPoint: 25,
      highlights: 15,
      vignette: 30,
    },
  },
];

export const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };

export function defaultEdit(): ImageEdit {
  return {
    adjust: { ...ZERO_ADJUST },
    filter: "none",
    filterAmount: 100,
    geo: { quarter: 0, flip: false, angle: 0, crop: { ...FULL }, aspect: null },
    marks: [],
  };
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;

export function isFullCrop(r: Rect) {
  return near(r.x, 0) && near(r.y, 0) && near(r.w, 1) && near(r.h, 1);
}

export function isGeoDefault(g: Geometry) {
  return (
    g.quarter % 4 === 0 && !g.flip && near(g.angle, 0) && isFullCrop(g.crop)
  );
}

export function isAdjustDefault(a: Adjust) {
  return ADJUST_TOOLS.every((t) => !a[t.key]);
}

/** 何も編集していない（元の画像のまま） */
export function isDefaultEdit(e: ImageEdit) {
  return (
    isAdjustDefault(e.adjust) &&
    (e.filter === "none" || !e.filterAmount) &&
    isGeoDefault(e.geo) &&
    !e.marks?.length
  );
}

/** フィルタを足した、実際にあてる調整の値 */
export function effectiveAdjust(e: ImageEdit): Adjust {
  const preset = FILTERS.find((f) => f.id === e.filter)?.preset ?? {};
  const k = e.filterAmount / 100;
  const out = { ...e.adjust };
  for (const t of ADJUST_TOOLS)
    out[t.key] = clamp((out[t.key] ?? 0) + (preset[t.key] ?? 0) * k, -100, 100);
  return out;
}

// ---- 向き・傾き・切り取り ----

/** 向きを変えたあとの大きさ（90° か 270° 回したら縦横が入れ替わる） */
export function orientedSize(w: number, h: number, quarter: number) {
  return quarter % 2 ? { w: h, h: w } : { w, h };
}

/** 傾けた画像で枠を埋めるための拡大率 */
export function coverScale(w: number, h: number, angleDeg: number) {
  const a = Math.abs((angleDeg * Math.PI) / 180);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return Math.max((w * cos + h * sin) / w, (w * sin + h * cos) / h);
}

/** 左に 90° 回す（iPhone の回転ボタンと同じ向き）。切り取りの範囲も一緒に回す */
export function rotateLeft(g: Geometry): Geometry {
  const c = g.crop;
  return {
    ...g,
    quarter: (g.quarter + (g.flip ? 3 : 1)) % 4,
    crop: { x: c.y, y: 1 - c.x - c.w, w: c.h, h: c.w },
    aspect: g.aspect ? 1 / g.aspect : null,
  };
}

/** 左右に反転する */
export function flipHorizontal(g: Geometry): Geometry {
  return {
    ...g,
    flip: !g.flip,
    angle: -g.angle,
    crop: { ...g.crop, x: 1 - g.crop.x - g.crop.w },
  };
}

/** 画像を左に 90° 回す（切り取りの範囲・マークアップも一緒に回す） */
export function rotateEditLeft(e: ImageEdit): ImageEdit {
  return {
    ...e,
    geo: rotateLeft(e.geo),
    marks: e.marks?.map((m) =>
      m.kind === "text"
        ? { ...m, x: m.y, y: 1 - m.x, rot: m.rot - Math.PI / 2 }
        : {
            ...m,
            points: m.points.map((v, i) =>
              i % 2 ? 1 - m.points[i - 1] : m.points[i + 1],
            ),
          },
    ),
  };
}

/** 画像を左右に反転する（マークアップは位置だけ反転し、文字は裏返さない） */
export function flipEdit(e: ImageEdit): ImageEdit {
  return {
    ...e,
    geo: flipHorizontal(e.geo),
    marks: e.marks?.map((m) =>
      m.kind === "text"
        ? { ...m, x: 1 - m.x, rot: -m.rot }
        : { ...m, points: m.points.map((v, i) => (i % 2 ? v : 1 - v)) },
    ),
  };
}

/** 縦横比（幅÷高さ）が ratio になる、枠の中でいちばん大きな範囲。今の範囲の真ん中に寄せる */
export function cropForAspect(
  current: Rect,
  ratio: number,
  frameW: number,
  frameH: number,
): Rect {
  // 0〜1 の範囲での縦横比
  const rn = (ratio * frameH) / frameW;
  let w = 1;
  let h = 1 / rn;
  if (h > 1) {
    h = 1;
    w = rn;
  }
  const cx = current.x + current.w / 2;
  const cy = current.y + current.h / 2;
  return {
    x: clamp(cx - w / 2, 0, 1 - w),
    y: clamp(cy - h / 2, 0, 1 - h),
    w,
    h,
  };
}

// ---- 描く ----

type Source = CanvasImageSource & { width: number; height: number };

/**
 * 編集をあてた画像を描く。
 * frame：true なら切り取る前の枠ぜんたい（切り取りの画面用）、false なら切り取った後の画像
 */
export function renderEdit(
  src: Source,
  edit: ImageEdit,
  frame = false,
  target?: HTMLCanvasElement,
  /** 描かないマークアップ（文字を書き換えている間は、上に出す入力欄で見せる） */
  skipMark?: string | null,
  /**
   * 一部分だけを描く（拡大表示で、見えている所だけを細かく描き直す）。
   * rect は枠の中の範囲（0〜1）、scale は src の 1px を何 px にするか
   */
  view?: { rect: Rect; scale: number },
): HTMLCanvasElement {
  const g = edit.geo;
  const { w: W, h: H } = orientedSize(src.width, src.height, g.quarter);
  const region = view?.rect ?? (frame ? FULL : g.crop);
  const sc = view?.scale ?? 1;
  const outW = Math.max(1, Math.round(region.w * W * sc));
  const outH = Math.max(1, Math.round(region.h * H * sc));
  const canvas = target ?? document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.save();
  ctx.scale(sc, sc);
  ctx.translate(-region.x * W + W / 2, -region.y * H + H / 2);
  ctx.rotate((g.angle * Math.PI) / 180);
  const s = coverScale(W, H, g.angle);
  ctx.scale(s, s);
  if (g.flip) ctx.scale(-1, 1);
  ctx.rotate((-g.quarter * Math.PI) / 2);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  ctx.restore();

  const a = effectiveAdjust(edit);
  if (!isAdjustDefault(a)) {
    // ビネットは切り取った範囲に合わせる（描いている範囲の上での位置にする）
    const vig = {
      x: (g.crop.x - region.x) * W * sc,
      y: (g.crop.y - region.y) * H * sc,
      w: g.crop.w * W * sc,
      h: g.crop.h * H * sc,
    };
    const img = ctx.getImageData(0, 0, outW, outH);
    applyAdjust(img, a, Math.max(W, H) * sc, vig);
    ctx.putImageData(img, 0, 0);
  }
  if (edit.marks?.length) {
    ctx.save();
    ctx.scale(sc, sc);
    ctx.translate(-region.x * W, -region.y * H);
    drawMarks(ctx, edit.marks, W, H, skipMark);
    ctx.restore();
  }
  return canvas;
}

// ---- マークアップ ----

/** 文字の書体（アプリと同じ書体） */
export function markFont() {
  return typeof document === "undefined"
    ? "sans-serif"
    : getComputedStyle(document.body).fontFamily || "sans-serif";
}

/** 文字の行の高さ（文字の大きさに対する割合） */
export const LINE_HEIGHT = 1.25;

/** 色に重ねて読みやすい色（白か黒） */
export function contrastOf(color: string) {
  const n = parseInt(color.replace("#", ""), 16);
  const L =
    0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return L > 150 ? "#000000" : "#ffffff";
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** 文字の大きさ（px）での、文字の箱の幅と高さ（背景付きなら余白も含む） */
export function textBox(m: TextMark, fontPx: number) {
  measureCtx ??= document.createElement("canvas").getContext("2d")!;
  measureCtx.font = `bold ${fontPx}px ${markFont()}`;
  const lines = m.text.split(/\r?\n/);
  const w = Math.max(
    fontPx * 0.5,
    ...lines.map((l) => measureCtx!.measureText(l).width),
  );
  const pad = m.style === "box" ? fontPx * 0.4 : fontPx * 0.15;
  return { w: w + pad * 2, h: lines.length * fontPx * LINE_HEIGHT + pad * 2 };
}

// 位置と大きさはどれも、枠の大きさ W・H（px）の上の px で考える（枠の中の位置 0〜1 のままだと、縦横で長さが違うため）

/** マークアップが入っている範囲。線は太さの分も、回した文字は回した後の範囲を含む */
export function markBounds(m: Mark, W: number, H: number) {
  const unit = Math.max(W, H);
  if (m.kind === "text") {
    const b = textBox(m, m.size * unit);
    const c = Math.abs(Math.cos(m.rot));
    const s = Math.abs(Math.sin(m.rot));
    const hw = (b.w * c + b.h * s) / 2;
    const hh = (b.w * s + b.h * c) / 2;
    return {
      x0: m.x * W - hw,
      y0: m.y * H - hh,
      x1: m.x * W + hw,
      y1: m.y * H + hh,
    };
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < m.points.length; i += 2) {
    x0 = Math.min(x0, m.points[i] * W);
    x1 = Math.max(x1, m.points[i] * W);
    y0 = Math.min(y0, m.points[i + 1] * H);
    y1 = Math.max(y1, m.points[i + 1] * H);
  }
  const r = (m.width * unit) / 2;
  return { x0: x0 - r, y0: y0 - r, x1: x1 + r, y1: y1 + r };
}

/** いくつかのマークアップをまとめて囲む範囲（1つ以上渡すこと） */
export function groupBounds(marks: Mark[], W: number, H: number) {
  return marks
    .map((m) => markBounds(m, W, H))
    .reduce((a, b) => ({
      x0: Math.min(a.x0, b.x0),
      y0: Math.min(a.y0, b.y0),
      x1: Math.max(a.x1, b.x1),
      y1: Math.max(a.y1, b.y1),
    }));
}

/** 点から線分までの距離 */
function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? clamp(((px - ax) * dx + (py - ay) * dy) / len, 0, 1) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** (px, py) がマークアップに当たるか。reach：線や文字の箱から、どれだけ離れていても当たりにするか */
export function hitMark(
  m: Mark,
  px: number,
  py: number,
  W: number,
  H: number,
  reach: number,
) {
  const unit = Math.max(W, H);
  if (m.kind === "text") {
    if (!m.text.trim()) return false;
    const b = textBox(m, m.size * unit);
    const dx = px - m.x * W;
    const dy = py - m.y * H;
    const lx = dx * Math.cos(m.rot) + dy * Math.sin(m.rot);
    const ly = -dx * Math.sin(m.rot) + dy * Math.cos(m.rot);
    return Math.abs(lx) <= b.w / 2 + reach && Math.abs(ly) <= b.h / 2 + reach;
  }
  const p = m.points;
  const r = reach + (m.width * unit) / 2;
  for (let i = 0; i < p.length; i += 2) {
    const ax = p[i] * W;
    const ay = p[i + 1] * H;
    const bx = (p[i + 2] ?? p[i]) * W;
    const by = (p[i + 3] ?? p[i + 1]) * H;
    if (distToSegment(px, py, ax, ay, bx, by) <= r) return true;
  }
  return false;
}

/** 動かす。du・dv は枠の中の位置（0〜1）での動かす量 */
export function moveMark(m: Mark, du: number, dv: number): Mark {
  return m.kind === "text"
    ? { ...m, x: m.x + du, y: m.y + dv }
    : { ...m, points: m.points.map((p, i) => p + (i % 2 ? dv : du)) };
}

/** 大きさを s 倍にする。(ax, ay) の点は動かさない。線は太さも、文字は文字の大きさも一緒に変える */
export function scaleMark(
  m: Mark,
  ax: number,
  ay: number,
  s: number,
  W: number,
  H: number,
): Mark {
  const sx = (u: number) => (ax + (u * W - ax) * s) / W;
  const sy = (v: number) => (ay + (v * H - ay) * s) / H;
  return m.kind === "text"
    ? { ...m, x: sx(m.x), y: sy(m.y), size: m.size * s }
    : {
        ...m,
        width: m.width * s,
        points: m.points.map((p, i) => (i % 2 ? sy(p) : sx(p))),
      };
}

/** マークアップを描く。ctx の原点は枠の左上、W・H は枠の大きさ（px） */
export function drawMarks(
  ctx: CanvasRenderingContext2D,
  marks: Mark[],
  W: number,
  H: number,
  skip?: string | null,
) {
  const unit = Math.max(W, H);
  for (const m of marks) {
    if (m.id === skip) continue;
    ctx.save();
    if (m.kind === "text") {
      if (!m.text.trim()) {
        ctx.restore();
        continue;
      }
      const px = m.size * unit;
      ctx.translate(m.x * W, m.y * H);
      ctx.rotate(m.rot);
      ctx.font = `bold ${px}px ${markFont()}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lines = m.text.split(/\r?\n/);
      const top = (-(lines.length - 1) * px * LINE_HEIGHT) / 2;
      if (m.style === "box") {
        const b = textBox(m, px);
        ctx.fillStyle = m.color;
        ctx.beginPath();
        ctx.roundRect(-b.w / 2, -b.h / 2, b.w, b.h, px * 0.3);
        ctx.fill();
      }
      lines.forEach((line, i) => {
        const y = top + i * px * LINE_HEIGHT;
        if (m.style === "outline") {
          ctx.lineJoin = "round";
          ctx.lineWidth = px * 0.18;
          ctx.strokeStyle = contrastOf(m.color);
          ctx.strokeText(line, 0, y);
        }
        ctx.fillStyle = m.style === "box" ? contrastOf(m.color) : m.color;
        ctx.fillText(line, 0, y);
      });
    } else {
      strokePath(ctx, m, W, H, unit);
    }
    ctx.restore();
  }
}

/** 線を、点の間をなめらかにつないで描く（マーカーは1本の中で色が重ならないよう、まとめて半透明に） */
export function strokePath(
  ctx: CanvasRenderingContext2D,
  m: Pick<StrokeMark, "kind" | "color" | "width" | "points">,
  W: number,
  H: number,
  unit = Math.max(W, H),
) {
  const p = m.points;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = m.color;
  ctx.fillStyle = m.color;
  ctx.lineWidth = m.width * unit;
  ctx.globalAlpha = m.kind === "marker" ? 0.4 : 1;
  ctx.beginPath();
  if (p.length <= 2) {
    ctx.arc(p[0] * W, p[1] * H, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.moveTo(p[0] * W, p[1] * H);
  for (let i = 2; i < p.length - 2; i += 2) {
    const mx = ((p[i] + p[i + 2]) / 2) * W;
    const my = ((p[i + 1] + p[i + 3]) / 2) * H;
    ctx.quadraticCurveTo(p[i] * W, p[i + 1] * H, mx, my);
  }
  ctx.lineTo(p[p.length - 2] * W, p[p.length - 1] * H);
  ctx.stroke();
}

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const toLinear = (v: number) =>
  v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
const toSrgb = (v: number) =>
  v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;

/** 色ごとにあてる明るさの曲線（露出・明るさ・コントラスト・ブラックポイント） */
function toneCurve(a: Adjust) {
  const ex = a.exposure / 100;
  const br = a.brightness / 100;
  const ct = a.contrast / 100;
  const bp = (a.blackPoint / 100) * 0.2;
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    let v = i / 255;
    if (ex) v = toSrgb(Math.min(1, toLinear(v) * Math.pow(2, ex * 1.6)));
    if (br) v = Math.pow(v, Math.pow(2, -br * 0.8));
    if (ct > 0) v = v + (v * v * (3 - 2 * v) - v) * ct * 1.4;
    else if (ct < 0) v = 0.5 + (v - 0.5) * (1 + ct * 0.6);
    if (bp > 0) v = (v - bp) / (1 - bp);
    else if (bp < 0) v = -bp + v * (1 + bp);
    lut[i] = clamp(v, 0, 1) * 255;
  }
  return lut;
}

/** 明るさごとにあてる曲線（ハイライト・シャドウ・ブリリアンス）。暗くするときは掛け算、明るくするときは白へ寄せる */
function lumaCurve(a: Adjust) {
  const sh = a.shadows / 100 + (a.brilliance / 100) * 0.7;
  const hl = a.highlights / 100 - (a.brilliance / 100) * 0.6;
  const mul = new Float32Array(256);
  const lift = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const L = i / 255;
    const wS = 1 - smooth(0, 0.6, L);
    const wH = smooth(0.4, 1, L);
    let d = 0;
    d += sh > 0 ? sh * 0.38 * wS * (1 - L) : sh * 0.5 * wS * L;
    d += hl > 0 ? hl * 0.3 * wH * (1 - L) : hl * 0.45 * wH * L;
    const L2 = clamp(L + d, 0, 1);
    mul[i] = d < 0 && L > 0.002 ? L2 / L : 1;
    lift[i] = d > 0 && L < 0.998 ? d / (1 - L) : 0;
  }
  return { mul, lift };
}

function applyAdjust(
  img: ImageData,
  a: Adjust,
  size: number,
  vig: { x: number; y: number; w: number; h: number },
) {
  const { data, width: w, height: h } = img;
  const n = w * h * 4;
  // 細かさの調整（ノイズ除去・シャープネス・精細度）は、ぼかした画像との差で作る。半径は画像の大きさに合わせる（プレビューと保存で同じ見た目にする）
  const nr = (a.noise / 100) * 0.75;
  const sp = (a.sharpness / 100) * 1.5;
  const df = (a.definition / 100) * 0.6;
  const smallBlur =
    nr || sp ? boxBlur(data, w, h, Math.max(1, Math.round(size / 1400))) : null;
  const wideBlur = df
    ? boxBlur(data, w, h, Math.max(2, Math.round(size * 0.015)))
    : null;

  const tone = toneCurve(a);
  const { mul, lift } = lumaCurve(a);
  const sat = a.saturation / 100;
  const vib = a.vibrance / 100;
  const wr = 1 + (a.warmth / 100) * 0.14 + (a.tint / 100) * 0.05;
  const wg = 1 - (a.tint / 100) * 0.1;
  const wb = 1 - (a.warmth / 100) * 0.14 + (a.tint / 100) * 0.05;
  const vg = a.vignette / 100;
  const cx = vig.x + vig.w / 2;
  const cy = vig.y + vig.h / 2;
  const rx = vig.w / 2;
  const ry = vig.h / 2;

  for (let i = 0; i < n; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    if (smallBlur) {
      const br = smallBlur[i];
      const bg = smallBlur[i + 1];
      const bb = smallBlur[i + 2];
      const or = r;
      const og = g;
      const ob = b;
      if (nr) {
        r += (br - r) * nr;
        g += (bg - g) * nr;
        b += (bb - b) * nr;
      }
      if (sp) {
        r += (or - br) * sp;
        g += (og - bg) * sp;
        b += (ob - bb) * sp;
      }
    }
    if (wideBlur) {
      r += (data[i] - wideBlur[i]) * df;
      g += (data[i + 1] - wideBlur[i + 1]) * df;
      b += (data[i + 2] - wideBlur[i + 2]) * df;
    }
    r = tone[r < 0 ? 0 : r > 255 ? 255 : r | 0];
    g = tone[g < 0 ? 0 : g > 255 ? 255 : g | 0];
    b = tone[b < 0 ? 0 : b > 255 ? 255 : b | 0];

    let L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const li = L | 0;
    const m = mul[li];
    const l = lift[li];
    if (m !== 1 || l) {
      r = r * m + (255 - r) * l;
      g = g * m + (255 - g) * l;
      b = b * m + (255 - b) * l;
    }

    if (sat || vib) {
      L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const mx = r > g ? (r > b ? r : b) : g > b ? g : b;
      const mn = r < g ? (r < b ? r : b) : g < b ? g : b;
      // 自然な彩度：色の薄いところほど強く効かせる
      const f = (1 + sat) * (1 + vib * (1 - (mx - mn) / 255));
      r = L + (r - L) * f;
      g = L + (g - L) * f;
      b = L + (b - L) * f;
    }
    r *= wr;
    g *= wg;
    b *= wb;

    if (vg) {
      const p = i >> 2;
      const dx = ((p % w) - cx) / rx;
      const dy = (((p / w) | 0) - cy) / ry;
      const t = smooth(0.45, 1.45, Math.sqrt(dx * dx + dy * dy));
      if (vg > 0) {
        const k = 1 - vg * 0.75 * t;
        r *= k;
        g *= k;
        b *= k;
      } else {
        const k = -vg * 0.6 * t;
        r += (255 - r) * k;
        g += (255 - g) * k;
        b += (255 - b) * k;
      }
    }
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}

/** ぼかした画像（箱型のぼかしを2回。ほぼガウスぼかしになる） */
function boxBlur(src: Uint8ClampedArray, w: number, h: number, r: number) {
  const a = new Uint8ClampedArray(src.length);
  const b = new Uint8ClampedArray(src.length);
  blurPass(src, a, w, h, r, true);
  blurPass(a, b, w, h, r, false);
  blurPass(b, a, w, h, r, true);
  blurPass(a, b, w, h, r, false);
  return b;
}

function blurPass(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  w: number,
  h: number,
  r: number,
  horizontal: boolean,
) {
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const step = horizontal ? 4 : w * 4;
  const lineStep = horizontal ? w * 4 : 4;
  const norm = 1 / (2 * r + 1);
  const last = len - 1;
  for (let l = 0; l < lines; l++) {
    const base = l * lineStep;
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let k = -r; k <= r; k++)
        sum += src[base + (k < 0 ? 0 : k > last ? last : k) * step + c];
      for (let i = 0; i < len; i++) {
        dst[base + i * step + c] = sum * norm;
        const add = i + r + 1 > last ? last : i + r + 1;
        const rem = i - r < 0 ? 0 : i - r;
        sum += src[base + add * step + c] - src[base + rem * step + c];
      }
    }
  }
}

/** 「自動」：明るさの分布から、ちょうどよさそうな調整の値を出す */
export function autoAdjust(src: Source): Partial<Adjust> {
  const s = Math.min(1, 256 / Math.max(src.width, src.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(src.width * s));
  c.height = Math.max(1, Math.round(src.height * s));
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const hist = new Uint32Array(256);
  let sum = 0;
  let sat = 0;
  const count = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    const L = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) | 0;
    hist[L]++;
    sum += L;
    sat +=
      Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
  }
  const pct = (p: number) => {
    let acc = 0;
    for (let i = 0; i < 256; i++)
      if ((acc += hist[i]) >= count * p) return i / 255;
    return 1;
  };
  const mean = sum / count / 255;
  const lo = pct(0.01);
  const hi = pct(0.99);
  const round = (v: number, lo: number, hi: number) =>
    Math.round(clamp(v, lo, hi));
  return {
    exposure: round((0.48 - mean) * 110, -40, 40),
    brilliance: 15,
    highlights: hi > 0.96 ? -25 : 0,
    shadows: mean < 0.4 ? 20 : 8,
    contrast: round((0.85 - (hi - lo)) * 40, 0, 25),
    blackPoint: round((lo - 0.02) * 250, 0, 30),
    vibrance: round((60 - sat / count) * 0.4, 0, 20),
  };
}
