import { useEffect, useMemo, useState } from 'react'

import { Empty, ErrorNote, Shell } from '@/components/Shell'
import { Input } from '@/components/ui/input'
import { fetchAllPeople, type OwnerPerson } from '@/lib/queries'

/**
 * Every login on the platform. The rows that matter most are the ones with no
 * accounts at all: they appear in no other list in the product, so without this
 * view a support question about them cannot be answered.
 */
export default function PlatformPeople() {
  const [people, setPeople] = useState<OwnerPerson[]>([])
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    fetchAllPeople().then(setPeople).catch((e: Error) => setError(e.message))
  }, [])

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return people
    return people.filter(
      (p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)
    )
  }, [people, filter])

  const unattached = people.filter((p) => p.accounts.length === 0).length

  return (
    <Shell title="People">
      <ErrorNote message={error} />
      <div className="flex flex-col gap-2">
        <Input placeholder="Filter by name or email" value={filter}
          onChange={(e) => setFilter(e.target.value)} />
        <p className="text-muted-foreground text-sm">
          {people.length} logins · {unattached} in no account
        </p>
      </div>

      {shown.length === 0 ? (
        <Empty>No logins match.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Accounts</th>
                <th className="px-4 py-2 font-medium">Signed up</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="px-4 py-2">{p.name}</td>
                  <td className="px-4 py-2">{p.email}</td>
                  <td className="px-4 py-2">
                    {p.accounts.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      p.accounts.join(', ')
                    )}
                  </td>
                  <td className="px-4 py-2">{new Date(p.created_at).toLocaleDateString('en-GB')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  )
}
