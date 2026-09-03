import { useMemo } from 'react'

import { Code } from '@/components/ui/table'
import type { ProgrammeRollup, ProgrammeTask } from '@/lib/queries'

/**
 * The programme as bars.
 *
 * Drawn as plain SVG rather than pulled from a Gantt library: what is needed is
 * a bar, a progress fill and a today line, and every commercial component
 * brings its own date engine — which would become a second opinion about dates
 * in a product whose whole point is that there is only one.
 *
 * Summary bars show the rolled-up span, so a summary cannot disagree with what
 * sits under it.
 */
const ROW_H = 22
const BAR_H = 11
const LABEL_W = 210
const TODAY = new Date('2026-08-30')

const day = 864e5

export function Gantt({
  tasks, rollups, watched, onSelect,
}: {
  tasks: ProgrammeTask[]
  rollups: Map<string, ProgrammeRollup>
  watched: Set<string>
  onSelect: (t: ProgrammeTask) => void
}) {
  const rows = useMemo(() => tasks.map((t) => {
    const roll = rollups.get(t.task_uid)
    return {
      task: t,
      start: new Date(roll?.rolled_start ?? t.start_date),
      finish: new Date(roll?.rolled_finish ?? t.finish_date),
      pct: roll?.rolled_percent ?? t.percent_complete,
    }
  }), [tasks, rollups])

  const bounds = useMemo(() => {
    if (rows.length === 0) return null
    const min = Math.min(...rows.map((r) => r.start.getTime()))
    const max = Math.max(...rows.map((r) => r.finish.getTime()))
    // A fortnight of air either side, so a bar never touches the frame.
    return { min: min - 14 * day, max: max + 14 * day }
  }, [rows])

  if (!bounds || rows.length === 0) return null

  const span = bounds.max - bounds.min
  const width = 900
  const x = (d: Date) => LABEL_W + ((d.getTime() - bounds.min) / span) * (width - LABEL_W - 12)
  const height = rows.length * ROW_H + 28

  // A tick at the start of each quarter, which is how a programme is read at
  // this zoom — month ticks would be unreadable over two years.
  const ticks: { at: number; label: string }[] = []
  const cursor = new Date(bounds.min)
  cursor.setDate(1)
  cursor.setMonth(Math.floor(cursor.getMonth() / 3) * 3)
  while (cursor.getTime() < bounds.max) {
    if (cursor.getTime() >= bounds.min) {
      ticks.push({
        at: x(new Date(cursor)),
        label: cursor.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
      })
    }
    cursor.setMonth(cursor.getMonth() + 3)
  }

  return (
    <div className="overflow-x-auto">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="Programme as a bar chart"
        className="min-w-[900px]"
      >
        {ticks.map((t) => (
          <g key={t.label}>
            <line
              x1={t.at} y1={16} x2={t.at} y2={height}
              stroke="var(--rule)" strokeWidth={1}
            />
            <text
              x={t.at + 3} y={11}
              className="fill-graphite"
              style={{ fontSize: 10, fontFamily: 'var(--font-mono-stack)' }}
            >
              {t.label}
            </text>
          </g>
        ))}

        {/* Today. The one line that is not a task. */}
        <line
          x1={x(TODAY)} y1={14} x2={x(TODAY)} y2={height}
          stroke="var(--stop)" strokeWidth={1.5} strokeDasharray="3 2"
        />

        {rows.map((r, i) => {
          const y = 22 + i * ROW_H
          const isSummary = r.task.task_type === 'Summary'
          const isMilestone = r.task.task_type === 'Milestone'
          const x1 = x(r.start)
          const x2 = Math.max(x(r.finish), x1 + 2)
          const done = r.task.removed ? 0 : ((r.pct ?? 0) / 100) * (x2 - x1)
          return (
            <g
              key={r.task.id}
              onClick={() => onSelect(r.task)}
              style={{ cursor: 'pointer' }}
              opacity={r.task.removed ? 0.4 : 1}
            >
              <title>
                {`${r.task.task_uid} · ${r.task.description}\n` +
                 `${r.start.toISOString().slice(0, 10)} → ${r.finish.toISOString().slice(0, 10)}` +
                 (isMilestone ? '' : ` · ${r.pct ?? 0}%`)}
              </title>

              <text
                x={4 + (r.task.level - 1) * 8}
                y={y + BAR_H - 1}
                style={{
                  fontSize: 11,
                  fontWeight: isSummary ? 600 : 400,
                  fontFamily: 'var(--font-sans-stack)',
                }}
                className="fill-foreground"
              >
                {watched.has(r.task.task_uid) ? '★ ' : ''}
                {r.task.description.length > 30
                  ? `${r.task.description.slice(0, 29)}…`
                  : r.task.description}
              </text>

              {isMilestone ? (
                <path
                  d={`M ${x1} ${y + 1} l 6 6 l -6 6 l -6 -6 z`}
                  fill="var(--brand)"
                />
              ) : (
                <>
                  <rect
                    x={x1} y={y} width={x2 - x1} height={BAR_H} rx={2}
                    fill={isSummary ? 'var(--graphite)' : 'var(--brand-soft)'}
                    stroke={isSummary ? 'var(--graphite)' : 'var(--brand)'}
                    strokeWidth={0.75}
                  />
                  {done > 0 && (
                    <rect
                      x={x1} y={y} width={done} height={BAR_H} rx={2}
                      fill={isSummary ? 'var(--ink)' : 'var(--brand)'}
                    />
                  )}
                </>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** Shown beside the chart so the colours are not a private language. */
export function GanttKey() {
  return (
    <div className="text-graphite mt-2 flex flex-wrap items-center gap-4 text-xs">
      <span className="flex items-center gap-1.5">
        <svg width="20" height="10"><rect width="20" height="10" rx="2"
          fill="var(--brand-soft)" stroke="var(--brand)" /></svg>
        Task
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="20" height="10"><rect width="20" height="10" rx="2"
          fill="var(--graphite)" /></svg>
        Summary, rolled up from its leaves
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="14" height="14"><path d="M 7 1 l 6 6 l -6 6 l -6 -6 z"
          fill="var(--brand)" /></svg>
        Milestone
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="14" height="10"><line x1="7" y1="0" x2="7" y2="10"
          stroke="var(--stop)" strokeWidth="1.5" strokeDasharray="3 2" /></svg>
        Today
      </span>
      <span><Code>★</Code> tracked by you</span>
    </div>
  )
}
