/**
 * 画面を切り替えたとき：サーバーの返事を待たずに、押したらすぐ移動して、中身はあとから出す
 * （これが無いと、URL に ID が入る画面では、返事が来るまで前の画面のまま止まって見える）
 */
export default function Loading() {
  return <p className="loading text-muted">読み込み中…</p>;
}
