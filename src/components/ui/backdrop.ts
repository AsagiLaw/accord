// ポップアップのまわり（暗いところ）を押して閉じる。押し始めも離したのもまわりのときだけ閉じる
// （中の文字をドラッグで選んで、まわりで離したときに閉じないように）

/** いちばん最近、押し始めたところ */
let downOn: EventTarget | null = null;
if (typeof window !== "undefined") window.addEventListener("pointerdown", (e) => (downOn = e.target), true);

/** 押し始めも離したのも、この要素そのもの（中の要素ではない）か */
export const isBackdropClick = (e: React.MouseEvent) => e.target === e.currentTarget && downOn === e.currentTarget;
