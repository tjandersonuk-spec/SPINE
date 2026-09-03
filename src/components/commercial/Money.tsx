import { Code } from '@/components/ui/table'
import { gbp } from '@/lib/format'

/**
 * A money figure.
 *
 * Monospace and tabular, because these are read down a column rather than
 * across a sentence — the same reason every other code in the product is.
 */
export function Money({
  value, dp = 0, className, tone,
}: {
  value: number | null | undefined
  dp?: number
  className?: string
  /** A signed figure reads better coloured, but only where the sign means
   *  something: a variance, never a fee. */
  tone?: 'signed' | 'plain'
}) {
  const t = tone === 'signed' && value
    ? value > 0 ? ' text-stop' : ' text-ok'
    : ''
  return (
    <Code className={'text-xs tabular-nums' + t + (className ? ' ' + className : '')}>
      {tone === 'signed' && value && value > 0 ? '+' : ''}{gbp(value, dp)}
    </Code>
  )
}
