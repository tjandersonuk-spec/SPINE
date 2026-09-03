import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

/**
 * Where an unconfirmed login lands, and the only place it can go.
 *
 * Supabase normally withholds the session until the address is confirmed, so
 * this is usually unreachable — but "usually" is doing too much work for a gate
 * on every authenticated route. The project's Auth settings can be changed, and
 * some flows hand back a session first; either way an unconfirmed address must
 * not reach project data, so the check lives in the app rather than resting on
 * a dashboard setting nobody can see from here.
 */
export default function ConfirmEmail() {
  const { session } = useAuth()
  const email = session?.user?.email ?? ''
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const resend = async () => {
    setBusy(true); setError(null)
    try {
      const { error: e } = await supabase.auth.resend({ type: 'signup', email })
      if (e) throw e
      setSent(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">Confirm your email address</h1>
      <p className="text-muted-foreground text-sm">
        We sent a link to <strong>{email}</strong>. Follow it and you will be signed in.
        Until then nothing else in the application will open — an unconfirmed address is not
        yet proof that it is yours.
      </p>

      {sent && (
        <p className="border-ok bg-ok-bg text-ok rounded border-l-[3px] px-3 py-2 text-sm">
          Sent again. It can take a minute, and it does sometimes land in spam.
        </p>
      )}
      {error && (
        <p className="border-stop bg-stop-bg text-stop rounded border-l-[3px] px-3 py-2 text-sm">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button disabled={busy || !email} onClick={() => void resend()}>
          {busy ? 'Sending…' : 'Send it again'}
        </Button>
        <Button variant="ghost" onClick={() => void supabase.auth.signOut()}>
          Sign out
        </Button>
      </div>
    </main>
  )
}
