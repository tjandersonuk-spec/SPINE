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

export function TimelineStrip({ t }: { t: Timeline }) {
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
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${at(m.date)}%` }}
            title={`${m.uid} · ${m.description} · ${m.date}`}
          >
            <svg width="11" height="11" aria-hidden>
              <path
                d="M 5.5 0 l 5 5.5 l -5 5.5 l -5 -5.5 z"
                fill={m.complete ? 'var(--ok)' : 'var(--brand)'}
              />
            </svg>
          </div>
        ))}
      </div>

      {t.milestones.length > 0 && (
        <p className="text-graphite mt-1.5 text-xs">
          {t.milestones.length} milestone{t.milestones.length === 1 ? '' : 's'} · next{' '}
          {t.milestones.find((m) => !m.complete)?.description ?? 'none outstanding'}
        </p>
      )}
    </div>
  )
}
