import { useEffect, useState } from 'react'

import { ErrorNote } from '@/components/ui/notes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { changeMyEmail, fetchMyProfile, updateMyProfile, type MyProfile } from '@/lib/queries'
import { PageHead } from '@/components/ui/panel'

export default function Profile() {
  const [me, setMe] = useState<MyProfile | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => {
    fetchMyProfile()
      .then((p) => {
        setMe(p)
        setName(p.name)
        setPhone(p.phone ?? '')
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  const run = async (fn: () => Promise<void>, message: string) => {
    setError(null)
    setSaved(null)
    try {
      await fn()
      setSaved(message)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <>
      <PageHead title="Your details" />
      <ErrorNote message={error} />
      {saved && <p className="text-ok-ink text-sm">{saved}</p>}

      <form
        className="flex max-w-md flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          run(() => updateMyProfile({ name, phone }), 'Saved.')
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <Button type="submit" className="self-start">Save</Button>
      </form>

      <section className="flex max-w-md flex-col gap-4 border-t pt-6">
        <div>
          <h2 className="font-semibold">Email address</h2>
          <p className="text-muted-foreground text-sm">
            Currently {me?.email}. Changing it sends a confirmation to the new address, and it only
            takes effect once you follow that link — an invitation is matched on this address, so
            it cannot be changed by typing alone.
          </p>
        </div>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            run(
              () => changeMyEmail(newEmail),
              `Confirmation sent to ${newEmail}. Your address changes when you follow the link.`
            )
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">New email address</Label>
            <Input id="email" type="email" required value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)} />
          </div>
          <Button type="submit" variant="outline" className="self-start">
            Send confirmation
          </Button>
        </form>
      </section>
    </>
  )
}
