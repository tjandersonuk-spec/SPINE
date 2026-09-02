import { useEffect, useMemo, useState } from 'react'

import { Empty, ErrorNote, Shell } from '@/components/Shell'
import { Input } from '@/components/ui/input'
import { Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
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
        <TableScroll>
          <Table>
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Email</TH>
                <TH>Accounts</TH>
                <TH>Signed up</TH>
              </tr>
            </THead>
            <TBody>
              {shown.map((p) => (
                <TR key={p.id}>
                  <TD>{p.name}</TD>
                  <TD className="font-mono text-[0.92em]">{p.email}</TD>
                  <TD>
                    {p.accounts.length === 0 ? (
                      <span className="text-graphite-light">—</span>
                    ) : (
                      p.accounts.join(', ')
                    )}
                  </TD>
                  <TD className="tabular-nums whitespace-nowrap">
                    {new Date(p.created_at).toLocaleDateString('en-GB')}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableScroll>
      )}
    </Shell>
  )
}
