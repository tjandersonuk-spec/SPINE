import { Link, NavLink, Outlet } from 'react-router'

import { CrystalMark } from '@/components/BrandMark'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

/**
 * The public site.
 *
 * Deliberately the application's own tokens rather than a separate brand: the
 * two are one product, and a marketing site that looks like a different
 * company is a promise the first screen after sign-up breaks. It does not use
 * AppShell, because there is no project to navigate and no person to greet --
 * the shell is for people who are already in.
 *
 * The reference in /docs is the old light palette; it is a reference for tone
 * and layout, which is what has been kept. The colours are the current ones.
 */
const NAV = [
  { to: '/product', label: 'Product' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/about', label: 'About' },
  { to: '/contact', label: 'Contact' },
]

export default function MarketingLayout({ children }: { children?: React.ReactNode }) {
  const { session } = useAuth()
  return (
    <div className="min-h-svh">
      <header className="bg-chrome text-chrome-ink sticky top-0 z-40 border-b border-white/10 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1080px] items-center gap-6 px-6">
          <Link
            to="/"
            className="flex items-center gap-2.5 text-[13px] font-extrabold tracking-[0.25em] text-white"
          >
            <CrystalMark className="size-5" />
            SPINE
          </Link>

          <nav className="ml-auto hidden items-center gap-5 text-sm sm:flex">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  cn('transition-opacity', isActive ? 'opacity-100' : 'opacity-70 hover:opacity-100')
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>

          {/* Somebody signed in who followed the wordmark here is not a
              prospect and should not be sold to; they need the way back. */}
          <div className="ml-auto flex items-center gap-2 sm:ml-0">
            {session ? (
              <Button asChild size="sm">
                <Link to="/">Back to your projects</Link>
              </Button>
            ) : (
              <>
                <Button asChild size="sm" variant="ghost">
                  <Link to="/sign-in">Sign in</Link>
                </Button>
                <Button asChild size="sm">
                  <Link to="/sign-up">Start a trial</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* `/` passes its page as a child; every other public route is nested. */}
      {children ?? <Outlet />}

      <footer className="border-glass-line mt-16 border-t">
        <div className="text-graphite mx-auto flex max-w-[1080px] flex-wrap items-center gap-x-6 gap-y-2 px-6 py-8 text-xs">
          <span className="font-mono tracking-[0.18em] uppercase">Spine</span>
          <span>Design management for main contractors.</span>
          <nav className="ml-auto flex flex-wrap gap-4">
            {NAV.map((n) => (
              <Link key={n.to} to={n.to} className="hover:text-foreground">
                {n.label}
              </Link>
            ))}
            {session
              ? <Link to="/" className="hover:text-foreground">Your projects</Link>
              : <Link to="/sign-in" className="hover:text-foreground">Sign in</Link>}
          </nav>
        </div>
        <div className="text-graphite-light mx-auto max-w-[1080px] px-6 pb-8 text-xs">
          “Spine” is a working name. The product is built by a main contractor’s design
          management team, on live higher-risk building projects.
        </div>
      </footer>
    </div>
  )
}

/** A page section. One measure, one rhythm, everywhere. */
export function Section({
  eyebrow, title, lead, children, alt = false,
}: {
  eyebrow?: string
  title?: React.ReactNode
  lead?: React.ReactNode
  children?: React.ReactNode
  alt?: boolean
}) {
  return (
    <section className={cn('py-14', alt && 'border-glass-line border-y bg-white/[0.015]')}>
      <div className="mx-auto max-w-[1080px] px-6">
        {eyebrow && (
          <p className="text-graphite-light mb-2 font-mono text-[10px] font-medium tracking-[0.18em] uppercase">
            {eyebrow}
          </p>
        )}
        {title && (
          <h2 className="max-w-[22ch] text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
            {title}
          </h2>
        )}
        {lead && <p className="text-graphite mt-3 max-w-[62ch] text-base">{lead}</p>}
        {children && <div className="mt-8">{children}</div>}
      </div>
    </section>
  )
}
