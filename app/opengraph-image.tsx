import { ImageResponse } from "next/og";

export const runtime = "edge";

export const alt = "ROI Calculator · Aneko AI";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Chat / social link previews use og:image, not the favicon. */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(145deg, #08062D 0%, #12104a 50%, #08062D 100%)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 24,
          }}
        >
          <span
            style={{
              color: "#7B7BFF",
              fontSize: 120,
              fontWeight: 700,
              fontFamily:
                "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
            }}
          >
            Aneko
          </span>
          <span
            style={{
              color: "rgba(255,255,255,0.85)",
              fontSize: 48,
              fontWeight: 600,
              fontFamily:
                "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
            }}
          >
            ROI Calculator
          </span>
        </div>
        <span
          style={{
            marginTop: 32,
            color: "rgba(255,255,255,0.5)",
            fontSize: 28,
            fontFamily:
              "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
          }}
        >
          Internal use
        </span>
      </div>
    ),
    { ...size },
  );
}
