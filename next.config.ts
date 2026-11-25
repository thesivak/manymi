import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compress: true,
  poweredByHeader: false,
  serverExternalPackages: ["pdfkit", "postgres"],
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  outputFileTracingIncludes: {
    "/api/invoices/[id]/pdf": ["./src/assets/fonts/**/*"],
  },
};

export default nextConfig;
