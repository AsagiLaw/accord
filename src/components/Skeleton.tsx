/**
 * 読み込み中に出す、形だけの枠（Discord のように、アイコンや文字の代わりに灰色の枠を並べる）。
 * すぐに読み終わるときにちらつかないよう、少し待ってからふわっと出す（globals.css の .skeleton）
 */

/** 灰色の枠1つ。幅・高さ・角の丸みは className で決める */
export function Bone({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden className={`bone block ${className}`} style={style} />;
}

// 発言の並び：ほかの人（アイコン・名前・吹き出し）と自分（右の吹き出し）。幅はいつも同じにして、出るたびに形が変わらないようにする
const CHAT_ROWS: { mine: boolean; widths: number[] }[] = [
  { mine: false, widths: [62, 38] },
  { mine: true, widths: [44] },
  { mine: false, widths: [70] },
  { mine: false, widths: [52, 30, 46] },
  { mine: true, widths: [58, 34] },
  { mine: false, widths: [40] },
];

/** チャットの読み込み中 */
export function ChatSkeleton({ composer = true }: { composer?: boolean }) {
  return (
    <div role="status" aria-label="読み込み中" data-name="チャットの読み込み中" className="skeleton flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden pb-2">
        {CHAT_ROWS.map((row, i) => (
          <div key={i} className={`mt-3 flex gap-2 ${row.mine ? "justify-end" : "justify-start"}`}>
            {!row.mine && <Bone className="mt-0.5 h-9 w-9 shrink-0 rounded-full" />}
            <div className={`flex min-w-0 flex-1 flex-col gap-1 ${row.mine ? "items-end" : "items-start"}`}>
              {!row.mine && <Bone className="mx-1 mb-0.5 h-3 w-24 rounded-full" />}
              {row.widths.map((w, j) => (
                <Bone key={j} className="h-9 max-w-[560px] rounded-[16px]" style={{ width: `${w}%` }} />
              ))}
            </div>
          </div>
        ))}
      </div>
      {composer && <Bone className="h-11 w-full shrink-0 rounded-[14px]" />}
    </div>
  );
}

// 文章の行の幅（段落ごと）
const DOC_PARAS = [[96, 88, 64], [92, 71], [98, 90, 84, 40], [76]];

/** ノート・ウィンドウ・ページなど、ブロックを並べた画面の読み込み中 */
export function DocSkeleton({ title = true, className = "" }: { title?: boolean; className?: string }) {
  return (
    <div role="status" aria-label="読み込み中" data-name="ページの読み込み中" className={`skeleton flex flex-col gap-5 ${className}`}>
      {title && <Bone className="h-8 w-2/5 rounded-[8px]" />}
      {DOC_PARAS.map((lines, i) => (
        <div key={i} className="flex flex-col gap-2">
          {lines.map((w, j) => (
            <Bone key={j} className="h-3.5 rounded-full" style={{ width: `${w}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** 1つのブロック（項目・ビューなど）の読み込み中：短い行を数本 */
export function BlockSkeleton({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div role="status" aria-label="読み込み中" className={`skeleton flex flex-col gap-2 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <Bone key={i} className="h-3.5 rounded-full" style={{ width: `${[90, 70, 80, 55][i % 4]}%` }} />
      ))}
    </div>
  );
}

// 表の列の幅（左の名前の列は広く）
const TABLE_COLS = [32, 18, 22, 14, 14];
const TABLE_CELL = [[80, 55, 70, 40, 60], [60, 70, 45, 65, 50], [90, 45, 60, 55, 35], [70, 60, 80, 30, 55], [50, 75, 50, 60, 45], [85, 40, 65, 45, 70]];

/** データベースの表の読み込み中：見出しの行と、罫線で区切ったマス */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-label="読み込み中" data-name="表の読み込み中" className="skeleton overflow-hidden rounded-[10px] border border-line">
      {Array.from({ length: rows + 1 }, (_, r) => (
        <div key={r} className={`flex ${r ? "border-t border-line" : "bg-tint/40"}`}>
          {TABLE_COLS.map((w, c) => (
            <div key={c} className={`flex h-9 items-center px-2.5 ${c ? "border-l border-line" : ""}`} style={{ width: `${w}%` }}>
              <Bone className={r ? "h-3 rounded-full" : "h-2.5 rounded-full"} style={{ width: `${r ? TABLE_CELL[(r - 1) % TABLE_CELL.length][c] : 45}%` }} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// 予定の帯を出すマス（週・曜日・幅）
const CAL_EVENTS: Record<string, number> = { "0-2": 70, "1-4": 85, "1-5": 55, "2-1": 60, "3-3": 80, "3-6": 50, "4-0": 65 };

/** データベースのカレンダーの読み込み中：月の見出し・曜日・5週分のマス（ところどころに予定の帯） */
export function CalendarSkeleton({ header = true }: { header?: boolean }) {
  return (
    <div role="status" aria-label="読み込み中" data-name="カレンダーの読み込み中" className="skeleton flex flex-col gap-2">
      {header && (
        <div className="flex items-center gap-2">
          <Bone className="h-6 w-32 rounded-[8px]" />
          <Bone className="ml-auto h-8 w-8 rounded-[8px]" />
          <Bone className="h-8 w-14 rounded-[8px]" />
          <Bone className="h-8 w-8 rounded-[8px]" />
        </div>
      )}
      <div className="grid grid-cols-7 overflow-hidden rounded-[10px] border border-line">
        {Array.from({ length: 7 }, (_, d) => (
          <div key={d} className={`flex h-7 items-center justify-center ${d ? "border-l border-line" : ""}`}>
            <Bone className="h-2.5 w-5 rounded-full" />
          </div>
        ))}
        {Array.from({ length: 35 }, (_, i) => {
          const w = Math.floor(i / 7);
          const d = i % 7;
          const ev = CAL_EVENTS[`${w}-${d}`];
          return (
            <div key={i} className={`flex h-20 flex-col gap-1.5 border-t border-line p-1.5 ${d ? "border-l" : ""}`}>
              <Bone className="h-2.5 w-4 rounded-full" />
              {ev && <Bone className="h-4 rounded-[4px]" style={{ width: `${ev}%` }} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** ビューの種類に合わせた読み込み中（表・カレンダー以外は、表の形にする） */
export function ViewSkeleton({ type, rows }: { type?: string; rows?: number }) {
  return type === "calendar" ? <CalendarSkeleton /> : <TableSkeleton rows={rows} />;
}

/** データベースの画面の読み込み中：アイコンと名前、ビューのタブ、ビューの中身 */
export function DatabaseSkeleton({ type }: { type?: string }) {
  return (
    <div role="status" aria-label="読み込み中" data-name="データベース画面の読み込み中" className="skeleton space-y-3">
      <div className="flex items-center gap-2">
        <Bone className="h-11 w-11 rounded-[10px]" />
        <Bone className="h-8 w-56 max-w-[50%] rounded-[8px]" />
      </div>
      <div className="flex items-center gap-2 border-b border-line pb-2">
        <Bone className="h-6 w-20 rounded-[8px]" />
        <Bone className="h-6 w-16 rounded-[8px]" />
        <Bone className="h-6 w-16 rounded-[8px]" />
        <Bone className="ml-auto h-8 w-24 rounded-[8px]" />
      </div>
      <ViewSkeleton type={type} />
    </div>
  );
}
