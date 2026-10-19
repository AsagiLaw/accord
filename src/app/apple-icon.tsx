import { ImageResponse } from "next/og";
import { Icon } from "@/components/Icon";

// iPhone・iPad で「ホーム画面に追加」したときのアイコン（PNG）。印は icon.svg と同じ。
// 角は iPhone の側で丸めるので、四角いまま塗りつぶす

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#00757f", color: "#fff" }}>
        <Icon name="note" size={100} />
      </div>
    ),
    size,
  );
}
