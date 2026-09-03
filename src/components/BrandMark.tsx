import { useState } from 'react'

/**
 * The crystalline mark beside the wordmark: a facetted stone in the brand
 * colour with a soft glow, so the header carries the tenant's colour even when
 * their logo is a raster that cannot be recoloured.
 */
export function CrystalMark({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={`text-primary shrink-0 ${className}`}
      style={{ filter: 'drop-shadow(0 0 6px color-mix(in srgb, var(--brand) 55%, transparent))' }}
    >
      <path
        d="M12 2 20 9 12 22 4 9Z"
        fill="currentColor"
        fillOpacity="0.18"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M4 9h16M12 2 8.5 9 12 22M12 2l3.5 7L12 22" stroke="currentColor" strokeWidth="1" strokeOpacity="0.7" fill="none" strokeLinejoin="round" />
    </svg>
  )
}

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
