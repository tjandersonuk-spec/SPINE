import { useState } from 'react'
import { useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { requestAccount } from '@/lib/queries'

export default function RequestAccount() {
  const [companyName, setCompanyName] = useState('')
  const [companyNumber, setCompanyNumber] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await requestAccount({ companyName, companyNumber, contactPhone, note })
      navigate('/')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-lg items-center p-6">
      <Card className="w-full">
        <form onSubmit={onSubmit}>
          <CardHeader>
            <CardTitle>Request an account</CardTitle>
            <CardDescription>
              This creates a request, not an account. We review each one by hand and will come back
              to you — including if we decline, with a reason.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="company">Company name</Label>
              <Input id="company" required value={companyName}
                onChange={(e) => setCompanyName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="number">Company number</Label>
              <Input id="number" value={companyNumber}
                onChange={(e) => setCompanyNumber(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="phone">Contact phone</Label>
              <Input id="phone" value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="note">Anything we should know</Label>
              <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </CardContent>
          <CardFooter className="flex gap-2">
            <Button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</Button>
            <Button type="button" variant="outline" onClick={() => navigate('/')}>Cancel</Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  )
}
