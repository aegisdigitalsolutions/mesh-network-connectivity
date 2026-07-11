import { Router, ArrowDown, ArrowUp, Timer } from 'lucide-react'
import type { Uplink, LinkStatus } from '@/lib/mesh-data'
import { SignalBars } from './signal-bars'
import { cn } from '@/lib/utils'

interface UplinkCardProps {
  uplink: Uplink
  onToggle: (id: string) => void
}

const statusMeta: Record<LinkStatus, { label: string; dot: string; text: string }> = {
  healthy: { label: 'Healthy', dot: 'bg-success', text: 'text-success' },
  degraded: { label: 'Degraded', dot: 'bg-warning', text: 'text-warning' },
  down: { label: 'Down', dot: 'bg-destructive', text: 'text-destructive' },
}

export function UplinkCard({ uplink, onToggle }: UplinkCardProps) {
  const meta = statusMeta[uplink.enabled ? uplink.status : 'down']
  const tone =
    !uplink.enabled || uplink.status === 'down'
      ? 'muted'
      : uplink.status === 'degraded'
        ? 'warning'
        : 'primary'
  const carrierColor = uplink.id === 'tmobile' ? 'text-tmobile' : 'text-att'

  return (
    <article
      className={cn(
        'rounded-2xl border bg-card p-4 transition-opacity',
        !uplink.enabled && 'opacity-55',
      )}
      style={{ borderColor: `color-mix(in oklch, var(--${uplink.id === 'tmobile' ? 'tmobile' : 'att'}) 35%, var(--border))` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-muted/60">
            <Router className={cn('size-5', carrierColor)} />
          </div>
          <div>
            <h3 className="font-semibold leading-tight">{uplink.carrier}</h3>
            <p className="text-xs text-muted-foreground">{uplink.hardware}</p>
          </div>
        </div>
        <SignalBars signal={uplink.enabled ? uplink.signal : 0} tone={tone as never} />
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className={cn('inline-flex items-center gap-1.5 font-mono text-xs', meta.text)}>
          <span className={cn('size-2 rounded-full', meta.dot)} />
          {meta.label}
          <span className="text-muted-foreground">· {uplink.band}</span>
        </span>

        <button
          type="button"
          role="switch"
          aria-checked={uplink.enabled}
          aria-label={`Toggle ${uplink.carrier} uplink`}
          onClick={() => onToggle(uplink.id)}
          className={cn(
            'relative h-6 w-11 shrink-0 rounded-full border transition-colors',
            uplink.enabled ? 'border-primary/50 bg-primary/80' : 'border-border bg-muted',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 size-4 rounded-full bg-background transition-transform',
              uplink.enabled ? 'translate-x-5' : 'translate-x-0.5',
            )}
          />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border/60 pt-3 font-mono">
        <Metric icon={<ArrowDown className="size-3.5" />} value={uplink.enabled ? uplink.down : 0} unit="Mbps" />
        <Metric icon={<ArrowUp className="size-3.5" />} value={uplink.enabled ? uplink.up : 0} unit="Mbps" />
        <Metric icon={<Timer className="size-3.5" />} value={uplink.enabled ? uplink.latencyMs : 0} unit="ms" />
      </div>
    </article>
  )
}

function Metric({ icon, value, unit }: { icon: React.ReactNode; value: number; unit: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-sm tabular-nums text-foreground">
        {value}
        <span className="ml-0.5 text-[10px] text-muted-foreground">{unit}</span>
      </span>
    </div>
  )
}
