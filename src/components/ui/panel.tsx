import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * A panel, with an optional kind.
 *
 * The kind tint says what sort of thing you are looking at, so a page is not a
 * sea of identical white boxes. It is deliberately a different axis from the
 * semantic colours: kind says *what this is*, state says *how it is going*, and
 * hi-vis is reserved entirely for a gap.
 */
const KINDS = {
  plain: { edge: 'border-l-rule-strong', head: 'bg-[rgba(127,140,152,0.06)]', title: '' },
  evidence: { edge: 'border-l-kind-evidence', head: 'bg-kind-evidence-bg', title: 'text-kind-evidence' },
  discuss: { edge: 'border-l-kind-discuss', head: 'bg-kind-discuss-bg', title: 'text-kind-discuss' },
  money: { edge: 'border-l-kind-money', head: 'bg-kind-money-bg', title: 'text-kind-money' },
  comply: { edge: 'border-l-kind-comply', head: 'bg-kind-comply-bg', title: 'text-kind-comply' },
} as const

export function Panel({
  title,
  kind = 'plain',
  actions,
  className,
  children,
  ...props
}: React.ComponentProps<'section'> & {
  title?: React.ReactNode
  kind?: keyof typeof KINDS
  actions?: React.ReactNode
}) {
  const k = KINDS[kind]
  return (
    <section
      className={cn(
        'border-rule bg-card mb-4 rounded-lg border shadow-sm',
        kind !== 'plain' && `border-l-4 ${k.edge}`,
        className
      )}
      {...props}
    >
      {(title || actions) && (
        <header
          className={cn(
            'border-rule flex flex-wrap items-center gap-2.5 rounded-t-lg border-b px-3.5 py-2.5',
            k.head
          )}
        >
          {title && (
            <h2 className={cn('text-sm font-bold tracking-[0.01em]', k.title)}>{title}</h2>
          )}
          {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-3.5">{children}</div>
    </section>
  )
}

/** The heading strip at the top of a page: what this is, and what it is called. */
export function PageHead({
  eyebrow,
  title,
  meta,
  actions,
}: {
  eyebrow?: React.ReactNode
  title: React.ReactNode
  meta?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && (
          <p className="text-graphite-light text-[10px] font-bold tracking-[0.13em] uppercase">
            {eyebrow}
          </p>
        )}
        <h1 className="text-xl font-bold tracking-[-0.01em]">{title}</h1>
        {meta && <p className="text-graphite mt-0.5 text-sm">{meta}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
