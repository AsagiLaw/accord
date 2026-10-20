// アップロードした画像から、一覧用の小さい画像と情報（サイズ・解像度）を作る

import { decodePsd, isPsd, isPsdFile, readPsdInfo } from "./psd";
import { crc32 } from "./zip";

const THUMB_MAX = 512;

/** メディアに入れられるファイルか（画像と PSD） */
export const isImageFile = (file: File) => file.type.startsWith("image/") || isPsdFile(file);

/** ファイルを選ぶ画面で選べる形式 */
export const IMAGE_ACCEPT = "image/*,.psd,.psb";

export type ImageInfo = {
  width: number;
  height: number;
  dpi: number;
  thumb: Blob;
  /** ブラウザがそのまま表示できない画像（PSD）を、表示用にした PNG */
  view?: Blob;
};

export async function readImage(file: Blob): Promise<ImageInfo> {
  const psd = (await isPsd(file)) ? await psdToPng(file) : null;
  const bitmap = await createImageBitmap(psd?.png ?? file);
  const thumb = await makeThumb(bitmap);
  const dpi = psd ? psd.dpi : dpiOf(await file.slice(0, HEAD_SIZE).arrayBuffer());
  const info = { width: bitmap.width, height: bitmap.height, dpi, thumb, view: psd?.png };
  bitmap.close();
  return info;
}

/** 画像を読み込む（ブラウザが読めない PSD も） */
export async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap((await isPsd(blob)) ? (await psdToPng(blob)).png : blob);
}

/** PSD を、元の大きさの PNG にする。カラープロファイルも入れて、ブラウザがその色で表示するようにする */
async function psdToPng(file: Blob) {
  const psd = await decodePsd(file);
  const canvas = document.createElement("canvas");
  canvas.width = psd.image.width;
  canvas.height = psd.image.height;
  canvas.getContext("2d")!.putImageData(psd.image, 0, 0);
  const png = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("png failed"))), "image/png"),
  );
  // 大きい画像のメモリを早めに返す
  canvas.width = canvas.height = 0;
  return { png: await withIcc(png, psd.icc), dpi: psd.dpi };
}

/** PNG にカラープロファイル（iCCP）を入れる。PNG は RGB なので、RGB のプロファイルだけ（CMYK・グレーは入れない） */
async function withIcc(png: Blob, icc: Uint8Array | null): Promise<Blob> {
  if (!icc || icc.length < 132 || String.fromCharCode(icc[16], icc[17], icc[18], icc[19]) !== "RGB ") return png;
  const zipped = new Blob([icc.slice()]).stream().pipeThrough(new CompressionStream("deflate"));
  const z = new Uint8Array(await new Response(zipped).arrayBuffer());
  // 名前「ICC」＋区切り＋圧縮の方法（0）＋圧縮したプロファイル
  const data = new Uint8Array(5 + z.length);
  data.set([0x49, 0x43, 0x43, 0, 0]);
  data.set(z, 5);
  const b = new Uint8Array(await png.arrayBuffer());
  const v = new DataView(b.buffer);
  const parts: Uint8Array<ArrayBuffer>[] = [b.subarray(0, 8)];
  let p = 8;
  while (p + 12 <= b.length) {
    const end = p + 12 + v.getUint32(p);
    const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    // 色の決まりの印は、プロファイルと食い違わないよう外す
    if (!["iCCP", "sRGB", "gAMA", "cHRM"].includes(type)) parts.push(b.subarray(p, end));
    if (type === "IHDR") parts.push(pngChunk("iCCP", data));
    p = end;
  }
  return new Blob(parts, { type: "image/png" });
}

function pngChunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** 一覧用の小さい画像を作る */
export async function makeThumb(src: CanvasImageSource & { width: number; height: number }): Promise<Blob> {
  const scale = Math.min(1, THUMB_MAX / Math.max(src.width, src.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(src.width * scale));
  canvas.height = Math.max(1, Math.round(src.height * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("thumb failed"))), "image/webp", 0.85),
  );
}

/** 画像の情報（解像度・カラープロファイル）を読むために、ファイルの先頭から読む大きさ（情報は画像の中身より前にある） */
const HEAD_SIZE = 1 << 20;

export type ImageMeta = {
  /** 解像度（dpi）。記録が無ければ 0 */
  dpi: number;
  /** 埋め込まれたカラープロファイルの名前。埋め込みが無ければ null */
  profile: string | null;
};

/** 元の画像から、解像度とカラープロファイルを読む */
export async function readImageMeta(blob: Blob): Promise<ImageMeta> {
  if (await isPsd(blob)) {
    const { dpi, icc } = await readPsdInfo(blob);
    return { dpi, profile: icc ? iccName(icc) : null };
  }
  const head = await blob.slice(0, HEAD_SIZE).arrayBuffer();
  return { dpi: dpiOf(head), profile: await profileOf(head).catch(() => null) };
}

/** JPEG（JFIF・EXIF・Photoshop の情報）と PNG（pHYs）から解像度を読む。分からなければ 0 */
export function dpiOf(buf: ArrayBuffer): number {
  try {
    const v = new DataView(buf);
    const sig = v.getUint16(0);
    if (sig === 0xffd8) {
      let p = 2;
      while (p < v.byteLength - 4) {
        const marker = v.getUint16(p);
        const len = v.getUint16(p + 2);
        if (marker >> 8 !== 0xff || marker === 0xffda) break;
        if (marker === 0xffe0 && v.getUint32(p + 4) === 0x4a464946) {
          const unit = v.getUint8(p + 11);
          const x = v.getUint16(p + 12);
          if (unit === 1) return x;
          if (unit === 2) return Math.round(x * 2.54);
        }
        if (marker === 0xffe1 && v.getUint32(p + 4) === 0x45786966) {
          const t = p + 10;
          const le = v.getUint16(t) === 0x4949;
          const ifd = t + v.getUint32(t + 4, le);
          const n = v.getUint16(ifd, le);
          let xr = 0;
          let unit = 2;
          for (let i = 0; i < n; i++) {
            const e = ifd + 2 + i * 12;
            const tag = v.getUint16(e, le);
            if (tag === 0x011a) {
              const off = t + v.getUint32(e + 8, le);
              xr = v.getUint32(off, le) / v.getUint32(off + 4, le);
            }
            if (tag === 0x0128) unit = v.getUint16(e + 8, le);
          }
          if (xr) return Math.round(unit === 3 ? xr * 2.54 : xr);
        }
        // Photoshop などで保存した JPEG は、「Photoshop 3.0」の情報の中に解像度がある
        if (marker === 0xffed && v.getUint32(p + 4) === 0x50686f74) {
          const dpi = photoshopDpi(v, p + 4 + 14, p + 2 + len);
          if (dpi) return dpi;
        }
        p += 2 + len;
      }
    } else if (sig === 0x8950) {
      let p = 8;
      while (p < v.byteLength - 12) {
        const len = v.getUint32(p);
        if (v.getUint32(p + 4) === 0x70485973) {
          const x = v.getUint32(p + 8);
          if (v.getUint8(p + 16) === 1) return Math.round(x * 0.0254);
        }
        p += 12 + len;
      }
    }
  } catch {
    // 壊れたヘッダーは「不明」として扱う
  }
  return 0;
}

/** Photoshop の情報（「8BIM」の並び）から、解像度（ResolutionInfo・0x03ED）を読む。値はいつも「1インチあたり」で入っている */
function photoshopDpi(v: DataView, start: number, end: number): number {
  let q = start;
  while (q + 12 <= end && v.getUint32(q) === 0x3842494d) {
    const id = v.getUint16(q + 4);
    // 名前（長さ＋文字。合わせて偶数の長さにそろえてある）
    const nameLen = 1 + v.getUint8(q + 6);
    const at = q + 6 + nameLen + (nameLen % 2);
    const size = v.getUint32(at);
    if (id === 0x03ed) return Math.round(v.getUint32(at + 4) / 65536);
    q = at + 4 + size + (size % 2);
  }
  return 0;
}

/**
 * 埋め込まれたカラープロファイルの名前を読む（JPEG・PNG・WebP）。埋め込みが無ければ null。
 * PNG で、プロファイルの代わりに「sRGB」などの印だけがあるときは、その名前
 */
async function profileOf(buf: ArrayBuffer): Promise<string | null> {
  const v = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const fourcc = (p: number) => String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);
  if (v.getUint16(0) === 0xffd8) {
    // JPEG：「ICC_PROFILE」の印が付いた APP2 に、分けて入っている（番号順につなげる）
    const parts: [number, Uint8Array][] = [];
    let p = 2;
    while (p < v.byteLength - 4) {
      const marker = v.getUint16(p);
      const len = v.getUint16(p + 2);
      if (marker >> 8 !== 0xff || marker === 0xffda) break;
      if (marker === 0xffe2 && fourcc(p + 4) === "ICC_" && fourcc(p + 8) === "PROF")
        parts.push([v.getUint8(p + 16), bytes.subarray(p + 18, p + 2 + len)]);
      p += 2 + len;
    }
    if (!parts.length) return null;
    parts.sort((a, b) => a[0] - b[0]);
    const all = new Uint8Array(parts.reduce((n, [, d]) => n + d.length, 0));
    let at = 0;
    for (const [, d] of parts) {
      all.set(d, at);
      at += d.length;
    }
    return iccName(all);
  }
  if (v.getUint32(0) === 0x89504e47) {
    // PNG：iCCP（名前＋圧縮したプロファイル）、sRGB の印、cICP（色の決まりの番号）
    let marked: string | null = null;
    let p = 8;
    while (p < v.byteLength - 12) {
      const len = v.getUint32(p);
      const type = fourcc(p + 4);
      const data = bytes.subarray(p + 8, p + 8 + len);
      if (type === "IDAT") break;
      if (type === "iCCP") {
        const zero = data.indexOf(0);
        const inflated = await inflate(data.subarray(zero + 2));
        return iccName(inflated) ?? new TextDecoder("latin1").decode(data.subarray(0, zero));
      }
      if (type === "sRGB") marked = "sRGB";
      if (type === "cICP" && !marked) marked = ({ 1: "sRGB", 9: "Rec. 2020", 12: "Display P3" } as Record<number, string>)[data[0]] ?? null;
      p += 12 + len;
    }
    return marked;
  }
  if (fourcc(0) === "RIFF" && fourcc(8) === "WEBP") {
    // WebP：ICCP の中にそのまま入っている
    let p = 12;
    while (p < v.byteLength - 8) {
      const size = v.getUint32(p + 4, true);
      if (fourcc(p) === "ICCP") return iccName(bytes.subarray(p + 8, p + 8 + size));
      p += 8 + size + (size % 2);
    }
  }
  return null;
}

/**
 * 画像の中に記録された、撮影した日時・作った日時（制作日に使う）。記録が無ければ null。
 * EXIF（JPEG・PNG・WebP）→ XMP（Photoshop など。PSD も）→ PNG の「Creation Time」の順に探す
 */
export async function readRecordedDate(blob: Blob): Promise<number | null> {
  try {
    const head = await blob.slice(0, HEAD_SIZE).arrayBuffer();
    return exifDateIn(head) ?? xmpDateIn(head) ?? pngTextDateIn(head);
  } catch {
    return null;
  }
}

/** 日時として使える値か（壊れた記録や、時計の合っていないカメラの 1970 年などを除く） */
const plausible = (t: number) => Number.isFinite(t) && t > Date.UTC(1971, 0, 1) && t < Date.now() + 86_400_000;

/** EXIF の日時「2025:01:01 12:34:56」（時差の記録は無いので、端末の時刻として読む） */
function exifTime(s: string): number | null {
  const g = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (!g) return null;
  const t = new Date(+g[1], +g[2] - 1, +g[3], +g[4], +g[5], +g[6]).getTime();
  return plausible(t) ? t : null;
}

/** EXIF（TIFF の形）から、撮影日時 → デジタル化した日時 → ファイルの日時の順に読む。t は TIFF の頭の位置 */
function tiffDate(v: DataView, t: number): number | null {
  const le = v.getUint16(t) === 0x4949;
  const entry = (ifd: number, tag: number) => {
    const n = v.getUint16(ifd, le);
    for (let i = 0; i < n; i++) if (v.getUint16(ifd + 2 + i * 12, le) === tag) return ifd + 2 + i * 12;
    return -1;
  };
  const text = (e: number) => {
    if (e < 0) return "";
    const count = v.getUint32(e + 4, le);
    const at = count > 4 ? t + v.getUint32(e + 8, le) : e + 8;
    let s = "";
    for (let i = 0; i < count - 1 && at + i < v.byteLength; i++) s += String.fromCharCode(v.getUint8(at + i));
    return s;
  };
  const ifd0 = t + v.getUint32(t + 4, le);
  const exifPtr = entry(ifd0, 0x8769);
  const exif = exifPtr >= 0 ? t + v.getUint32(exifPtr + 8, le) : -1;
  const found = exif >= 0 ? [0x9003, 0x9004].map((tag) => exifTime(text(entry(exif, tag)))) : [];
  return found.find((x) => x !== null) ?? exifTime(text(entry(ifd0, 0x0132)));
}

function exifDateIn(buf: ArrayBuffer): number | null {
  try {
    const v = new DataView(buf);
    const bytes = new Uint8Array(buf);
    const fourcc = (p: number) => String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);
    if (v.getUint16(0) === 0xffd8) {
      // JPEG：「Exif」の印が付いた APP1
      let p = 2;
      while (p < v.byteLength - 4) {
        const marker = v.getUint16(p);
        if (marker >> 8 !== 0xff || marker === 0xffda) break;
        if (marker === 0xffe1 && v.getUint32(p + 4) === 0x45786966) return tiffDate(v, p + 10);
        p += 2 + v.getUint16(p + 2);
      }
    } else if (v.getUint32(0) === 0x89504e47) {
      // PNG：eXIf の中身がそのまま TIFF の形
      let p = 8;
      while (p < v.byteLength - 12) {
        const len = v.getUint32(p);
        const type = fourcc(p + 4);
        if (type === "IDAT") break;
        if (type === "eXIf") return tiffDate(v, p + 8);
        p += 12 + len;
      }
    } else if (fourcc(0) === "RIFF" && fourcc(8) === "WEBP") {
      // WebP：EXIF の中身（先頭に「Exif」の印が付いていることもある）
      let p = 12;
      while (p < v.byteLength - 8) {
        const size = v.getUint32(p + 4, true);
        if (fourcc(p) === "EXIF") return tiffDate(v, fourcc(p + 8) === "Exif" ? p + 14 : p + 8);
        p += 8 + size + (size % 2);
      }
    }
  } catch {
    // 壊れた記録は「無い」として扱う
  }
  return null;
}

/** ISO の日時。日付だけ・時差の無いものは端末の時刻として読む */
function isoTime(s: string): number | null {
  const g = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?/.exec(s);
  if (!g) return null;
  const t = g[7]
    ? Date.parse(`${g[1]}-${g[2]}-${g[3]}T${g[4]}:${g[5]}:${g[6] ?? "00"}${g[7].length === 5 ? `${g[7].slice(0, 3)}:${g[7].slice(3)}` : g[7]}`)
    : new Date(+g[1], +g[2] - 1, +g[3], +(g[4] ?? 0), +(g[5] ?? 0), +(g[6] ?? 0)).getTime();
  return plausible(t) ? t : null;
}

/** XMP（Photoshop・Lightroom などが書く）から、撮影日時 → 作った日時を読む（日付だけのことがある photoshop:DateCreated は最後） */
function xmpDateIn(buf: ArrayBuffer): number | null {
  const text = new TextDecoder("latin1").decode(buf);
  for (const key of ["exif:DateTimeOriginal", "xmp:CreateDate", "photoshop:DateCreated"]) {
    const g = new RegExp(`${key}(?:=["']|>)\\s*([0-9][0-9T:.+\\-Z]+)`).exec(text);
    const t = g && isoTime(g[1]);
    if (t) return t;
  }
  return null;
}

/** PNG の文字の記録「Creation Time」（決まった書き方は無いので、読めるものだけ） */
function pngTextDateIn(buf: ArrayBuffer): number | null {
  const v = new DataView(buf);
  if (v.byteLength < 8 || v.getUint32(0) !== 0x89504e47) return null;
  const bytes = new Uint8Array(buf);
  let p = 8;
  while (p < v.byteLength - 12) {
    const len = v.getUint32(p);
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    if (type === "IDAT") break;
    if (type === "tEXt") {
      const data = new TextDecoder("latin1").decode(bytes.subarray(p + 8, p + 8 + len));
      const [key, value] = data.split("\0");
      if (key === "Creation Time" && value) {
        const t = isoTime(value.trim()) ?? Date.parse(value);
        if (t && plausible(t)) return t;
      }
    }
    p += 12 + len;
  }
  return null;
}

/** PNG の iCCP の中身（zlib で圧縮されている）を戻す */
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** ICC プロファイルから、名前（desc）を読む。RGB 以外（CMYK・グレー）なら、それも付ける */
function iccName(icc: Uint8Array): string | null {
  if (icc.length < 132) return null;
  const v = new DataView(icc.buffer, icc.byteOffset, icc.byteLength);
  const space = String.fromCharCode(icc[16], icc[17], icc[18], icc[19]).trim();
  const kind = space === "CMYK" ? "（CMYK）" : space === "GRAY" ? "（グレー）" : "";
  const count = v.getUint32(128);
  for (let i = 0; i < count; i++) {
    const e = 132 + i * 12;
    if (e + 12 > icc.length) break;
    if (v.getUint32(e) !== 0x64657363) continue; // 'desc'
    const at = v.getUint32(e + 4);
    const type = v.getUint32(at);
    let name = "";
    if (type === 0x64657363) {
      // ICC v2：文字数と、ASCII の文字
      const n = v.getUint32(at + 8);
      name = new TextDecoder("latin1").decode(icc.subarray(at + 12, at + 12 + n));
    } else if (type === 0x6d6c7563) {
      // ICC v4（mluc）：言語ごとの UTF-16 の文字。最初のものを使う
      const len = v.getUint32(at + 20);
      const off = v.getUint32(at + 24);
      name = new TextDecoder("utf-16be").decode(icc.subarray(at + off, at + off + len));
    }
    name = name.replace(/\0+$/, "").trim();
    return name ? name + kind : null;
  }
  return null;
}

export function formatSize(bytes: number): string {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
  return bytes + " B";
}

export function aspectRatio(w: number, h: number): string {
  if (!w || !h) return "—";
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(w, h);
  return w / g <= 32 && h / g <= 32 ? `${w / g} : ${h / g}` : `${(w / h).toFixed(2)} : 1`;
}

const ICON_MAX = 256;

/** ルームや人のアイコンにする画像を、正方形に切り抜いて小さくする（data URL） */
export async function squareIconFrom(file: Blob) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(ICON_MAX, side);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  return canvas.toDataURL("image/webp", 0.9);
}
