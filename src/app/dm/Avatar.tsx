/**
 * 人の丸いアイコン：名前の最初の1文字（絵文字も1文字として扱う）。
 * onAccent：選んでいる行など、アクセントの色の上に置くとき（同じ色で見えなくならないよう白地にする）
 */
export function Avatar({ name, size = 36, onAccent }: { name: string; size?: number; onAccent?: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full font-bold text-accent ${onAccent ? "bg-card" : "bg-tint"}`}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {Array.from(name.trim())[0] ?? "?"}
    </span>
  );
}
