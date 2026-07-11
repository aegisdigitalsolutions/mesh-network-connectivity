'use client'

import { useEffect, useState } from 'react'
import { Activity, RadioTower } from 'lucide-react'
import {
  INITIAL_UPLINKS,
  INITIAL_DEVICES,
  tickUplinks,
  buildSnapshot,
  type Uplink,
} from '@/lib/mesh-data'
import { BondSummary } from './bond-summary'
import { UplinkCard } from './uplink-card'
import { DeviceList } from './device-list'

const HISTORY_LEN = 40

export function Dashboard() {
  const [uplinks, setUplinks] = useState<Uplink[]>(INITIAL_UPLINKS)
  const [history, setHistory] = useState<number[]>(() => Array(HISTORY_LEN).fill(0))

  const snapshot = buildSnapshot(uplinks, INITIAL_DEVICES)

  useEffect(() => {
    const interval = setInterval(() => {
      setUplinks((prev) => {
        const next = tickUplinks(prev)
        const total = next
          .filter((u) => u.enabled && u.status !== 'down')
          .reduce((s, u) => s + u.down, 0)
        setHistory((h) => [...h.slice(1), total])
        return next
      })
    }, 1200)
    return () => clearInterval(interval)
  }, [])

  function toggleUplink(id: string) {
    setUplinks((prev) =>
      prev.map((u) => (u.id === id ? { ...u, enabled: !u.enabled } : u)),
    )
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 pb-10 pt-5">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary/15">
            <RadioTower className="size-5 text-primary" />
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight">MeshLink</h1>
            <p className="font-mono text-[11px] text-muted-foreground">Bonded Network Control</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2.5 py-1 font-mono text-[11px] text-success">
          <Activity className="size-3.5" />
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-success" />
          </span>
          Live
        </span>
      </header>

      <BondSummary snapshot={snapshot} history={history} />

      <div className="flex items-center justify-between px-1">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Uplinks
        </h2>
        <span className="font-mono text-[11px] text-muted-foreground">2 independent networks</span>
      </div>
      <div className="flex flex-col gap-3">
        {uplinks.map((uplink) => (
          <UplinkCard key={uplink.id} uplink={uplink} onToggle={toggleUplink} />
        ))}
      </div>

      <DeviceList devices={snapshot.devices} />

      <p className="px-1 text-center font-mono text-[10px] leading-relaxed text-muted-foreground">
        Control plane · telemetry simulated · wire to your VPS bonding API + native plugin to go live
      </p>
    </div>
  )
}
