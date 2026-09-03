import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

import { supabase } from '@/lib/supabase'
import type { Account } from '@/lib/queries'

/**
 * The person, top right.
 *
 * One control: who you are signed in as, the accounts you belong to, anything
 * waiting for your consent, light or dark, and sign out. An invitation has to
 * be findable from wherever you are -- it is an act of consent, and a consent
 * nobody can find is a membership that never happens -- so the count sits on
 * the button itself.
 */
export function AccountMenu({
  name, accounts, waiting, owner, dark, onToggleDark,
}: {
  name: string
  accounts: Account[]
  /** Invitations and membership requests awaiting this person. */
  waiting: number
  owner: boolean
  dark: boolean
  onToggleDark: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Closes on a click anywhere else and on Escape, like a menu should.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const item = 'block w-full rounded px-2.5 py-1.5 text-left text-[13px] hover:bg-surface-2'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md border border-white/15 bg-white/5 px-2.5 py-1 text-xs hover:bg-white/15"
      >
        <span className="max-w-[160px] truncate">{name || 'Account'}</span>
        {waiting > 0 && (
          <span
            className="bg-hivis rounded-full px-1.5 font-mono text-[10px] font-bold text-[#3d3006]"
            title={`${waiting} waiting for you`}
          >
            {waiting}
          </span>
        )}
        <span aria-hidden className="text-[9px] opacity-70">▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className="bg-card border-rule text-foreground absolute right-0 z-50 mt-1.5 w-[260px] rounded-lg border p-1.5 shadow-2xl"
          onClick={() => setOpen(false)}
        >
          <div className="text-graphite px-2.5 pt-1 pb-1.5 text-[10px] font-bold tracking-[0.13em] uppercase">
            Signed in as
          </div>
          <Link to="/me" className={item} role="menuitem">
            <span className="block font-medium">{name}</span>
            <span className="text-graphite block text-xs">Your details</span>
          </Link>

          {waiting > 0 && (
            <Link to="/accounts" className={item} role="menuitem">
              <span className="font-medium">{waiting} waiting for your answer</span>
              <span className="text-graphite block text-xs">Invitations and requests</span>
            </Link>
          )}

          <div className="text-graphite px-2.5 pt-2.5 pb-1.5 text-[10px] font-bold tracking-[0.13em] uppercase">
            My accounts
          </div>
          {accounts.length === 0 ? (
            <Link to="/accounts" className={item} role="menuitem">
              <span className="text-graphite text-xs">Not in any account yet</span>
            </Link>
          ) : (
            accounts.map((a) =>
              // An admin administers the account, so their row opens it. For
              // everyone else it is a name: nothing about who else is in it.
              a.role === 'admin' ? (
                <Link key={a.id} to={`/account/${a.id}`} className={item} role="menuitem">
                  <span className="font-medium">{a.name}</span>
                  <span className="text-graphite block text-xs">
                    admin{a.status !== 'active' && ` · ${a.status}`}
                  </span>
                </Link>
              ) : (
                <div key={a.id} className="px-2.5 py-1.5 text-[13px]">
                  <span>{a.name}</span>
                  <span className="text-graphite block text-xs">
                    {a.role}{a.status !== 'active' && ` · ${a.status}`}
                  </span>
                </div>
              ))
          )}

          {owner && (
            <>
              <div className="text-graphite px-2.5 pt-2.5 pb-1.5 text-[10px] font-bold tracking-[0.13em] uppercase">
                Platform
              </div>
              <Link to="/platform/accounts" className={item} role="menuitem">Accounts</Link>
              <Link to="/platform/people" className={item} role="menuitem">People</Link>
            </>
          )}

          <div className="border-rule mt-1.5 flex gap-1 border-t pt-1.5">
            <button type="button" onClick={onToggleDark} className={item} role="menuitem">
              {dark ? 'Light mode' : 'Dark mode'}
            </button>
            <button
              type="button"
              onClick={() => void supabase.auth.signOut()}
              className={item}
              role="menuitem"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
