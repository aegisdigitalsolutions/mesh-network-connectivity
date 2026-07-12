// The seam between UI and the bonding engine.
//
// Today: SimulatedMeshClient generates live telemetry in-browser.
// In the Capacitor build: if the native plugin (window.MeshBonding) is present,
// NativeMeshClient forwards to it — the same UI drives the real VpnService +
// ConnectivityManager bond described in docs/vps-bonding-setup.md.
//
// The UI only depends on this interface, so going live is a drop-in swap.

import {
  tickUplinks,
  buildSnapshot,
  type Uplink,
  type MeshSnapshot,
} from './mesh-data'
import type { BondConfig } from './mesh-config'
import { installNativeBridge } from './native-adapter'

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface MeshClient {
  readonly mode: 'simulated' | 'native'
  connect(config: BondConfig): Promise<void>
  disconnect(): Promise<void>
  getState(): ConnectionState
  setUplinkEnabled(id: string, enabled: boolean): void
  // Returns the latest snapshot; advances simulated telemetry one tick.
  poll(): MeshSnapshot
}

// ---- Simulated client (browser / v0 preview) ----

class SimulatedMeshClient implements MeshClient {
  readonly mode = 'simulated' as const
  // No preset gear — nothing to simulate until a real source reports in.
  private uplinks: Uplink[] = []
  private state: ConnectionState = 'disconnected'

  async connect(): Promise<void> {
    this.state = 'connecting'
    await new Promise((r) => setTimeout(r, 600))
    this.state = 'connected'
  }

  async disconnect(): Promise<void> {
    this.state = 'disconnected'
  }

  getState(): ConnectionState {
    return this.state
  }

  setUplinkEnabled(id: string, enabled: boolean): void {
    this.uplinks = this.uplinks.map((u) => (u.id === id ? { ...u, enabled } : u))
  }

  poll(): MeshSnapshot {
    // Only advance live telemetry once connected; otherwise links read as down.
    if (this.state === 'connected') {
      this.uplinks = tickUplinks(this.uplinks)
    } else {
      this.uplinks = this.uplinks.map((u) => ({
        ...u,
        status: 'down',
        signal: 0,
        down: 0,
        up: 0,
        latencyMs: 0,
      }))
    }
    return buildSnapshot(this.uplinks, [])
  }
}

// ---- Native bridge client (Capacitor build) ----
// Expected shape of the injected plugin. Implemented in Kotlin/Swift.
interface NativeBonding {
  connect(opts: { host: string; port: number; key: string }): Promise<void>
  disconnect(): Promise<void>
  getSnapshot(): MeshSnapshot
  getState(): ConnectionState
  setUplinkEnabled(opts: { id: string; enabled: boolean }): void
}

declare global {
  interface Window {
    MeshBonding?: NativeBonding
  }
}

class NativeMeshClient implements MeshClient {
  readonly mode = 'native' as const
  constructor(private native: NativeBonding) {}

  async connect(config: BondConfig): Promise<void> {
    await this.native.connect({ host: config.host, port: config.port, key: config.key })
  }
  async disconnect(): Promise<void> {
    await this.native.disconnect()
  }
  getState(): ConnectionState {
    return this.native.getState()
  }
  setUplinkEnabled(id: string, enabled: boolean): void {
    this.native.setUplinkEnabled({ id, enabled })
  }
  poll(): MeshSnapshot {
    return this.native.getSnapshot()
  }
}

let client: MeshClient | null = null

// Returns the native client when running inside the Capacitor shell with the
// plugin installed, otherwise the in-browser simulation.
export function getMeshClient(): MeshClient {
  if (client) return client
  if (typeof window !== 'undefined') {
    // Installs window.MeshBonding when inside the native Android shell.
    // No-op in the browser, so the preview stays in simulation mode.
    installNativeBridge()
    if (window.MeshBonding) {
      client = new NativeMeshClient(window.MeshBonding)
      return client
    }
  }
  client = new SimulatedMeshClient()
  return client
}
