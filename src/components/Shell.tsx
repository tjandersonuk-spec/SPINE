import { Link, useLocation } from 'react-router'

import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'

/** Chrome shared by every signed-in page. */
export function Shell({
  title,
  back,
  children,
}: {
  title: string
  back?: { to: string; label: string }
  children: React.ReactNode
}) {
  const { pathname } = useLocation()
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-4xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          {back && (
            <Link to={back.to} className="text-muted-foreground text-sm hover:underline">
              ← {back.label}
            </Link>
          )}
          <h1 className="text-xl font-semibold">{title}</h1>
        </div>
        <div className="flex items-center gap-2">
          {pathname !== '/' && (
            <Button asChild variant="ghost" size="sm">
              <Link to="/">Home</Link>
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut()}>
            Sign out
          </Button>
        </div>
      </header>
      {children}
    </div>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-8 text-center text-sm">
      {children}
    </p>
  )
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm">
      {message}
    </p>
  )
}
