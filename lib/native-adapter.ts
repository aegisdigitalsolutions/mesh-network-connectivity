// Bridges the Kotlin MeshBonding plugin to the UI's data model.
//
// The native plugin (BondVpnService) emits a telemetry snapshot shaped around
// radios ("wifi", "cell"). The UI, however, speaks the MeshSnapshot model in
// lib/mesh-data.ts (carrier Uplink[] + device roster + aggregates). This adapter
// installs window.MeshBonding with the exact NativeBonding contract that
// mesh-client.ts expects, translating native radio telemetry into UI Uplinks.
//
// Dependency-free by design: instead of importing "@capacitor/core" (which the
// web bundle does not ship), it reads the `window.Capacitor` runtime that the
// native Android shell injects. On the web (v0 preview / static export) that
// global is absent, so installNativeBridge() is a no-op and the app stays in
// simulation mode. It only activates inside the installed Android APK.

import {
  buildSnapshot,
  type Uplink,
  type LinkStatus,
  type MeshDevice,
  type DeviceKind,
  type Transport,
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
interface NativeDevice {
  id: string
  name: string
  model?: string
  kind?: string
  transport?: string
  online: boolean
  usage?: number
  ip: string
}
interface NativeSnapshot {
  state: ConnectionState
  uplinks: NativeUplink[]
  devices?: NativeDevice[]
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

// The Capacitor runtime object injected by the native WebView. Only the members
// this adapter needs are declared. Note: `registerPlugin` is a @capacitor/core
// export and is NOT guaranteed to exist on the natively-injected global — the
// reliably-present surface is `Plugins` + `isNativePlatform`/`getPlatform`.
interface CapacitorRuntime {
  isNativePlatform?: () => boolean
  getPlatform?: () => string
  registerPlugin?: <T>(name: string) => T
  Plugins?: Record<string, unknown>
}

function getCapacitor(): CapacitorRuntime | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { Capacitor?: CapacitorRuntime }).Capacitor
}

function isNative(cap: CapacitorRuntime | undefined): boolean {
  if (!cap) return false
  try {
    if (typeof cap.isNativePlatform === 'function') return cap.isNativePlatform()
    if (typeof cap.getPlatform === 'function') return cap.getPlatform() !== 'web'
  } catch {
    /* fall through */
  }
  // If a Plugins bag with our plugin exists, we're clearly in the native shell.
  return !!cap.Plugins && 'MeshBonding' in cap.Plugins
}

// Resolve the native plugin proxy without depending on registerPlugin being
// present on the injected global. Prefer the always-populated Plugins bag.
function resolvePlugin(cap: CapacitorRuntime): NativePlugin | undefined {
  const fromBag = cap.Plugins?.['MeshBonding'] as NativePlugin | undefined
  if (fromBag) return fromBag
  if (typeof cap.registerPlugin === 'function') {
    return cap.registerPlugin<NativePlugin>('MeshBonding')
  }
  return undefined
}

// Everything below is built purely from what the native plugin reports. No
// preset gear: uplinks and devices appear only as the bond actually sees them.
let currentUplinks: Uplink[] = []
let currentDevices: MeshDevice[] = []
let currentState: ConnectionState = 'disconnected'

function mapStatus(status: string, enabled: boolean): LinkStatus {
  if (!enabled || status === 'disabled' || status === 'down') return 'down'
  if (status === 'active') return 'healthy'
  return 'degraded'
}

const DEVICE_KINDS: DeviceKind[] = ['android', 'ipad', 'iphone']
const TRANSPORTS: Transport[] = ['wifi', 'bluetooth', 'host']

function mapUplink(n: NativeUplink): Uplink {
  const status = mapStatus(n.status, n.enabled)
  const live = status !== 'down'
  return {
    id: n.id,
    carrier: n.name,
    hardware: n.type ?? '',
    status,
    enabled: n.enabled,
    // native reports a single throughput figure; surface it as down, and a
    // rough up estimate until per-direction stats are wired in glorytun show.
    down: live ? Math.round(n.telemetry.throughputMbps) : 0,
    up: live ? Math.round(n.telemetry.throughputMbps * 0.15) : 0,
    latencyMs: live ? Math.round(n.telemetry.latencyMs) : 0,
    signal: status === 'healthy' ? 75 : status === 'degraded' ? 40 : 0,
    band: '',
  }
}

function mapDevice(d: NativeDevice): MeshDevice {
  const kind = (DEVICE_KINDS as string[]).includes(d.kind ?? '')
    ? (d.kind as DeviceKind)
    : 'android'
  const transport = (TRANSPORTS as string[]).includes(d.transport ?? '')
    ? (d.transport as Transport)
    : 'wifi'
  return {
    id: d.id,
    name: d.name,
    model: d.model ?? '',
    kind,
    transport,
    online: d.online,
    usage: Math.round(d.usage ?? 0),
    ip: d.ip,
  }
}

function applyNative(ns: NativeSnapshot): void {
  currentUplinks = (ns.uplinks ?? []).map(mapUplink)
  currentDevices = (ns.devices ?? []).map(mapDevice)
  currentState = ns.state
}

function snapshot(): MeshSnapshot {
  return buildSnapshot(currentUplinks, currentDevices)
}

let installed = false

/** Idempotent. Installs window.MeshBonding only inside the native Android shell. */
export function installNativeBridge(): void {
  if (installed) return
  if (typeof window === 'undefined') return

  const cap = getCapacitor()
  if (!isNative(cap) || !cap) return // browser -> simulation

  const native = resolvePlugin(cap)
  if (!native) return // native shell but plugin missing -> stay simulated
  installed = true

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
