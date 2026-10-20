import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 開発中の「N」の印は、左下のアカウントの欄に重ならないよう右下に出す
  devIndicators: { position: "bottom-right" },
  // 開発中に localhost と 127.0.0.1 の2つのタブで、別々の人としてログインして試せるようにする（開発中だけ効く）
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
