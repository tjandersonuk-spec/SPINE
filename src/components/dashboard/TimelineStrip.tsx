import { useState } from 'react'

import { Code } from '@/components/ui/table'
import type { Timeline } from '@/lib/queries'

/**
 * The programme, as one bar.
 *
 * Drawn from programme_timeline(), which Phase 13's period report calls too —
 * the notes are firm that there should be exactly one function behind this,
 * because two would eventually draw different pictures of the same project.
 */
const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '—'
const fmtDay = (d: string) =>
  new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })

export function TimelineStrip({ t }: { t: Timeline }) {
  const [over, setOver] = useState<string | null>(null)

  if (!t.start || !t.finish) {
    return (
      <p className="text-graphite text-sm">
        No programme imported, so nothing in this project has a date yet.
      </p>
    )
  }

  const from = new Date(t.start).getTime()
  const to = new Date(t.finish).getTime()
  const span = Math.max(to - from, 1)
  const at = (d: string) =>
    Math.min(100, Math.max(0, ((new Date(d).getTime() - from) / span) * 100))

  return (
    <div>
      <div className="text-graphite mb-1.5 flex items-baseline justify-between text-xs">
        <Code>{fmt(t.start)}</Code>
        <span>
          {t.percent_elapsed}% of the time gone, {t.percent_complete ?? 0}% of the work done
        </span>
        <Code>{fmt(t.finish)}</Code>
      </div>

      <div className="bg-surface-2 border-rule relative h-7 rounded border">
        {/* Work done, weighted by duration — the same arithmetic the roll-up
            uses, so the bar and any summary line agree. */}
        <div
          className="bg-brand-soft h-full rounded-l"
          style={{ width: `${t.percent_complete ?? 0}%` }}
        />
        {/* Time elapsed. Where this sits against the fill is the whole point of
            the strip: ahead, level, or behind. */}
        <div
          className="bg-stop absolute top-0 h-full w-[2px]"
          style={{ left: `${t.percent_elapsed}%` }}
          title={`Today — ${t.percent_elapsed}% through`}
        />
        {t.milestones.map((m) => (
          <div
            key={m.uid}
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-default p-1"
            style={{ left: `${at(m.date)}%` }}
            onMouseEnter={() => setOver(m.uid)}
            onMouseLeave={() => setOver((u) => (u === m.uid ? null : u))}
            tabIndex={0}
            onFocus={() => setOver(m.uid)}
            onBlur={() => setOver((u) => (u === m.uid ? null : u))}
            aria-label={`${m.description}, ${m.date}`}
          >
            <svg width="11" height="11" aria-hidden>
              <path
                d="M 5.5 0 l 5 5.5 l -5 5.5 l -5 -5.5 z"
                fill={m.complete ? 'var(--ok)' : 'var(--brand)'}
                stroke={over === m.uid ? 'var(--foreground)' : 'none'}
                strokeWidth="1"
              />
            </svg>
          </div>
        ))}
      </div>

      {/* The name of the diamond under the cursor. A native `title` tooltip
          takes a second to appear and lands under the pointer; on a strip of
          twenty diamonds that is unusable, and the whole reason to draw them
          is to be able to read them. */}
      <div className="mt-1.5 min-h-5">
        {(() => {
          const m = t.milestones.find((x) => x.uid === over)
          if (!m) {
            return t.milestones.length > 0 && (
              <p className="text-graphite text-xs">
                {t.milestones.length} milestone{t.milestones.length === 1 ? '' : 's'}. Hover one
                to read it. Next:{' '}
                {t.milestones.find((x) => !x.complete)?.description ?? 'none outstanding'}
              </p>
            )
          }
          return (
            <p className="text-xs">
              <Code className="text-[10px]">{m.uid}</Code>{' '}
              <span className="font-medium">{m.description}</span>{' '}
              <Code className="text-graphite text-[10px]">{fmtDay(m.date)}</Code>{' '}
              <span className={m.complete ? 'text-ok-ink' : 'text-graphite'}>
                {m.complete ? 'complete' : 'outstanding'}
              </span>
            </p>
          )
        })()}
      </div>

    </div>
  )
}
