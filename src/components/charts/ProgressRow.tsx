import { Code } from '@/components/ui/table'

/**
 * Done of total, with what is late called out separately.
 *
 * A single figure — "18 of 24" — hides the thing somebody needs to act on,
 * which is that four of the outstanding six are past their date. So overdue is
 * its own segment at the left of the remainder rather than a colour applied to
 * the whole bar, and it carries its own number.
 *
 * Struck-out rows are excluded upstream by `tracked_progress()`: `required =
 * false` drops a row from every denominator, and a bar that counted them would
 * disagree with the page it links to.
 */
export function ProgressRow({
  label, done, total, overdue = 0, href, onOpenOverdue,
}: {
  label: React.ReactNode
  done: number
  total: number
  overdue?: number
  href?: React.ReactNode
  /** Given, the late count opens the rows behind it. */
  onOpenOverdue?: () => void
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const late = Math.min(overdue, Math.max(0, total - done))

  return (
    <div className="py-2">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-sm">{label}{href}</span>
        <span className="flex items-baseline gap-2">
          <Code className="text-xs font-bold">{done}/{total}</Code>
          <span className="text-graphite font-mono text-[10px]">{pct}%</span>
        </span>
      </div>
      <div className="border-rule bg-surface-2 flex h-2.5 gap-[2px] overflow-hidden rounded-full border">
        <div className="chart-ink bg-ok" style={{ width: `${pct}%` }} title={`${done} done`} />
        {late > 0 && (
          <div className="chart-ink bg-stop" style={{ width: `${(late / total) * 100}%` }}
            title={`${late} overdue`} />
        )}
      </div>
      {late > 0 && (
        onOpenOverdue ? (
          <button type="button" onClick={onOpenOverdue}
            className="text-stop-ink focus-visible:ring-primary/40 mt-1 rounded font-mono text-[10px] outline-none hover:underline focus-visible:ring-2">
            {late} past its date
          </button>
        ) : (
          <p className="text-stop-ink mt-1 font-mono text-[10px]">{late} past its date</p>
        )
      )}
    </div>
  )
}
