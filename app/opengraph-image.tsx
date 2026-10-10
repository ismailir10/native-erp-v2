import { ImageResponse } from "next/og";

export const alt = "Buku · Pembukuan yang bisa ditelusuri";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Same palette as globals.css; raster image rendering cannot read CSS custom properties. */
export default function OpenGraphImage() {
  return new ImageResponse(<div style={{ display: "flex", flexDirection: "column", justifyContent: "center", width: "100%", height: "100%", padding: 80, background: "#F4F2F0", color: "#0C0A08", fontFamily: "sans-serif" }}>
    <div style={{ display: "flex", alignItems: "center", fontSize: 72, fontWeight: 700 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 100, height: 100, marginRight: 24, borderRadius: 24, background: "#2152E8", color: "#ffffff" }}>B</div>Buku
    </div>
    <div style={{ display: "flex", marginTop: 48, fontSize: 48, lineHeight: 1.2 }}>Pembukuan yang bisa ditelusuri.</div>
    <div style={{ display: "flex", marginTop: 24, fontSize: 28, color: "#5F5B58" }}>Dokumen, buku besar, dan tutup buku dalam satu ruang kerja.</div>
  </div>, size);
}
