'use client'

import { useEffect, useState } from 'react'
import { X, Server, KeyRound, Plug, Gauge } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  type BondConfig,
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  isConfigured,
} from '@/lib/mesh-config'

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  onSaved: (config: BondConfig) => void
}

export function SettingsDialog({ open, onClose, onSaved }: SettingsDialogProps) {
  const [config, setConfig] = useState<BondConfig>(DEFAULT_CONFIG)

  useEffect(() => {
    if (open) setConfig(loadConfig())
  }, [open])

  if (!open) return null

  function update<K extends keyof BondConfig>(key: K, value: BondConfig[K]) {
    setConfig((c) => ({ ...c, [key]: value }))
  }

  function handleSave() {
    saveConfig(config)
    onSaved(config)
    onClose()
  }

  const ready = isConfigured(config)

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-background/70 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Bonding connection settings"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-3xl border border-border bg-card p-5 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary/15">
              <Server className="size-5 text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold leading-tight">VPS Bonding</h2>
              <p className="font-mono text-[11px] text-muted-foreground">glorytun endpoint</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close settings"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-5 flex flex-col gap-4">
          <Field label="Droplet host" hint="Public IP or hostname of your VPS">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-input px-3">
              <Server className="size-4 shrink-0 text-muted-foreground" />
              <input
                value={config.host}
                onChange={(e) => update('host', e.target.value)}
                placeholder="203.0.113.10"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="h-11 w-full bg-transparent font-mono text-sm outline-none placeholder:text-muted-foreground/60"
              />
            </div>
          </Field>

          <Field label="Port" hint="glorytun UDP port">
            <input
              value={config.port}
              onChange={(e) => update('port', Number(e.target.value.replace(/\D/g, '')) || 0)}
              inputMode="numeric"
              placeholder="5000"
              className="h-11 w-full rounded-xl border border-border bg-input px-3 font-mono text-sm outline-none placeholder:text-muted-foreground/60"
            />
          </Field>

          <Field label="Pre-shared key" hint="Hex key from `glorytun keygen` on the VPS">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-input px-3">
              <KeyRound className="size-4 shrink-0 text-muted-foreground" />
              <input
                value={config.key}
                onChange={(e) => update('key', e.target.value)}
                type="password"
                placeholder="a1b2c3…"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="h-11 w-full bg-transparent font-mono text-sm outline-none placeholder:text-muted-foreground/60"
              />
            </div>
          </Field>

          <ToggleRow
            label="Auto-connect on launch"
            on={config.autoConnect}
            onToggle={() => update('autoConnect', !config.autoConnect)}
          />

          <ToggleRow
            label="Accelerator"
            hint="Optimized transport — larger buffers & MTU probing. Pair with accelerator-tune.sh on the droplet."
            icon={<Gauge className="size-4 shrink-0 text-primary" />}
            on={config.accelerator}
            onToggle={() => update('accelerator', !config.accelerator)}
          />
        </div>

        <button
          type="button"
          onClick={handleSave}
          className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Plug className="size-4" />
          Save connection
        </button>

        {!ready && (
          <p className="mt-3 text-center font-mono text-[10px] leading-relaxed text-muted-foreground">
            Host + key required. See docs/vps-bonding-setup.md to provision the droplet.
          </p>
        )}
      </div>
    </div>
  )
}

function ToggleRow({
  label,
  hint,
  icon,
  on,
  onToggle,
}: {
  label: string
  hint?: string
  icon?: React.ReactNode
  on: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      className="flex items-center justify-between gap-3 rounded-xl border border-border bg-input px-3 py-2.5 text-left"
    >
      <span className="flex items-start gap-2">
        {icon}
        <span className="flex flex-col">
          <span className="text-sm">{label}</span>
          {hint && (
            <span className="font-mono text-[10px] leading-relaxed text-muted-foreground">{hint}</span>
          )}
        </span>
      </span>
      <span
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full border transition-colors',
          on ? 'border-primary/50 bg-primary/80' : 'border-border bg-muted',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-4 rounded-full bg-background transition-transform',
            on ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </span>
    </button>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium">{label}</span>
      {children}
      <span className="font-mono text-[10px] text-muted-foreground">{hint}</span>
    </label>
  )
}
