// PSD（Photoshop の画像。大きいサイズの PSB も）を読む。ブラウザは PSD をそのまま表示できないので、ここで1枚の絵（ImageData）にする。
// ファイルに入っている「統合した画像」を使う。それが無いファイル（「互換性を優先」を切って保存したもの）は、レイヤーを重ねて作る
// （調整レイヤー・レイヤー効果・一部の描画モードは再現しないので、Photoshop の見た目と少し違うことがある）

export const PSD_MIME = "image/vnd.adobe.photoshop";

/** ファイル名や形式から、PSD か。形式が空のこともある（Photoshop が入っていない Windows など）ので、拡張子でも見る */
export function isPsdFile(file: { name: string; type: string }) {
  return file.type === PSD_MIME || /\.ps[db]$/i.test(file.name);
}

/** 中身が PSD か（先頭が「8BPS」） */
export async function isPsd(blob: Blob) {
  if (blob.size < 26) return false;
  return new DataView(await blob.slice(0, 4).arrayBuffer()).getUint32(0) === 0x38425053;
}

export type PsdImage = {
  image: ImageData;
  /** 解像度（dpi）。記録が無ければ 0 */
  dpi: number;
  /** 埋め込まれたカラープロファイル（ICC）。無ければ null */
  icc: Uint8Array | null;
};

/** 色の決まり（Color Mode）ごとの、色のチャンネルの数 */
const COLOR_CHANNELS: Record<number, number> = { 0: 1, 1: 1, 2: 1, 3: 3, 4: 4, 8: 1, 9: 3 };
const MULTICHANNEL = 7;

/** PSB で長さが 8 バイトになる、追加の情報の種類 */
const LARGE_KEYS = ["LMsk", "Lr16", "Lr32", "Layr", "Mt16", "Mt32", "Mtrn", "Alph", "FMsk", "lnk2", "FEid", "FXid", "PxSD"];

class Reader {
  readonly v: DataView;
  p = 0;
  /** PSB（長さの欄が 8 バイトのところがある） */
  big = false;
  constructor(readonly b: Uint8Array) {
    this.v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  u8() {
    return this.v.getUint8(this.p++);
  }
  u16() {
    const x = this.v.getUint16(this.p);
    this.p += 2;
    return x;
  }
  i16() {
    const x = this.v.getInt16(this.p);
    this.p += 2;
    return x;
  }
  u32() {
    const x = this.v.getUint32(this.p);
    this.p += 4;
    return x;
  }
  i32() {
    const x = this.v.getInt32(this.p);
    this.p += 4;
    return x;
  }
  /** 長さの欄（PSB では 8 バイト） */
  len(large = this.big) {
    return large ? this.u32() * 2 ** 32 + this.u32() : this.u32();
  }
  str4() {
    const b = this.b;
    const p = (this.p += 4) - 4;
    return String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
  }
}

type Header = { channels: number; height: number; width: number; depth: number; mode: number };

function readHeader(r: Reader): Header {
  if (r.u32() !== 0x38425053) throw new Error("PSD ではありません");
  const version = r.u16();
  if (version !== 1 && version !== 2) throw new Error("この PSD の版には対応していません");
  r.big = version === 2;
  r.p += 6;
  const h = { channels: r.u16(), height: r.u32(), width: r.u32(), depth: r.u16(), mode: r.u16() };
  if (!(h.mode in COLOR_CHANNELS) && h.mode !== MULTICHANNEL) throw new Error("この色の形式の PSD には対応していません");
  if (![1, 8, 16, 32].includes(h.depth)) throw new Error("このビット数の PSD には対応していません");
  if (!h.width || !h.height) throw new Error("大きさが 0 の PSD です");
  return h;
}

// ---- 画像の情報（Image Resources） ----

type Resources = Map<number, Uint8Array>;

function readResources(b: Uint8Array): Resources {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Resources = new Map();
  let q = 0;
  while (q + 12 <= b.length) {
    const id = v.getUint16(q + 4);
    // 名前（長さ＋文字。合わせて偶数の長さにそろえてある）
    const nameLen = 1 + v.getUint8(q + 6);
    const at = q + 6 + nameLen + (nameLen % 2);
    if (at + 4 > b.length) break;
    const size = v.getUint32(at);
    out.set(id, b.subarray(at + 4, at + 4 + size));
    q = at + 4 + size + (size % 2);
  }
  return out;
}

/** 解像度（ResolutionInfo・0x03ED）。値はいつも「1インチあたり」で、16.16 の固定小数で入っている */
function dpiOf(res: Resources) {
  const d = res.get(0x03ed);
  return d && d.length >= 4 ? Math.round(new DataView(d.buffer, d.byteOffset).getUint32(0) / 65536) : 0;
}

const iccOf = (res: Resources) => res.get(0x040f) ?? null;

/** 解像度とカラープロファイルだけを読む（全体は読まない） */
export async function readPsdInfo(blob: Blob): Promise<{ dpi: number; icc: Uint8Array | null }> {
  const head = new DataView(await blob.slice(0, 30).arrayBuffer());
  const at = 30 + head.getUint32(26);
  const len = new DataView(await blob.slice(at, at + 4).arrayBuffer()).getUint32(0);
  const res = readResources(new Uint8Array(await blob.slice(at + 4, at + 4 + len).arrayBuffer()));
  return { dpi: dpiOf(res), icc: iccOf(res) };
}

// ---- 全体を読む ----

export async function decodePsd(blob: Blob): Promise<PsdImage> {
  const r = new Reader(new Uint8Array(await blob.arrayBuffer()));
  const h = readHeader(r);
  const colorData = r.b.subarray(r.p + 4, r.p + 4 + r.v.getUint32(r.p));
  r.p += 4 + colorData.length;
  const resLen = r.u32();
  const res = readResources(r.b.subarray(r.p, r.p + resLen));
  r.p += resLen;
  const lmLen = r.len();
  const lmEnd = r.p + lmLen;
  const layers = lmLen ? readLayerSection(r, lmEnd) : { count: 0, layers: [] };
  r.p = lmEnd;

  const { width: w, height: hh, mode, depth } = h;
  const n = w * hh;
  const colors = mode === MULTICHANNEL ? 1 : COLOR_CHANNELS[mode];
  // 「統合した画像」が本物か（Version Info・0x0421）。「互換性を優先」を切って保存すると、中身の無い画像が入っている
  const version = res.get(0x0421);
  const realMerged = !version || version.length < 5 || version[4] !== 0;
  const palette = mode === 2 ? colorData : undefined;

  let rgba: Uint8ClampedArray;
  if (realMerged || !layers.layers.length) {
    // 色のチャンネルの後ろのチャンネルが透明度なのは、レイヤーの数が負の数で記録されているとき。
    // レイヤーの無いファイルは、名前の付いたチャンネル（保存した選択範囲など）でなければ透明度とみなす
    const extra = mode !== MULTICHANNEL && h.channels > colors;
    const hasAlpha = extra && (layers.count < 0 || (!layers.count && !res.has(0x03ee) && !res.has(0x0415)));
    const raw = await readRaw(r.b, r.p, r.b.length, w, hh, depth, colors + (hasAlpha ? 1 : 0), h.channels, r.big);
    const planes = raw.map((p, i) => to8(p, w, hh, depth, i >= colors));
    rgba = toRgba(planes.slice(0, colors), hasAlpha ? planes[colors] : null, n, mode, palette);
    if (hasAlpha) removeWhiteMatte(rgba);
    // インデックスカラーの透明にする色（Transparency Index・0x0417）
    const ti = res.get(0x0417);
    if (palette && ti && ti.length >= 2) {
      const index = (ti[0] << 8) | ti[1];
      const p0 = planes[0];
      for (let i = 0; i < n; i++) if (p0[i] === index) rgba[i * 4 + 3] = 0;
    }
  } else {
    rgba = await renderLayers(r, h, layers.layers);
  }
  return { image: new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, w, hh), dpi: dpiOf(res), icc: iccOf(res) };
}

/**
 * Photoshop の統合した画像は、透けている所の色が白と混ぜてあるので、元の色に戻す
 * （色 = 元の色 × 不透明度 ＋ 白 × (1 − 不透明度)）
 */
function removeWhiteMatte(d: Uint8ClampedArray) {
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (!a || a === 255) continue;
    const k = 255 / a;
    d[i] = (d[i] - 255 + a) * k;
    d[i + 1] = (d[i + 1] - 255 + a) * k;
    d[i + 2] = (d[i + 2] - 255 + a) * k;
  }
}

// ---- チャンネルの中身 ----

/** at から size バイト。ファイルが途中で切れていても、決まった大きさで返す（足りない所は 0） */
function slice(b: Uint8Array, at: number, size: number) {
  if (at + size <= b.length) return b.subarray(at, at + size);
  const out = new Uint8Array(size);
  if (at < b.length) out.set(b.subarray(at));
  return out;
}

/**
 * at（圧縮の方法の欄）から、チャンネルの中身を count 枚読む（そのままのバイトの並び）。
 * 統合した画像は total 枚のチャンネルが続けて入っていて、レイヤーは1チャンネルずつ入っている。
 * 圧縮の方法：0 そのまま・1 RLE（PackBits）・2 ZIP・3 予測付きの ZIP
 */
async function readRaw(b: Uint8Array, at: number, end: number, w: number, h: number, depth: number, count: number, total: number, big: boolean) {
  const comp = (b[at] << 8) | b[at + 1];
  let p = at + 2;
  const rowBytes = Math.ceil((w * depth) / 8);
  const size = rowBytes * h;
  const out: Uint8Array[] = [];
  if (comp === 0) {
    for (let c = 0; c < count; c++) out.push(slice(b, p + c * size, size));
  } else if (comp === 1) {
    // 先に全部の行の長さが並び（PSB は 4 バイト、PSD は 2 バイト）、そのあとに中身が続く
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const cw = big ? 4 : 2;
    const counts = p;
    p += total * h * cw;
    for (let c = 0; c < count; c++) {
      const plane = new Uint8Array(size);
      for (let y = 0; y < h; y++) {
        const k = counts + (c * h + y) * cw;
        if (k + cw > b.length) break;
        const len = big ? v.getUint32(k) : v.getUint16(k);
        unpackBits(b, p, Math.min(p + len, b.length), plane, y * rowBytes, rowBytes);
        p += len;
      }
      out.push(plane);
    }
  } else if (comp === 2 || comp === 3) {
    const all = await inflate(b.subarray(p, end));
    for (let c = 0; c < count; c++) {
      const plane = slice(all, c * size, size);
      if (comp === 3) unpredict(plane, w, h, depth);
      out.push(plane);
    }
  } else {
    throw new Error("この圧縮の方法には対応していません");
  }
  return out;
}

/** PackBits：先頭の数が 0〜127 なら、続く n+1 バイトをそのまま。129〜255 なら、次の1バイトを 257−n 回くり返す */
function unpackBits(src: Uint8Array, p: number, end: number, out: Uint8Array, o: number, n: number) {
  const stop = o + n;
  while (p < end && o < stop) {
    const c = src[p++];
    if (c < 128) {
      const k = Math.min(c + 1, stop - o);
      out.set(src.subarray(p, p + k), o);
      p += c + 1;
      o += k;
    } else if (c > 128) {
      const k = Math.min(257 - c, stop - o);
      out.fill(src[p++], o, o + k);
      o += k;
    }
  }
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 予測付きの ZIP：行ごとに、1つ前との差で入っているのを戻す。32 ビットは、さらにバイトの順が並べ替えてある */
function unpredict(d: Uint8Array, w: number, h: number, depth: number) {
  if (depth === 8) {
    for (let y = 0; y < h; y++) for (let x = y * w + 1, e = (y + 1) * w; x < e; x++) d[x] = (d[x] + d[x - 1]) & 0xff;
  } else if (depth === 16) {
    for (let y = 0; y < h; y++) {
      let prev = (d[y * w * 2] << 8) | d[y * w * 2 + 1];
      for (let x = 1; x < w; x++) {
        const i = (y * w + x) * 2;
        prev = (prev + ((d[i] << 8) | d[i + 1])) & 0xffff;
        d[i] = prev >> 8;
        d[i + 1] = prev & 0xff;
      }
    }
  } else if (depth === 32) {
    const row = new Uint8Array(w * 4);
    for (let y = 0; y < h; y++) {
      const at = y * w * 4;
      for (let x = 1; x < w * 4; x++) d[at + x] = (d[at + x] + d[at + x - 1]) & 0xff;
      // 1行の中で「全部の画素の1バイト目」「2バイト目」…の順に並んでいるのを、画素ごとに戻す
      row.set(d.subarray(at, at + w * 4));
      for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) d[at + x * 4 + k] = row[k * w + x];
    }
  }
}

let srgbLut: Uint8Array | undefined;

/**
 * 1画素1バイト（0〜255）にする。16 ビットは上の桁だけ使う。
 * 32 ビットは 0〜1 の小数で、色はガンマのかかっていない値なので、sRGB のガンマをかける（linear：透明度・マスクはそのまま）
 */
function to8(raw: Uint8Array, w: number, h: number, depth: number, linear: boolean): Uint8Array {
  if (depth === 8) return raw;
  const n = w * h;
  const out = new Uint8Array(n);
  if (depth === 16) {
    for (let i = 0; i < n; i++) out[i] = raw[i * 2];
  } else if (depth === 32) {
    const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    srgbLut ??= Uint8Array.from({ length: 4096 }, (_, i) => Math.round(255 * gamma(i / 4095)));
    for (let i = 0; i < n; i++) {
      const f = Math.min(1, Math.max(0, v.getFloat32(i * 4) || 0));
      out[i] = linear ? Math.round(f * 255) : srgbLut[Math.round(f * 4095)];
    }
  } else {
    // 1 ビット（白黒の画像）：1 が黒
    const rowBytes = Math.ceil(w / 8);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = raw[y * rowBytes + (x >> 3)] & (0x80 >> (x & 7)) ? 0 : 255;
  }
  return out;
}

const gamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** 色のチャンネル（と透明度）から、RGBA の画素を作る。CMYK は簡単な計算で RGB にする（カラープロファイルは使わない） */
function toRgba(planes: Uint8Array[], alpha: Uint8Array | null, n: number, mode: number, palette?: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(n * 4);
  const [c0, c1, c2, c3] = planes;
  if (mode === 3) {
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      out[o] = c0[i];
      out[o + 1] = c1[i];
      out[o + 2] = c2[i];
    }
  } else if (mode === 4) {
    // PSD の CMYK は、インクの量を反対にした値（255 がインク無し）で入っている
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      const k = c3[i] / 255;
      out[o] = c0[i] * k;
      out[o + 1] = c1[i] * k;
      out[o + 2] = c2[i] * k;
    }
  } else if (mode === 9) {
    for (let i = 0, o = 0; i < n; i++, o += 4) labToRgb(c0[i], c1[i], c2[i], out, o);
  } else if (mode === 2 && palette) {
    // インデックスカラー：色の表は R が 256 色、G が 256 色、B が 256 色の順
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      const x = c0[i];
      out[o] = palette[x];
      out[o + 1] = palette[256 + x];
      out[o + 2] = palette[512 + x];
    }
  } else {
    // グレー・白黒・ダブルトーン・マルチチャンネル（最初のチャンネルを濃淡として見せる）
    for (let i = 0, o = 0; i < n; i++, o += 4) out[o] = out[o + 1] = out[o + 2] = c0[i];
  }
  for (let i = 0, o = 3; i < n; i++, o += 4) out[o] = alpha ? alpha[i] : 255;
  return out;
}

/** Lab（D50）を sRGB にする */
function labToRgb(l8: number, a8: number, b8: number, out: Uint8ClampedArray, o: number) {
  const fy = ((l8 * 100) / 255 + 16) / 116;
  const fx = fy + (a8 - 128) / 500;
  const fz = fy - (b8 - 128) / 200;
  const f = (t: number) => (t > 6 / 29 ? t * t * t : 3 * (6 / 29) ** 2 * (t - 4 / 29));
  const x = 0.96422 * f(fx);
  const y = f(fy);
  const z = 0.82521 * f(fz);
  const lin = [3.1338561 * x - 1.6168667 * y - 0.4906146 * z, -0.9787684 * x + 1.9161415 * y + 0.033454 * z, 0.0719453 * x - 0.2289914 * y + 1.4052427 * z];
  for (let k = 0; k < 3; k++) out[o + k] = 255 * gamma(Math.min(1, Math.max(0, lin[k])));
}

// ---- レイヤー（統合した画像が無いときに、重ねて作る） ----

type Channel = { id: number; len: number; at: number };
type Rect = { top: number; left: number; bottom: number; right: number };
type Layer = Rect & {
  channels: Channel[];
  blend: string;
  opacity: number;
  /** 塗り（iOpa）の不透明度 */
  fill: number;
  /** 下のレイヤーでクリッピングしている */
  clipping: boolean;
  hidden: boolean;
  mask?: Rect & { color: number; disabled: boolean };
  /** グループの印（lsct）：1・2 はグループ（開いている・閉じている）、3 はグループの終わり */
  section: number;
  /** グループの描画モード（「通過」は pass） */
  sectionBlend?: string;
};

/** レイヤーとマスクの情報。16・32 ビットの画像は、レイヤーの情報が追加の情報（Lr16・Lr32）の中に入っている */
function readLayerSection(r: Reader, end: number): { count: number; layers: Layer[] } {
  const infoLen = r.len();
  const infoEnd = r.p + infoLen;
  let found = infoLen ? readLayerInfo(r) : null;
  if (found && !found.count) found = null;
  r.p = infoEnd;
  if (r.p + 4 <= end) r.p += 4 + r.u32(); // 全体のマスクの情報
  while (!found && r.p + 12 <= end) {
    const sig = r.str4();
    if (sig !== "8BIM" && sig !== "8B64") break;
    const key = r.str4();
    const len = r.len(sig === "8B64" || (r.big && LARGE_KEYS.includes(key)));
    const at = r.p;
    if (len && (key === "Lr16" || key === "Lr32" || key === "Layr")) found = readLayerInfo(r);
    r.p = at + len + (len % 2);
  }
  return found ?? { count: 0, layers: [] };
}

function readLayerInfo(r: Reader): { count: number; layers: Layer[] } {
  const count = r.i16();
  const layers: Layer[] = [];
  for (let i = 0; i < Math.abs(count); i++) {
    const rect = { top: r.i32(), left: r.i32(), bottom: r.i32(), right: r.i32() };
    const channels: Channel[] = [];
    for (let k = r.u16(); k > 0; k--) channels.push({ id: r.i16(), len: r.len(), at: 0 });
    r.p += 4; // 「8BIM」
    const blend = r.str4();
    const opacity = r.u8();
    const clipping = r.u8() === 1;
    const flags = r.u8();
    r.p += 1;
    const extraEnd = r.p + 4 + r.u32();
    const maskLen = r.u32();
    const maskEnd = r.p + maskLen;
    const mask = maskLen >= 18 ? { top: r.i32(), left: r.i32(), bottom: r.i32(), right: r.i32(), color: r.u8(), disabled: !!(r.u8() & 2) } : undefined;
    r.p = maskEnd;
    r.p += 4 + r.u32(); // 描画の範囲（ブレンド条件）
    const nameLen = 1 + r.u8();
    r.p += nameLen - 1 + ((4 - (nameLen % 4)) % 4);
    let fill = 255;
    let section = 0;
    let sectionBlend: string | undefined;
    while (r.p + 12 <= extraEnd) {
      const sig = r.str4();
      if (sig !== "8BIM" && sig !== "8B64") break;
      const key = r.str4();
      const len = r.len(r.big && LARGE_KEYS.includes(key));
      const at = r.p;
      if (key === "iOpa") fill = r.u8();
      if (key === "lsct" || key === "lsdk") {
        section = r.u32();
        if (len >= 12) {
          r.p += 4;
          sectionBlend = r.str4();
        }
      }
      r.p = at + len + (len % 2);
    }
    r.p = extraEnd;
    layers.push({ ...rect, channels, blend, opacity, fill, clipping, hidden: !!(flags & 2), mask, section, sectionBlend });
  }
  // 続けて、レイヤーごと・チャンネルごとの中身が並んでいる（場所だけ覚えておき、重ねるときに読む）
  for (const l of layers)
    for (const c of l.channels) {
      c.at = r.p;
      r.p += c.len;
    }
  return { count, layers };
}

type Node = { layer: Layer; children?: Node[] };

/** レイヤーの並び（下から上）を、グループの入れ子にする（それぞれの中は上から下） */
function layerTree(layers: Layer[]): Node[] {
  const root: Node[] = [];
  const stack = [root];
  for (const layer of [...layers].reverse()) {
    if (layer.section === 1 || layer.section === 2) {
      const node: Node = { layer, children: [] };
      stack.at(-1)!.push(node);
      stack.push(node.children!);
    } else if (layer.section === 3) {
      if (stack.length > 1) stack.pop();
    } else {
      stack.at(-1)!.push({ layer });
    }
  }
  return root;
}

type Pixels = { left: number; top: number; w: number; h: number; rgba: Uint8ClampedArray };
type Mask = { left: number; top: number; w: number; h: number; data: Uint8Array | null; color: number };
/** クリッピングの土台になるレイヤー（その形の中にだけ、上のレイヤーを描く） */
type Clip = { px: Pixels; mask: Mask | null; opacity: number };

const maskAt = (m: Mask, x: number, y: number) =>
  m.data && x >= m.left && y >= m.top && x < m.left + m.w && y < m.top + m.h ? m.data[(y - m.top) * m.w + (x - m.left)] : m.color;

async function renderLayers(r: Reader, h: Header, layers: Layer[]): Promise<Uint8ClampedArray> {
  const { width: W, height: H, depth, mode } = h;
  const colors = COLOR_CHANNELS[mode] ?? 1;

  const channel = async (l: Layer, id: number, w: number, hh: number) => {
    const c = l.channels.find((c) => c.id === id);
    if (!c || !c.len) return null;
    const [raw] = await readRaw(r.b, c.at, c.at + c.len, w, hh, depth, 1, 1, r.big);
    return to8(raw, w, hh, depth, id < 0);
  };

  const pixelsOf = async (l: Layer): Promise<Pixels | null> => {
    const w = l.right - l.left;
    const hh = l.bottom - l.top;
    if (w <= 0 || hh <= 0) return null;
    const planes: Uint8Array[] = [];
    for (let k = 0; k < colors; k++) {
      const p = await channel(l, k, w, hh);
      if (!p) return null;
      planes.push(p);
    }
    return { left: l.left, top: l.top, w, h: hh, rgba: toRgba(planes, await channel(l, -1, w, hh), w * hh, mode) };
  };

  const maskOf = async (l: Layer): Promise<Mask | null> => {
    const m = l.mask;
    if (!m || m.disabled) return null;
    const w = m.right - m.left;
    const hh = m.bottom - m.top;
    const data = w > 0 && hh > 0 ? await channel(l, -2, w, hh) : null;
    return { left: m.left, top: m.top, w, h: hh, data, color: m.color };
  };

  /** nodes（上から下）を、下から順に target へ重ねる。mul：上のグループの不透明度 */
  const draw = async (nodes: Node[], target: Uint8ClampedArray, mul: number) => {
    let base: Clip | "none" | null = null;
    for (const node of [...nodes].reverse()) {
      const l = node.layer;
      if (!l.clipping) base = null;
      if (l.hidden) {
        if (!l.clipping) base = "none";
        continue;
      }
      if (l.clipping && base === "none") continue;
      const clip = l.clipping && base && base !== "none" ? base : null;
      const mask = await maskOf(l);
      if (node.children) {
        const blend = l.sectionBlend ?? l.blend;
        const opacity = (l.opacity / 255) * mul * (clip?.opacity ?? 1);
        if (blend === "pass" && !mask && !clip) {
          // 「通過」のグループは、中のレイヤーをそのまま下に重ねる
          await draw(node.children, target, opacity);
        } else {
          const own = new Uint8ClampedArray(W * H * 4);
          await draw(node.children, own, 1);
          blendInto(target, W, H, { left: 0, top: 0, w: W, h: H, rgba: own }, opacity, blend, mask, clip);
        }
        continue;
      }
      const px = await pixelsOf(l);
      if (!px) {
        if (!l.clipping) base = "none";
        continue;
      }
      blendInto(target, W, H, px, (l.opacity / 255) * (l.fill / 255) * mul * (clip?.opacity ?? 1), l.blend, mask, clip);
      if (!l.clipping) base = { px, mask, opacity: l.opacity / 255 };
    }
  };

  const out = new Uint8ClampedArray(W * H * 4);
  await draw(layerTree(layers), out, 1);
  return out;
}

/** src を target に重ねる（描画モード・不透明度・マスク・クリッピングをあてる） */
function blendInto(target: Uint8ClampedArray, W: number, H: number, src: Pixels, opacity: number, blend: string, mask: Mask | null, clip: Clip | null) {
  if (opacity <= 0) return;
  const lut = blendLut(blend);
  const x0 = Math.max(0, src.left);
  const x1 = Math.min(W, src.left + src.w);
  const y0 = Math.max(0, src.top);
  const y1 = Math.min(H, src.top + src.h);
  const s = src.rgba;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const si = ((y - src.top) * src.w + (x - src.left)) * 4;
      let a = s[si + 3] * opacity;
      if (mask) a = (a * maskAt(mask, x, y)) / 255;
      if (clip) {
        const c = clip.px;
        const inside = x >= c.left && y >= c.top && x < c.left + c.w && y < c.top + c.h;
        a = inside ? (a * c.rgba[((y - c.top) * c.w + (x - c.left)) * 4 + 3]) / 255 : 0;
        if (clip.mask) a = (a * maskAt(clip.mask, x, y)) / 255;
      }
      if (a <= 0) continue;
      const di = (y * W + x) * 4;
      const as = a / 255;
      const ab = target[di + 3] / 255;
      const ao = as + ab * (1 - as);
      for (let k = 0; k < 3; k++) {
        const cs = s[si + k];
        const cb = target[di + k];
        // 下に色があるところでは、描画モードで混ぜた色を使う
        const mixed = lut ? (1 - ab) * cs + ab * lut[(cb << 8) | cs] : cs;
        target[di + k] = (as * mixed + ab * cb * (1 - as)) / ao;
      }
      target[di + 3] = ao * 255;
    }
  }
}

/** 描画モードの計算（下の色 b・上の色 s。0〜1）。無いもの（色相・彩度など）は「通常」として描く */
const BLENDS: Record<string, (b: number, s: number) => number> = {
  dark: Math.min,
  "mul ": (b, s) => b * s,
  idiv: (b, s) => (b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s)),
  lbrn: (b, s) => Math.max(0, b + s - 1),
  lite: Math.max,
  scrn: (b, s) => b + s - b * s,
  "div ": (b, s) => (b <= 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s))),
  lddg: (b, s) => Math.min(1, b + s),
  over: (b, s) => (b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)),
  sLit: (b, s) => (s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b) : b + (2 * s - 1) * ((b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)) - b)),
  hLit: (b, s) => (s <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)),
  vLit: (b, s) => (s <= 0.5 ? BLENDS.idiv(b, 2 * s) : BLENDS["div "](b, 2 * s - 1)),
  lLit: (b, s) => Math.min(1, Math.max(0, b + 2 * s - 1)),
  pLit: (b, s) => (s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1)),
  hMix: (b, s) => (b + s >= 1 ? 1 : 0),
  diff: (b, s) => Math.abs(b - s),
  smud: (b, s) => b + s - 2 * b * s,
  fsub: (b, s) => Math.max(0, b - s),
  fdiv: (b, s) => (s <= 0 ? 1 : Math.min(1, b / s)),
};

const luts = new Map<string, Uint8Array>();

/** 描画モードの計算を、下の色と上の色（0〜255）の組み合わせごとに先に作っておく（「通常」は null） */
function blendLut(blend: string): Uint8Array | null {
  const f = BLENDS[blend];
  if (!f) return null;
  let lut = luts.get(blend);
  if (!lut) {
    lut = new Uint8Array(65536);
    for (let b = 0; b < 256; b++) for (let s = 0; s < 256; s++) lut[(b << 8) | s] = Math.round(255 * f(b / 255, s / 255));
    luts.set(blend, lut);
  }
  return lut;
}
