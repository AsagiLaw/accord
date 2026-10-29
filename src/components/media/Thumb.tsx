"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import type { Media } from "@/lib/local/db";
import { ThumbImage } from "@/components/ThumbImage";
import { startMediaDrag, useOriginalUrl } from "@/lib/media/export";
import { useUploadProgress } from "@/lib/media/remote";
import { editableName, labelOf } from "@/lib/media/logic";
import { useMediaPrefs } from "@/lib/media/prefs";
import { toast } from "@/components/ui/overlay";

export { ThumbImage };

let warnedMulti = false;

/**
 * R2 に置いている途中の画像のゲージ。置き終わっている画像には何も出さない。
 * 順番を待っている間は空のゲージ。詳しい割合はカーソルを置くと出る
 */
export function UploadGauge({ id, className = "" }: { id: string; className?: string }) {
  const value = useUploadProgress(id);
  if (value === undefined) return null;
  const pct = Math.round(value * 100);
  const label = value > 0 ? `アップロード中 ${pct}%` : "アップロード待ち";
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      title={label}
      data-name="アップロードのゲージ"
      className={`block overflow-hidden ${className}`}
    >
      <span
        className="block h-full rounded-full bg-accent transition-[width] duration-200"
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

/**
 * 画像の上に重ねる、透明な元の画像。これをドラッグすると、他のアプリ（Photoshop・デスクトップなど）に元の画像のファイルとして渡る。
 * 元の画像は大きいので、カーソルを乗せたときに読み込む。ドラッグ中に見せる絵は、重ねている下の見た目（親の要素）にする。
 * 親には relative を付けておくこと。multiSelected：複数選んでいる中の1枚か（渡せるのは1枚だけなので、最初の1回だけ知らせる）
 */
export function DragOriginal({
  m,
  multiSelected = false,
}: {
  m: Media;
  multiSelected?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  // 元の画像を調べる仕組みは、カーソルを乗せた画像だけで動かす（何百枚もある一覧を、すぐ出し・すぐ閉じられるように）
  if (!hovered)
    return (
      // eslint-disable-next-line @next/next/no-img-element -- ブラウザ内の画像なので next/image は使えない
      <img alt="" aria-hidden data-drag-original onPointerEnter={() => setHovered(true)} className="absolute inset-0 h-full w-full opacity-0" />
    );
  return <HoveredOriginal m={m} multiSelected={multiSelected} />;
}

function HoveredOriginal({ m, multiSelected }: { m: Media; multiSelected: boolean }) {
  const src = useOriginalUrl(m);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- ブラウザ内の画像なので next/image は使えない
    <img
      src={src}
      alt=""
      aria-hidden
      data-drag-original
      onDragStart={(e) => {
        if (
          startMediaDrag(e, m, e.currentTarget.parentElement) &&
          multiSelected &&
          !warnedMulti
        ) {
          warnedMulti = true;
          toast(
            "ドラッグで渡せるのは1枚だけです。複数枚は右クリックの「ダウンロード」を使ってください",
          );
        }
      }}
      className="absolute inset-0 h-full w-full opacity-0"
    />
  );
}

/**
 * 名前をその場で書き換える入力欄（画像の名前の所に出す）。Enter か外を押すと決まり、Esc でやめる。
 * 画像のクリック・ダブルクリック・キー操作には伝えない
 */
export function NameField({
  name,
  onDone,
  className = "",
}: {
  name: string;
  onDone: (name: string | null) => void;
  className?: string;
}) {
  const [value, setValue] = useState(name);
  const finished = useRef(false);
  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const v = value.trim();
    onDone(save && v && v !== name ? v : null);
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <input
      autoFocus
      value={value}
      aria-label="画像の名前"
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        // 日本語の変換を決めるための Enter では決めない
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
      onClick={stop}
      onDoubleClick={stop}
      onPointerDown={stop}
      onContextMenu={stop}
      className={`min-w-0 rounded-[6px] border border-accent bg-card px-1.5 text-ink outline-none ${className}`}
    />
  );
}

export function Thumb({
  m,
  selected,
  order,
  onClick,
  onDoubleClick,
  onFav,
  extra,
  renaming,
  onRenamed,
}: {
  m: Media;
  selected: boolean;
  /** 複数選択時の何番目か */
  order?: number;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  onFav?: () => void;
  extra?: React.ReactNode;
  /** 名前をその場で書き換えているとき */
  renaming?: boolean;
  onRenamed?: (name: string | null) => void;
}) {
  const { showExt, iconStyle, cardName } = useMediaPrefs();
  // Windows 風：エクスプローラーの画像表示のように、画像を切り抜かずに正方形の枠へ収め（下にそろえる）、名前を画像の下に出す
  const explorer = iconStyle === "explorer";
  const drag = !renaming && <DragOriginal m={m} multiSelected={order !== undefined} />;
  const nameField = (className: string) => (
    <NameField name={editableName(m)} onDone={(n) => onRenamed?.(n)} className={className} />
  );
  // 画像の上に重ねる印（ゲージ・選んだ順の番号・お気に入り・子ライブラリーの印など）
  const marks = (
    <>
      {/* R2 に置いている途中なら、ゲージを出す（明るい画像の上でも見えるよう、暗い下地と影を付ける）。標準で名前を出すときは名前の札のすぐ上 */}
      <UploadGauge
        id={m.id}
        className={`pointer-events-auto absolute right-2 left-2 h-1.5 rounded-full bg-black/50 shadow-[0_0_4px_#0008] ${explorer || !cardName ? "bottom-2" : "bottom-[32px]"}`}
      />
      {/* 複数選んでいるときだけ、選んだ順の番号を出す（1枚だけのときは枠の色だけ） */}
      {selected && order !== undefined && (
        <span className="absolute top-1.5 left-1.5 grid h-6 min-w-6 place-items-center rounded-full bg-accent px-1 text-xs font-bold text-accent-ink">
          {order}
        </span>
      )}
      {onFav && (
        <button
          aria-label={m.fav ? "お気に入りから外す" : "お気に入りに追加"}
          aria-pressed={m.fav}
          onClick={(e) => {
            e.stopPropagation();
            onFav();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          className={`absolute top-1 right-1 grid h-8 w-8 place-items-center rounded-full bg-black/40 text-white transition ${
            m.fav
              ? "text-yellow-300 opacity-100"
              : "opacity-0 group-hover:opacity-100 focus:opacity-100"
          }`}
        >
          <Icon name="star" size={16} />
        </button>
      )}
      {extra}
    </>
  );
  // 元の画像の縦横比（分からなければ正方形）。Windows 風では、この形のまま枠に収める
  const ratio = m.width && m.height ? m.width / m.height : 1;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={m.name}
      data-media={m.id}
      data-name="画像"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") onDoubleClick?.();
        if (e.key === " ") {
          e.preventDefault();
          onClick(e as unknown as React.MouseEvent);
        }
      }}
      className={
        explorer
          ? `group relative flex cursor-default flex-col items-center gap-1 rounded-[6px] border p-1.5 outline-none select-none ${
              selected ? "border-accent/50 bg-accent/15" : "border-transparent hover:bg-tint focus-visible:bg-tint"
            }`
          : `group relative aspect-square cursor-pointer overflow-hidden rounded-[12px] border border-line bg-card transition duration-300 select-none motion-safe:hover:-translate-y-[3px] active:scale-95 ${
              selected ? "outline-[3px] -outline-offset-1 outline-accent" : ""
            }`
      }
    >
      {explorer ? (
        <>
          <div className="relative flex aspect-square w-full items-end justify-center">
            {/* 画像の形の枠（拡大表示がこの位置から出てくる。ドラッグで渡すときの絵もこの形） */}
            <span
              className="relative block overflow-hidden"
              style={{ width: `${Math.min(1, ratio) * 100}%`, aspectRatio: ratio }}
            >
              <ThumbImage id={m.id} alt={m.name} />
              {/* 他のアプリ（デスクトップ・Photoshop など）へドラッグすると、元の画像のファイルとして渡す */}
              {drag}
            </span>
            {marks}
          </div>
          {renaming ? (
            nameField("h-6 w-full text-center text-xs")
          ) : (
            // 長い名前は2行まで（全部はカーソルを合わせると出る）
            <span
              title={labelOf(m, showExt)}
              className="line-clamp-2 w-full text-center text-xs leading-4 [overflow-wrap:anywhere]"
            >
              {labelOf(m, showExt)}
            </span>
          )}
        </>
      ) : (
        <>
          <ThumbImage id={m.id} alt={m.name} />
          {/* 他のアプリ（デスクトップ・Photoshop など）へドラッグすると、元の画像のファイルとして渡す */}
          {drag}
          {/* 名前を出さない設定でも、名前を変えている間は入力欄を出す */}
          {renaming ? (
            nameField("absolute right-2 bottom-2 left-2 h-6 text-xs font-bold")
          ) : (
            cardName && <span className="pointer-events-none absolute bottom-2 left-2 max-w-[calc(100%-16px)] truncate rounded-[10px] bg-black/25 px-2.5 py-px text-xs font-bold text-white backdrop-blur-md [text-shadow:0_1px_3px_#000,0_0_8px_#000a]">
              {labelOf(m, showExt)}
            </span>
          )}
          {marks}
        </>
      )}
    </div>
  );
}
