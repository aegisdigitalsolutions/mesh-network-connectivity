'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, RadioTower, Settings, Power, Loader2 } from 'lucide-react'
import { buildSnapshot, INITIAL_UPLINKS, INITIAL_DEVICES, type MeshSnapshot } from '@/lib/mesh-data'
import { getMeshClient, type ConnectionState } from '@/lib/mesh-client'
import { loadConfig, isConfigured, type BondConfig } from '@/lib/mesh-config'
import { BondSummary } from './bond-summary'
import { UplinkCard } from './uplink-card'
import { DeviceList } from './device-list'
import { SettingsDialog } from './settings-dialog'
import { cn } from '@/lib/utils'

const HISTORY_LEN = 40
const EMPTY_SNAPSHOT = buildSnapshot(
  INITIAL_UPLINKS.map((u) => ({ ...u, status: 'down' as const, signal: 0, down: 0, up: 0, latencyMs: 0 })),
  INITIAL_DEVICES,
)

export function Dashboard() {
  const [snapshot, setSnapshot] = useState<MeshSnapshot>(EMPTY_SNAPSHOT)
  const [history, setHistory] = useState<number[]>(() => Array(HISTORY_LEN).fill(0))
  const [state, setState] = useState<ConnectionState>('disconnected')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [config, setConfig] = useState<BondConfig | null>(null)
  const clientRef = useRef(getMeshClient())

  const configured = config ? isConfigured(config) : false

  const connect = useCallback(async (cfg: BondConfig) => {
    if (!isConfigured(cfg)) {
      setSettingsOpen(true)
      return
    }
    setState('connecting')
    try {
      await clientRef.current.connect(cfg)
      setState(clientRef.current.getState())
    } catch {
      setState('error')
    }
  }, [])

  const disconnect = useCallback(async () => {
    await clientRef.current.disconnect()
    setState('disconnected')
  }, [])

  // Load persisted config once, and auto-connect if requested.
  useEffect(() => {
    const cfg = loadConfig()
    setConfig(cfg)
    if (cfg.autoConnect && isConfigured(cfg)) {
      void connect(cfg)
    }
  }, [connect])

  // Telemetry poll loop — always running, driven by the active client.
  useEffect(() => {
    const interval = setInterval(() => {
      const snap = clientRef.current.poll()
      setSnapshot(snap)
      setHistory((h) => [...h.slice(1), snap.aggregateDown])
    }, 1200)
    return () => clearInterval(interval)
  }, [])

  function toggleUplink(id: string) {
    const target = snapshot.uplinks.find((u) => u.id === id)
    if (!target) return
    clientRef.current.setUplinkEnabled(id, !target.enabled)
  }

  const connected = state === 'connected'

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 pb-10 pt-5">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary/15">
            <RadioTower className="size-5 text-primary" />
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight">MeshLink</h1>
            <p className="font-mono text-[11px] text-muted-foreground">
              {clientRef.current.mode === 'native' ? 'Native bond · live' : 'Bonded Network Control'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ConnectionPill state={state} />
          <button
            type="button"
            aria-label="Connection settings"
            onClick={() => setSettingsOpen(true)}
            className="flex size-9 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
          >
            <Settings className="size-4" />
          </button>
        </div>
      </header>

      <BondSummary snapshot={snapshot} history={history} />

      <ConnectControl
        state={state}
        configured={configured}
        onConnect={() => config && connect(config)}
        onDisconnect={disconnect}
        onConfigure={() => setSettingsOpen(true)}
      />

      <div className="flex items-center justify-between px-1">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Uplinks</h2>
        <span className="font-mono text-[11px] text-muted-foreground">2 independent networks</span>
      </div>
      <div className={cn('flex flex-col gap-3 transition-opacity', !connected && 'opacity-60')}>
        {snapshot.uplinks.map((uplink) => (
          <UplinkCard key={uplink.id} uplink={uplink} onToggle={toggleUplink} />
        ))}
      </div>

      <DeviceList devices={snapshot.devices} />

      <p className="px-1 text-center font-mono text-[10px] leading-relaxed text-muted-foreground">
        {clientRef.current.mode === 'native'
          ? 'Live telemetry from native bonding plugin'
          : 'Control plane · telemetry simulated · configure your VPS to go live'}
      </p>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={(cfg) => setConfig(cfg)}
      />
    </div>
  )
}

function ConnectionPill({ state }: { state: ConnectionState }) {
  const meta = {
    connected: { text: 'text-success', border: 'border-success/40', bg: 'bg-success/10', label: 'Live', dot: 'bg-success' },
    connecting: { text: 'text-warning', border: 'border-warning/40', bg: 'bg-warning/10', label: 'Linking', dot: 'bg-warning' },
    disconnected: { text: 'text-muted-foreground', border: 'border-border', bg: 'bg-muted/40', label: 'Offline', dot: 'bg-muted-foreground' },
    error: { text: 'text-destructive', border: 'border-destructive/40', bg: 'bg-destructive/10', label: 'Error', dot: 'bg-destructive' },
  }[state]

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px]',
        meta.border,
        meta.bg,
        meta.text,
      )}
    >
      <Activity className="size-3.5" />
      {state === 'connected' && (
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
          <span className="relative inline-flex size-1.5 rounded-full bg-success" />
        </span>
      )}
      {state !== 'connected' && <span className={cn('size-1.5 rounded-full', meta.dot)} />}
      {meta.label}
    </span>
  )
}

function ConnectControl({
  state,
  configured,
  onConnect,
  onDisconnect,
  onConfigure,
}: {
  state: ConnectionState
  configured: boolean
  onConnect: () => void
  onDisconnect: () => void
  onConfigure: () => void
}) {
  if (!configured) {
    return (
      <button
        type="button"
        onClick={onConfigure}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-primary/40 bg-primary/5 font-medium text-primary transition-colors hover:bg-primary/10"
      >
        <Settings className="size-4" />
        Configure VPS to activate bond
      </button>
    )
  }

  if (state === 'connected') {
    return (
      <button
        type="button"
        onClick={onDisconnect}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-card font-medium text-foreground transition-colors hover:bg-muted"
      >
        <Power className="size-4 text-success" />
        Bonded · Tap to disconnect
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onConnect}
      disabled={state === 'connecting'}
      className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-70"
    >
      {state === 'connecting' ? (
        <>
          <Loader2 className="size-4 animate-spin" />
          Establishing bond…
        </>
      ) : (
        <>
          <Power className="size-4" />
          Connect bond
        </>
      )}
    </button>
  )
}
