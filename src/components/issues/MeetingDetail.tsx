import { useCallback, useEffect, useState } from 'react'

import { CommentThread } from '@/components/issues/CommentThread'
import { Button } from '@/components/ui/button'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import {
  addAgendaItem, carryIssueForward, fetchAgenda, fetchDirectoryPeople, fetchIssues,
  fetchMeetingIssues, fetchMeetingPeople, fetchMeetings, raiseIssue, setMeetingPerson,
  type AgendaItem, type Meeting,
} from '@/lib/queries'

/**
 * A meeting, its agenda, who was there, and what came out of it.
 *
 * Carrying an item forward adds it to the next agenda without touching where it
 * was first raised. An earlier design moved it, which left the previous minutes
 * showing an empty agenda — minutes have to stay a record of the day.
 */
type Attendee = Awaited<ReturnType<typeof fetchMeetingPeople>>[number]
type Item = Awaited<ReturnType<typeof fetchMeetingIssues>>[number]

const ROLES = ['attendee', 'apology', 'distribution'] as const

export function MeetingDetail({
  projectId, meeting, canEdit, onClose,
}: {
  projectId: string
  meeting: Meeting
  canEdit: boolean
  onClose: () => void
}) {
  const [agenda, setAgenda] = useState<AgendaItem[]>([])
  const [people, setPeople] = useState<Attendee[]>([])
  const [directory, setDirectory] = useState<Awaited<ReturnType<typeof fetchDirectoryPeople>>>([])
  const [items, setItems] = useState<Item[]>([])
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [openIssues, setOpenIssues] = useState<{ id: string; reference: string; title: string }[]>([])
  const [heading, setHeading] = useState('')
  const [newItem, setNewItem] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    Promise.all([
      fetchAgenda(meeting.id), fetchMeetingPeople(meeting.id), fetchDirectoryPeople(projectId),
      fetchMeetingIssues(meeting.id), fetchMeetings(projectId), fetchIssues(projectId),
    ])
      .then(([a, p, d, i, m, all]) => {
        setAgenda(a); setPeople(p); setDirectory(d); setItems(i); setMeetings(m)
        setOpenIssues(all.filter((x) => x.status === 'Open')
          .map((x) => ({ id: x.id, reference: x.reference, title: x.title })))
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [meeting.id, projectId])

  useEffect(load, [load])

  const guard = (p: Promise<unknown>) =>
    p.then(load).catch((e: Error) => setError(e.message))

  const roleOf = (personId: string) => people.find((p) => p.person_id === personId)?.role ?? ''

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm" onClick={onClose} role="presentation">
      <aside
        className="glass-popover flex h-full w-full max-w-[680px] flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Meeting ${meeting.reference}`}
      >
        <header className="border-rule flex items-start justify-between gap-3 border-b px-5 py-4">
          <div>
            <Code className="text-graphite text-xs">{meeting.reference}</Code>
            <h2 className="mt-0.5 text-base font-semibold">{meeting.title}</h2>
            <p className="text-graphite text-xs">
              {new Date(meeting.meeting_date).toLocaleDateString('en-GB', {
                weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
              })}
              {meeting.location ? ` · ${meeting.location}` : ''}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">✕</Button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && <p className="text-stop mb-3 text-sm">{error}</p>}

          <h3 className="mb-2 text-sm font-semibold">Agenda</h3>
          {agenda.length === 0 ? (
            <p className="text-graphite mb-3 text-sm">Nothing on the agenda yet.</p>
          ) : (
            <ol className="mb-3 flex flex-col gap-1">
              {agenda.map((a) => (
                <li key={a.id} className="text-sm">
                  <Code className="text-graphite text-xs">{a.position}</Code> {a.heading}
                </li>
              ))}
            </ol>
          )}
          {canEdit && (
            <form
              className="mb-5 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (!heading.trim()) return
                guard(addAgendaItem(meeting.id, agenda.length + 1, heading.trim()))
                  .then(() => setHeading(''))
              }}
            >
              <input
                value={heading}
                onChange={(e) => setHeading(e.target.value)}
                placeholder="Add an agenda heading"
                className="border-rule flex-1 rounded border px-3 py-1.5 text-sm"
              />
              <Button size="sm" type="submit" disabled={!heading.trim()}>Add</Button>
            </form>
          )}

          <h3 className="mb-2 text-sm font-semibold">Items ({items.length})</h3>
          {items.length === 0 ? (
            <p className="text-graphite mb-3 text-sm">
              Nothing raised here yet. An item raised in this meeting stays attached to it even
              once it is carried forward.
            </p>
          ) : (
            <TableScroll>
              <Table>
                <THead>
                  <TR>
                    <TH className="w-[82px]">Ref</TH>
                    <TH>Item</TH>
                    <TH className="w-[128px]">Origin</TH>
                    <TH className="w-[76px]">Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {items.map((i) => (
                    <TR key={i.issue_id} muted={i.status === 'Closed'}>
                      <TD><Code className="text-xs">{i.reference}</Code></TD>
                      <TD>{i.title}</TD>
                      <TD className="text-graphite text-xs">
                        {i.raised_meeting_id === meeting.id
                          ? 'Raised here'
                          : `Carried from ${
                              meetings.find((m) => m.id === i.raised_meeting_id)?.reference
                              ?? 'elsewhere'}`}
                      </TD>
                      <TD>
                        {i.status === 'Closed'
                          ? <Pill tone="ok">Closed</Pill>
                          : <Pill tone="neutral">Open</Pill>}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableScroll>
          )}

          {canEdit && (
            <>
              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!newItem.trim()) return
                  guard(raiseIssue(projectId, {
                    title: newItem.trim(), kind: 'meeting', meetingId: meeting.id,
                  })).then(() => setNewItem(''))
                }}
              >
                <input
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                  placeholder="Raise an item in this meeting"
                  className="border-rule flex-1 rounded border px-3 py-1.5 text-sm"
                />
                <Button size="sm" type="submit" disabled={!newItem.trim()}>Raise</Button>
              </form>

              <label className="mt-2 block">
                <span className="text-graphite mb-1 block text-xs">
                  Carry an open item forward onto this agenda
                </span>
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) guard(carryIssueForward(e.target.value, meeting.id))
                  }}
                  className="border-rule w-full rounded border px-2 py-1.5 text-sm"
                >
                  <option value="">— choose an item —</option>
                  {openIssues
                    .filter((o) => !items.some((i) => i.issue_id === o.id))
                    .map((o) => (
                      <option key={o.id} value={o.id}>{o.reference} · {o.title}</option>
                    ))}
                </select>
                <span className="text-graphite mt-1 block text-xs">
                  It appears on both agendas. Where it was first raised never moves, so the
                  earlier minutes still show what was discussed on the day.
                </span>
              </label>
            </>
          )}

          <h3 className="mt-5 mb-2 text-sm font-semibold">
            Who is on this meeting ({people.length})
          </h3>
          <p className="text-graphite mb-2 max-w-prose text-xs">
            This list is also who can read the minutes — attendance and audience are the same
            thing, so a meeting you are not on does not appear to you at all.
          </p>
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH>Person</TH>
                  <TH className="w-[140px]">Firm</TH>
                  <TH className="w-[150px]">On the meeting as</TH>
                </TR>
              </THead>
              <TBody>
                {directory.map((p) => (
                  <TR key={p.id} muted={!roleOf(p.id)}>
                    <TD>{p.name}</TD>
                    <TD className="text-graphite text-xs">{p.company_name}</TD>
                    <TD>
                      {canEdit ? (
                        <select
                          value={roleOf(p.id)}
                          onChange={(e) => guard(setMeetingPerson(
                            meeting.id, p.id,
                            (e.target.value || null) as typeof ROLES[number] | null))}
                          className="border-rule w-full rounded border px-2 py-1 text-xs"
                          aria-label={`Role for ${p.name}`}
                        >
                          <option value="">— not on it —</option>
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r.charAt(0).toUpperCase() + r.slice(1)}
                            </option>
                          ))}
                        </select>
                      ) : roleOf(p.id) ? (
                        <Pill tone="neutral">{roleOf(p.id)}</Pill>
                      ) : (
                        <span className="text-graphite text-xs">—</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>

          <h3 className="mt-5 mb-2 text-sm font-semibold">Discussion</h3>
          <CommentThread projectId={projectId} entityType="meeting" entityId={meeting.id} />
        </div>

        <footer className="border-rule flex justify-end border-t px-5 py-3">
          <Button size="sm" onClick={onClose}>Done</Button>
        </footer>
      </aside>
    </div>
  )
}
