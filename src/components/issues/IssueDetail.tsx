import { useState } from 'react'

import { CommentThread } from '@/components/issues/CommentThread'
import { Button } from '@/components/ui/button'
import { Code, Pill } from '@/components/ui/table'
import { ISSUE_KIND_LABELS, answerRfi, closeIssue, type Issue } from '@/lib/queries'

/** One issue in full, with its own discussion thread. */
export function IssueDetail({
  projectId, issue, canReview, onClose, onChanged,
}: {
  projectId: string
  issue: Issue
  canReview: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const act = (p: Promise<unknown>) => {
    setBusy(true); setError(null)
    p.then(() => { onChanged(); onClose() })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false))
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm" onClick={onClose} role="presentation">
      <aside
        className="glass-popover flex h-full w-full max-w-[600px] flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Issue ${issue.reference}`}
      >
        <header className="border-rule flex items-start justify-between gap-3 border-b px-5 py-4">
          <div>
            <Code className="text-graphite text-xs">{issue.reference}</Code>
            <h2 className="mt-0.5 text-base font-semibold">{issue.title}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Pill tone="neutral">{ISSUE_KIND_LABELS[issue.source_kind]}</Pill>
              {issue.status === 'Closed' ? <Pill tone="ok">Closed</Pill>
                : issue.overdue ? <Pill tone="stop">Overdue</Pill>
                : <Pill tone="neutral">Open</Pill>}
              <span
                className="text-graphite text-xs"
                title={`priority ${issue.priority} + time pressure`}
              >
                urgency {issue.urgency}
              </span>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">✕</Button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && <p className="text-stop mb-3 text-sm">{error}</p>}

          {issue.description && (
            <p className="mb-4 text-sm whitespace-pre-wrap">{issue.description}</p>
          )}

          <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-graphite">Due</dt>
            <dd>
              <Code>{issue.due ?? '—'}</Code>
              {issue.anchor_state === 'removed' && (
                <span className="text-stop ml-1.5 text-xs">
                  line removed from the programme
                </span>
              )}
            </dd>
            <dt className="text-graphite">Anchored to</dt>
            <dd>
              {issue.programme_task_uid
                ? <><Code>{issue.programme_task_uid}</Code>{' '}
                    <span className="text-graphite text-xs">
                      {issue.offset_days >= 0 ? '+' : ''}{issue.offset_days}d from {issue.anchor}
                    </span></>
                : <span className="text-graphite">not anchored</span>}
            </dd>
            <dt className="text-graphite">Raised</dt>
            <dd>{new Date(issue.raised_at).toLocaleDateString('en-GB')}</dd>
          </dl>

          {issue.source_kind === 'rfi' && (
            <section className="border-rule bg-surface-2 mb-4 rounded border p-3">
              <h3 className="mb-1 text-sm font-semibold">The question</h3>
              <p className="mb-3 text-sm whitespace-pre-wrap">{issue.rfi_question}</p>

              {issue.rfi_response ? (
                <>
                  <h3 className="mb-1 text-sm font-semibold">The answer</h3>
                  <p className="text-sm whitespace-pre-wrap">{issue.rfi_response}</p>
                </>
              ) : canReview ? (
                <form
                  className="flex flex-col gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!answer.trim()) return
                    act(answerRfi(issue.id, answer.trim()))
                  }}
                >
                  <textarea
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    rows={3}
                    placeholder="Answer it…"
                    className="border-rule w-full rounded border px-3 py-2 text-sm"
                  />
                  <Button size="sm" type="submit" disabled={busy || !answer.trim()}>
                    Answer
                  </Button>
                </form>
              ) : (
                <p className="text-graphite text-sm">Waiting on an answer.</p>
              )}
            </section>
          )}

          <h3 className="mb-2 text-sm font-semibold">Discussion</h3>
          <CommentThread
            projectId={projectId}
            entityType="issue"
            entityId={issue.id}
            canRaiseTask={false}
          />
        </div>

        <footer className="border-rule flex gap-2 border-t px-5 py-3">
          <Button
            size="sm"
            variant={issue.status === 'Closed' ? 'secondary' : 'default'}
            disabled={busy}
            onClick={() => act(closeIssue(issue.id, issue.status === 'Closed'))}
          >
            {issue.status === 'Closed' ? 'Reopen' : 'Close'}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>Done</Button>
        </footer>
      </aside>
    </div>
  )
}
