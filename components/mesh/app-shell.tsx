'use client'

import { useState } from 'react'
import { RadioTower, Share2 } from 'lucide-react'
import { Dashboard } from './dashboard'
import { MeshDrop } from './meshdrop'
import { cn } from '@/lib/utils'

type Tab = 'bond' | 'drop'

export function AppShell() {
  const [tab, setTab] = useState<Tab>('bond')

  return (
    <div className="relative min-h-dvh bg-background">
      {tab === 'bond' ? <Dashboard /> : <MeshDrop />}

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur"
      >
        <div className="mx-auto flex w-full max-w-md items-stretch">
          <TabButton
            label="Bond"
            active={tab === 'bond'}
            icon={<RadioTower className="size-5" />}
            onClick={() => setTab('bond')}
          />
          <TabButton
            label="MeshDrop"
            active={tab === 'drop'}
            icon={<Share2 className="size-5" />}
            onClick={() => setTab('drop')}
          />
        </div>
      </nav>
    </div>
  )
}

function TabButton({
  label,
  active,
  icon,
  onClick,
}: {
  label: string
  active: boolean
  icon: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex flex-1 flex-col items-center gap-1 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] text-[11px] font-medium transition-colors',
        active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  )
}
