import { useMemo } from 'react'

/**
 * A trend line, drawn from snapshots.
 *
 * The one place in the product that reads stored derived values, and it reads
 * them because a trend needs facts about dates: yesterday's overdue count
 * cannot be recomputed, because the register has moved since.
 *
 * A hand-rolled SVG rather than a chart library, per the stack note.
 */
export type Series = { key: string; label: string; className: string; dashed?: boolean }

export function TrendChart({
  points, series, format,
}: {
  points: Record<string, number | string>[]
  series: Series[]
  format?: (v: number) => string
}) {
  const g = useMemo(() => {
    if (points.length === 0) return null
    const W = 720, H = 190, L = 56, R = 12, T = 12, B = 26
    const max = Math.max(
      1, ...points.flatMap((p) => series.map((s) => Number(p[s.key] ?? 0))))
    const x = (i: number) =>
      L + (points.length === 1 ? (W - L - R) / 2 : (i / (points.length - 1)) * (W - L - R))
    const y = (v: number) => T + (1 - v / max) * (H - T - B)
    return { W, H, L, R, T, B, max, x, y }
  }, [points, series])

  if (!g) {
    return (
      <p className="text-graphite text-sm">
        No history yet. The nightly job writes one row per project per day; a trend needs a
        few of them before it says anything.
      </p>
    )
  }
  const fmt = format ?? ((v: number) => String(Math.round(v)))
  const ticks = [0, 0.5, 1].map((f) => f * g.max)
  const label = (d: string) =>
    new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  // At most eight date labels, or they overlap into a smudge.
  const every = Math.max(1, Math.ceil(points.length / 8))

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${g.W} ${g.H}`}
        className="w-full min-w-[520px]"
        role="img"
        aria-label={series.map((s) => s.label).join(', ') + ' over time'}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={g.L} x2={g.W - g.R} y1={g.y(v)} y2={g.y(v)}
              className="stroke-rule" strokeWidth="1" />
            <text x={g.L - 6} y={g.y(v) + 3} textAnchor="end"
              className="fill-graphite" style={{ fontSize: 9 }}>
              {fmt(v)}
            </text>
          </g>
        ))}
        {points.map((p, i) => i % every === 0 && (
          <text key={String(p.date)} x={g.x(i)} y={g.H - 8} textAnchor="middle"
            className="fill-graphite" style={{ fontSize: 9 }}>
            {label(String(p.date))}
          </text>
        ))}
        {series.map((s) => (
          <path
            key={s.key}
            d={points.map((p, i) =>
              `${i === 0 ? 'M' : 'L'}${g.x(i).toFixed(1)},${g.y(Number(p[s.key] ?? 0)).toFixed(1)}`)
              .join(' ')}
            fill="none"
            strokeWidth="2"
            strokeDasharray={s.dashed ? '4 3' : undefined}
            className={s.className}
          />
        ))}
      </svg>
      <div className="text-graphite mt-1 flex flex-wrap gap-4 text-xs">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <svg width="16" height="4" aria-hidden>
              <line x1="0" y1="2" x2="16" y2="2" strokeWidth="2"
                strokeDasharray={s.dashed ? '4 3' : undefined} className={s.className} />
            </svg>
            {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}
