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

// No preset gear. Uplinks and devices populate from live telemetry only —
// the native bonding plugin (on-device) or a real VPS feed. Until something
// actually reports in, both lists are empty and the UI shows a waiting state.

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
