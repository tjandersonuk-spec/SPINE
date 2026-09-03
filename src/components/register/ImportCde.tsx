import Papa from 'papaparse'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import {
  acceptIntoRegister, fetchReconcile, importDocuments, type ReconcileRow,
} from '@/lib/queries'

/**
 * Import a CDE export, then reconcile it.
 *
 * These are deliberately two steps and two transactions. Importing writes the
 * raw rows and changes the register not at all; the register changes only when
 * someone accepts a row. Auto-applying the diff would be quicker and would
 * produce a register nobody trusts, which is worth less than no register.
 */

const FIELDS = [
  { key: 'document_number', label: 'Document number', required: true,
    hints: ['document number', 'document no', 'number', 'doc ref', 'reference', 'name', 'filename'] },
  { key: 'title', label: 'Title', required: false,
    hints: ['title', 'description', 'document title'] },
  { key: 'revision', label: 'Revision', required: true,
    hints: ['revision', 'rev', 'version'] },
  { key: 'workflow_status', label: 'Workflow status', required: false,
    hints: ['status', 'workflow status', 'state', 'suitability'] },
  { key: 'file_format', label: 'File format', required: true,
    hints: ['format', 'file format', 'file type', 'extension', 'type'] },
] as const

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')

function guessMapping(headers: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  const taken = new Set<string>()
  for (const f of FIELDS) {
    const hit = headers.find((h) => !taken.has(h) && f.hints.some((x) => norm(h) === norm(x)))
      ?? headers.find((h) => !taken.has(h) && f.hints.some((x) => norm(h).includes(norm(x))))
    if (hit) { out[f.key] = hit; taken.add(hit) }
  }
  return out
}

const TONE: Record<ReconcileRow['change'], 'ok' | 'warn' | 'neutral'> = {
  new: 'ok', 'first issue': 'ok', revised: 'warn', retitled: 'warn', unchanged: 'neutral',
}

export function ImportCde({
  projectId, onClose, onDone,
}: { projectId: string; onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<'file' | 'reconcile' | 'done'>('file')
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [label, setLabel] = useState('')
  const [diff, setDiff] = useState<ReconcileRow[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ added: number; updated: number } | null>(null)

  const missing = FIELDS.filter((f) => f.required && !mapping[f.key])

  const mapped = useMemo(() => rows.map((r) => {
    const out: Record<string, unknown> = {}
    for (const f of FIELDS) if (mapping[f.key]) out[f.key] = (r[mapping[f.key]] ?? '').trim()
    return out
  }), [rows, mapping])

  const onFile = (file: File) => {
    setError(null)
    if (!label) setLabel(file.name.replace(/\.csv$/i, ''))
    Papa.parse<Record<string, string>>(file, {
      header: true, skipEmptyLines: true,
      complete: (res) => {
        const hs = (res.meta.fields ?? []).filter(Boolean)
        if (!hs.length) { setError('That file has no header row.'); return }
        setHeaders(hs); setRows(res.data); setMapping(guessMapping(hs))
      },
      error: (e) => setError(e.message),
    })
  }

  const doImport = async () => {
    setBusy(true); setError(null)
    try {
      const out = await importDocuments(projectId, label || 'CDE export', mapped)
      if (!out.ok) {
        setError(`${out.errors?.length} rows could not be read. First: ` +
          `row ${out.errors?.[0].row}, ${out.errors?.[0].message}`)
        return
      }
      const d = await fetchReconcile(projectId)
      setDiff(d)
      // Everything that actually changed is pre-selected; nothing is applied
      // until the user presses accept.
      setPicked(new Set(d.filter((r) => r.change !== 'unchanged').map((r) => r.document_number)))
      setStep('reconcile')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const doAccept = async () => {
    setBusy(true); setError(null)
    try {
      setResult(await acceptIntoRegister(projectId, [...picked]))
      setStep('done')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const changed = diff.filter((r) => r.change !== 'unchanged')

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6">
      <div
        className="bg-card border-rule w-full max-w-[900px] rounded-lg border shadow-2xl"
        role="dialog"
        aria-label="Import a CDE export"
      >
        <header className="border-rule flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-base font-semibold">
            {step === 'file' ? 'Import a CDE export'
              : step === 'reconcile' ? 'What this export would change'
              : 'Register updated'}
          </h2>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">✕</Button>
        </header>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {error && (
            <p className="border-stop bg-stop-bg text-stop mb-3 rounded border-l-[3px] px-3 py-2 text-sm">
              {error}
            </p>
          )}

          {step === 'file' && (
            <>
              <label className="mb-4 block">
                <span className="mb-1 block text-sm font-medium">CDE export (CSV)</span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }}
                  className="border-rule w-full rounded border px-3 py-2 text-sm"
                />
                <span className="text-graphite mt-1 block text-xs">
                  Asite, Aconex and Viewpoint all name their columns differently — map them below.
                </span>
              </label>

              {headers.length > 0 && (
                <>
                  <label className="mb-4 block">
                    <span className="mb-1 block text-sm font-medium">What to call this export</span>
                    <input
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="CDE export — 14 August"
                      className="border-rule w-full rounded border px-3 py-2 text-sm"
                    />
                  </label>

                  <h3 className="mb-2 text-sm font-semibold">Match the columns</h3>
                  <div className="mb-3 grid gap-2 sm:grid-cols-2">
                    {FIELDS.map((f) => (
                      <label key={f.key} className="flex items-center gap-2 text-sm">
                        <span className="w-[140px] shrink-0">
                          {f.label}{f.required && <span className="text-stop ml-0.5">*</span>}
                        </span>
                        <select
                          value={mapping[f.key] ?? ''}
                          onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                          className="border-rule flex-1 rounded border px-2 py-1.5 text-sm"
                        >
                          <option value="">
                            {f.required ? '— choose a column —' : '— not in this file —'}
                          </option>
                          {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                  <p className="text-graphite max-w-prose text-xs">
                    File format matters: only PDFs become register rows. A DWG of the same
                    document number sets a flag on that row rather than making a second one.
                  </p>
                </>
              )}
            </>
          )}

          {step === 'reconcile' && (
            <>
              <p className="text-graphite mb-3 max-w-prose text-sm">
                The export has been recorded. <strong>Nothing has changed in the register yet.</strong>
                {' '}Pick what to accept — a register nobody accepted is a register nobody trusts.
              </p>
              {changed.length === 0 ? (
                <p className="border-ok bg-ok-bg text-ok rounded border-l-[3px] px-3 py-2 text-sm">
                  Nothing has moved since the last export. The register is already up to date.
                </p>
              ) : (
                <TableScroll>
                  <Table>
                    <THead>
                      <TR>
                        <TH className="w-[38px]">
                          <input
                            type="checkbox"
                            aria-label="Select all"
                            checked={picked.size === changed.length}
                            onChange={(e) => setPicked(e.target.checked
                              ? new Set(changed.map((r) => r.document_number))
                              : new Set())}
                          />
                        </TH>
                        <TH className="w-[210px]">Number</TH>
                        <TH>Title</TH>
                        <TH className="w-[110px]">Register</TH>
                        <TH className="w-[70px]">Export</TH>
                        <TH className="w-[104px]">Change</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {changed.map((r) => (
                        <TR key={r.document_number}>
                          <TD>
                            <input
                              type="checkbox"
                              aria-label={`Accept ${r.document_number}`}
                              checked={picked.has(r.document_number)}
                              onChange={(e) => setPicked((p) => {
                                const n = new Set(p)
                                if (e.target.checked) n.add(r.document_number)
                                else n.delete(r.document_number)
                                return n
                              })}
                            />
                          </TD>
                          <TD><Code className="text-xs">{r.document_number}</Code></TD>
                          <TD>{r.title ?? <span className="text-graphite">—</span>}</TD>
                          <TD>
                            <Code className="text-graphite text-xs">
                              {r.register_revision ?? 'not in register'}
                            </Code>
                          </TD>
                          <TD><Code className="text-xs">{r.revision}</Code></TD>
                          <TD><Pill tone={TONE[r.change]}>{r.change}</Pill></TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableScroll>
              )}
            </>
          )}

          {step === 'done' && result && (
            <p className="border-ok bg-ok-bg text-ok rounded border-l-[3px] px-3 py-2 text-sm">
              {result.added} added, {result.updated} updated.
            </p>
          )}
        </div>

        <footer className="border-rule flex items-center justify-end gap-2 border-t px-5 py-3">
          {step === 'file' && (
            <>
              <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button
                size="sm"
                disabled={busy || rows.length === 0 || missing.length > 0}
                onClick={() => void doImport()}
              >
                {busy ? 'Reading…' : `Read ${rows.length || ''} rows`}
              </Button>
            </>
          )}
          {step === 'reconcile' && (
            <>
              <Button size="sm" variant="ghost" onClick={onDone}>
                Leave the register as it is
              </Button>
              <Button
                size="sm"
                disabled={busy || picked.size === 0}
                onClick={() => void doAccept()}
              >
                {busy ? 'Applying…' : `Accept ${picked.size}`}
              </Button>
            </>
          )}
          {step === 'done' && <Button size="sm" onClick={onDone}>Done</Button>}
        </footer>
      </div>
    </div>
  )
}
