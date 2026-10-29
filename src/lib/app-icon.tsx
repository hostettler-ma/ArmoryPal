import { ImageResponse } from "next/og";

/**
 * The app icon, drawn with Expo 2025 Noyama colors: a green tile with two
 * overlapping cards (borrow / bring). `padding` shrinks the art for maskable
 * icons, whose outer ~20% may be cropped by the OS.
 */
export function appIcon(size: number, { padding = 0, rounded = true } = {}) {
  const art = size * (1 - padding * 2);
  const card = (left: number, top: number, rotate: number, color: string) => (
    <div
      style={{
        position: "absolute",
        left: left * art,
        top: top * art,
        width: art * 0.36,
        height: art * 0.5,
        borderRadius: art * 0.05,
        background: color,
        border: `${Math.max(2, art * 0.025)}px solid #1f2a00`,
        transform: `rotate(${rotate}deg)`,
      }}
    />
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#99c41e",
          borderRadius: rounded ? size * 0.22 : 0,
        }}
      >
        <div style={{ position: "relative", width: art, height: art, display: "flex" }}>
          {card(0.2, 0.24, -12, "#00a59e")}
          {card(0.44, 0.24, 10, "#ffffff")}
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
