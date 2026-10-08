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
  const head = await file.slice(0, 65536).arrayBuffer();
  const info = { width: bitmap.width, height: bitmap.height, dpi: dpiOf(head), thumb };
  bitmap.close();
  return info;
}

/** JPEG（JFIF・EXIF）と PNG（pHYs）から解像度を読む。分からなければ 0 */
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
