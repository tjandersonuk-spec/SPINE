import { useCallback, useEffect, useState } from 'react'

import { RaiseIssue } from '@/components/issues/RaiseIssue'
import { Button } from '@/components/ui/button'
import { Code } from '@/components/ui/table'
import {
  addComment, attachDrawingToComment, deleteComment, editComment, fetchCommentAttachments,
  fetchComments, fetchRegister, raiseIssue, type Comment, type Drawing,
} from '@/lib/queries'

/**
 * Discussion on any record.
 *
 * One component and one table for every entity, because a thread is the same
 * thing whether it hangs off a drawing, a matrix item or a fee. An attachment
 * is a live link to a register row rather than a filename: a drawing referenced
 * here six months ago still shows the revision it is at now, which is the whole
 * reason the link is not a string.
 */
type Attachment = Awaited<ReturnType<typeof fetchCommentAttachments>>[number]

export function CommentThread({
  projectId, entityType, entityId, canRaiseTask = true,
}: {
  projectId: string
  entityType: string
  entityId: string
  canRaiseTask?: boolean
}) {
  const [comments, setComments] = useState<Comment[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [drawings, setDrawings] = useState<Drawing[]>([])
  const [me, setMe] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [attachTo, setAttachTo] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** Raising is chosen before the remark is posted, not after: the task's
   *  title, owner and date are decided while the person is still thinking
   *  about the thing they just typed. */
  const [raising, setRaising] = useState<'comment' | 'rfi' | null>(null)

  const load = useCallback(() => {
    Promise.all([
      fetchComments(projectId, entityType, entityId),
      fetchRegister(projectId),
      import('@/lib/supabase').then((m) => m.supabase.auth.getUser()),
    ])
      .then(async ([c, d, u]) => {
        setComments(c)
        setDrawings(d)
        setMe(u.data.user?.id ?? null)
        setAttachments(await fetchCommentAttachments(c.map((x) => x.id)))
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [projectId, entityType, entityId])

  useEffect(load, [load])

  const post = async () => {
    if (!body.trim()) return
    setBusy(true); setError(null)
    try {
      const id = await addComment(projectId, entityType, entityId, body.trim())
      if (attachTo) await attachDrawingToComment(id, attachTo)
      setBody(''); setAttachTo('')
      load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const raiseFrom = async (c: Comment) => {
    try {
      const out = await raiseIssue(projectId, {
        title: c.body.length > 70 ? `${c.body.slice(0, 69)}…` : c.body,
        kind: 'comment',
        description: c.body,
        originCommentId: c.id,
      })
      setError(null)
      alert(`${out.reference} raised, carrying this discussion as its description.`)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const fmt = (d: string) =>
    new Date(d).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
    })

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-stop text-sm">{error}</p>}

      {comments.length === 0 ? (
        <p className="text-graphite text-sm">
          Nothing discussed here yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.map((c) => {
            const mine = c.author_id === me
            const atts = attachments.filter((a) => a.comment_id === c.id)
            return (
              <li key={c.id} className="border-rule border-l-[3px] pl-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-semibold">{c.author_name ?? 'Someone'}</span>
                  <span className="text-graphite text-xs">{fmt(c.created_at)}</span>
                  {c.edited_at && <span className="text-graphite text-xs">· edited</span>}
                </div>

                {editing === c.id ? (
                  <form
                    className="mt-1 flex flex-col gap-2"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const v = (new FormData(e.currentTarget).get('body') as string).trim()
                      if (!v) return
                      editComment(c.id, v)
                        .then(() => { setEditing(null); load() })
                        .catch((err: Error) => setError(err.message))
                    }}
                  >
                    <textarea
                      name="body"
                      defaultValue={c.body}
                      rows={3}
                      className="border-rule w-full rounded border px-3 py-2 text-sm"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" type="submit">Save</Button>
                      <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <p className="mt-0.5 text-sm whitespace-pre-wrap">{c.body}</p>
                )}

                {atts.length > 0 && (
                  <ul className="mt-1.5 flex flex-wrap gap-2">
                    {atts.map((a) => (
                      <li key={a.id}>
                        {a.document_number ? (
                          <a
                            href={a.cde_url ?? '#'}
                            target={a.cde_url ? '_blank' : undefined}
                            rel="noreferrer"
                            className="border-rule bg-surface-2 inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs"
                            title="The revision shown is the register's now, not when this was written"
                          >
                            <Code>{a.document_number}</Code>
                            <span className="text-graphite">rev {a.revision_now ?? '—'}</span>
                          </a>
                        ) : (
                          <span className="border-rule bg-surface-2 rounded border px-2 py-1 text-xs">
                            {a.name ?? 'Attachment'}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-1 flex flex-wrap gap-2">
                  {canRaiseTask && (
                    <button
                      type="button"
                      onClick={() => void raiseFrom(c)}
                      className="text-graphite text-xs underline"
                    >
                      Raise a task from this
                    </button>
                  )}
                  {mine && editing !== c.id && (
                    <>
                      <button
                        type="button"
                        onClick={() => setEditing(c.id)}
                        className="text-graphite text-xs underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          deleteComment(c.id).then(load).catch((e: Error) => setError(e.message))
                        }}
                        className="text-graphite text-xs underline"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <form
        className="border-rule flex flex-col gap-2 rounded-lg border p-3"
        onSubmit={(e) => { e.preventDefault(); void post() }}
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="Add to the discussion…"
          className="border-rule w-full rounded border px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-56 flex-1">
            <span className="text-graphite mb-1 block text-xs">Reference a drawing</span>
            <select
              value={attachTo}
              onChange={(e) => setAttachTo(e.target.value)}
              className="border-rule w-full rounded border px-2 py-1.5 text-sm"
            >
              {/* The option value is the id, never the number: a select feeding
                  a foreign key that posts a display string silently never
                  resolves. */}
              <option value="">— none —</option>
              {drawings.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.document_number} · {d.title ?? 'untitled'}
                </option>
              ))}
            </select>
          </label>
          {canRaiseTask && (
            <Button
              size="sm"
              variant="outline"
              type="button"
              disabled={busy || !body.trim()}
              onClick={() => setRaising('comment')}
              title="Post this and raise it as a task at the same time"
            >
              Raise as a task
            </Button>
          )}
          {canRaiseTask && (
            <Button
              size="sm"
              variant="outline"
              type="button"
              disabled={busy || !body.trim()}
              onClick={() => setRaising('rfi')}
            >
              Raise as an RFI
            </Button>
          )}
          <Button size="sm" type="submit" disabled={busy || !body.trim()}>
            {busy ? 'Posting…' : 'Post'}
          </Button>
        </div>
        <p className="text-graphite text-xs">
          Raising asks for a title, who carries it and a date anchored to the programme, and
          posts the remark and the task together. The task remembers it came from here, so the
          task list can be filtered by it.
        </p>
      </form>

      {/* The same form the issues tab uses. A second, thinner one for "raise
          from a discussion" would drift from it within a phase. */}
      {raising && (
        <RaiseIssue
          projectId={projectId}
          kind={raising}
          origin={{ entityType, entityId, body: body.trim() }}
          initialDescription={body.trim()}
          onClose={() => setRaising(null)}
          onRaised={() => {
            setRaising(null)
            setBody('')
            setAttachTo('')
            load()
          }}
        />
      )}
    </div>
  )
}
