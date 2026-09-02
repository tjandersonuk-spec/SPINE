import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * The drawing-office table.
 *
 * Dense by design: a design manager reads a hundred matrix rows or four hundred
 * register rows down a column, so the row height, the small uppercase headers
 * and the top-aligned cells are all doing work. The rules are taken from the
 * prototype rather than invented.
 *
 * Wrap in <TableScroll> so a wide table scrolls inside itself instead of
 * pushing the page sideways.
 */
export function TableScroll({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('border-rule bg-card overflow-x-auto rounded-lg border shadow-xs', className)}
      {...props}
    />
  )
}

export function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return <table className={cn('w-full border-collapse text-sm', className)} {...props} />
}

export function THead({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead className={cn('', className)} {...props} />
}

export function TH({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        // small, uppercase, tracked out — a label, not a heading
        'text-graphite-light border-rule-strong border-b-[1.5px] bg-[rgba(127,140,152,0.06)]',
        'px-2.5 py-2 text-left text-[10px] font-bold tracking-[0.08em] whitespace-nowrap uppercase',
        className
      )}
      {...props}
    />
  )
}

export function TBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody className={cn('', className)} {...props} />
}

/**
 * `gap` is the only decoration this table has, and it means exactly one thing:
 * something nobody has been given. The left rule and the wash are the same
 * treatment the prototype uses, so the eye finds it at a glance down a long
 * list without reading a word.
 */
export function TR({
  className,
  gap = false,
  muted = false,
  ...props
}: React.ComponentProps<'tr'> & { gap?: boolean; muted?: boolean }) {
  return (
    <tr
      className={cn(
        'transition-colors duration-100',
        gap
          ? 'bg-hivis-bg text-hivis-ink border-l-hivis border-l-[3px] hover:brightness-[0.98]'
          : 'hover:bg-[rgba(127,140,152,0.08)]',
        muted && 'opacity-50',
        className
      )}
      {...props}
    />
  )
}

export function TD({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      className={cn('border-rule border-b px-2.5 py-[7px] align-top', className)}
      {...props}
    />
  )
}

/** A reference, a code, a drawing number — anything read down a column. */
export function Code({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn('font-mono text-[0.92em] tracking-[-0.01em] tabular-nums', className)}
      {...props}
    />
  )
}

/** A status word: ok, warn, stop, or hi-vis for a gap. Never a bare colour. */
export function Pill({
  tone = 'neutral',
  className,
  ...props
}: React.ComponentProps<'span'> & { tone?: 'neutral' | 'ok' | 'warn' | 'stop' | 'gap' }) {
  const tones = {
    neutral: 'bg-surface-2 border-rule text-graphite',
    ok: 'bg-ok-bg border-ok text-ok',
    warn: 'bg-warn-bg border-warn text-warn',
    stop: 'bg-stop-bg border-stop text-stop',
    gap: 'bg-hivis-bg border-hivis text-hivis-ink',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5',
        'text-[11px] font-bold tracking-[0.04em] uppercase',
        tones[tone],
        className
      )}
      {...props}
    />
  )
}
