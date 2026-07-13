// MeshDrop — device-to-device file & media sharing across the mesh.
//
// Same seam pattern as mesh-client.ts:
//   • SimulatedDropClient — runs in the browser / v0 preview with demo peers
//     and animated transfers, so the UI is fully explorable offline.
//   • RelayDropClient — talks to the MeshDrop relay running on the VPS droplet
//     (native/scripts/meshdrop-relay.js). Every device on the bond can reach
//     the relay, so any phone/tablet shares files without a per-device install.
//
// The UI depends only on DropClient, so switching to the live relay is a swap.

export type PeerKind = 'android' | 'iphone' | 'ipad' | 'unknown'

export interface MeshPeer {
  id: string
  name: string
  kind: PeerKind
  online: boolean
  self?: boolean
}

export type TransferDirection = 'incoming' | 'outgoing'
export type TransferStatus = 'pending' | 'active' | 'complete' | 'failed'

export interface Transfer {
  id: string
  name: string
  size: number
  mime: string
  direction: TransferDirection
  peerName: string
  progress: number // 0..1
  status: TransferStatus
  url?: string // download URL once complete (relay mode)
  error?: string
  createdAt: number
}

export interface DropSnapshot {
  peers: MeshPeer[]
  transfers: Transfer[]
  online: boolean
}

export interface DropClient {
  readonly mode: 'simulated' | 'relay'
  /** Kick off sending files to a peer (id, or 'all' to broadcast). */
  send(files: File[], peerId: string): void
  /** Latest state; advances simulated transfers one tick. */
  poll(): DropSnapshot
  /** Dismiss a transfer from the feed. */
  dismiss(id: string): void
}

// ---- helpers ----

let counter = 0
function uid(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now().toString(36)}-${counter}`
}

function kindFromName(name: string): PeerKind {
  const n = name.toLowerCase()
  if (n.includes('iphone')) return 'iphone'
  if (n.includes('ipad')) return 'ipad'
  if (n.includes('galaxy') || n.includes('android') || n.includes('pixel')) return 'android'
  return 'unknown'
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

// ---- Simulated client (browser / preview) ----

class SimulatedDropClient implements DropClient {
  readonly mode = 'simulated' as const
  private peers: MeshPeer[] = [
    { id: 'self', name: 'This device', kind: 'android', online: true, self: true },
    { id: 'p1', name: 'iPad Pro', kind: 'ipad', online: true },
    { id: 'p2', name: 'iPhone 15', kind: 'iphone', online: true },
    { id: 'p3', name: 'Galaxy S22+', kind: 'android', online: true },
  ]
  private transfers: Transfer[] = []
  private lastIncoming = Date.now()

  send(files: File[], peerId: string): void {
    const peer = this.peers.find((p) => p.id === peerId)
    const peerName = peerId === 'all' ? 'All devices' : peer?.name ?? 'Unknown'
    for (const file of files) {
      this.transfers.unshift({
        id: uid('tx'),
        name: file.name,
        size: file.size,
        mime: file.type || 'application/octet-stream',
        direction: 'outgoing',
        peerName,
        progress: 0,
        status: 'active',
        createdAt: Date.now(),
      })
    }
  }

  poll(): DropSnapshot {
    // Advance active transfers; simulate a realistic mesh-speed transfer.
    this.transfers = this.transfers.map((t) => {
      if (t.status !== 'active') return t
      // ~large chunk per tick to feel fast on the local mesh.
      const step = Math.max(0.08, Math.min(0.34, (6 * 1024 * 1024) / Math.max(t.size, 1)))
      const progress = Math.min(1, t.progress + step)
      return progress >= 1
        ? { ...t, progress: 1, status: 'complete' as const }
        : { ...t, progress }
    })

    // Occasionally receive a demo file so the incoming path is visible.
    if (Date.now() - this.lastIncoming > 14000 && this.transfers.length < 8) {
      this.lastIncoming = Date.now()
      const samples = [
        { name: 'IMG_4821.jpg', size: 3_820_000, mime: 'image/jpeg' },
        { name: 'clip_sunset.mp4', size: 24_600_000, mime: 'video/mp4' },
        { name: 'notes.pdf', size: 512_000, mime: 'application/pdf' },
      ]
      const s = samples[Math.floor(Math.random() * samples.length)]
      const from = this.peers.filter((p) => !p.self)
      this.transfers.unshift({
        id: uid('tx'),
        name: s.name,
        size: s.size,
        mime: s.mime,
        direction: 'incoming',
        peerName: from[Math.floor(Math.random() * from.length)].name,
        progress: 0,
        status: 'active',
        createdAt: Date.now(),
      })
    }

    return { peers: this.peers, transfers: this.transfers, online: true }
  }

  dismiss(id: string): void {
    this.transfers = this.transfers.filter((t) => t.id !== id)
  }
}

// ---- Relay client (talks to the VPS relay over HTTP) ----

interface RelayPeer {
  id: string
  name: string
  online: boolean
}
interface RelayFile {
  id: string
  name: string
  size: number
  mime: string
  from: string
  createdAt: number
}

class RelayDropClient implements DropClient {
  readonly mode = 'relay' as const
  private base: string
  private selfName: string
  private peers: MeshPeer[] = []
  private transfers: Transfer[] = []
  private online = false
  private seenInbox = new Set<string>()

  constructor(base: string, selfName: string) {
    this.base = base.replace(/\/$/, '')
    this.selfName = selfName
    void this.refresh()
  }

  send(files: File[], peerId: string): void {
    for (const file of files) {
      const tx: Transfer = {
        id: uid('tx'),
        name: file.name,
        size: file.size,
        mime: file.type || 'application/octet-stream',
        direction: 'outgoing',
        peerName: peerId === 'all' ? 'All devices' : this.peers.find((p) => p.id === peerId)?.name ?? 'peer',
        progress: 0,
        status: 'active',
        createdAt: Date.now(),
      }
      this.transfers.unshift(tx)
      void this.upload(file, peerId, tx.id)
    }
  }

  private async upload(file: File, peerId: string, txId: string): Promise<void> {
    try {
      // Raw-body upload so the relay stays dependency-free (no multipart parse).
      // Metadata rides in the query string; the body is the file bytes.
      const qs = new URLSearchParams({
        to: peerId,
        from: this.selfName,
        name: file.name,
        mime: file.type || 'application/octet-stream',
      })
      const res = await fetch(`${this.base}/upload?${qs.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      })
      if (!res.ok) throw new Error(`relay ${res.status}`)
      this.setTx(txId, { progress: 1, status: 'complete' })
    } catch (e) {
      this.setTx(txId, { status: 'failed', error: e instanceof Error ? e.message : 'upload failed' })
    }
  }

  private setTx(id: string, patch: Partial<Transfer>): void {
    this.transfers = this.transfers.map((t) => (t.id === id ? { ...t, ...patch } : t))
  }

  private async refresh(): Promise<void> {
    try {
      const [peersRes, inboxRes] = await Promise.all([
        fetch(`${this.base}/peers?self=${encodeURIComponent(this.selfName)}`),
        fetch(`${this.base}/inbox?self=${encodeURIComponent(this.selfName)}`),
      ])
      this.online = peersRes.ok
      if (peersRes.ok) {
        const data = (await peersRes.json()) as { peers: RelayPeer[] }
        this.peers = [
          { id: 'self', name: this.selfName, kind: kindFromName(this.selfName), online: true, self: true },
          ...data.peers
            .filter((p) => p.name !== this.selfName)
            .map((p) => ({ id: p.id, name: p.name, kind: kindFromName(p.name), online: p.online })),
        ]
      }
      if (inboxRes.ok) {
        const data = (await inboxRes.json()) as { files: RelayFile[] }
        for (const f of data.files) {
          if (this.seenInbox.has(f.id)) continue
          this.seenInbox.add(f.id)
          this.transfers.unshift({
            id: f.id,
            name: f.name,
            size: f.size,
            mime: f.mime,
            direction: 'incoming',
            peerName: f.from,
            progress: 1,
            status: 'complete',
            url: `${this.base}/download/${f.id}`,
            createdAt: f.createdAt,
          })
        }
      }
    } catch {
      this.online = false
    }
  }

  poll(): DropSnapshot {
    void this.refresh()
    return { peers: this.peers, transfers: this.transfers, online: this.online }
  }

  dismiss(id: string): void {
    this.transfers = this.transfers.filter((t) => t.id !== id)
  }
}

let dropClient: DropClient | null = null

/**
 * Returns the relay client when a relay base URL is configured (native build
 * on the mesh), otherwise the in-browser simulation. `relayBase` comes from the
 * bond config (host + relay port).
 */
export function getDropClient(relayBase?: string, selfName = 'This device'): DropClient {
  if (dropClient) return dropClient
  if (relayBase && relayBase.trim().length > 0) {
    dropClient = new RelayDropClient(relayBase, selfName)
  } else {
    dropClient = new SimulatedDropClient()
  }
  return dropClient
}

/** Reset the cached client (used when relay config changes). */
export function resetDropClient(): void {
  dropClient = null
}
