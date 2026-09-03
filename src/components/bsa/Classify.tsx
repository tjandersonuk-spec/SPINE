import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { classifyChange, type ChangeRequest } from '@/lib/queries'

/**
 * Classifying a change under the Building Safety Act.
 *
 * The app never suggests a category. Recordable, notifiable or major is a
 * duty-holder judgement made by the client, the principal designer and the
 * principal contractor together — so there is no default selected, no
 * recommendation, and no hint from the impact fields.
 *
 * The written basis is required. A classification with no reasoning is the
 * thing somebody has to defend later, and the database refuses it either way.
 */
const CLASSES = ['Recordable', 'Notifiable', 'Major'] as const

export function Classify({
  change, onClose, onDone,
}: {
  change: ChangeRequest
  onClose: () => void
  onDone: () => void
}) {
  const [bsaClass, setBsaClass] = useState<typeof CLASSES[number] | ''>('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <form
        className="bg-card border-rule w-full max-w-[560px] rounded-lg border p-5 shadow-2xl"
        onSubmit={(e) => {
          e.preventDefault()
          if (!bsaClass || !note.trim()) return
          setBusy(true); setError(null)
          classifyChange(change.id, bsaClass, note.trim())
            .then(onDone)
            .catch((err: Error) => setError(err.message))
            .finally(() => setBusy(false))
        }}
      >
        <h2 className="mb-1 text-base font-semibold">
          Classify {change.reference} under the Building Safety Act
        </h2>
        <p className="text-graphite mb-4 max-w-prose text-sm">
          This is a duty-holder judgement, reached between the client, the principal designer and
          the principal contractor. Nothing here is suggested or pre-selected, and the app will
          not compute it from the impact — what is recorded is your decision, when you made it,
          and why.
        </p>

        {error && (
          <p className="border-stop bg-stop-bg text-stop mb-3 rounded border-l-[3px] px-3 py-2 text-sm">
            {error}
          </p>
        )}

        <fieldset className="mb-4">
          <legend className="mb-2 text-sm font-medium">Classification</legend>
          <div className="flex flex-col gap-1.5">
            {CLASSES.map((c) => (
              <label key={c} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="bsa_class"
                  value={c}
                  checked={bsaClass === c}
                  onChange={() => setBsaClass(c)}
                  className="mt-1"
                />
                <span>{c}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="mb-4 block">
          <span className="mb-1 block text-sm font-medium">The basis for it</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            placeholder="Who agreed it, when, and on what grounds."
            className="border-rule w-full rounded border px-3 py-2 text-sm"
          />
          <span className="text-graphite mt-1 block text-xs">
            Required. A classification without its reasoning is the one somebody has to defend.
          </span>
        </label>

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button size="sm" type="submit" disabled={busy || !bsaClass || !note.trim()}>
            {busy ? 'Recording…' : 'Record the classification'}
          </Button>
        </div>
      </form>
    </div>
  )
}
