import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Code } from '@/components/ui/table'
import {
  fetchDirectoryPeople, fetchProgramme, raiseIssue,
  type Issue, type ProgrammeTask,
} from '@/lib/queries'

/** Raise a task or an RFI. Same form, same table, one field different. */
export function RaiseIssue({
  projectId, kind, onClose, onRaised,
}: {
  projectId: string
  kind: Issue['source_kind']
  onClose: () => void
  onRaised: () => void
}) {
  const [people, setPeople] = useState<Awaited<ReturnType<typeof fetchDirectoryPeople>>>([])
  const [lines, setLines] = useState<ProgrammeTask[]>([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [question, setQuestion] = useState('')
  const [person, setPerson] = useState('')
  const [uid, setUid] = useState('')
  const [offset, setOffset] = useState('0')
  const [anchor, setAnchor] = useState<'start' | 'finish'>('finish')
  const [priority, setPriority] = useState('50')
  const [restricted, setRestricted] = useState(false)
  const [named, setNamed] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([fetchDirectoryPeople(projectId), fetchProgramme(projectId)])
      .then(([p, t]) => { setPeople(p); setLines(t.filter((x) => !x.removed)) })
      .catch((e: Error) => setError(e.message))
  }, [projectId])

  const isRfi = kind === 'rfi'
  const ready = title.trim() && (!isRfi || question.trim())

  const line = lines.find((l) => l.task_uid === uid)
  const preview = line
    ? (() => {
        const base = new Date(anchor === 'start' ? line.start_date : line.finish_date)
        base.setDate(base.getDate() + (parseInt(offset, 10) || 0))
        return base.toISOString().slice(0, 10)
      })()
    : null

  const submit = async () => {
    setBusy(true); setError(null)
    try {
      await raiseIssue(projectId, {
        title: title.trim(),
        kind,
        description: description.trim() || null,
        personId: person || null,
        taskUid: uid || null,
        offsetDays: parseInt(offset, 10) || 0,
        anchor,
        priority: parseInt(priority, 10) || 50,
        rfiQuestion: isRfi ? question.trim() : null,
        // A named list still shows the item to whoever raised it and whoever
        // owns it, so restricting cannot hide it from the people carrying it.
        visibility: restricted
          ? { mode: 'named', people: [...named] }
          : { mode: 'project' },
      })
      onRaised()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6">
      <div
        className="bg-card border-rule w-full max-w-[620px] rounded-lg border shadow-2xl"
        role="dialog"
        aria-label={isRfi ? 'Raise an RFI' : 'Raise a task'}
      >
        <header className="border-rule flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-base font-semibold">
            {isRfi ? 'Raise an RFI' : 'Raise a task'}
          </h2>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">✕</Button>
        </header>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {error && (
            <p className="border-stop bg-stop-bg text-stop mb-3 rounded border-l-[3px] px-3 py-2 text-sm">
              {error}
            </p>
          )}

          <label className="mb-3 block">
            <span className="mb-1 block text-sm font-medium">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="border-rule w-full rounded border px-3 py-2 text-sm"
            />
          </label>

          {isRfi && (
            <label className="mb-3 block">
              <span className="mb-1 block text-sm font-medium">The question</span>
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                rows={3}
                placeholder="Which duct takes priority at grid E?"
                className="border-rule w-full rounded border px-3 py-2 text-sm"
              />
              <span className="text-graphite mt-1 block text-xs">
                An RFI without a question is refused — it is the whole record.
              </span>
            </label>
          )}

          <label className="mb-3 block">
            <span className="mb-1 block text-sm font-medium">
              {isRfi ? 'Background' : 'Description'}
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="border-rule w-full rounded border px-3 py-2 text-sm"
            />
          </label>

          <div className="mb-3 flex flex-wrap gap-2">
            <label className="min-w-56 flex-1">
              <span className="mb-1 block text-sm font-medium">Who is carrying it</span>
              <select
                value={person}
                onChange={(e) => setPerson(e.target.value)}
                className="border-rule w-full rounded border px-2 py-2 text-sm"
              >
                <option value="">— nobody yet —</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} · {p.company_name}</option>
                ))}
              </select>
            </label>
            <label className="w-[110px]">
              <span className="mb-1 block text-sm font-medium">Priority</span>
              <input
                type="number"
                min={0}
                max={100}
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="border-rule w-full rounded border px-3 py-2 font-mono text-sm"
              />
            </label>
          </div>

          <h3 className="mb-1 text-sm font-semibold">When it is due</h3>
          <p className="text-graphite mb-2 max-w-prose text-xs">
            Anchored to a programme line, so it moves when the programme does.
          </p>
          <div className="mb-3 flex flex-wrap gap-2">
            <label className="min-w-56 flex-1">
              <span className="mb-1 block text-xs font-medium">Programme line</span>
              <select
                value={uid}
                onChange={(e) => setUid(e.target.value)}
                className="border-rule w-full rounded border px-2 py-1.5 text-sm"
              >
                <option value="">— not anchored —</option>
                {lines.map((l) => (
                  <option key={l.id} value={l.task_uid}>{l.task_uid} · {l.description}</option>
                ))}
              </select>
            </label>
            <label className="w-[90px]">
              <span className="mb-1 block text-xs font-medium">Days</span>
              <input
                type="number"
                value={offset}
                onChange={(e) => setOffset(e.target.value)}
                className="border-rule w-full rounded border px-2 py-1.5 font-mono text-sm"
              />
            </label>
            <label className="w-[140px]">
              <span className="mb-1 block text-xs font-medium">From the</span>
              <select
                value={anchor}
                onChange={(e) => setAnchor(e.target.value as 'start' | 'finish')}
                className="border-rule w-full rounded border px-2 py-1.5 text-sm"
              >
                <option value="finish">finish</option>
                <option value="start">start</option>
              </select>
            </label>
          </div>
          {preview && (
            <p className="border-rule bg-surface-2 mb-3 rounded border-l-[3px] px-3 py-2 text-sm">
              Due <Code>{preview}</Code>, and moves whenever that line does.
            </p>
          )}

          <label className="mb-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={restricted}
              onChange={(e) => setRestricted(e.target.checked)}
            />
            Restrict who can see this
          </label>
          {restricted && (
            <div className="border-rule mb-2 max-h-40 overflow-y-auto rounded border p-2">
              <p className="text-graphite mb-2 text-xs">
                You and whoever is carrying it always see it, whatever is ticked here — a
                distribution list must never hide an item from the people responsible for it.
                The contractor’s own staff see everything.
              </p>
              {people.filter((p) => p.profile_id).map((p) => (
                <label key={p.id} className="flex items-center gap-2 py-0.5 text-sm">
                  <input
                    type="checkbox"
                    checked={named.has(p.profile_id!)}
                    onChange={(e) => setNamed((prev) => {
                      const next = new Set(prev)
                      if (e.target.checked) next.add(p.profile_id!)
                      else next.delete(p.profile_id!)
                      return next
                    })}
                  />
                  {p.name} <span className="text-graphite text-xs">{p.company_name}</span>
                </label>
              ))}
              {people.some((p) => !p.profile_id) && (
                <p className="text-graphite mt-2 text-xs">
                  People in the directory who have not accepted an invitation yet are not listed:
                  a restriction is a list of logins, and they do not have one.
                </p>
              )}
            </div>
          )}
        </div>

        <footer className="border-rule flex items-center justify-end gap-2 border-t px-5 py-3">
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={busy || !ready} onClick={() => void submit()}>
            {busy ? 'Raising…' : isRfi ? 'Raise the RFI' : 'Raise the task'}
          </Button>
        </footer>
      </div>
    </div>
  )
}
