import { ImageResponse } from "next/og";

// Default social-share card for the whole site. Static and brand-only (no DB
// call at image-build time) so it can never fail a page render; product pages
// override the title/description in their own metadata and fall back to this
// image. Satori only understands flexbox + inline styles — keep it simple.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt =
  "TCGROI — opening sealed product is almost always a losing bet";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0b0d10",
          backgroundImage:
            "radial-gradient(120% 130% at 0% 0%, rgba(234,179,8,0.16), transparent 55%)",
          padding: "72px",
          color: "#e6e8eb",
          fontFamily: "sans-serif",
        }}
      >
        {/* Lockup */}
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "64px",
              height: "64px",
              borderRadius: "16px",
              background: "#eab308",
              color: "#0b0d10",
              fontSize: "44px",
              fontWeight: 900,
            }}
          >
            ↓
          </div>
          <div style={{ display: "flex", fontSize: "40px", fontWeight: 800 }}>
            <div style={{ display: "flex" }}>TCG</div>
            <div style={{ display: "flex", color: "#eab308" }}>ROI</div>
          </div>
        </div>

        {/* Thesis */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: "82px",
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
            }}
          >
            <div style={{ display: "flex" }}>Opening sealed product</div>
            <div style={{ display: "flex" }}>
              <div style={{ display: "flex" }}>is almost always a&nbsp;</div>
              <div style={{ display: "flex", color: "#f87171" }}>losing bet.</div>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              marginTop: "28px",
              fontSize: "30px",
              color: "#8b93a1",
            }}
          >
            Expected value &amp; ROI for every sealed Pokémon &amp; One Piece
            product.
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
