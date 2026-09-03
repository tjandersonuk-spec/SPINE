import { useCallback, useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router'

import { MeetingDetail } from '@/components/issues/MeetingDetail'
import { Button } from '@/components/ui/button'
import { Panel, PageHead } from '@/components/ui/panel'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { fetchMeetings, type Meeting } from '@/lib/queries'
import { supabase } from '@/lib/supabase'
import type { ProjectContext } from '@/pages/project/ProjectLayout'

const fmt = (d: string) =>
  new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

export default function MeetingsPage() {
  const { id = '' } = useParams()
  const ctx = useOutletContext<ProjectContext>()
  const [rows, setRows] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Meeting | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(() => {
    fetchMeetings(id)
      .then((r) => { setRows(r); setError(null) })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(load, [load])

  if (loading) return <div className="text-graphite p-6 text-sm">Loading…</div>

  return (
    <>
      <PageHead
        eyebrow="My work"
        title="Meetings"
        meta="Minutes are a record of the day. An item carried forward appears on both agendas."
        actions={ctx.canEdit ? (
          <Button size="sm" onClick={() => setAdding(true)}>New meeting</Button>
        ) : null}
      />

      {error && (
        <Panel kind="comply" className="mb-4">
          <p className="text-stop text-sm">{error}</p>
        </Panel>
      )}

      {rows.length === 0 ? (
        <Panel title="No meetings yet">
          <p className="text-graphite max-w-prose text-sm">
            A meeting you are not on does not appear here at all — attendance and distribution are
            the same list, and that list is what decides who can read the minutes.
          </p>
        </Panel>
      ) : (
        <Panel title={`${rows.length} meeting${rows.length === 1 ? '' : 's'}`}>
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH className="w-[84px]">Ref</TH>
                  <TH className="w-[110px]">Date</TH>
                  <TH>Title</TH>
                  <TH className="w-[110px]">Type</TH>
                  <TH className="w-[86px]">Status</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((m) => (
                  <TR key={m.id}>
                    <TD>
                      <button
                        type="button"
                        onClick={() => setOpen(m)}
                        className="text-primary cursor-pointer hover:underline"
                      >
                        <Code>{m.reference}</Code>
                      </button>
                    </TD>
                    <TD><Code className="text-graphite text-xs">{fmt(m.meeting_date)}</Code></TD>
                    <TD>{m.title}</TD>
                    <TD className="text-graphite text-xs">{m.meeting_type}</TD>
                    <TD>
                      {m.status === 'Issued'
                        ? <Pill tone="ok">Issued</Pill>
                        : <Pill tone="warn">Draft</Pill>}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
        </Panel>
      )}

      {adding && (
        <NewMeeting
          projectId={id}
          onClose={() => setAdding(false)}
          onCreated={() => { setAdding(false); load() }}
          onError={setError}
        />
      )}

      {open && (
        <MeetingDetail
          projectId={id}
          meeting={open}
          canEdit={ctx.canEdit}
          onClose={() => { setOpen(null); load() }}
        />
      )}
    </>
  )
}

function NewMeeting({
  projectId, onClose, onCreated, onError,
}: {
  projectId: string
  onClose: () => void
  onCreated: () => void
  onError: (m: string) => void
}) {
  const [busy, setBusy] = useState(false)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm">
      <form
        className="glass-popover w-full max-w-[480px] rounded-lg p-5"
        onSubmit={(e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          const reference = String(f.get('reference') ?? '').trim()
          const title = String(f.get('title') ?? '').trim()
          // Refuses empty input rather than creating a blank row.
          if (!reference || !title) return
          setBusy(true)
          // The Supabase builder is a PromiseLike, not a Promise: it has .then
          // but no .catch, so it has to be awaited rather than chained.
          void (async () => {
            try {
              const { error } = await supabase.from('meetings').insert({
                project_id: projectId,
                reference,
                title,
                meeting_type: String(f.get('meeting_type') ?? 'Design'),
                meeting_date: String(f.get('meeting_date') ?? ''),
                location: String(f.get('location') ?? '').trim() || null,
              })
              if (error) throw error
              onCreated()
            } catch (err) {
              onError((err as Error).message)
            } finally {
              setBusy(false)
            }
          })()
        }}
      >
        <h2 className="mb-3 text-base font-semibold">New meeting</h2>

        <div className="mb-3 flex gap-2">
          <label className="w-[120px]">
            <span className="mb-1 block text-sm font-medium">Reference</span>
            <input name="reference" placeholder="DTM-01" required
              className="border-rule w-full rounded border px-3 py-2 font-mono text-sm" />
          </label>
          <label className="flex-1">
            <span className="mb-1 block text-sm font-medium">Date</span>
            <input name="meeting_date" type="date" required
              className="border-rule w-full rounded border px-3 py-2 text-sm" />
          </label>
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-sm font-medium">Title</span>
          <input name="title" placeholder="Design team meeting" required
            className="border-rule w-full rounded border px-3 py-2 text-sm" />
        </label>

        <div className="mb-4 flex gap-2">
          <label className="w-[150px]">
            <span className="mb-1 block text-sm font-medium">Type</span>
            <select name="meeting_type"
              className="border-rule w-full rounded border px-2 py-2 text-sm">
              {['Design', 'Progress', 'Client', 'Workshop', 'Site'].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="flex-1">
            <span className="mb-1 block text-sm font-medium">Location</span>
            <input name="location"
              className="border-rule w-full rounded border px-3 py-2 text-sm" />
          </label>
        </div>

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button size="sm" type="submit" disabled={busy}>Create</Button>
        </div>
      </form>
    </div>
  )
}
