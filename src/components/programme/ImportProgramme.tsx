import Papa from 'papaparse'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Code, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { importProgramme, type ImportReport } from '@/lib/queries'

/**
 * Import a programme revision.
 *
 * Every planner's export has different headers — Asta, P6 and MSP disagree
 * about all six — so the file is never assumed to match. The mapping step is
 * the import: guess from the headers, let the user correct the guess, preview
 * what will happen, then send.
 *
 * Nothing here is validation in any meaningful sense. The browser only shapes
 * the rows; import_programme() validates and applies them in one transaction,
 * so a determined user posting straight to the function gets the same answer.
 */

/** The six fields the programme needs, and what each planner tends to call them. */
const FIELDS = [
  { key: 'task_uid', label: 'ID', required: true,
    hints: ['id', 'uid', 'task id', 'unique id', 'activity id', 'code', 'ref'] },
  { key: 'description', label: 'Description', required: true,
    hints: ['description', 'name', 'task name', 'activity name', 'title'] },
  { key: 'start_date', label: 'Start', required: true,
    hints: ['start', 'start date', 'early start', 'planned start'] },
  { key: 'finish_date', label: 'Finish', required: true,
    hints: ['finish', 'end', 'finish date', 'early finish', 'planned finish'] },
  { key: 'percent_complete', label: 'Percent complete', required: false,
    hints: ['percent', '% complete', 'percent complete', 'pct', 'progress'] },
  { key: 'level', label: 'Outline level', required: false,
    hints: ['level', 'outline level', 'wbs level', 'indent'] },
  { key: 'parent_uid', label: 'Parent ID', required: false,
    hints: ['parent', 'parent id', 'summary id', 'wbs parent'] },
  { key: 'task_type', label: 'Type', required: false,
    hints: ['type', 'task type', 'activity type'] },
] as const

const norm = (s: string) => s.toLowerCase().replace(/[^a-z%]/g, '')

/** Best guess at which column is which, so the common case needs no clicking. */
function guessMapping(headers: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  const taken = new Set<string>()
  for (const f of FIELDS) {
    const hit = headers.find(
      (h) => !taken.has(h) && f.hints.some((x) => norm(h) === norm(x)))
      ?? headers.find((h) => !taken.has(h) && f.hints.some((x) => norm(h).includes(norm(x))))
    if (hit) { out[f.key] = hit; taken.add(hit) }
  }
  return out
}

/** Dates arrive in whatever the planner exported. ISO passes through; the two
 *  common British forms are converted; anything else is left alone for the
 *  server to reject by name rather than being silently mangled here. */
function toIso(raw: string): string {
  const v = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
  const m = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (m) {
    const [, d, mo, y] = m
    const year = y.length === 2 ? `20${y}` : y
    return `${year}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return v
}

type Row = Record<string, string>

export function ImportProgramme({
  projectId, onClose, onImported,
}: {
  projectId: string
  onClose: () => void
  onImported: () => void
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [label, setLabel] = useState('')
  const [fileName, setFileName] = useState('')
  const [report, setReport] = useState<ImportReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const missing = FIELDS.filter((f) => f.required && !mapping[f.key])

  const mapped = useMemo(() => rows.map((r) => {
    const out: Record<string, unknown> = {}
    for (const f of FIELDS) {
      const col = mapping[f.key]
      if (!col) continue
      const raw = (r[col] ?? '').trim()
      if (f.key === 'start_date' || f.key === 'finish_date') out[f.key] = toIso(raw)
      else if (f.key === 'percent_complete' || f.key === 'level') {
        const n = parseInt(raw.replace('%', ''), 10)
        out[f.key] = Number.isFinite(n) ? n : (f.key === 'level' ? 1 : 0)
      } else out[f.key] = raw
    }
    return out
  }), [rows, mapping])

  const onFile = (file: File) => {
    setError(null); setReport(null); setFileName(file.name)
    if (!label) setLabel(file.name.replace(/\.csv$/i, ''))
    Papa.parse<Row>(file, {
      header: true, skipEmptyLines: true,
      complete: (res) => {
        const hs = (res.meta.fields ?? []).filter(Boolean)
        if (hs.length === 0) { setError('That file has no header row.'); return }
        setHeaders(hs)
        setRows(res.data)
        setMapping(guessMapping(hs))
      },
      error: (e) => setError(e.message),
    })
  }

  const send = async () => {
    setBusy(true); setError(null)
    try {
      setReport(await importProgramme(projectId, label || fileName || 'Programme import', mapped))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /** Rejected rows go back as a CSV lined up with what was submitted, so the
   *  planner can fix them in the file they already have. */
  const downloadRejects = () => {
    if (!report?.errors) return
    const byRow = new Map<number, string[]>()
    for (const e of report.errors) {
      byRow.set(e.row, [...(byRow.get(e.row) ?? []), `${e.field}: ${e.message}`])
    }
    const csv = Papa.unparse([
      ['Row in file', ...headers, 'Why it was rejected'],
      ...[...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([n, why]) =>
        [String(n), ...headers.map((h) => rows[n - 1]?.[h] ?? ''), why.join('; ')]),
    ])
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `rejected-rows-${fileName || 'programme'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6">
      <div
        className="bg-card border-rule w-full max-w-[860px] rounded-lg border shadow-2xl"
        role="dialog"
        aria-label="Import a programme revision"
      >
        <header className="border-rule flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-base font-semibold">Import a programme revision</h2>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">✕</Button>
        </header>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {/* ---------------------------------------------------- the result */}
          {report ? (
            report.ok ? (
              <div>
                <p className="border-ok bg-ok-bg text-ok mb-4 rounded border-l-[3px] px-3 py-2 text-sm">
                  Revision applied. {report.added} added, {report.updated} updated,
                  {' '}{report.removed} removed{report.restored ? `, ${report.restored} restored` : ''}.
                </p>
                {report.moved && report.moved.length > 0 ? (
                  <>
                    <h3 className="mb-2 text-sm font-semibold">
                      What moved ({report.moved.length})
                    </h3>
                    <p className="text-graphite mb-2 max-w-prose text-xs">
                      Everything anchored to these lines has already been rescheduled. No
                      dependent record was written — the dates are computed from here.
                    </p>
                    <TableScroll>
                      <Table>
                        <THead>
                          <TR>
                            <TH className="w-[76px]">ID</TH>
                            <TH>Line</TH>
                            <TH className="w-[96px]">Was</TH>
                            <TH className="w-[96px]">Now</TH>
                            <TH className="w-[72px]">Slip</TH>
                          </TR>
                        </THead>
                        <TBody>
                          {report.moved.map((m) => (
                            <TR key={m.task_uid}>
                              <TD><Code className="text-xs">{m.task_uid}</Code></TD>
                              <TD>{m.description}</TD>
                              <TD><Code className="text-graphite text-xs">{m.was_finish}</Code></TD>
                              <TD><Code className="text-xs">{m.now_finish}</Code></TD>
                              <TD>
                                <Code
                                  className={
                                    'text-xs ' +
                                    (m.finish_slip_days > 0 ? 'text-stop'
                                      : m.finish_slip_days < 0 ? 'text-ok' : 'text-graphite')
                                  }
                                >
                                  {m.finish_slip_days > 0 ? '+' : ''}{m.finish_slip_days}d
                                </Code>
                              </TD>
                            </TR>
                          ))}
                        </TBody>
                      </Table>
                    </TableScroll>
                  </>
                ) : (
                  <p className="text-graphite text-sm">No dates moved in this revision.</p>
                )}
                <div className="mt-5">
                  <Button size="sm" onClick={onImported}>Done</Button>
                </div>
              </div>
            ) : (
              <div>
                <p className="border-stop bg-stop-bg text-stop mb-3 rounded border-l-[3px] px-3 py-2 text-sm">
                  Nothing was imported. {report.errors?.length} problem
                  {report.errors?.length === 1 ? '' : 's'} in {report.row_count} rows — the
                  previous revision is untouched.
                </p>
                <TableScroll>
                  <Table>
                    <THead>
                      <TR><TH className="w-[64px]">Row</TH><TH className="w-[120px]">Field</TH><TH>Problem</TH></TR>
                    </THead>
                    <TBody>
                      {report.errors?.slice(0, 50).map((e, i) => (
                        <TR key={`${e.row}-${e.field}-${i}`}>
                          <TD><Code className="text-xs">{e.row}</Code></TD>
                          <TD className="text-graphite text-xs">{e.field}</TD>
                          <TD>{e.message}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableScroll>
                {(report.errors?.length ?? 0) > 50 && (
                  <p className="text-graphite mt-2 text-xs">
                    Showing the first 50. Download the rejects for all of them.
                  </p>
                )}
                <div className="mt-4 flex gap-2">
                  <Button size="sm" variant="secondary" onClick={downloadRejects}>
                    Download rejected rows
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setReport(null)}>
                    Change the mapping
                  </Button>
                </div>
              </div>
            )
          ) : (
            <>
              {/* ------------------------------------------------ the file */}
              <label className="mb-4 block">
                <span className="mb-1 block text-sm font-medium">Programme export (CSV)</span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }}
                  className="border-rule w-full rounded border px-3 py-2 text-sm"
                />
                <span className="text-graphite mt-1 block text-xs">
                  Export from Asta, P6 or MS Project. The column names do not matter — you map
                  them below.
                </span>
              </label>

              {headers.length > 0 && (
                <>
                  <label className="mb-4 block">
                    <span className="mb-1 block text-sm font-medium">
                      What to call this revision
                    </span>
                    <input
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="Rev 12 — August progress update"
                      className="border-rule w-full rounded border px-3 py-2 text-sm"
                    />
                  </label>

                  <h3 className="mb-2 text-sm font-semibold">Match the columns</h3>
                  <div className="mb-4 grid gap-2 sm:grid-cols-2">
                    {FIELDS.map((f) => (
                      <label key={f.key} className="flex items-center gap-2 text-sm">
                        <span className="w-[130px] shrink-0">
                          {f.label}
                          {f.required && <span className="text-stop ml-0.5">*</span>}
                        </span>
                        <select
                          value={mapping[f.key] ?? ''}
                          onChange={(e) =>
                            setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
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

                  {missing.length > 0 && (
                    <p className="border-warn bg-warn-bg text-warn mb-3 rounded border-l-[3px] px-3 py-2 text-sm">
                      Still to match: {missing.map((f) => f.label).join(', ')}.
                    </p>
                  )}

                  <h3 className="mb-2 text-sm font-semibold">
                    Preview — first 8 of {rows.length} rows
                  </h3>
                  <TableScroll>
                    <Table>
                      <THead>
                        <TR>
                          <TH className="w-[76px]">ID</TH>
                          <TH>Description</TH>
                          <TH className="w-[96px]">Start</TH>
                          <TH className="w-[96px]">Finish</TH>
                          <TH className="w-[64px]">Type</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {mapped.slice(0, 8).map((r, i) => (
                          <TR key={i}>
                            <TD><Code className="text-xs">{String(r.task_uid ?? '')}</Code></TD>
                            <TD>{String(r.description ?? '')}</TD>
                            <TD><Code className="text-xs">{String(r.start_date ?? '')}</Code></TD>
                            <TD><Code className="text-xs">{String(r.finish_date ?? '')}</Code></TD>
                            <TD className="text-graphite text-xs">
                              {String(r.task_type ?? 'Task')}
                            </TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  </TableScroll>

                  <p className="text-graphite mt-3 max-w-prose text-xs">
                    Lines missing from this file are marked removed, never deleted — anything
                    dated from them keeps its date and is flagged.
                  </p>
                </>
              )}

              {error && <p className="text-stop mt-3 text-sm">{error}</p>}
            </>
          )}
        </div>

        {!report && (
          <footer className="border-rule flex items-center justify-end gap-2 border-t px-5 py-3">
            <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              disabled={busy || rows.length === 0 || missing.length > 0}
              onClick={() => void send()}
            >
              {busy ? 'Importing…' : `Import ${rows.length || ''} lines`}
            </Button>
          </footer>
        )}
      </div>
    </div>
  )
}
