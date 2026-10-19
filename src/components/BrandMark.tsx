/**
 * アプリの印（カップのキャラクター）。色の四角に、白で抜いた形を乗せる。
 * 形は public/brand-mark.png をマスクにして塗るので、色は文字の色（text-accent-ink）に合う。
 * global-error でも使うので、"use client" もデータの読み込みも持たない
 */
export function BrandMark({ size = 48, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-grid shrink-0 place-items-center bg-accent text-accent-ink ${className}`}
      style={{ width: size, height: size, borderRadius: size / 3 }}
    >
      <BrandShape size={Math.round(size * 0.82)} />
    </span>
  );
}

/** 印の形だけ（四角なし）。色は文字の色。左の列のダイレクトメッセージのボタンなどで、アイコンの代わりに使う */
export function BrandShape({ size = 24 }: { size?: number }) {
  const mask = "url(/brand-mark.png) center / contain no-repeat";
  return <span aria-hidden className="block shrink-0 bg-current" style={{ width: size, height: size, mask, WebkitMask: mask }} />;
}
