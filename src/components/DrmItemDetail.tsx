import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import {
  DRM_ROLE_NAMES, fetchDrmRolesForItem, setDrmFields, setDrmRole,
  type DrmItem, type DrmLead, type DrmRole,
} from '@/lib/queries'

/**
 * One matrix item in full: who leads it, who else is involved, and the three
 * things the register needs to know about it.
 *
 * Every role here names a *discipline*, never a company. Which firm that is
 * resolves live through the directory, so reassigning a discipline reassigns
 * everything anchored to it without a single record being rewritten.
 */
const ROLES: DrmRole['role_code'][] = ['S', 'R', 'C', 'A', 'I']

/** RIBA stages, as the prototype names them. */
const STAGES = ['', '2', '3', '4', '5', '6', '7']
const LOI = ['', 'LOD 200', 'LOD 300', 'LOD 350', 'LOD 400', 'LOD 500']

export function DrmItemDetail({
  item, disciplines, leads, canEdit, onClose, onChanged,
}: {
  item: DrmItem
  disciplines: { code: string; name: string }[]
  leads: DrmLead[]
  canEdit: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [roles, setRoles] = useState<DrmRole[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetchDrmRolesForItem(item.id)
      .then((r) => { if (live) setRoles(r) })
      .catch((e: Error) => { if (live) setError(e.message) })
    return () => { live = false }
  }, [item.id])

  const roleOf = (code: string) => roles.find((r) => r.discipline_code === code)?.role_code ?? ''

  const change = async (code: string, role: string) => {
    setError(null)
    const next = (role || null) as DrmRole['role_code'] | null
    setRoles((prev) => [
      ...prev.filter((r) => r.discipline_code !== code),
      ...(next ? [{ drm_item_id: item.id, discipline_code: code, role_code: next }] : []),
    ])
    try {
      await setDrmRole(item.id, code, next)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const save = (patch: Parameters<typeof setDrmFields>[1]) => {
    setDrmFields(item.id, patch).then(onChanged).catch((e: Error) => setError(e.message))
  }

  const lead = leads.find((l) => l.drm_item_id === item.id)
  const involved = roles.length

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/35" onClick={onClose} role="presentation">
      <aside
        className="bg-card border-rule flex h-full w-full max-w-[560px] flex-col border-l shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Matrix item ${item.ref}`}
      >
        <header className="border-rule flex items-start justify-between gap-3 border-b px-5 py-4">
          <div>
            <Code className="text-graphite text-xs">{item.ref}</Code>
            <h2 className="mt-0.5 text-base font-semibold">{item.item}</h2>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">✕</Button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && <p className="text-stop mb-3 text-sm">{error}</p>}

          {item.guidance_note && (
            <p className="border-rule bg-surface-2 mb-4 rounded border-l-[3px] px-3 py-2 text-sm">
              {item.guidance_note}
            </p>
          )}

          <h3 className="mb-2 text-sm font-semibold">Lead</h3>
          <p className="mb-4 text-sm">
            {item.lead_discipline ? (
              <>
                <Code className="font-semibold">{item.lead_discipline}</Code>
                {' — '}
                {lead?.company_name
                  ? lead.company_name
                  : <span className="text-hivis-ink bg-hivis-bg rounded px-1.5 py-0.5">
                      nobody holds this discipline
                    </span>}
              </>
            ) : (
              <span className="text-hivis-ink bg-hivis-bg rounded px-1.5 py-0.5">
                no discipline named
              </span>
            )}
          </p>

          <h3 className="mb-1 text-sm font-semibold">
            Everyone else involved{involved > 0 && ` (${involved})`}
          </h3>
          <p className="text-graphite mb-2 max-w-prose text-xs">
            Supporting, reviewing, contributing, approving or informed. A discipline holds one of
            these or none — it cannot both review and approve, which is the whole point of the
            distinction.
          </p>
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH className="w-[52px]">Code</TH>
                  <TH>Discipline</TH>
                  <TH className="w-[150px]">Role</TH>
                </TR>
              </THead>
              <TBody>
                {disciplines
                  .filter((d) => d.code !== item.lead_discipline)
                  .map((d) => (
                    <TR key={d.code} muted={!roleOf(d.code)}>
                      <TD><Code className="text-xs">{d.code}</Code></TD>
                      <TD>{d.name}</TD>
                      <TD>
                        {canEdit ? (
                          <select
                            value={roleOf(d.code)}
                            onChange={(e) => void change(d.code, e.target.value)}
                            className="border-rule w-full rounded border px-2 py-1 text-xs"
                            aria-label={`Role for ${d.name}`}
                          >
                            <option value="">—</option>
                            {ROLES.map((r) => (
                              <option key={r} value={r}>{r} · {DRM_ROLE_NAMES[r]}</option>
                            ))}
                          </select>
                        ) : roleOf(d.code) ? (
                          <Pill tone="neutral">
                            {DRM_ROLE_NAMES[roleOf(d.code) as DrmRole['role_code']]}
                          </Pill>
                        ) : (
                          <span className="text-graphite text-xs">—</span>
                        )}
                      </TD>
                    </TR>
                  ))}
              </TBody>
            </Table>
          </TableScroll>

          <h3 className="mt-5 mb-2 text-sm font-semibold">Design transfer</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="mb-1 block text-xs font-medium">Transfers at stage</span>
              <select
                defaultValue={item.transfers_at_stage ?? ''}
                disabled={!canEdit}
                onChange={(e) => save({ transfers_at_stage: e.target.value || null })}
                className="border-rule w-full rounded border px-2 py-1.5 text-sm"
              >
                {STAGES.map((s) => (
                  <option key={s} value={s}>{s ? `RIBA ${s}` : '—'}</option>
                ))}
              </select>
              <span className="text-graphite mt-1 block text-xs">
                When responsibility passes to the contractor’s side.
              </span>
            </label>

            <label>
              <span className="mb-1 block text-xs font-medium">Level of information</span>
              <select
                defaultValue={item.level_of_information ?? ''}
                disabled={!canEdit}
                onChange={(e) => save({ level_of_information: e.target.value || null })}
                className="border-rule w-full rounded border px-2 py-1.5 text-sm"
              >
                {LOI.map((s) => <option key={s} value={s}>{s || '—'}</option>)}
              </select>
            </label>
          </div>

          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-medium">Contractor design portion package</span>
            <input
              defaultValue={item.cdp_package ?? ''}
              disabled={!canEdit}
              onBlur={(e) => save({ cdp_package: e.target.value.trim() || null })}
              placeholder="Curtain walling"
              className="border-rule w-full rounded border px-3 py-2 text-sm"
            />
            <span className="text-graphite mt-1 block text-xs">
              Which CDP package carries this, if any. Named here so the warranty and the design
              responsibility agree about who owns it.
            </span>
          </label>

          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-medium">Notes</span>
            <textarea
              defaultValue={item.notes ?? ''}
              disabled={!canEdit}
              onBlur={(e) => save({ notes: e.target.value.trim() || null })}
              rows={3}
              className="border-rule w-full rounded border px-3 py-2 text-sm"
            />
          </label>
        </div>

        <footer className="border-rule border-t px-5 py-3">
          <Button size="sm" onClick={onClose}>Done</Button>
        </footer>
      </aside>
    </div>
  )
}
