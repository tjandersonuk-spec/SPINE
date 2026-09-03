import { useCallback, useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router'

import { BepFieldValues } from '@/components/register/BepFieldValues'
import { Button } from '@/components/ui/button'
import { RequireModule } from '@/components/shell/RequireModule'
import { Panel, PageHead } from '@/components/ui/panel'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import {
  addRevisionRule, fetchBepFields, fetchRevisionRules, fetchSuitabilityCodes,
  hasBep, removeRevisionRule, seedBep, setSuitabilityInUse, updateBepField,
  type BepField,
} from '@/lib/queries'
import type { ProjectContext } from '@/pages/project/ProjectLayout'

const SOURCE_NOTE: Record<BepField['source'], string> = {
  project: 'A fixed code for this project',
  directory: 'The project’s companies, read live — there are no stored values',
  standard: 'A list you maintain here',
  free: 'Anything of the right length',
}

export default function BepPage() {
  const { id = '' } = useParams()
  const ctx = useOutletContext<ProjectContext>()
  const [exists, setExists] = useState<boolean | null>(null)
  const [fields, setFields] = useState<BepField[]>([])
  const [rules, setRules] = useState<{ prefix: string; construction_status: string }[]>([])
  const [codes, setCodes] = useState<
    { code: string; description: string | null; in_use: boolean }[]>([])
  const [editingValues, setEditingValues] = useState<BepField | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newPrefix, setNewPrefix] = useState('')
  const [newStatus, setNewStatus] = useState('')

  const load = useCallback(() => {
    hasBep(id)
      .then(async (b) => {
        setExists(b)
        if (!b) return
        const [f, r, c] = await Promise.all([
          fetchBepFields(id), fetchRevisionRules(id), fetchSuitabilityCodes(id),
        ])
        setFields(f); setRules(r); setCodes(c); setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [id])

  useEffect(load, [load])

  const guard = (p: Promise<unknown>) =>
    p.then(load).catch((e: Error) => setError(e.message))

  if (exists === null) return <div className="text-graphite p-6 text-sm">Loading…</div>

  return (
    <RequireModule module="bep">
      <PageHead
        eyebrow="Set up"
        title="BIM execution plan"
        meta="The naming convention, and what a revision code means. The register checks against it."
      />

      {error && (
        <Panel kind="comply" className="mb-4">
          <p className="text-stop text-sm">{error}</p>
        </Panel>
      )}

      {!exists ? (
        <Panel title="No BEP on this project">
          <p className="text-graphite mb-3 max-w-prose text-sm">
            Adopting the ISO 19650 UK Annex structure gives you a seven-field naming convention,
            the standard type codes, and the P / C / CR revision rule. Everything is editable
            afterwards — this is a starting point, not a straitjacket.
          </p>
          {ctx.canEdit ? (
            <Button size="sm" onClick={() => guard(seedBep(id))}>
              Set up the naming convention
            </Button>
          ) : (
            <p className="text-graphite text-xs">
              Someone on the contractor’s team needs to set this up.
            </p>
          )}
        </Panel>
      ) : (
        <>
          <Panel title="Naming convention">
            <p className="text-graphite mb-3 max-w-prose text-sm">
              Fields in order, separated by a hyphen. A drawing number is checked against this
              and the register says which field is wrong rather than showing an unexplained
              cross.
            </p>
            <TableScroll>
              <Table>
                <THead>
                  <TR>
                    <TH className="w-[40px]">#</TH>
                    <TH className="w-[130px]">Field</TH>
                    <TH className="w-[100px]">Length</TH>
                    <TH className="w-[80px]">Required</TH>
                    <TH>Permitted values</TH>
                    <TH className="w-[90px]" />
                  </TR>
                </THead>
                <TBody>
                  {fields.map((f) => (
                    <TR key={f.id}>
                      <TD><Code className="text-xs">{f.position}</Code></TD>
                      <TD>{f.name}</TD>
                      <TD>
                        <Code className="text-xs">
                          {f.min_len === f.max_len ? f.min_len : `${f.min_len}–${f.max_len}`}
                        </Code>
                      </TD>
                      <TD>
                        {f.required
                          ? <Pill tone="ok">Yes</Pill>
                          : <span className="text-graphite text-xs">optional</span>}
                      </TD>
                      <TD className="text-graphite text-xs">{SOURCE_NOTE[f.source]}</TD>
                      <TD>
                        {ctx.canEdit && f.source !== 'directory' && f.source !== 'free' && (
                          <Button size="sm" variant="ghost" onClick={() => setEditingValues(f)}>
                            Codes
                          </Button>
                        )}
                        {f.source === 'directory' && (
                          <Button size="sm" variant="ghost" onClick={() => setEditingValues(f)}>
                            View
                          </Button>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableScroll>
            {ctx.canEdit && (
              <p className="text-graphite mt-3 max-w-prose text-xs">
                Field lengths are editable inline below. The Originator field has no editor
                because it has no stored values — its permitted codes are the project’s companies,
                read live. Two lists of the same thing diverge, and a BEP that disagrees with the
                directory cannot be enforced.
              </p>
            )}
          </Panel>

          {ctx.canEdit && (
            <Panel title="Field lengths">
              <div className="grid gap-2 sm:grid-cols-2">
                {fields.map((f) => (
                  <div key={f.id} className="flex items-center gap-2 text-sm">
                    <span className="w-[110px] shrink-0">{f.name}</span>
                    <input
                      type="number"
                      min={1}
                      defaultValue={f.min_len}
                      onBlur={(e) => {
                        const v = parseInt(e.target.value, 10)
                        if (v && v !== f.min_len) guard(updateBepField(f.id, { min_len: v }))
                      }}
                      className="border-rule w-[64px] rounded border px-2 py-1 font-mono text-sm"
                      aria-label={`${f.name} minimum length`}
                    />
                    <span className="text-graphite">to</span>
                    <input
                      type="number"
                      min={1}
                      defaultValue={f.max_len}
                      onBlur={(e) => {
                        const v = parseInt(e.target.value, 10)
                        if (v && v !== f.max_len) guard(updateBepField(f.id, { max_len: v }))
                      }}
                      className="border-rule w-[64px] rounded border px-2 py-1 font-mono text-sm"
                      aria-label={`${f.name} maximum length`}
                    />
                  </div>
                ))}
              </div>
            </Panel>
          )}

          <Panel title="What a revision means">
            <p className="text-graphite mb-3 max-w-prose text-sm">
              A revision prefix maps to a construction status. The longest matching prefix wins,
              so <Code>CR</Code> beats <Code>C</Code> without the rules needing to be in any
              particular order.
            </p>
            <TableScroll>
              <Table>
                <THead>
                  <TR>
                    <TH className="w-[90px]">Prefix</TH>
                    <TH>Means</TH>
                    <TH className="w-[80px]" />
                  </TR>
                </THead>
                <TBody>
                  {rules.map((r) => (
                    <TR key={r.prefix}>
                      <TD><Code>{r.prefix}</Code></TD>
                      <TD>{r.construction_status}</TD>
                      <TD>
                        {ctx.canEdit && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => guard(removeRevisionRule(id, r.prefix))}
                          >
                            Remove
                          </Button>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableScroll>
            {ctx.canEdit && (
              <form
                className="mt-3 flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!newPrefix.trim() || !newStatus.trim()) return
                  guard(addRevisionRule(id, newPrefix.trim().toUpperCase(), newStatus.trim()))
                    .then(() => { setNewPrefix(''); setNewStatus('') })
                }}
              >
                <label>
                  <span className="mb-1 block text-xs font-medium">Prefix</span>
                  <input
                    value={newPrefix}
                    onChange={(e) => setNewPrefix(e.target.value)}
                    placeholder="T"
                    className="border-rule w-[80px] rounded border px-2 py-1.5 font-mono text-sm"
                  />
                </label>
                <label className="flex-1">
                  <span className="mb-1 block text-xs font-medium">Means</span>
                  <input
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value)}
                    placeholder="Tender issue"
                    className="border-rule w-full rounded border px-2 py-1.5 text-sm"
                  />
                </label>
                <Button
                  size="sm"
                  type="submit"
                  disabled={!newPrefix.trim() || !newStatus.trim()}
                >
                  Add rule
                </Button>
              </form>
            )}
          </Panel>

          <Panel title="Suitability codes">
            <TableScroll>
              <Table>
                <THead>
                  <TR>
                    <TH className="w-[70px]">Code</TH>
                    <TH>Means</TH>
                    <TH className="w-[90px]">In use</TH>
                  </TR>
                </THead>
                <TBody>
                  {codes.map((c) => (
                    <TR key={c.code} muted={!c.in_use}>
                      <TD><Code>{c.code}</Code></TD>
                      <TD>{c.description}</TD>
                      <TD>
                        <input
                          type="checkbox"
                          checked={c.in_use}
                          disabled={!ctx.canEdit}
                          onChange={(e) =>
                            guard(setSuitabilityInUse(id, c.code, e.target.checked))}
                          aria-label={`${c.code} in use`}
                        />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableScroll>
          </Panel>
        </>
      )}

      {editingValues && (
        <BepFieldValues
          field={editingValues}
          canEdit={ctx.canEdit}
          onClose={() => { setEditingValues(null); load() }}
        />
      )}
    </RequireModule>
  )
}
