/**
 * A single bar cut into segments, and the legend that makes it readable.
 *
 * This is the one recipe for "a whole, divided into states" — appointments by
 * completeness, a fee split by what has been paid. It is deliberately not a pie
 * or a donut: the question is always "how much of the whole is X", which a
 * length answers and an angle does not.
 *
 * **Every segment is labelled with its own number.** That is not decoration.
 * The semantic hues are fixed in both themes and are not the chart's to change,
 * and measured against each other they are closer than two peer series should
 * be: warn against stop is ΔE 11.2 to normal vision on the light paper, and ok
 * against stop is 5.0 under deuteranopia on the dark. Colour therefore carries
 * the tone and never the identity — the number and the word do that, so the bar
 * reads correctly in either theme, to a colourblind reader, and in print where
 * the glass tokens are replaced with opaque white.
 *
 * The 2px gaps between segments are structural for the same reason: two
 * abutting fills of similar lightness read as one.
 */
export type Segment = {
  key: string
  label: string
  value: number
  /** A background utility — `bg-ok`, `bg-warn`, `bg-stop`, `bg-primary`. */
  className: string
  /** Shown under the bar instead of the raw value, where a count is not the point. */
  display?: string
}

export function SegmentBar({
  segments, total, remainder, empty, caption,
}: {
  segments: Segment[]
  /** The denominator, where the segments do not add up to it (a fee not yet invoiced). */
  total?: number
  /** What the unfilled part of the bar is. Named in the legend and left as bare
   *  track: drawing it as a segment in the track's own colour is ink that says
   *  nothing, and it read as an empty bar rather than as a remainder. */
  remainder?: { label: string; display: string }
  empty?: string
  caption?: React.ReactNode
}) {
  const shown = segments.filter((s) => s.value > 0)
  const sum = segments.reduce((a, s) => a + s.value, 0)
  const whole = Math.max(total ?? sum, sum, 1)

  if (sum === 0) {
    return <p className="text-graphite text-sm">{empty ?? 'Nothing to show yet.'}</p>
  }

  return (
    <div>
      <div
        className="border-rule-strong bg-surface-2 flex h-6 gap-[2px] overflow-hidden rounded-md border"
        role="img"
        aria-label={shown.map((s) => `${s.label}: ${s.display ?? s.value}`).join(', ')}
      >
        {shown.map((s) => (
          <div
            key={s.key}
            className={`chart-ink ${s.className}`}
            style={{ width: `${(s.value / whole) * 100}%` }}
            title={`${s.label}: ${s.display ?? s.value}`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {remainder && whole > sum && (
          <span className="flex items-center gap-1.5 text-xs">
            <span className="border-rule-strong size-2.5 shrink-0 rounded-[2px] border"
              aria-hidden />
            <span className="font-mono font-bold">{remainder.display}</span>
            <span className="text-graphite">{remainder.label}</span>
          </span>
        )}
        {shown.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-xs">
            <span className={`chart-ink ${s.className} size-2.5 shrink-0 rounded-[2px]`}
              aria-hidden />
            <span className="font-mono font-bold">{s.display ?? s.value}</span>
            <span className="text-graphite">{s.label}</span>
          </span>
        ))}
      </div>
      {caption && <p className="text-graphite mt-2 max-w-prose text-xs">{caption}</p>}
    </div>
  )
}
