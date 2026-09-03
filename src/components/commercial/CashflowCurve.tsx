import { useMemo } from 'react'

import { fmtMonth, gbp } from '@/lib/format'
import type { CashflowPoint } from '@/lib/queries'

/**
 * The cashflow curve: planned against invoiced, both cumulative.
 *
 * A hand-rolled SVG rather than a chart library, per the stack note. The
 * planned line is the payment schedule resolved through the programme, so
 * re-importing a revision redraws this with no writes at all — which is the
 * whole reason no instalment date is ever stored.
 *
 * The agreed subtotal is drawn separately from the planned total, because a
 * curve built partly on instalments nobody has agreed to is optimistic and
 * saying so is the point.
 */
export function CashflowCurve({ points }: { points: CashflowPoint[] }) {
  const geometry = useMemo(() => {
    if (points.length === 0) return null
    const W = 720, H = 200, L = 64, R = 12, T = 12, B = 28
    const max = Math.max(
      ...points.map((p) => Math.max(p.planned_cumulative, p.invoiced_cumulative)), 1)
    const x = (i: number) =>
      L + (points.length === 1 ? (W - L - R) / 2
        : (i / (points.length - 1)) * (W - L - R))
    const y = (v: number) => T + (1 - v / max) * (H - T - B)
    const path = (key: keyof CashflowPoint) =>
      points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(Number(p[key])).toFixed(1)}`)
        .join(' ')
    return { W, H, L, T, B, R, max, x, y, path }
  }, [points])

  if (!geometry) {
    return (
      <p className="text-graphite text-sm">
        Nothing to draw yet. The curve needs instalments anchored to the programme, or
        invoices submitted.
      </p>
    )
  }
  const g = geometry
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * g.max)

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${g.W} ${g.H}`}
        className="min-w-[560px] w-full"
        role="img"
        aria-label="Cumulative planned and invoiced cashflow by month"
      >
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={g.L} x2={g.W - g.R} y1={g.y(v)} y2={g.y(v)}
              className="stroke-rule" strokeWidth="1"
            />
            <text
              x={g.L - 6} y={g.y(v) + 3} textAnchor="end"
              className="fill-graphite" style={{ fontSize: 9 }}
            >
              {gbp(v)}
            </text>
          </g>
        ))}
        {points.map((p, i) => (
          <text
            key={p.month} x={g.x(i)} y={g.H - 8} textAnchor="middle"
            className="fill-graphite" style={{ fontSize: 9 }}
          >
            {fmtMonth(p.month)}
          </text>
        ))}
        {/* Planned in full, then the agreed subset dashed inside it. */}
        <path d={g.path('planned_cumulative')} fill="none"
          className="stroke-graphite" strokeWidth="1.5" />
        <path d={g.path('planned_agreed_cumulative')} fill="none"
          className="stroke-graphite" strokeWidth="1.5" strokeDasharray="4 3" />
        <path d={g.path('invoiced_cumulative')} fill="none"
          className="stroke-brand" strokeWidth="2" />
        <path d={g.path('paid_cumulative')} fill="none"
          className="stroke-ok" strokeWidth="2" />
        {points.map((p, i) => (
          <circle key={p.month} cx={g.x(i)} cy={g.y(p.invoiced_cumulative)} r="2.5"
            className="fill-brand" />
        ))}
      </svg>
      <div className="text-graphite mt-1 flex flex-wrap gap-4 text-xs">
        <Key className="bg-graphite">Planned (all instalments)</Key>
        <Key className="bg-graphite" dashed>Planned (agreed only)</Key>
        <Key className="bg-brand">Invoiced</Key>
        <Key className="bg-ok">Paid</Key>
      </div>
    </div>
  )
}

function Key({
  children, className, dashed,
}: { children: React.ReactNode; className: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={'inline-block h-[2px] w-4 ' + className}
        style={dashed ? { backgroundImage: 'none', opacity: 0.55 } : undefined}
      />
      {children}
    </span>
  )
}
