// Data model + live-simulated telemetry for the bonded mesh control plane.
// This mirrors the shape your Capacitor native plugin / VPS API would return,
// so the UI can later be pointed at real data with minimal changes.

export type LinkStatus = 'healthy' | 'degraded' | 'down'
export type Transport = 'wifi' | 'bluetooth' | 'host'
export type DeviceKind = 'android' | 'ipad' | 'iphone'

export interface Uplink {
  id: string
  carrier: string
  hardware: string
  status: LinkStatus
  enabled: boolean
  // percent 0-100
  signal: number
  // Mbps
  down: number
  up: number
  latencyMs: number
  band: string
}

export interface MeshDevice {
  id: string
  name: string
  model: string
  kind: DeviceKind
  transport: Transport
  online: boolean
  // Mbps currently pulled through the bond
  usage: number
  ip: string
}

export interface MeshSnapshot {
  uplinks: Uplink[]
  devices: MeshDevice[]
  aggregateDown: number
  aggregateUp: number
  activeLinks: number
  failoverArmed: boolean
}

// ---- Static registry of your actual gear (2 independent networks) ----

export const INITIAL_UPLINKS: Uplink[] = [
  {
    id: 'tmobile',
    carrier: 'T-Mobile',
    hardware: 'Netgear Nighthawk M7 Pro',
    status: 'healthy',
    enabled: true,
    signal: 82,
    down: 214,
    up: 41,
    latencyMs: 38,
    band: '5G n41',
  },
  {
    id: 'att',
    carrier: 'AT&T',
    hardware: 'AT&T Prepaid 5G Hotspot',
    status: 'healthy',
    enabled: true,
    signal: 71,
    down: 168,
    up: 28,
    latencyMs: 44,
    band: '5G n77',
  },
]

export const INITIAL_DEVICES: MeshDevice[] = [
  { id: 'd1', name: 'Host — S26 Ultra', model: 'Galaxy S26 Ultra', kind: 'android', transport: 'host', online: true, usage: 46, ip: '10.8.0.1' },
  { id: 'd2', name: 'S26 Ultra', model: 'Galaxy S26 Ultra', kind: 'android', transport: 'wifi', online: true, usage: 22, ip: '10.8.0.2' },
  { id: 'd3', name: 'S22+', model: 'Galaxy S22+', kind: 'android', transport: 'wifi', online: true, usage: 8, ip: '10.8.0.3' },
  { id: 'd4', name: 'A17 (Cricket)', model: 'Galaxy A17', kind: 'android', transport: 'wifi', online: true, usage: 5, ip: '10.8.0.4' },
  { id: 'd5', name: 'A17 (US Mobile)', model: 'Galaxy A17', kind: 'android', transport: 'bluetooth', online: true, usage: 2, ip: '10.8.0.5' },
  { id: 'd6', name: 'Prepaid Android 1', model: 'Android', kind: 'android', transport: 'wifi', online: true, usage: 4, ip: '10.8.0.6' },
  { id: 'd7', name: 'Prepaid Android 2', model: 'Android', kind: 'android', transport: 'bluetooth', online: false, usage: 0, ip: '10.8.0.7' },
  { id: 'd8', name: 'Prepaid Android 3', model: 'Android', kind: 'android', transport: 'wifi', online: true, usage: 3, ip: '10.8.0.8' },
  { id: 'd9', name: 'iPad Pro', model: 'iPad Pro', kind: 'ipad', transport: 'wifi', online: true, usage: 31, ip: '10.8.0.9' },
  { id: 'd10', name: 'iPad Air', model: 'iPad Air', kind: 'ipad', transport: 'wifi', online: true, usage: 12, ip: '10.8.0.10' },
  { id: 'd11', name: 'iPhone 15', model: 'iPhone 15', kind: 'iphone', transport: 'wifi', online: true, usage: 18, ip: '10.8.0.11' },
  { id: 'd12', name: 'iPhone 14', model: 'iPhone 14', kind: 'iphone', transport: 'bluetooth', online: true, usage: 6, ip: '10.8.0.12' },
]

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function jitter(value: number, amount: number) {
  return value + (Math.random() - 0.5) * amount
}

function statusFromSignal(signal: number): LinkStatus {
  if (signal < 18) return 'down'
  if (signal < 45) return 'degraded'
  return 'healthy'
}

// Advance one telemetry tick. Enabled uplinks drift naturally; disabled ones drop.
export function tickUplinks(uplinks: Uplink[]): Uplink[] {
  return uplinks.map((u) => {
    if (!u.enabled) {
      return { ...u, status: 'down', signal: 0, down: 0, up: 0, latencyMs: 0 }
    }
    const signal = clamp(jitter(u.signal, 10), 6, 98)
    const status = statusFromSignal(signal)
    const factor = signal / 100
    const baseDown = u.carrier === 'T-Mobile' ? 260 : 200
    const baseUp = u.carrier === 'T-Mobile' ? 48 : 34
    return {
      ...u,
      signal: Math.round(signal),
      status,
      down: status === 'down' ? 0 : Math.round(clamp(jitter(baseDown * factor, 40), 0, 400)),
      up: status === 'down' ? 0 : Math.round(clamp(jitter(baseUp * factor, 10), 0, 80)),
      latencyMs: status === 'down' ? 0 : Math.round(clamp(jitter(40 / factor, 12), 22, 180)),
    }
  })
}

export function buildSnapshot(uplinks: Uplink[], devices: MeshDevice[]): MeshSnapshot {
  const live = uplinks.filter((u) => u.enabled && u.status !== 'down')
  const aggregateDown = live.reduce((s, u) => s + u.down, 0)
  const aggregateUp = live.reduce((s, u) => s + u.up, 0)
  return {
    uplinks,
    devices,
    aggregateDown,
    aggregateUp,
    activeLinks: live.length,
    failoverArmed: live.length >= 2,
  }
}
