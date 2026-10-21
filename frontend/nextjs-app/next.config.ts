import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (.next/standalone/server.js).
  output: 'standalone',
  // This app has its own lockfile inside the monorepo; keep tracing and Turbopack rooted here.
  outputFileTracingRoot: import.meta.dirname,
  turbopack: { root: import.meta.dirname },
  poweredByHeader: false,
}

export default nextConfig
