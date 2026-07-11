import { Smartphone, Tablet, Bluetooth, Wifi, Crown } from 'lucide-react'
import type { MeshDevice, Transport } from '@/lib/mesh-data'
import { cn } from '@/lib/utils'

interface DeviceListProps {
  devices: MeshDevice[]
}

const transportMeta: Record<Transport, { icon: typeof Wifi; label: string; className: string }> = {
  wifi: { icon: Wifi, label: 'Wi-Fi', className: 'text-primary' },
  bluetooth: { icon: Bluetooth, label: 'Bluetooth', className: 'text-att' },
  host: { icon: Crown, label: 'Host', className: 'text-warning' },
}

export function DeviceList({ devices }: DeviceListProps) {
  const online = devices.filter((d) => d.online).length

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <header className="flex items-center justify-between">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Mesh Devices
        </h2>
        <span className="font-mono text-xs text-muted-foreground">
          <span className="text-success">{online}</span> / {devices.length} online
        </span>
      </header>

      <ul className="mt-3 divide-y divide-border/60">
        {devices.map((device) => (
          <DeviceRow key={device.id} device={device} />
        ))}
      </ul>
    </section>
  )
}

function DeviceRow({ device }: { device: MeshDevice }) {
  const Transport = transportMeta[device.transport]
  const TransportIcon = Transport.icon
  const KindIcon = device.kind === 'ipad' ? Tablet : Smartphone

  return (
    <li className="flex items-center gap-3 py-2.5">
      <div
        className={cn(
          'flex size-9 items-center justify-center rounded-lg bg-muted/60',
          !device.online && 'opacity-40',
        )}
      >
        <KindIcon className="size-4 text-foreground" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className={cn('truncate text-sm font-medium', !device.online && 'text-muted-foreground')}>
            {device.name}
          </p>
          {device.transport === 'host' && (
            <span className="rounded bg-warning/15 px-1.5 py-px font-mono text-[9px] uppercase text-warning">
              gateway
            </span>
          )}
        </div>
        <p className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
          <TransportIcon className={cn('size-3', Transport.className)} />
          {Transport.label}
          <span aria-hidden>·</span>
          {device.ip}
        </p>
      </div>

      <div className="text-right">
        {device.online ? (
          <p className="text-sm tabular-nums">
            {device.usage}
            <span className="ml-0.5 text-[10px] text-muted-foreground">Mbps</span>
          </p>
        ) : (
          <p className="font-mono text-[11px] text-muted-foreground">offline</p>
        )}
      </div>
    </li>
  )
}
