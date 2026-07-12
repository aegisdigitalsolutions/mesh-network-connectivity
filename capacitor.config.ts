import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.meshlink.app',
  appName: 'MeshLink',
  // The Next.js static export lands here (see next.config.mjs CAPACITOR_BUILD).
  webDir: 'out',
  android: {
    // Allow the WebView to reach the dashboard's own bundled assets.
    allowMixedContent: true,
  },
}

export default config
