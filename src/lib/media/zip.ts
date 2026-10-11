// 複数のファイルを1つの ZIP にまとめる。画像はもともと圧縮されているので、圧縮はせずにそのまま入れる（無圧縮の ZIP）。
// ファイル名は UTF-8 の印を付けて入れる（日本語の名前も Windows の「すべて展開」でそのまま出る）

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** ZIP に入れる日時（MS-DOS の形） */
function dosTime(d: Date) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** ZIP の大きさの上限（これを超えるには ZIP64 という別の形が要る） */
const LIMIT = 0xffffffff;

export async function makeZip(files: { name: string; data: Blob }[]): Promise<Blob> {
  const enc = new TextEncoder();
  const { time, date } = dosTime(new Date());
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const f of files) {
    const name = enc.encode(f.name);
    const data = new Uint8Array(await f.data.arrayBuffer());
    const crc = crc32(data);
    if (offset + 30 + name.length + data.length > LIMIT) throw new Error("ZIP にできる大きさ（4GB）を超えています");

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // 展開に要るバージョン
    local.setUint16(6, 0x0800, true); // ファイル名は UTF-8
    local.setUint16(8, 0, true); // 無圧縮
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    // 中身は元の Blob のまま入れる（読み出した data は CRC を出すためだけに使い、すぐ手放す）
    parts.push(local.buffer, name, f.data);

    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true); // 作ったバージョン
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, time, true);
    c.setUint16(14, date, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true); // このファイルの始まり
    central.push(new Uint8Array(c.buffer), name);

    offset += 30 + name.length + data.length;
  }

  const centralSize = central.reduce((n, x) => n + x.length, 0);
  if (offset + centralSize + 22 > LIMIT) throw new Error("ZIP にできる大きさ（4GB）を超えています");
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
}
