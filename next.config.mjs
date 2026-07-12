/** @type {import('next').NextConfig} */

// When building the Android APK in CI we need a static export (an `out/` folder
// Capacitor can wrap). This is gated behind CAPACITOR_BUILD so the normal v0
// preview / Vercel deploy keeps running as a dynamic Next.js app.
const isCapacitorBuild = process.env.CAPACITOR_BUILD === '1'

const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  ...(isCapacitorBuild
    ? {
        output: 'export',
        // Capacitor serves from file:// so relative asset paths are required.
        assetPrefix: './',
      }
    : {}),
}

export default nextConfig
