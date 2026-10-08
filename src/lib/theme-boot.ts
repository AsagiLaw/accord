// サーバー側のレイアウトからも読むので、"use client" を付けないファイルに置く
export const THEME_KEY = "irai-note:theme";

/** 最初の描画の前に <html data-theme> を付けて、ちらつきを防ぐスクリプト */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;
