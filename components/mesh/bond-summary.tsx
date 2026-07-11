import { ArrowDown, ArrowUp, ShieldCheck, ShieldAlert } from 'lucide-react'
import type { MeshSnapshot } from '@/lib/mesh-data'
import { ThroughputGraph } from './throughput-graph'
import { cn } from '@/lib/utils'

interface BondSummaryProps {
  snapshot: MeshSnapshot
  history: number[]
}

export function BondSummary({ snapshot, history }: BondSummaryProps) {
  const { aggregateDown, aggregateUp, activeLinks, failoverArmed } = snapshot

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Bonded Throughput
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-5xl font-semibold tabular-nums text-foreground">
              {aggregateDown}
            </span>
            <span className="text-lg text-muted-foreground">Mbps</span>
          </div>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs',
            failoverArmed
              ? 'border-success/40 bg-success/10 text-success'
              : 'border-warning/40 bg-warning/10 text-warning',
          )}
        >
          {failoverArmed ? <ShieldCheck className="size-3.5" /> : <ShieldAlert className="size-3.5" />}
          {failoverArmed ? 'Failover armed' : 'No redundancy'}
        </span>
      </div>

      <div className="mt-4 h-14 w-full">
        <ThroughputGraph history={history} className="h-full w-full" />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat icon={<ArrowDown className="size-4 text-primary" />} label="Down" value={`${aggregateDown}`} unit="Mbps" />
        <Stat icon={<ArrowUp className="size-4 text-primary" />} label="Up" value={`${aggregateUp}`} unit="Mbps" />
        <Stat label="Active links" value={`${activeLinks}`} unit="of 2" />
      </div>
    </section>
  )
}

function Stat({
  icon,
  label,
  value,
  unit,
}: {
  icon?: React.ReactNode
  label: string
  value: string
  unit: string
}) {
  return (
    <div className="rounded-xl bg-muted/40 px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-xl font-semibold tabular-nums">{value}</span>
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>
    </div>
  )
}
