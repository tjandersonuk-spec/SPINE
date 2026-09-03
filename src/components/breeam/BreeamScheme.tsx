import { useState } from 'react'

import { ImportBreeam } from '@/components/breeam/ImportBreeam'
import { downloadTemplate } from '@/components/breeam/templates'
import { Button } from '@/components/ui/button'
import { Panel } from '@/components/ui/panel'
import { Code, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import {
  createBreeamScheme, deleteBreeamScheme, setActiveBreeamScheme, updateBreeamScheme,
  type BreeamImportKind, type BreeamScheme as Scheme,
} from '@/lib/queries'

/**
 * Scheme setup.
 *
 * A scheme is a version of the standard, and a project holds several: UKNC
 * 2018 stays live for a project registered under the older regulations while
 * a newer one sits on a later version. Switching the live scheme switches the
 * whole framework. The framework itself — sections, weightings, ratings,
 * issues, credits, minimum standards — is loaded from the three templates by
 * whoever holds the licence; nothing here is typed in, and nothing ships.
 */
export function BreeamScheme({
  projectId, schemes, activeId, canEdit, onChanged,
}: {
  projectId: string
  schemes: Scheme[]
  activeId: string | null
  canEdit: boolean
  onChanged: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState('')
  const [name, setName] = useState('')
  const [importing, setImporting] = useState<BreeamImportKind | null>(null)

  const active = schemes.find((s) => s.id === activeId) ?? null

  const guard = (p: Promise<unknown>) =>
    p.then(onChanged).catch((e: Error) => setError(e.message))

  const create = (e: React.FormEvent) => {
    e.preventDefault()
    // Refuses empty input rather than creating a blank scheme.
    if (!version.trim()) return
    void guard(createBreeamScheme(projectId, version.trim(), name.trim())
      .then((id) => setActiveBreeamScheme(projectId, id))
      .then(() => { setVersion(''); setName('') }))
  }

  return (
    <>
      {error && (
        <Panel kind="comply" className="mb-4"><p className="text-stop text-sm">{error}</p></Panel>
      )}

      <Panel title="Schemes on this project">
        <p className="text-graphite mb-3 max-w-prose text-sm">
          One row per version of the standard. The live scheme is the one every figure on this
          page is computed against; switching it switches the whole framework.
        </p>
        {schemes.length > 0 && (
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH className="w-[64px]">Live</TH>
                  <TH className="w-[180px]">Version</TH>
                  <TH>Name</TH>
                  <TH className="w-[90px]">Sections</TH>
                  <TH className="w-[110px]">Types</TH>
                  <TH className="w-[80px]" />
                </TR>
              </THead>
              <TBody>
                {schemes.map((s) => (
                  <TR key={s.id}>
                    <TD>
                      <input
                        type="radio"
                        name="live-scheme"
                        checked={s.id === activeId}
                        disabled={!canEdit}
                        onChange={() => {
                          if (s.id !== activeId) void guard(setActiveBreeamScheme(projectId, s.id))
                        }}
                        aria-label={`Make ${s.version} the live scheme`}
                      />
                    </TD>
                    <TD><Code className="text-xs">{s.version}</Code></TD>
                    <TD>{s.name ?? <span className="text-graphite">—</span>}</TD>
                    <TD><Code className="text-xs">{s.sections.length}</Code></TD>
                    <TD className="text-xs">{s.building_types.join(', ') || '—'}</TD>
                    <TD>
                      {canEdit && (
                        <button
                          type="button"
                          className="text-graphite text-xs underline"
                          onClick={() => {
                            if (window.confirm(
                              `Delete ${s.version} and every issue and credit loaded under it?`))
                              void guard(deleteBreeamScheme(s.id))
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
        )}

        {canEdit && (
          <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={create}>
            <label className="w-[200px]">
              <span className="mb-1 block text-xs font-medium">Version</span>
              <input
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="UKNC 2018 v7.1"
                className="border-rule w-full rounded border px-2 py-1.5 font-mono text-sm"
              />
            </label>
            <label className="flex-1 min-w-[200px]">
              <span className="mb-1 block text-xs font-medium">Name (optional)</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="border-rule w-full rounded border px-2 py-1.5 text-sm"
              />
            </label>
            <Button size="sm" type="submit" disabled={!version.trim()}>Add a scheme</Button>
          </form>
        )}
      </Panel>

      {active && (
        <>
          <Panel
            title={`Framework — ${active.version}`}
            actions={canEdit && (
              <div className="flex gap-1">
                <Button size="sm" variant="secondary" onClick={() => setImporting('sections')}>
                  Import sections
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setImporting('credits')}>
                  Import credits
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setImporting('minstd')}>
                  Import minimum standards
                </Button>
              </div>
            )}
          >
            <p className="text-graphite mb-3 max-w-prose text-sm">
              The framework is loaded from the licence-holder's own tracker in three published
              templates — sections and weightings, issues and credits, minimum standards.
              Nothing in it ships with this product: BREEAM's technical manual is BRE copyright.
              Download a template:{' '}
              {(['sections', 'credits', 'minstd'] as BreeamImportKind[]).map((k, i) => (
                <span key={k}>
                  {i > 0 && ' · '}
                  <button type="button" className="underline" onClick={() => downloadTemplate(k)}>
                    {k === 'minstd' ? 'minimum standards' : k}
                  </button>
                </span>
              ))}
              .
            </p>

            {canEdit && (
              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                <Field label="Version" value={active.version} mono
                  onSave={(v) => v.trim() && guard(updateBreeamScheme(active.id, { version: v.trim() }))} />
                <Field label="Name" value={active.name ?? ''}
                  onSave={(v) => guard(updateBreeamScheme(active.id, { name: v.trim() || null }))} />
                <label className="block">
                  <span className="mb-1 block text-xs font-medium">Building type in force</span>
                  <select
                    value={active.building_type ?? ''}
                    onChange={(e) => void guard(updateBreeamScheme(active.id, {
                      building_type: e.target.value || null }))}
                    className="border-rule w-full rounded border px-2 py-1.5 text-sm"
                  >
                    <option value="">— none: nothing is weighted —</option>
                    {active.building_types.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
              </div>
            )}

            {active.sections.length === 0 ? (
              <p className="text-graphite text-sm">No sections yet. Import the sections template.</p>
            ) : (
              <TableScroll>
                <Table>
                  <THead>
                    <TR>
                      <TH className="w-[72px]">Code</TH>
                      <TH>Section</TH>
                      <TH className="w-[80px]">Stated</TH>
                      {active.building_types.map((t) => (
                        <TH key={t} className="w-[110px]">{t}</TH>
                      ))}
                    </TR>
                  </THead>
                  <TBody>
                    {active.sections.map((s) => (
                      <TR key={s.code}>
                        <TD><Code className="text-xs">{s.code}</Code></TD>
                        <TD>{s.name ?? <span className="text-graphite">—</span>}</TD>
                        <TD>
                          <Code className="text-graphite text-xs">
                            {s.stated === undefined || s.stated === null ? '—' : s.stated}
                          </Code>
                        </TD>
                        {active.building_types.map((t) => {
                          const w = active.weightings[t]?.[s.code]
                          return (
                            <TD key={t}>
                              <Code className={'text-xs' + (t === active.building_type ? '' : ' text-graphite')}>
                                {w === undefined ? '—' : `${(w * 100).toFixed(1)}%`}
                              </Code>
                            </TD>
                          )
                        })}
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableScroll>
            )}
          </Panel>

          <Panel title="Rating thresholds">
            {active.ratings.length === 0 ? (
              <p className="text-graphite text-sm">
                No thresholds yet. They are part of the scheme and come with the sections template's
                accompanying figures — add them by importing the scheme's published values.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {[...active.ratings].sort((a, b) => b.min - a.min).map((r) => (
                  <span key={r.name} className="border-rule rounded border px-2 py-1 text-sm">
                    {r.name} <Code className="text-graphite text-xs">≥ {(r.min * 100).toFixed(0)}%</Code>
                  </span>
                ))}
              </div>
            )}
          </Panel>
        </>
      )}

      {importing && active && (
        <ImportBreeam
          schemeId={active.id}
          kind={importing}
          onClose={() => setImporting(null)}
          onImported={() => { setImporting(null); onChanged() }}
        />
      )}
    </>
  )
}

/** A text field saved on blur, so a rename is one edit and not a form. */
function Field({
  label, value, mono, onSave,
}: {
  label: string; value: string; mono?: boolean
  onSave: (v: string) => unknown
}) {
  const [draft, setDraft] = useState(value)
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium">{label}</span>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft !== value) onSave(draft) }}
        className={'border-rule w-full rounded border px-2 py-1.5 text-sm' + (mono ? ' font-mono' : '')}
      />
    </label>
  )
}
