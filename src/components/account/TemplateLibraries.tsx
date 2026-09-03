import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Empty, ErrorNote } from '@/components/ui/notes'
import { fieldClass } from '@/components/ui/input'
import { Eyebrow, Panel } from '@/components/ui/panel'
import { Select } from '@/components/ui/select-native'
import { Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  addTemplateRow, CHECKLIST_TYPES, deleteTemplateRow, fetchAccountChecklistTemplates,
  fetchAccountRiskTemplates, fetchAccountScopeTemplates, fetchAccountWarrantyTemplates,
  fetchScopeTemplateItems, forkTemplateLibrary, updateTemplateRow, type TemplateKind,
} from '@/lib/queries'

/**
 * The account's own templates.
 *
 * Every library ships as a published default and an account works from that
 * default until it takes a copy. From then on it edits the copy, and the
 * published set carries on unchanged underneath — which is what makes editing
 * safe: nothing an account does here can reach another account, and nothing the
 * platform later adds to the published set overwrites an edit already made.
 *
 * A fork is not automatic. Reading the published set is the right answer for an
 * account that agrees with it, and forking on first read would give every
 * account a frozen copy of whatever shipped the day they signed up. The button
 * is the moment somebody decides to disagree.
 *
 * Editing a template never rewrites a project that already loaded a copy of it:
 * the project holds its own rows, and the template name is stored as it was.
 */
type FieldKind = 'text' | 'long' | 'number' | 'select'
type Field = {
  key: string
  label: string
  kind?: FieldKind
  width?: string
  mono?: boolean
  options?: readonly string[]
  /** Blank is fine for a nullable column; a required one refuses to save empty. */
  required?: boolean
}

const RIBA = ['0', '1', '2', '3', '4', '5', '6', '7'] as const

export function TemplateLibraries({
  organisationId, canEdit,
}: { organisationId: string; canEdit: boolean }) {
  return (
    <Tabs defaultValue="checklists">
      <TabsList>
        <TabsTrigger value="checklists">Checklists</TabsTrigger>
        <TabsTrigger value="scope">Scope of service</TabsTrigger>
        <TabsTrigger value="risk">Risk and opportunity</TabsTrigger>
        <TabsTrigger value="warranty">Warranties</TabsTrigger>
      </TabsList>

      <TabsContent value="checklists" className="pt-4">
        <ChecklistLibrary organisationId={organisationId} canEdit={canEdit} />
      </TabsContent>
      <TabsContent value="scope" className="pt-4">
        <ScopeLibrary organisationId={organisationId} canEdit={canEdit} />
      </TabsContent>
      <TabsContent value="risk" className="pt-4">
        <Library
          organisationId={organisationId}
          canEdit={canEdit}
          which="risk"
          kind="risk"
          title="Risk and opportunity library"
          note="Loaded into a project by the risk register. A project skips anything whose
                title it already carries, so editing a title here changes what counts as a
                duplicate later."
          fetch={fetchAccountRiskTemplates}
          fields={[
            { key: 'reference', label: 'Ref', width: 'w-[90px]', mono: true, required: true },
            { key: 'kind', label: 'Kind', width: 'w-[130px]', kind: 'select',
              options: ['risk', 'opportunity'], required: true },
            { key: 'title', label: 'Title', required: true },
            { key: 'category', label: 'Category', width: 'w-[150px]' },
            { key: 'likelihood', label: 'Likelihood', width: 'w-[110px]', kind: 'select',
              options: ['1', '2', '3', '4', '5'], required: true },
            { key: 'description', label: 'Description', kind: 'long' },
          ]}
          blank={{ reference: '', kind: 'risk', title: '', likelihood: 3, sort_order: 999 }}
        />
      </TabsContent>
      <TabsContent value="warranty" className="pt-4">
        <Library
          organisationId={organisationId}
          canEdit={canEdit}
          which="warranty"
          kind="warranty"
          title="Warranty library"
          note="Each row names the responsibility-matrix duty it answers to. That is how a
                warranty finds its owner: through the lead discipline on that duty, live. A
                warranty never names a company, here or on a project."
          fetch={fetchAccountWarrantyTemplates}
          fields={[
            { key: 'reference', label: 'Ref', width: 'w-[90px]', mono: true, required: true },
            { key: 'drm_ref', label: 'Duty', width: 'w-[90px]', mono: true, required: true },
            { key: 'title', label: 'Title', required: true },
            { key: 'period_years', label: 'Years', width: 'w-[80px]', kind: 'number' },
            { key: 'beneficiary', label: 'Beneficiary', width: 'w-[180px]' },
            { key: 'form', label: 'Form', width: 'w-[180px]' },
            { key: 'description', label: 'Description', kind: 'long' },
          ]}
          blank={{ reference: '', drm_ref: '', title: '', sort_order: 999 }}
        />
      </TabsContent>
    </Tabs>
  )
}

/* ------------------------------------------------------------ checklists */
function ChecklistLibrary({
  organisationId, canEdit,
}: { organisationId: string; canEdit: boolean }) {
  const [type, setType] = useState<string>('precon')
  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <Eyebrow>Checklist</Eyebrow>
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          {CHECKLIST_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      </div>
      <Library
        key={type}
        organisationId={organisationId}
        canEdit={canEdit}
        which="checklist"
        kind="checklist"
        title={`${type} checklist`}
        note="Loaded into a project by its checklist page. Loading twice adds what is new and
              leaves every answer already written exactly as it was, so a template can grow
              after a project has started."
        fetch={(org) => fetchAccountChecklistTemplates(org, type)}
        fields={[
          { key: 'reference', label: 'Ref', width: 'w-[90px]', mono: true, required: true },
          { key: 'heading', label: 'Heading', width: 'w-[150px]', required: true },
          { key: 'title', label: 'Title', required: true },
          { key: 'discipline', label: 'Disc', width: 'w-[80px]', mono: true },
          { key: 'prompt', label: 'Prompt', kind: 'long' },
        ]}
        blank={{ type, reference: '', heading: '', title: '', sort_order: 999 }}
      />
    </>
  )
}

/* ------------------------------------------------------------ scope */
function ScopeLibrary({
  organisationId, canEdit,
}: { organisationId: string; canEdit: boolean }) {
  const [open, setOpen] = useState<string | null>(null)
  const [name, setName] = useState<string>('')

  return (
    <>
      <Library
        organisationId={organisationId}
        canEdit={canEdit}
        which="scope"
        kind="scope"
        title="Scope of service templates"
        note="A named template, never one flat list. This shipped broken once: a
              discipline-tagged row added to a single shared template gave a mechanical
              engineer architectural production-information duties. A template with a
              discipline is only offered to a firm that holds it; a core template is offered
              to everybody."
        fetch={fetchAccountScopeTemplates}
        fields={[
          { key: 'name', label: 'Template', required: true },
          { key: 'discipline', label: 'Discipline', width: 'w-[110px]', mono: true },
          { key: 'is_core', label: 'Core', width: 'w-[90px]', kind: 'select',
            options: ['true', 'false'] },
        ]}
        blank={{ name: '', is_core: false }}
        onSelect={(row) => { setOpen(row.id as string); setName(row.name as string) }}
        selectedId={open}
      />

      {open && (
        <ScopeItems templateId={open} name={name} canEdit={canEdit} />
      )}
    </>
  )
}

function ScopeItems({
  templateId, name, canEdit,
}: { templateId: string; name: string; canEdit: boolean }) {
  return (
    <Library
      key={templateId}
      organisationId=""
      canEdit={canEdit}
      which={null}
      kind="scopeItem"
      title={`Duties in “${name}”`}
      note="Each duty as it will read on an appointment. The stage is the RIBA stage the duty
            belongs to."
      fetch={() => fetchScopeTemplateItems(templateId)}
      fields={[
        { key: 'reference', label: 'Ref', width: 'w-[90px]', mono: true, required: true },
        { key: 'heading', label: 'Heading', width: 'w-[150px]', required: true },
        { key: 'riba_stage', label: 'Stage', width: 'w-[90px]', kind: 'select',
          options: RIBA, required: true },
        { key: 'description', label: 'Duty', kind: 'long', required: true },
      ]}
      blank={{ template_id: templateId, reference: '', heading: '', description: '',
               riba_stage: '3' }}
    />
  )
}

/* ------------------------------------------------------------ the editor */
type Row = Record<string, unknown> & { id: string; organisation_id?: string | null }

function Library({
  organisationId, canEdit, which, kind, title, note, fetch, fields, blank,
  onSelect, selectedId,
}: {
  organisationId: string
  canEdit: boolean
  /** null for a child table, which is forked with its parent. */
  which: 'checklist' | 'scope' | 'risk' | 'warranty' | null
  kind: TemplateKind
  title: string
  note: string
  fetch: (org: string) => Promise<unknown[]>
  fields: Field[]
  blank: Record<string, unknown>
  onSelect?: (row: Row) => void
  selectedId?: string | null
}) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState<Record<string, unknown> | null>(null)

  const load = useCallback(() => {
    fetch(organisationId)
      .then((r) => { setRows(r as Row[]); setError(null) })
      .catch((e: Error) => setError(e.message))
  }, [fetch, organisationId])

  useEffect(load, [load])

  // Forked when the rows carry this account's id. A child table has no
  // organisation of its own — it is forked with the template above it.
  const forked = which === null
    ? true
    : (rows ?? []).some((r) => r.organisation_id === organisationId)
  const editable = canEdit && forked

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null)
    try { await fn(); load() } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  const save = (row: Row, field: Field, raw: string) => {
    const before = row[field.key]
    const value =
      field.kind === 'number' ? (raw === '' ? null : Number(raw))
      : field.key === 'is_core' ? raw === 'true'
      : field.key === 'likelihood' ? Number(raw)
      : raw === '' ? (field.required ? before : null)
      : raw
    if (value === before) return           // a write that changes nothing
    if (field.required && (value === '' || value === null)) return
    void act(() => updateTemplateRow(kind, row.id, { [field.key]: value }))
  }

  if (error && !rows) return <ErrorNote message={error} />
  if (!rows) return <p className="text-graphite p-4 text-sm">Loading…</p>

  return (
    <Panel
      title={title}
      actions={
        which !== null && !forked && canEdit ? (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void act(async () => {
              await forkTemplateLibrary(organisationId, which)
            })}
          >
            Take a copy to edit
          </Button>
        ) : which !== null && forked && canEdit ? (
          <div className="flex items-center gap-2">
            <Pill tone="ok">Your copy</Pill>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              title="Bring in anything added to the published library since you took your copy. Your edits are untouched."
              onClick={() => void act(async () => {
                const n = await forkTemplateLibrary(organisationId, which)
                if (n === 0) setError('Nothing new in the published library.')
              })}
            >
              Pull in new rows
            </Button>
          </div>
        ) : null
      }
    >
      <p className="text-graphite mb-3 max-w-prose text-xs">{note}</p>

      {which !== null && !forked && (
        <p className="text-graphite border-rule-strong mb-3 rounded-md border border-dashed px-3 py-2 text-xs">
          You are using the published library. Take a copy to change it — the published one
          carries on underneath, and nothing you do to your copy reaches another account.
        </p>
      )}

      <ErrorNote message={error} />

      {rows.length === 0 ? (
        <Empty>Nothing in this library yet.</Empty>
      ) : (
        <TableScroll>
          <Table>
            <THead>
              <TR>
                {fields.map((f) => (
                  <TH key={f.key} className={f.width}>{f.label}</TH>
                ))}
                {editable && <TH className="w-[60px]" aria-label="Remove" />}
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => (
                <TR
                  key={row.id}
                  className={
                    onSelect ? 'cursor-pointer' : undefined
                  }
                  onClick={onSelect ? () => onSelect(row) : undefined}
                  muted={Boolean(selectedId) && selectedId !== row.id}
                >
                  {fields.map((f) => (
                    <TD key={f.key}>
                      {editable ? (
                        <Cell field={f} row={row} onSave={save} />
                      ) : (
                        <span className={f.mono ? 'font-mono text-xs' : ''}>
                          {String(row[f.key] ?? '—')}
                        </span>
                      )}
                    </TD>
                  ))}
                  {editable && (
                    <TD>
                      <button
                        type="button"
                        className="text-stop-ink text-xs underline-offset-2 hover:underline"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation()
                          void act(() => deleteTemplateRow(kind, row.id))
                        }}
                      >
                        Remove
                      </button>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        </TableScroll>
      )}

      {editable && (
        <div className="mt-3">
          {adding ? (
            <div className="border-rule-highlight glass-hi rounded-lg border p-3">
              <Eyebrow className="mb-2">New row</Eyebrow>
              <div className="flex flex-wrap gap-2">
                {fields.map((f) => (
                  <label key={f.key} className="flex flex-col gap-1">
                    <span className="text-graphite text-xs">{f.label}</span>
                    <NewField
                      field={f}
                      value={adding[f.key]}
                      onChange={(v) => setAdding({ ...adding, [f.key]: v })}
                    />
                  </label>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  disabled={busy || fields.some((f) => f.required && !adding[f.key])}
                  onClick={() => void act(async () => {
                    await addTemplateRow(kind, adding)
                    setAdding(null)
                  })}
                >
                  Add
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAdding(null)}>
                  Cancel
                </Button>
              </div>
              <p className="text-graphite mt-2 text-xs">
                Every field marked on the table is required; the button stays disabled rather
                than creating a blank row.
              </p>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setAdding({ ...blank })}>
              Add a row
            </Button>
          )}
        </div>
      )}
    </Panel>
  )
}

/** An editable cell. Saves on blur, because a save button per cell is a form
 *  nobody finishes and a save on every keystroke is a write per character. */
function Cell({
  field, row, onSave,
}: { field: Field; row: Row; onSave: (r: Row, f: Field, v: string) => void }) {
  const value = row[field.key]
  const shown = value === null || value === undefined ? '' : String(value)

  if (field.kind === 'select') {
    return (
      <Select
        defaultValue={shown}
        className="h-7 py-0 text-xs"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onSave(row, field, e.target.value)}
      >
        {!field.required && <option value="">—</option>}
        {field.options?.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </Select>
    )
  }
  return (
    <input
      defaultValue={shown}
      type={field.kind === 'number' ? 'number' : 'text'}
      className={
        'w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm '
        + 'hover:border-rule focus:border-primary/60 focus:bg-white/[0.04] focus:outline-none '
        + (field.mono ? 'font-mono text-xs ' : '')
      }
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => onSave(row, field, e.target.value)}
    />
  )
}

function NewField({
  field, value, onChange,
}: { field: Field; value: unknown; onChange: (v: unknown) => void }) {
  const shown = value === null || value === undefined ? '' : String(value)
  if (field.kind === 'select') {
    return (
      <Select
        value={shown}
        className="h-8 text-xs"
        onChange={(e) => onChange(
          field.key === 'is_core' ? e.target.value === 'true'
          : field.key === 'likelihood' ? Number(e.target.value)
          : e.target.value)}
      >
        {!field.required && <option value="">—</option>}
        {field.options?.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </Select>
    )
  }
  return (
    <input
      value={shown}
      type={field.kind === 'number' ? 'number' : 'text'}
      className={fieldClass + ' h-8 ' + (field.width ?? 'w-[200px]') + (field.mono ? ' font-mono' : '')}
      onChange={(e) => onChange(
        field.kind === 'number'
          ? (e.target.value === '' ? null : Number(e.target.value))
          : e.target.value)}
    />
  )
}
