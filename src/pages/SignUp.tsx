import { useState } from 'react'
import { Link } from 'react-router'

import { BrandMark } from '@/components/BrandMark'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'

/**
 * Creating a login grants nothing. It creates a profile and stops there — no
 * account, no membership, no request. Asking for an account is a separate act,
 * from the landing page, after the address is confirmed.
 */
export default function SignUp() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    setBusy(false)
    if (error) setError(error.message)
    else setSent(true)
  }

  if (sent) {
    return (
      <main className="flex min-h-svh items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Check your email</CardTitle>
            <CardDescription>
              We have sent a confirmation link to {email}. Nothing else works until you follow it.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            {/* This screen is otherwise a wall: it has no form and no controls,
                so without this the only way off it is the browser's back
                button. */}
            <p className="text-muted-foreground text-sm">
              <Link to="/welcome" className="underline">Back to the site</Link>
            </p>
          </CardFooter>
        </Card>
      </main>
    )
  }

  return (
    <main className="bg-brand-canvas flex min-h-svh flex-col items-center justify-center gap-2 p-6">
      <BrandMark />
      <Card className="w-full max-w-sm">
        <form onSubmit={onSubmit}>
          <CardHeader>
            <CardTitle>Create a login</CardTitle>
            <CardDescription>
              A login on its own gives you nothing to look at. You can then ask for an account for
              your company, or wait to be invited to a project.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Your name</Label>
              <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Work email</Label>
              <Input id="email" type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required minLength={8} value={password}
                onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Creating…' : 'Create login'}
            </Button>
            <p className="text-muted-foreground text-sm">
              Already have one? <Link to="/sign-in" className="underline">Sign in</Link>
            </p>
            <p className="text-muted-foreground text-sm">
              <Link to="/welcome" className="underline">Back to the site</Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </main>
  )
}
