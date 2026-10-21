import type { MetadataRoute } from "next";

/**
 * ホーム画面に追加したとき、アプリとして開くための決まり（PWA）。
 * アイコンは public/icons に置く（maskable は Android の丸や角丸に切られても絵が欠けないよう、四隅まで塗ったもの）
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Accord",
    short_name: "Accord",
    description: "イラストレーターとマネージャーのための依頼・メディア・チャット管理",
    lang: "ja",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f2f2f2",
    theme_color: "#00757f",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
