/** @type {import('next').NextConfig} */
const nextConfig = {
  // Internal-only tool: tell crawlers not to index ANY response (belt-and-suspenders
  // alongside the noindex <meta> in app/layout.tsx and app/robots.ts).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};
export default nextConfig;
