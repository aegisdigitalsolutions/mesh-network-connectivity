'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Share2,
  Upload,
  Users,
  Smartphone,
  Tablet,
  Send,
  Download,
  Check,
  X,
  Loader2,
  FileImage,
  FileVideo,
  FileText,
  File as FileIcon,
} from 'lucide-react'
import {
  getDropClient,
  resetDropClient,
  formatBytes,
  type DropSnapshot,
  type MeshPeer,
  type Transfer,
} from '@/lib/meshdrop'
import { loadConfig } from '@/lib/mesh-config'
import { cn } from '@/lib/utils'

const EMPTY: DropSnapshot = { peers: [], transfers: [], online: false }

export function MeshDrop() {
  const [snap, setSnap] = useState<DropSnapshot>(EMPTY)
  const [target, setTarget] = useState<string>('all')
  const fileRef = useRef<HTMLInputElement>(null)
  const clientRef = useRef(getDropClient())

  // Rebuild the client if a relay is configured (host + relay port). Simulated
  // otherwise, so the preview is fully interactive.
  useEffect(() => {
    const cfg = loadConfig()
    if (cfg.relayPort && cfg.host) {
      resetDropClient() // drop the default simulated client, switch to relay
      clientRef.current = getDropClient(`http://${cfg.host}:${cfg.relayPort}`, 'This device')
    }
    setSnap(clientRef.current.poll())
  }, [])

  useEffect(() => {
    const interval = setInterval(() => setSnap(clientRef.current.poll()), 700)
    return () => clearInterval(interval)
  }, [])

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (files && files.length > 0) {
      clientRef.current.send(Array.from(files), target)
      setSnap(clientRef.current.poll())
    }
    e.target.value = '' // allow re-picking the same file
  }

  const peers = snap.peers.filter((p) => !p.self)
  const activeCount = snap.transfers.filter((t) => t.status === 'active').length

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 pb-28 pt-5">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary/15">
            <Share2 className="size-5 text-primary" />
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight">MeshDrop</h1>
            <p className="font-mono text-[11px] text-muted-foreground">
              {clientRef.current.mode === 'relay' ? 'Relay · live mesh' : 'Local share · demo'}
            </p>
          </div>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px]',
            snap.online
              ? 'border-success/40 bg-success/10 text-success'
              : 'border-border bg-muted/40 text-muted-foreground',
          )}
        >
          <Users className="size-3.5" />
          {peers.length} {peers.length === 1 ? 'device' : 'devices'}
        </span>
      </header>

      {/* Destination picker */}
      <section className="flex flex-col gap-2">
        <h2 className="px-1 font-mono text-xs uppercase tracking-widest text-muted-foreground">Send to</h2>
        <div className="flex flex-wrap gap-2">
          <TargetChip
            label="All devices"
            icon={<Users className="size-3.5" />}
            active={target === 'all'}
            onClick={() => setTarget('all')}
          />
          {peers.map((p) => (
            <TargetChip
              key={p.id}
              label={p.name}
              icon={<PeerIcon peer={p} />}
              active={target === p.id}
              dimmed={!p.online}
              onClick={() => setTarget(p.id)}
            />
          ))}
          {peers.length === 0 && (
            <span className="font-mono text-[11px] text-muted-foreground">No other devices on the mesh yet</span>
          )}
        </div>
      </section>

      {/* Drop / pick zone */}
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-primary/40 bg-primary/5 px-4 py-8 text-center transition-colors hover:bg-primary/10"
      >
        <Upload className="size-6 text-primary" />
        <span className="text-sm font-medium text-foreground">Tap to select files or photos</span>
        <span className="font-mono text-[10px] text-muted-foreground">
          Sends to {target === 'all' ? 'all devices' : snap.peers.find((p) => p.id === target)?.name ?? 'peer'}
        </span>
      </button>
      <input ref={fileRef} type="file" multiple className="hidden" onChange={onPick} aria-hidden />

      {/* Transfers */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Transfers</h2>
          {activeCount > 0 && (
            <span className="font-mono text-[11px] text-primary">{activeCount} active</span>
          )}
        </div>

        {snap.transfers.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-border bg-card/50 px-4 py-8 text-center">
            <Send className="size-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No transfers yet</p>
            <p className="font-mono text-[10px] text-muted-foreground">
              Files you send or receive appear here
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {snap.transfers.map((t) => (
              <TransferRow key={t.id} t={t} onDismiss={() => clientRef.current.dismiss(t.id)} />
            ))}
          </ul>
        )}
      </section>

      <p className="px-1 text-center font-mono text-[10px] leading-relaxed text-muted-foreground">
        {clientRef.current.mode === 'relay'
          ? 'Files relay through your VPS across the bonded mesh'
          : 'Demo mode · configure the relay port in settings to share for real'}
      </p>
    </div>
  )
}

function TargetChip({
  label,
  icon,
  active,
  dimmed,
  onClick,
}: {
  label: string
  icon: React.ReactNode
  active: boolean
  dimmed?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors',
        active
          ? 'border-primary/50 bg-primary/15 text-foreground'
          : 'border-border bg-card text-muted-foreground hover:text-foreground',
        dimmed && 'opacity-50',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function PeerIcon({ peer }: { peer: MeshPeer }) {
  if (peer.kind === 'ipad') return <Tablet className="size-3.5" />
  return <Smartphone className="size-3.5" />
}

function fileIcon(mime: string) {
  if (mime.startsWith('image/')) return <FileImage className="size-4 text-primary" />
  if (mime.startsWith('video/')) return <FileVideo className="size-4 text-primary" />
  if (mime.includes('pdf') || mime.startsWith('text/')) return <FileText className="size-4 text-primary" />
  return <FileIcon className="size-4 text-muted-foreground" />
}

function TransferRow({ t, onDismiss }: { t: Transfer; onDismiss: () => void }) {
  const pct = Math.round(t.progress * 100)
  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted/60">
          {fileIcon(t.mime)}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{t.name}</span>
          <span className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
            {t.direction === 'incoming' ? (
              <Download className="size-3" />
            ) : (
              <Send className="size-3" />
            )}
            {t.direction === 'incoming' ? 'from' : 'to'} {t.peerName} · {formatBytes(t.size)}
          </span>
        </div>
        <TransferStatusIcon t={t} onDismiss={onDismiss} />
      </div>

      {t.status === 'active' && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </li>
  )
}

function TransferStatusIcon({ t, onDismiss }: { t: Transfer; onDismiss: () => void }) {
  if (t.status === 'active') {
    return (
      <span className="flex items-center gap-1 font-mono text-[11px] text-primary">
        <Loader2 className="size-3.5 animate-spin" />
        {Math.round(t.progress * 100)}%
      </span>
    )
  }
  if (t.status === 'failed') {
    return (
      <button type="button" onClick={onDismiss} aria-label="Dismiss failed transfer" className="text-destructive">
        <X className="size-4" />
      </button>
    )
  }
  // complete
  if (t.direction === 'incoming' && t.url) {
    return (
      <a
        href={t.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Download ${t.name}`}
        className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-primary transition-colors hover:bg-primary/25"
      >
        <Download className="size-4" />
      </a>
    )
  }
  return (
    <button
      type="button"
      onClick={onDismiss}
      aria-label="Dismiss transfer"
      className="flex size-8 items-center justify-center rounded-lg bg-success/15 text-success"
    >
      <Check className="size-4" />
    </button>
  )
}
