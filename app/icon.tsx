import { ImageResponse } from "next/og";

export const runtime = "edge";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/** Raster favicon — many clients ignore or mishandle SVG favicons. */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#08062D",
          borderRadius: 7,
        }}
      >
        <span
          style={{
            color: "#7B7BFF",
            fontSize: 19,
            fontWeight: 700,
            fontFamily:
              "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
          }}
        >
          A
        </span>
      </div>
    ),
    { ...size },
  );
}
