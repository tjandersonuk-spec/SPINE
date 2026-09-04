import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import { Eyebrow } from '@/components/ui/panel'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { fmtDate } from '@/lib/format'
import type { MetricItem } from '@/lib/queries'

/**
 * The rows behind a figure.
 *
 * A number on a dashboard that cannot be opened is a number somebody has to go
 * and reconstruct by hand on another page, which is what the other page was
 * already for. So every figure that counted something says what, and every row
 * in here is a working link to the record — the rule the rest of the product
 * follows and the dashboard did not.
 *
 * The list is not filtered here. `metric_items()` returns exactly the rows the
 * figure counted, from the same predicates, and a test asserts the two agree —
 * narrowing a wider query in the browser is how a list and its total start
 * disagreeing, and it is also the easiest way in this product to show somebody
 * a record they should not have.
 */
export function DetailDrawer({
  projectId, title, note, items, loading, onClose,
}: {
  projectId: string
  title: string
  note?: React.ReactNode
  items: MetricItem[]
  loading: boolean
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/40"
      onClick={onClose}
      role="presentation"
    >
      <aside
        className="glass-popover flex h-full w-full max-w-2xl flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <header className="border-glass-line flex items-start justify-between gap-3 border-b px-5 py-4">
          <div>
            <Eyebrow>What this counted</Eyebrow>
            <h2 className="mt-1 text-base font-semibold">{title}</h2>
            {note && <p className="text-graphite mt-1 max-w-prose text-xs">{note}</p>}
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </header>

        <div className="grow overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-graphite text-sm">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-graphite text-sm">
              Nothing here now. The figure may have moved since the page loaded.
            </p>
          ) : (
            <TableScroll>
              <Table>
                <THead>
                  <TR>
                    <TH className="w-[110px]">Ref</TH>
                    <TH>Item</TH>
                    <TH className="w-[96px]">Due</TH>
                  </TR>
                </THead>
                <TBody>
                  {items.map((it, n) => (
                    <TR key={`${it.reference}-${n}`} gap={it.overdue}>
                      <TD>
                        <Link
                          to={`/project/${projectId}/${it.link}?ref=${encodeURIComponent(it.reference)}`}
                          className="text-primary hover:underline"
                          onClick={onClose}
                        >
                          <Code className="text-xs">{it.reference || 'Open'}</Code>
                        </Link>
                      </TD>
                      <TD>
                        <Link
                          to={`/project/${projectId}/${it.link}?ref=${encodeURIComponent(it.reference)}`}
                          className="hover:underline"
                          onClick={onClose}
                        >
                          {it.title}
                        </Link>
                        {it.detail && (
                          <span className="text-graphite block text-xs">{it.detail}</span>
                        )}
                      </TD>
                      <TD>
                        {it.due
                          ? <Code className="text-graphite text-xs">{fmtDate(it.due)}</Code>
                          : <span className="text-graphite text-xs">—</span>}
                        {it.overdue && <Pill tone="stop" className="ml-1">late</Pill>}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableScroll>
          )}
        </div>
      </aside>
    </div>
  )
}
