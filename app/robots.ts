import type { MetadataRoute } from "next";

// Internal-only tool — block all crawlers from every path. Serves /robots.txt.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
