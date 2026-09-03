import { useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { BrandMark } from '@/components/BrandMark'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'

export default function SignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) setError(error.message)
    else navigate('/')
  }

  return (
    <main className="bg-brand-canvas flex min-h-svh flex-col items-center justify-center gap-2 p-6">
      <BrandMark />
      <Card className="w-full max-w-sm">
        <form onSubmit={onSubmit}>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required value={password}
                onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
            <p className="text-muted-foreground text-sm">
              No login? <Link to="/sign-up" className="underline">Create one</Link>
            </p>
            {/* A way out. Somebody who cannot get past this screen -- wrong
                address, no account yet, waiting on an approval -- is otherwise
                stuck on it, with the site they arrived from unreachable. */}
            <p className="text-muted-foreground text-sm">
              <Link to="/welcome" className="underline">Back to the site</Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </main>
  )
}
