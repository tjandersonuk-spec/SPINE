import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext, useParams } from 'react-router'

import { RequireModule } from '@/components/shell/RequireModule'
import { Button } from '@/components/ui/button'
import { fieldClass } from '@/components/ui/input'
import { ErrorNote } from '@/components/ui/notes'
import { Eyebrow, PageHead, Panel } from '@/components/ui/panel'
import { Code, Pill } from '@/components/ui/table'
import { fmtDate } from '@/lib/format'
import {
  createRoom, fetchProjectPeople, fetchProjectRooms, fetchRoomAudience, fetchRoomMessages,
  markRoomRead, postRoomMessage, raiseFromRoom, setRoomArchived, subscribeToRoom,
  withdrawRoomMessage,
  type ProjectPerson, type RoomAudience, type RoomMessage, type RoomRow,
} from '@/lib/queries'
import type { ProjectContext } from '@/pages/project/ProjectLayout'

/**
 * Project rooms.
 *
 * The correspondence that has not found its record yet. Everything else in the
 * product hangs off something — an issue, a drawing, a matrix duty — and the
 * conversations that do not are happening on WhatsApp, where the golden thread
 * cannot see them and they leave with the person who leaves the company.
 *
 * Two things about this page are not conveniences and must not be softened.
 *
 * Every room states its audience at the top, ending in "and administrators",
 * because that is always true: an account admin and a project admin read every
 * room. Rooms are not direct messages, and somebody about to type needs to
 * know that before they type rather than after.
 *
 * Nothing here can be made to disappear. There is no delete — a message is
 * withdrawn, which marks the row and leaves it where it was, and the database
 * refuses a delete rather than the button being hidden.
 */
/** A date only when it is not today: a room reads as a conversation, and the
 *  full date on every line is what makes a transcript instead. */
function fmtWhen(iso: string): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const today = new Date().toDateString() === d.toDateString()
  return today ? time : `${fmtDate(iso)} ${time}`
}

const MODE_LABEL: Record<string, string> = {
  project: 'Everyone on the project',
  internal: 'Account staff only',
  named: 'Only the people named',
  parties: 'The companies named, and the people named',
}

/** The sentence under the room name. It always ends with administrators. */
function audienceSentence(a: RoomAudience): string {
  const parts: string[] = [MODE_LABEL[a.mode] ?? a.mode]
  if (a.companies?.length) parts.push(a.companies.join(', '))
  if (a.people?.length) parts.push(a.people.join(', '))
  return `${parts.join(' — ')}, and administrators.`
}

export default function RoomsPage() {
  return (
    <RequireModule module="rooms">
      <Rooms />
    </RequireModule>
  )
}

function Rooms() {
  const { id = '' } = useParams()
  const ctx = useOutletContext<ProjectContext>()
  const [rooms, setRooms] = useState<RoomRow[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [audience, setAudience] = useState<RoomAudience | null>(null)
  const [messages, setMessages] = useState<RoomMessage[]>([])
  const [people, setPeople] = useState<ProjectPerson[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadRooms = useCallback(() => {
    fetchProjectRooms(id)
      .then((r) => {
        setRooms(r)
        setCurrent((c) => c ?? r.find((x) => !x.archived)?.id ?? r[0]?.id ?? null)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => { loadRooms() }, [loadRooms])
  useEffect(() => { fetchProjectPeople(id).then(setPeople).catch(() => setPeople([])) }, [id])

  const loadMessages = useCallback(() => {
    if (!current) return
    Promise.all([fetchRoomMessages(current), fetchRoomAudience(current)])
      .then(([m, a]) => { setMessages(m); setAudience(a); setError(null) })
      .catch((e: Error) => setError(e.message))
  }, [current])

  useEffect(() => { setSelected(new Set()); loadMessages() }, [loadMessages])

  // Live, through Realtime. The subscription hears only what the room's
  // audience already lets this person read — the policy is applied to the
  // replicated row, not by this component.
  useEffect(() => {
    if (!current) return
    return subscribeToRoom(current, () => { loadMessages(); loadRooms() })
  }, [current, loadMessages, loadRooms])

  // Caught up, once the messages are on screen.
  useEffect(() => {
    if (!current || !messages.length) return
    markRoomRead(current).then(loadRooms).catch(() => undefined)
    // Deliberately not re-running on loadRooms: marking read reloads the list,
    // which would mark it read again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, messages.length])

  const room = rooms.find((r) => r.id === current) ?? null

  if (loading) return null

  return (
    <>
      <PageHead
        eyebrow={ctx.project?.code}
        title="Project rooms"
        meta="Conversations that have not found a record yet. Nothing here is private."
        actions={<NewRoom projectId={id} people={people} onDone={loadRooms} />}
      />
      <ErrorNote message={error} />

      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <RoomList rooms={rooms} current={current} onPick={setCurrent} />
        {room && audience ? (
          <RoomPane
            room={room}
            audience={audience}
            messages={messages}
            people={people}
            me={ctx.me}
            selected={selected}
            onSelect={setSelected}
            onChanged={() => { loadMessages(); loadRooms() }}
            onError={setError}
          />
        ) : (
          <Panel title="No room open">
            <p className="text-graphite max-w-prose text-sm">
              {rooms.length
                ? 'Choose a room on the left.'
                : 'No rooms yet. A room is a place for the part of a job that has not '
                  + 'become an issue or a drawing yet — a facade coordination thread, a '
                  + 'week of back and forth about a detail. Every one says at the top who '
                  + 'can read it.'}
            </p>
          </Panel>
        )}
      </div>
    </>
  )
}

function RoomList({
  rooms, current, onPick,
}: { rooms: RoomRow[]; current: string | null; onPick: (id: string) => void }) {
  return (
    <Panel title="Rooms">
      <div className="flex flex-col gap-1">
        {rooms.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onPick(r.id)}
            className={`rounded-md px-3 py-2 text-left transition-colors ${
              r.id === current ? 'glass-hi' : 'hover:bg-white/[0.05]'
            }`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium">{r.name}</span>
              {r.unread > 0 && (
                <span className="bg-primary text-primary-foreground shadow-brand rounded-full px-1.5 font-mono text-[10px] font-bold">
                  {r.unread}
                </span>
              )}
            </span>
            <span className="text-graphite block truncate text-xs">
              {r.archived
                ? 'Archived'
                : r.last_body ?? (r.purpose || 'Nothing said yet')}
            </span>
          </button>
        ))}
        {!rooms.length && (
          <p className="text-graphite text-sm">None yet.</p>
        )}
      </div>
    </Panel>
  )
}

function RoomPane({
  room, audience, messages, people, me, selected, onSelect, onChanged, onError,
}: {
  room: RoomRow
  audience: RoomAudience
  messages: RoomMessage[]
  people: ProjectPerson[]
  me: string | null
  selected: Set<string>
  onSelect: (s: Set<string>) => void
  onChanged: () => void
  onError: (m: string | null) => void
}) {
  const [body, setBody] = useState('')
  const [mentions, setMentions] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const foot = useRef<HTMLDivElement>(null)

  useEffect(() => { foot.current?.scrollIntoView({ block: 'end' }) }, [messages.length])

  const mentionable = useMemo(
    () => people.filter((p) => p.profile_id).sort((a, b) => a.name.localeCompare(b.name)),
    [people])

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onSelect(next)
  }

  const send = () => {
    if (!body.trim()) return
    setBusy(true)
    postRoomMessage(room.id, body, mentions)
      .then(() => { setBody(''); setMentions([]); onError(null); onChanged() })
      .catch((e: Error) => onError(e.message))
      .finally(() => setBusy(false))
  }

  return (
    <Panel
      title={room.name}
      actions={
        <div className="flex items-center gap-2">
          <RaiseFromSelection
            roomId={room.id}
            ids={[...selected]}
            people={people}
            onDone={() => { onSelect(new Set()); onChanged() }}
            onError={onError}
          />
          <Button variant="ghost" size="sm"
            onClick={() => setRoomArchived(room.id, !room.archived).then(onChanged)
              .catch((e: Error) => onError(e.message))}>
            {room.archived ? 'Reopen' : 'Archive'}
          </Button>
        </div>
      }
    >
      {/* Who can read this, before anybody types rather than after. */}
      <div className="border-glass-line mb-4 border-b pb-3">
        <Eyebrow>Who can read this</Eyebrow>
        <p className="mt-1 text-sm">{audienceSentence(audience)}</p>
        {room.purpose && <p className="text-graphite mt-1 text-xs">{room.purpose}</p>}
      </div>

      <div className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto pr-1">
        {messages.map((m) => (
          <Message key={m.id} m={m} mine={m.author_id === me}
            picked={selected.has(m.id)} onPick={() => toggle(m.id)}
            onWithdraw={() => withdrawRoomMessage(m.id).then(onChanged)
              .catch((e: Error) => onError(e.message))} />
        ))}
        {!messages.length && (
          <p className="text-graphite text-sm">Nothing said yet.</p>
        )}
        <div ref={foot} />
      </div>

      {room.archived ? (
        <p className="text-graphite border-glass-line mt-4 border-t pt-3 text-sm">
          This room is archived. It still reads; nothing more can be added to it.
        </p>
      ) : (
        <div className="border-glass-line mt-4 border-t pt-3">
          <textarea
            className={`${fieldClass} min-h-20 w-full resize-y`}
            placeholder="Write something"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
            }}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              className={fieldClass}
              value=""
              onChange={(e) => {
                if (e.target.value && !mentions.includes(e.target.value)) {
                  setMentions([...mentions, e.target.value])
                }
              }}
            >
              <option value="">Name somebody…</option>
              {mentionable.map((p) => (
                <option key={p.id} value={p.profile_id!}>{p.name}</option>
              ))}
            </select>
            {mentions.map((pid) => (
              <Pill key={pid} tone="neutral">
                {mentionable.find((p) => p.profile_id === pid)?.name ?? 'Someone'}
              </Pill>
            ))}
            <span className="grow" />
            <Button size="sm" disabled={busy || !body.trim()} onClick={send}>Send</Button>
          </div>
          <p className="text-graphite mt-2 text-xs">
            Naming somebody emails them. Anyone named who cannot read this room is dropped —
            a message about something they could not open is worse than not being told.
          </p>
        </div>
      )}
    </Panel>
  )
}

function Message({
  m, mine, picked, onPick, onWithdraw,
}: {
  m: RoomMessage; mine: boolean; picked: boolean
  onPick: () => void; onWithdraw: () => void
}) {
  return (
    <div className={`rounded-md px-3 py-2 ${picked ? 'glass-hi' : 'bg-white/[0.03]'}`}>
      <div className="flex items-baseline gap-2">
        <input
          type="checkbox"
          className="accent-primary size-3.5"
          checked={picked}
          onChange={onPick}
          aria-label="Include in a task"
        />
        <span className="text-sm font-medium">{m.author}</span>
        <Code className="text-[10px]">{fmtWhen(m.created_at)}</Code>
        {m.edited_at && <span className="text-graphite text-[10px]">edited</span>}
        <span className="grow" />
        {mine && !m.deleted_at && (
          <button type="button" className="text-graphite hover:text-foreground text-xs"
            onClick={onWithdraw}>
            Withdraw
          </button>
        )}
      </div>
      {m.deleted_at && (
        <p className="text-warn mt-1 text-xs">
          Withdrawn by {m.deleted_by}. It stays here: a retraction is part of the record.
        </p>
      )}
      <p className={`mt-1 text-sm whitespace-pre-wrap ${m.deleted_at ? 'text-graphite line-through' : ''}`}>
        {m.body}
      </p>
    </div>
  )
}

/**
 * The control that makes this part of the product rather than a chat window
 * bolted to it. It takes a selection, not one message: the real workflow is
 * "this whole exchange is now an RFI".
 */
function RaiseFromSelection({
  roomId, ids, people, onDone, onError,
}: {
  roomId: string; ids: string[]; people: ProjectPerson[]
  onDone: () => void; onError: (m: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<'chat' | 'rfi'>('chat')
  const [person, setPerson] = useState('')
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)

  if (!ids.length) {
    return <span className="text-graphite text-xs">Tick messages to raise a task</span>
  }

  const go = () => {
    setBusy(true)
    raiseFromRoom({
      roomId, messageIds: ids, title, kind,
      personId: person || null, question: kind === 'rfi' ? question : null,
    })
      .then(() => { setOpen(false); setTitle(''); setQuestion(''); onError(null); onDone() })
      .catch((e: Error) => onError(e.message))
      .finally(() => setBusy(false))
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Raise from {ids.length} {ids.length === 1 ? 'message' : 'messages'}
      </Button>
    )
  }

  return (
    <div className="glass-popover absolute right-4 z-10 mt-2 flex w-80 flex-col gap-2 rounded-md p-3">
      <Eyebrow>From {ids.length} selected</Eyebrow>
      <input className={fieldClass} placeholder="Title" value={title}
        onChange={(e) => setTitle(e.target.value)} />
      <select className={fieldClass} value={kind}
        onChange={(e) => setKind(e.target.value as 'chat' | 'rfi')}>
        <option value="chat">Task</option>
        <option value="rfi">RFI</option>
      </select>
      {kind === 'rfi' && (
        <input className={fieldClass} placeholder="The question" value={question}
          onChange={(e) => setQuestion(e.target.value)} />
      )}
      <select className={fieldClass} value={person} onChange={(e) => setPerson(e.target.value)}>
        <option value="">Nobody yet</option>
        {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <p className="text-graphite text-xs">
        The messages are quoted into it, and this room is told where they went.
      </p>
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !title.trim()} onClick={go}>Raise</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  )
}

function NewRoom({
  projectId, people, onDone,
}: { projectId: string; people: ProjectPerson[]; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [purpose, setPurpose] = useState('')
  const [mode, setMode] = useState('project')
  const [named, setNamed] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mentionable = people.filter((p) => p.profile_id)

  const go = () => {
    setBusy(true)
    createRoom({
      projectId, name, purpose,
      visibility: mode === 'named' ? { mode: 'named', people: named } : { mode },
    })
      .then(() => { setOpen(false); setName(''); setPurpose(''); setNamed([]); onDone() })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false))
  }

  if (!open) return <Button size="sm" onClick={() => setOpen(true)}>New room</Button>

  return (
    <div className="glass-popover absolute right-0 z-10 mt-2 flex w-80 flex-col gap-2 rounded-md p-3">
      <ErrorNote message={error} />
      <input className={fieldClass} placeholder="Name" value={name}
        onChange={(e) => setName(e.target.value)} />
      <input className={fieldClass} placeholder="What it is for" value={purpose}
        onChange={(e) => setPurpose(e.target.value)} />
      <select className={fieldClass} value={mode} onChange={(e) => setMode(e.target.value)}>
        <option value="project">Everyone on the project</option>
        <option value="internal">Account staff only</option>
        <option value="named">Only the people I name</option>
      </select>
      {mode === 'named' && (
        <select
          className={fieldClass}
          value=""
          onChange={(e) => {
            if (e.target.value && !named.includes(e.target.value)) {
              setNamed([...named, e.target.value])
            }
          }}
        >
          <option value="">Add somebody…</option>
          {mentionable.map((p) => (
            <option key={p.id} value={p.profile_id!}>{p.name}</option>
          ))}
        </select>
      )}
      {mode === 'named' && named.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {named.map((pid) => (
            <Pill key={pid} tone="neutral">
              {mentionable.find((p) => p.profile_id === pid)?.name ?? 'Someone'}
            </Pill>
          ))}
        </div>
      )}
      <p className="text-graphite text-xs">
        Whichever you choose, an account admin and this project's admin can read it. There
        are no private rooms, and the room says so at the top.
      </p>
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !name.trim()} onClick={go}>Create</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  )
}
