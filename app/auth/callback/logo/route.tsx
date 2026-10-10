import { ImageResponse } from "next/og";

/** PNG rather than SVG so the same hosted mark works in email clients. */
export function GET() {
  return new ImageResponse(<div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 20, background: "#2152E8", color: "white", fontSize: 54, fontWeight: 700 }}>B</div>, { width: 80, height: 80 });
}
