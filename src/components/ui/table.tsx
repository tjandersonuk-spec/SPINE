import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * The drawing-office table.
 *
 * Dense by design: a design manager reads a hundred matrix rows or four hundred
 * register rows down a column, so the row height, the small uppercase headers
 * and the top-aligned cells are all doing work. No zebra: a stripe is a
 * decoration that competes with the one decoration that means something.
 *
 * Wrap in <TableScroll> so a wide table scrolls inside itself instead of
 * pushing the page sideways.
 */
export function TableScroll({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('glass overflow-x-auto rounded-lg', className)}
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
        // small, uppercase, tracked, monospace — a label, not a heading
        'text-graphite-light border-glass-line border-b bg-white/[0.02]',
        'px-2.5 py-2 text-left font-mono text-[10px] font-medium tracking-widest whitespace-nowrap uppercase',
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
 * something nobody has been given. The hi-vis edge and the inner halo are the
 * same treatment everywhere a gap is shown, so the eye finds it at a glance
 * down a long list without reading a word.
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
        'transition-colors duration-150',
        gap
          ? 'bg-hivis-bg text-hivis-ink border-l-hivis shadow-hivis-halo border-l-4 hover:brightness-110'
          : 'hover:bg-primary/[0.04]',
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
      className={cn('border-rule border-b px-2.5 py-1.5 align-top', className)}
      {...props}
    />
  )
}

/**
 * A reference, a code, a drawing number — anything read down a column.
 * `tag` boxes it as a discipline or code chip, for the places a code stands
 * alone rather than heads a row.
 */
export function Code({
  className, tag = false, ...props
}: React.ComponentProps<'span'> & { tag?: boolean }) {
  return (
    <span
      className={cn(
        'font-mono text-[0.92em] tracking-[-0.01em] tabular-nums',
        tag && 'text-brand-2 border-primary/30 bg-primary/10 inline-block rounded-md border px-1.5 py-0.5 text-xs',
        className
      )}
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
  // Luminous capsules: a tinted glass ground, a hairline of the same hue, and
  // ink light enough to sit on it. Only the gap glows outward.
  const tones = {
    neutral: 'bg-surface-2/60 border-rule-strong text-graphite backdrop-blur-sm',
    ok: 'bg-ok-bg border-ok/30 text-ok-ink shadow-ok',
    warn: 'bg-warn-bg border-warn/30 text-warn-ink',
    stop: 'bg-stop-bg border-stop/30 text-stop-ink',
    gap: 'bg-hivis-bg border-hivis/40 text-hivis-ink shadow-hivis',
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
