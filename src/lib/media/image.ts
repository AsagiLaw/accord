// アップロードした画像から、一覧用の小さい画像と情報（サイズ・解像度）を作る

const THUMB_MAX = 512;

export type ImageInfo = { width: number; height: number; dpi: number; thumb: Blob };

export async function readImage(file: File): Promise<ImageInfo> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, THUMB_MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const thumb = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("thumb failed"))), "image/webp", 0.85),
  );
  const head = await file.slice(0, HEAD_SIZE).arrayBuffer();
  const info = { width: bitmap.width, height: bitmap.height, dpi: dpiOf(head), thumb };
  bitmap.close();
  return info;
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
