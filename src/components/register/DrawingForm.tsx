import { useEffect, useState } from 'react'

import { CommentThread } from '@/components/issues/CommentThread'
import { Button } from '@/components/ui/button'
import { Code } from '@/components/ui/table'
import {
  addPlannedDrawing, fetchProgramme, setDrawingAnchor,
  type Drawing, type ProgrammeTask,
} from '@/lib/queries'

/**
 * Add a drawing that is expected, or set where an existing one takes its date
 * from.
 *
 * There is no date field. A drawing is due a number of days either side of a
 * programme line, so that re-importing the programme moves it with everything
 * else. The override exists for the case the spine genuinely cannot express,
 * and says plainly what it costs.
 */
export function DrawingForm({
  projectId, drawing, onClose, onSaved,
}: {
  projectId: string
  /** Null to add a drawing that is expected but has not arrived. */
  drawing: Drawing | null
  onClose: () => void
  onSaved: () => void
}) {
  const [lines, setLines] = useState<ProgrammeTask[]>([])
  const [number, setNumber] = useState(drawing?.document_number ?? '')
  const [title, setTitle] = useState(drawing?.title ?? '')
  const [cdeUrl, setCdeUrl] = useState(drawing?.cde_url ?? '')
  const [uid, setUid] = useState(drawing?.programme_task_uid ?? '')
  const [offset, setOffset] = useState(String(drawing?.offset_days ?? 0))
  const [anchor, setAnchor] = useState<'start' | 'finish'>(drawing?.anchor ?? 'finish')
  const [override, setOverride] = useState(drawing?.due_date_override ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchProgramme(projectId)
      .then((t) => setLines(t.filter((x) => !x.removed)))
      .catch((e: Error) => setError(e.message))
  }, [projectId])

  const line = lines.find((l) => l.task_uid === uid)
  const preview = (() => {
    if (override) return override
    if (!line) return null
    const base = new Date(anchor === 'start' ? line.start_date : line.finish_date)
    base.setDate(base.getDate() + (parseInt(offset, 10) || 0))
    return base.toISOString().slice(0, 10)
  })()

  const save = async () => {
    setBusy(true); setError(null)
    try {
      const a = {
        programme_task_uid: uid || null,
        offset_days: parseInt(offset, 10) || 0,
        anchor,
        due_date_override: override || null,
      }
      if (drawing) {
        await setDrawingAnchor(drawing.id, a)
        // The number, title and CDE link are editable on an existing row; the
        // revision is not, because it comes from reconciliation alone.
        const { supabase } = await import('@/lib/supabase')
        const { error: e } = await supabase.from('drawing_register')
          .update({ document_number: number.trim(), title: title.trim() || null,
                    cde_url: cdeUrl.trim() || null })
          .eq('id', drawing.id)
        if (e) throw e
      } else {
        if (!number.trim()) { setError('A drawing needs a number.'); return }
        await addPlannedDrawing(projectId, {
          document_number: number.trim(),
          title: title.trim() || null,
          ...a,
        })
      }
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-6 backdrop-blur-sm">
      <div
        className="glass-popover w-full max-w-[560px] rounded-lg"
        role="dialog"
        aria-label={drawing ? 'Edit drawing' : 'Add an expected drawing'}
      >
        <header className="border-rule flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-base font-semibold">
            {drawing ? 'Edit drawing' : 'Add an expected drawing'}
          </h2>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">✕</Button>
        </header>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {error && (
            <p className="border-stop bg-stop-bg text-stop mb-3 rounded border-l-[3px] px-3 py-2 text-sm">
              {error}
            </p>
          )}

          {!drawing && (
            <p className="text-graphite mb-4 max-w-prose text-sm">
              A drawing you are expecting goes in the register now, before it exists. It is the
              same row it will be when it arrives — the ones that never turn up are only visible
              because they were written down.
            </p>
          )}

          <label className="mb-3 block">
            <span className="mb-1 block text-sm font-medium">Document number</span>
            <input
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="KMW-BEL-BC-GF-DR-A-0100"
              className="border-rule w-full rounded border px-3 py-2 font-mono text-sm"
            />
            <span className="text-graphite mt-1 block text-xs">
              Checked against the naming convention; the register says why if it does not match.
            </span>
          </label>

          <label className="mb-3 block">
            <span className="mb-1 block text-sm font-medium">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ground floor general arrangement"
              className="border-rule w-full rounded border px-3 py-2 text-sm"
            />
          </label>

          {drawing && (
            <label className="mb-4 block">
              <span className="mb-1 block text-sm font-medium">CDE link</span>
              <input
                value={cdeUrl}
                onChange={(e) => setCdeUrl(e.target.value)}
                placeholder="https://…"
                className="border-rule w-full rounded border px-3 py-2 text-sm"
              />
              <span className="text-graphite mt-1 block text-xs">
                A link only. The file stays in the CDE — nothing is ever uploaded here.
              </span>
            </label>
          )}

          <h3 className="mb-2 text-sm font-semibold">When it is due</h3>
          <p className="text-graphite mb-3 max-w-prose text-xs">
            No date is typed. A drawing is due so many days from the start or finish of a
            programme line, so that re-importing the programme moves it along with everything
            else anchored there.
          </p>

          <label className="mb-3 block">
            <span className="mb-1 block text-sm font-medium">Programme line</span>
            <select
              value={uid}
              onChange={(e) => setUid(e.target.value)}
              className="border-rule w-full rounded border px-2 py-2 text-sm"
            >
              <option value="">— not anchored —</option>
              {lines.map((l) => (
                <option key={l.id} value={l.task_uid}>
                  {l.task_uid} · {l.description}
                </option>
              ))}
            </select>
          </label>

          <div className="mb-3 flex gap-2">
            <label className="flex-1">
              <span className="mb-1 block text-sm font-medium">Days</span>
              <input
                type="number"
                value={offset}
                onChange={(e) => setOffset(e.target.value)}
                className="border-rule w-full rounded border px-3 py-2 font-mono text-sm"
              />
            </label>
            <label className="flex-[2]">
              <span className="mb-1 block text-sm font-medium">From the</span>
              <select
                value={anchor}
                onChange={(e) => setAnchor(e.target.value as 'start' | 'finish')}
                className="border-rule w-full rounded border px-2 py-2 text-sm"
              >
                <option value="finish">finish of that line</option>
                <option value="start">start of that line</option>
              </select>
            </label>
          </div>

          {preview && (
            <p className="border-rule bg-surface-2 mb-3 rounded border-l-[3px] px-3 py-2 text-sm">
              Due <Code>{preview}</Code>
              {override
                ? ' — a typed date, which will not move with the programme.'
                : ' — and moves whenever that line does.'}
            </p>
          )}

          <label className="mb-1 block">
            <span className="mb-1 block text-sm font-medium">Override the date</span>
            <input
              type="date"
              value={override}
              onChange={(e) => setOverride(e.target.value)}
              className="border-rule w-full rounded border px-3 py-2 text-sm"
            />
            <span className="text-graphite mt-1 block text-xs">
              An escape hatch for the case the programme genuinely cannot express. It wins over
              the anchor and stops following the programme, so it is flagged wherever it is used.
              Leave it empty unless you mean it.
            </span>
          </label>
          {drawing && (
            <>
              <h3 className="mt-5 mb-2 text-sm font-semibold">Discussion</h3>
              <CommentThread
                projectId={projectId}
                entityType="drawing"
                entityId={drawing.id}
              />
            </>
          )}
        </div>

        <footer className="border-rule flex items-center justify-end gap-2 border-t px-5 py-3">
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={busy || !number.trim()} onClick={() => void save()}>
            {busy ? 'Saving…' : drawing ? 'Save' : 'Add to the register'}
          </Button>
        </footer>
      </div>
    </div>
  )
}
