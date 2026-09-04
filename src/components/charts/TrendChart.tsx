import { useMemo, useState } from 'react'

/**
 * A trend line, drawn from snapshots.
 *
 * The one place in the product that reads stored derived values, and it reads
 * them because a trend needs facts about dates: yesterday's overdue count
 * cannot be recomputed, because the register has moved since.
 *
 * A hand-rolled SVG rather than a chart library, per the stack note.
 *
 * Two things here are not styling preferences.
 *
 * **A reference series is recessive, not a peer.** "Anticipated" against
 * "issued" is a baseline the other line is read against, and it is drawn
 * thinner, dashed and in graphite. That is also what keeps it legible: graphite
 * against the brand cyan measures ΔE 11.6 to normal vision on the dark ground,
 * which is below the 15 two peer series need — so it must not read as one.
 * Marking it `reference` is how the caller says so.
 *
 * **Every line is labelled at its end.** The tenant's brand is the accent and
 * it is theirs to set, so its contrast against the paper is not something this
 * component can guarantee — the default cyan measures 2.1:1 on the light
 * theme. A visible label is the relief, and it also means the chart is never
 * read by colour alone.
 */
export type Series = {
  key: string
  label: string
  className: string
  dashed?: boolean
  /** A baseline the others are read against: thinner, and never a peer. */
  reference?: boolean
}

export function TrendChart({
  points, series, format,
}: {
  points: Record<string, number | string>[]
  series: Series[]
  format?: (v: number) => string
}) {
  const [hover, setHover] = useState<number | null>(null)

  const g = useMemo(() => {
    if (points.length === 0) return null
    const W = 720, H = 200, L = 56, R = 96, T = 12, B = 26
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
  const last = points.length - 1
  const at = hover ?? last

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${g.W} ${g.H}`}
        className="w-full min-w-[520px]"
        role="img"
        aria-label={series.map((s) => s.label).join(', ') + ' over time'}
        onMouseLeave={() => setHover(null)}
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

        {/* The crosshair, and the day it is reading. */}
        {hover !== null && (
          <line x1={g.x(hover)} x2={g.x(hover)} y1={g.T} y2={g.H - g.B}
            className="stroke-rule-strong" strokeWidth="1" />
        )}

        {series.map((s) => (
          <path
            key={s.key}
            d={points.map((p, i) =>
              `${i === 0 ? 'M' : 'L'}${g.x(i).toFixed(1)},${g.y(Number(p[s.key] ?? 0)).toFixed(1)}`)
              .join(' ')}
            fill="none"
            strokeWidth={s.reference ? 1 : 2}
            strokeDasharray={s.dashed || s.reference ? '4 3' : undefined}
            className={s.className}
          />
        ))}

        {/* Direct labels at the right-hand end. Identity is never colour
            alone, and the reading is on the chart rather than in a tooltip
            somebody has to go looking for. */}
        {series.map((s, n) => {
          const v = Number(points[at][s.key] ?? 0)
          return (
            <g key={s.key}>
              <circle cx={g.x(at)} cy={g.y(v)} r={s.reference ? 2.5 : 4}
                className={`${s.className} fill-background`} strokeWidth="2" />
              <text
                x={g.W - g.R + 8}
                y={g.T + 12 + n * 15}
                className={s.reference ? 'fill-graphite' : 'fill-foreground'}
                style={{ fontSize: 10, fontWeight: s.reference ? 400 : 700 }}
              >
                {fmt(v)} {s.label.toLowerCase()}
              </text>
            </g>
          )
        })}

        {/* Hit targets wider than the marks. */}
        {points.map((p, i) => (
          <rect
            key={`hit-${String(p.date)}`}
            x={g.x(i) - (g.W - g.L - g.R) / Math.max(1, points.length) / 2}
            y={g.T}
            width={(g.W - g.L - g.R) / Math.max(1, points.length)}
            height={g.H - g.T - g.B}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>
      <p className="text-graphite mt-1 text-xs">
        {hover === null
          ? `Latest: ${label(String(points[last].date))}. Hover to read a day.`
          : label(String(points[hover].date))}
      </p>
    </div>
  )
}
