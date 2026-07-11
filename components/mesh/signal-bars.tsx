import { cn } from '@/lib/utils'

interface SignalBarsProps {
  signal: number // 0-100
  tone?: 'primary' | 'warning' | 'destructive' | 'muted'
  className?: string
}

export function SignalBars({ signal, tone = 'primary', className }: SignalBarsProps) {
  const bars = [15, 40, 65, 90]
  const toneClass = {
    primary: 'bg-primary',
    warning: 'bg-warning',
    destructive: 'bg-destructive',
    muted: 'bg-muted-foreground',
  }[tone]

  return (
    <div className={cn('flex items-end gap-0.5', className)} aria-label={`Signal ${signal}%`}>
      {bars.map((threshold, i) => (
        <span
          key={threshold}
          className={cn(
            'w-1 rounded-full transition-colors',
            signal >= threshold ? toneClass : 'bg-muted',
          )}
          style={{ height: `${6 + i * 4}px` }}
        />
      ))}
    </div>
  )
}
