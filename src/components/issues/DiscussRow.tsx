import { useState } from 'react'

import { CommentThread } from '@/components/issues/CommentThread'
import { TD, TR } from '@/components/ui/table'

/**
 * Discussion on a table row, without giving the row a detail page.
 *
 * Most registers in this product are one table and no detail view, so a thread
 * has nowhere to live unless the row can open one. This is that: a toggle in
 * the last cell and a full-width row underneath it.
 *
 * One at a time is deliberate. A register with twenty open threads is a page
 * nobody reads, and the point of putting the conversation on the item is that
 * it is next to the item rather than in a pile.
 */
export function useDiscussion() {
  const [talking, setTalking] = useState<string | null>(null)
  return {
    isOpen: (id: string) => talking === id,
    toggle: (id: string) => setTalking((t) => (t === id ? null : id)),
    open: (id: string) => setTalking(id),
  }
}

export function DiscussButton({
  open, onToggle,
}: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="text-graphite mt-1 block text-xs underline"
    >
      {open ? 'Hide' : 'Discuss'}
    </button>
  )
}

export function DiscussRow({
  projectId, entityType, entityId, colSpan,
}: {
  projectId: string
  /** Also the task's category when a remark here is raised as one, so it must
   *  be the register's own name — `planning`, `warranty`, `transmittal`. */
  entityType: string
  entityId: string
  colSpan: number
}) {
  return (
    <TR>
      <TD colSpan={colSpan} className="bg-surface-2/40">
        <div className="px-1 py-2">
          <CommentThread projectId={projectId} entityType={entityType} entityId={entityId} />
        </div>
      </TD>
    </TR>
  )
}
