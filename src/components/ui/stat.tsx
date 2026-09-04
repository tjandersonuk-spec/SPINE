import * as React from 'react'

import { Eyebrow } from '@/components/ui/panel'
import { cn } from '@/lib/utils'

/**
 * A figure on a glass tile: the KPI block.
 *
 * The value is huge and monospace because it is read against its neighbours,
 * not as a word. The tone is the state of the figure, and it is a halo on the
 * tile rather than a colour on the number, so a row of tiles reads as a row
 * with one lit. `gap` is hi-vis and means the figure counts unallocated
 * things; nothing else may use it.
 */
const TONES = {
  plain: { tile: '', value: 'text-foreground' },
  warn: { tile: 'border-warn/40 shadow-warn-halo', value: 'text-warn-ink' },
  stop: { tile: 'border-stop/40 shadow-stop-halo', value: 'text-stop-ink' },
  gap: { tile: 'glass-hivis', value: 'text-hivis-ink' },
} as const

export function Stat({
  label, value, hint, tone = 'plain', className, ...props
}: React.ComponentProps<'div'> & {
  label: React.ReactNode
  value: React.ReactNode
  hint?: React.ReactNode
  tone?: keyof typeof TONES
}) {
  const t = TONES[tone]
  return (
    <div
      className={cn('glass rounded-lg px-3.5 py-3', t.tile, className)}
      {...props}
    >
      <Eyebrow>{label}</Eyebrow>
      <p className={cn('mt-1 font-mono text-3xl font-semibold tracking-tight tabular-nums', t.value)}>
        {value}
      </p>
      {hint && <p className="text-graphite mt-1 text-xs">{hint}</p>}
    </div>
  )
}
