/**
 * 読み込み中のくるくる。入れ物（relative を付けたもの）の真ん中に重ねる。
 * すぐ読み終わるときにちらつかないよう、少し待ってからふわっと出す（globals.css の .skeleton）。
 * onImage：画像の上に重ねるとき。どんな画像の上でも見えるよう、暗い丸を敷いて少し大きく出す
 */
export function Spinner({ onImage = false, className = "" }: { onImage?: boolean; className?: string }) {
  const ring = (
    <span
      className={`block aspect-square animate-spin rounded-full border-2 ${onImage ? "w-9 border-white/25" : "w-[min(28px,40%)] border-ink/15"} border-t-accent`}
    />
  );
  return (
    <span role="status" aria-label="読み込み中" className={`skeleton pointer-events-none absolute inset-0 grid place-items-center ${className}`}>
      {onImage ? <span className="rounded-full bg-black/50 p-2.5">{ring}</span> : ring}
    </span>
  );
}
