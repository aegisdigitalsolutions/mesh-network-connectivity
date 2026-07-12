// Bridges the Kotlin MeshBonding plugin to the UI's data model.
//
// The native plugin (BondVpnService) emits a telemetry snapshot shaped around
// radios ("wifi", "cell"). The UI, however, speaks the MeshSnapshot model in
// lib/mesh-data.ts (carrier Uplink[] + device roster + aggregates). This adapter
// installs window.MeshBonding with the exact NativeBonding contract that
// mesh-client.ts expects, translating native radio telemetry into UI Uplinks.
//
// On the web (v0 preview / static export in a browser) Capacitor reports a
// non-native platform, so installNativeBridge() is a no-op and the app stays in
// simulation mode. It only activates inside the installed Android APK.

import { Capacitor, registerPlugin } from '@capacitor/core'
import {
  INITIAL_UPLINKS,
  INITIAL_DEVICES,
  buildSnapshot,
  type Uplink,
  type LinkStatus,
  type MeshSnapshot,
} from './mesh-data'
import type { ConnectionState } from './mesh-client'

interface NativeUplinkTelemetry {
  throughputMbps: number
  latencyMs: number
  bytesTransferred: number
}
interface NativeUplink {
  id: string // "wifi" | "cell"
  name: string
  type: string
  status: string // "active" | "down" | "disabled"
  enabled: boolean
  telemetry: NativeUplinkTelemetry
}
interface NativeSnapshot {
  state: ConnectionState
  uplinks: NativeUplink[]
  serverHost: string
  timestamp: number
}

interface NativePlugin {
  connect(opts: { host: string; port: number; key: string }): Promise<void>
  disconnect(): Promise<void>
  getSnapshot(): Promise<NativeSnapshot>
  getState(): Promise<{ state: ConnectionState }>
  setUplinkEnabled(opts: { id: string; enabled: boolean }): Promise<void>
  addListener(event: string, cb: (data: NativeSnapshot) => void): void
}

// Which native radio feeds each UI uplink slot. On the host phone the Wi-Fi
// link is the connection out to the M7 (T-Mobile) hotspot; the phone's own SIM
// is the cellular path (mapped to the AT&T slot). Tune on-device if needed.
const SLOT_TO_RADIO: Record<string, string> = { tmobile: 'wifi', att: 'cell' }

let currentUplinks: Uplink[] = INITIAL_UPLINKS.map((u) => downed(u))
let currentState: ConnectionState = 'disconnected'

function downed(u: Uplink): Uplink {
  return { ...u, status: 'down', signal: 0, down: 0, up: 0, latencyMs: 0 }
}

function mapStatus(status: string, enabled: boolean): LinkStatus {
  if (!enabled || status === 'disabled' || status === 'down') return 'down'
  if (status === 'active') return 'healthy'
  return 'degraded'
}

function applyNative(ns: NativeSnapshot): void {
  const byRadio: Record<string, NativeUplink> = {}
  for (const u of ns.uplinks ?? []) byRadio[u.id] = u

  currentUplinks = INITIAL_UPLINKS.map((base) => {
    const n = byRadio[SLOT_TO_RADIO[base.id]]
    if (!n) return downed(base)
    const status = mapStatus(n.status, n.enabled)
    if (status === 'down') return { ...downed(base), enabled: n.enabled }
    return {
      ...base,
      enabled: n.enabled,
      status,
      // native reports a single throughput figure; surface it as down, and a
      // rough up estimate until per-direction stats are wired in glorytun show.
      down: Math.round(n.telemetry.throughputMbps),
      up: Math.round(n.telemetry.throughputMbps * 0.15),
      latencyMs: Math.round(n.telemetry.latencyMs),
      signal: status === 'degraded' ? 40 : 75,
    }
  })
  currentState = ns.state
}

function snapshot(): MeshSnapshot {
  return buildSnapshot(currentUplinks, INITIAL_DEVICES)
}

let installed = false

/** Idempotent. Installs window.MeshBonding only inside the native Android shell. */
export function installNativeBridge(): void {
  if (installed) return
  if (typeof window === 'undefined') return
  if (!Capacitor.isNativePlatform()) return // browser -> simulation mode
  installed = true

  const native = registerPlugin<NativePlugin>('MeshBonding')

  native.addListener('meshSnapshot', (s) => applyNative(s))
  // Prime the cache in case the app was relaunched while the VPN was already up.
  native.getSnapshot().then(applyNative).catch(() => {})
  native.getState().then((r) => { currentState = r.state }).catch(() => {})

  window.MeshBonding = {
    connect: (o) => native.connect(o),
    disconnect: () => native.disconnect(),
    getSnapshot: () => snapshot(), // sync — reads the translated cache
    getState: () => currentState, // sync
    setUplinkEnabled: (o) => {
      currentUplinks = currentUplinks.map((u) =>
        u.id === o.id ? { ...u, enabled: o.enabled } : u,
      )
      void native.setUplinkEnabled(o)
    },
  }
}
