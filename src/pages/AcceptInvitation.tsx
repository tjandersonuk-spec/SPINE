import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/lib/auth'
import { acceptInvitation } from '@/lib/queries'

/**
 * Accepting is the consent step: it is the only thing that creates a membership.
 * The person must be signed in as the invited address, which the database
 * re-checks — the guard is not in this component.
 */
export default function AcceptInvitation() {
  const { token = '' } = useParams()
  const { session, loading } = useAuth()
  const [state, setState] = useState<'working' | 'done' | 'error'>('working')
  const [error, setError] = useState<string | null>(null)
  // A token may be redeemed once; StrictMode runs effects twice in development.
  const started = useRef(false)

  useEffect(() => {
    if (loading || !session || started.current) return
    started.current = true
    acceptInvitation(token)
      .then(() => setState('done'))
      .catch((e: Error) => {
        setError(e.message)
        setState('error')
      })
  }, [loading, session, token])

  if (loading) return null

  if (!session) {
    return (
      <main className="flex min-h-svh items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Sign in to accept</CardTitle>
            <CardDescription>
              Sign in with the address the invitation was sent to, or create a login for it. The
              invitation stays valid for 14 days.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Button asChild><Link to={`/sign-in?next=/accept/${token}`}>Sign in</Link></Button>
            <Button asChild variant="outline"><Link to="/sign-up">Create a login</Link></Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            {state === 'done' ? 'Invitation accepted' : state === 'error' ? 'Could not accept' : 'Accepting…'}
          </CardTitle>
          <CardDescription>
            {state === 'done'
              ? 'It now appears on your landing page.'
              : state === 'error'
                ? error
                : 'One moment.'}
          </CardDescription>
        </CardHeader>
        {state !== 'working' && (
          <CardContent>
            <Button asChild><Link to="/">Go to my projects</Link></Button>
          </CardContent>
        )}
      </Card>
    </main>
  )
}
