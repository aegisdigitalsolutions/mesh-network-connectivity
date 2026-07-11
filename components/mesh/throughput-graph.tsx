interface ThroughputGraphProps {
  history: number[]
  className?: string
}

// Lightweight live SVG area sparkline for aggregate throughput.
export function ThroughputGraph({ history, className }: ThroughputGraphProps) {
  const width = 100
  const height = 40
  const max = Math.max(60, ...history)
  const step = history.length > 1 ? width / (history.length - 1) : width

  const points = history.map((v, i) => {
    const x = i * step
    const y = height - (v / max) * height
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })

  const line = points.length ? `M${points.join(' L')}` : ''
  const area = points.length
    ? `M0,${height} L${points.join(' L')} L${width},${height} Z`
    : ''

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      role="img"
      aria-label="Aggregate throughput over time"
    >
      <defs>
        <linearGradient id="tp-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {area && <path d={area} fill="url(#tp-fill)" />}
      {line && (
        <path
          d={line}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
    </svg>
  )
}
