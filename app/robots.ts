import type { MetadataRoute } from "next";

// Block well-behaved crawlers from indexing any path (tool is password-gated).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        disallow: "/",
      },
    ],
  };
}
