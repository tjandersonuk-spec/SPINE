/**
 * Money and dates, formatted in one place.
 *
 * Every figure in the commercial tier excludes VAT and is sterling. Said once
 * here rather than in a label somebody eventually changes.
 */
export const gbp = (v: number | null | undefined, dp = 0) =>
  v === null || v === undefined
    ? '—'
    : new Intl.NumberFormat('en-GB', {
        style: 'currency', currency: 'GBP',
        minimumFractionDigits: dp, maximumFractionDigits: dp,
      }).format(v)

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB',
        { day: '2-digit', month: 'short', year: '2-digit' })
    : '—'

export const fmtMonth = (d: string) =>
  new Date(d).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
