import { useState } from 'react'

/**
 * The logo above the sign-in card.
 *
 * Two things make it sit on the page rather than on top of it. The page behind
 * is painted --brand-canvas, which is set to the colour at the logo's own edge;
 * and the image is masked with a radial gradient that fades its outer eighth to
 * nothing, so the join is a gradient rather than a line. Get the canvas colour
 * wrong and the feather turns into a visible halo, which is worse than no
 * feather at all — so the two are set together.
 *
 * Drop the file at public/brand/logo.png. Until it exists this falls back to a
 * wordmark, so the page is never broken by a missing asset.
 */
export function BrandMark({ className = '' }: { className?: string }) {
  const [missing, setMissing] = useState(false)

  if (missing) {
    return (
      <div className={`text-center ${className}`}>
        <span className="text-2xl font-extrabold tracking-[0.18em]">SPINE</span>
      </div>
    )
  }

  return (
    <img
      src="/brand/logo.png"
      alt="Spine"
      onError={() => setMissing(true)}
      className={`h-auto w-full max-w-[220px] object-contain ${className}`}
      style={{
        // fade the outer eighth so the edge dissolves into --brand-canvas
        maskImage: 'radial-gradient(closest-side, black 78%, transparent 100%)',
        WebkitMaskImage: 'radial-gradient(closest-side, black 78%, transparent 100%)',
      }}
    />
  )
}
