import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 開発中の「N」の印は、左下のアカウントの欄に重ならないよう右下に出す
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
