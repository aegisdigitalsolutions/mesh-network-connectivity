// Persisted connection config for the bonding VPS + native plugin.
// This is app configuration (not user data), so localStorage is appropriate.

export interface BondConfig {
  // Your DigitalOcean droplet public IP or hostname
  host: string
  // glorytun UDP port (see docs/vps-bonding-setup.md)
  port: number
  // glorytun pre-shared key (hex) — pairs the client to your VPS
  key: string
  // Auto-start the bond when the app launches
  autoConnect: boolean
  // "Accelerator" — request the optimized transport profile (larger buffers,
  // MTU probing) to pair with the server-side tuning in accelerator-tune.sh.
  accelerator: boolean
}

export const DEFAULT_CONFIG: BondConfig = {
  // Your live DigitalOcean bonding droplet
  host: '159.203.67.127',
  port: 5000,
  key: '',
  autoConnect: false,
  accelerator: true,
}

const STORAGE_KEY = 'meshlink.bondConfig.v1'

export function loadConfig(): BondConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CONFIG
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<BondConfig>) }
  } catch {
    return DEFAULT_CONFIG
  }
}

export function saveConfig(config: BondConfig): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

export function isConfigured(config: BondConfig): boolean {
  return config.host.trim().length > 0 && config.key.trim().length > 0
}
