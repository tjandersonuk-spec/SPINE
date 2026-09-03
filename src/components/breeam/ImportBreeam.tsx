import Papa from 'papaparse'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Code, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { TEMPLATES, download, downloadTemplate } from '@/components/breeam/templates'
import {
  breeamImportApply, breeamImportPreview, breeamImportValidate,
  type BreeamImportKind, type BreeamImportPreview, type BreeamImportResult, type BreeamImportRow,
} from '@/lib/queries'

/**
 * The three BREEAM imports: sections and weightings, issues and credits, and
 * minimum standards.
 *
 * Same discipline as every other import: a published template, every column
 * matched before anything is sent, a preview of what will change, and the
 * rejected rows handed back as a CSV to fix. The browser only shapes the rows;
 * breeam_import_validate() and breeam_import_apply() decide, so a file posted
 * straight to the function gets the same answer as one that came through here.
 */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z%]/g, '')

type Row = Record<string, string>

export function ImportBreeam({
  schemeId, kind, onClose, onImported,
}: {
  schemeId: string
  kind: BreeamImportKind
  onClose: () => void
  onImported: () => void
}) {
  const t = TEMPLATES[kind]
  const [rows, setRows] = useState<Row[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<BreeamImportPreview | null>(null)
  const [verdicts, setVerdicts] = useState<BreeamImportRow[]>([])
  const [result, setResult] = useState<BreeamImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Every column is required: the template's headers must all be present, and
  // a file missing one is refused whole rather than half-imported.
  const missing = t.fields.filter((f) => !mapping[f.key])

  const mapped = useMemo(() => rows.map((r) => {
    const out: Row = {}
    for (const f of t.fields) {
      const col = mapping[f.key]
      out[f.key] = col ? (r[col] ?? '').trim() : ''
    }
    return out
  }), [rows, mapping, t.fields])

  const onFile = (file: File) => {
    setError(null); setResult(null); setPreview(null); setVerdicts([]); setFileName(file.name)
    Papa.parse<Row>(file, {
      header: true, skipEmptyLines: true,
      complete: (res) => {
        const hs = (res.meta.fields ?? []).filter(Boolean)
        if (hs.length === 0) { setError('That file has no header row.'); return }
        setHeaders(hs)
        setRows(res.data)
        // Guess by the published header; the person corrects the guess.
        const m: Record<string, string> = {}
        for (const f of t.fields) {
          const hit = hs.find((h) => norm(h) === norm(f.header))
          if (hit) m[f.key] = hit
        }
        setMapping(m)
      },
      error: (e) => setError(e.message),
    })
  }

  // Every column matched and something to send.
  const ready = rows.length > 0 && missing.length === 0

  // The preview is the server's answer, not the browser's guess.
  useEffect(() => {
    if (!ready) return
    let live = true
    Promise.all([
      breeamImportPreview(schemeId, kind, mapped),
      breeamImportValidate(schemeId, kind, mapped),
    ])
      .then(([p, v]) => { if (live) { setPreview(p); setVerdicts(v); setError(null) } })
      .catch((e: Error) => { if (live) { setPreview(null); setError(e.message) } })
    return () => { live = false }
  }, [schemeId, kind, mapped, ready])

  const apply = async () => {
    setBusy(true); setError(null)
    try {
      setResult(await breeamImportApply(schemeId, kind, mapped, fileName || t.title))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const rejects = verdicts.filter((v) => !v.accepted)

  /** Rejected rows go back in the template's own columns, so they can be fixed
   *  in the file the assessor already has. */
  const downloadRejects = () => {
    download(`breeam-rejected-rows-${fileName || kind}.csv`, Papa.unparse([
      [...t.fields.map((f) => f.header), 'Why it was rejected'],
      ...rejects.map((v) => [
        ...t.fields.map((f) => mapped[v.line - 2]?.[f.key] ?? ''), v.why ?? '']),
    ]))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-6 backdrop-blur-sm">
      <div
        className="glass-popover w-full max-w-[860px] rounded-lg"
        role="dialog"
        aria-label={`Import ${t.title}`}
      >
        <header className="border-rule flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-base font-semibold">Import — {t.title}</h2>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">✕</Button>
        </header>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {result ? (
            <div>
              <p className="border-ok bg-ok-bg text-ok mb-4 rounded border-l-[3px] px-3 py-2 text-sm">
                Applied. {result.created} created, {result.updated} updated
                {result.rejected ? `, ${result.rejected} rejected and left out` : ''}.
              </p>
              {rejects.length > 0 && (
                <Button size="sm" variant="secondary" onClick={downloadRejects}>
                  Download the {rejects.length} rejected row{rejects.length === 1 ? '' : 's'}
                </Button>
              )}
              <div className="mt-5">
                <Button size="sm" onClick={onImported}>Done</Button>
              </div>
            </div>
          ) : (
            <>
              <label className="mb-4 block">
                <span className="mb-1 block text-sm font-medium">{t.title} (CSV)</span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }}
                  className="border-rule w-full rounded border px-3 py-2 text-sm"
                />
                <span className="text-graphite mt-1 block text-xs">
                  Start from the{' '}
                  <button type="button" className="underline" onClick={() => downloadTemplate(kind)}>
                    published template
                  </button>
                  . Every column must be present; the file is refused whole if one is missing.
                </span>
              </label>

              {headers.length > 0 && (
                <>
                  <h3 className="mb-2 text-sm font-semibold">Match the columns</h3>
                  <div className="mb-4 grid gap-2 sm:grid-cols-2">
                    {t.fields.map((f) => (
                      <label key={f.key} className="flex items-center gap-2 text-sm">
                        <span className="w-[170px] shrink-0">
                          {f.header}<span className="text-stop ml-0.5">*</span>
                        </span>
                        <select
                          value={mapping[f.key] ?? ''}
                          onChange={(e) =>
                            setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                          className="border-rule flex-1 rounded border px-2 py-1.5 text-sm"
                        >
                          <option value="">— choose a column —</option>
                          {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>

                  {missing.length > 0 ? (
                    <p className="border-warn bg-warn-bg text-warn mb-3 rounded border-l-[3px] px-3 py-2 text-sm">
                      Still to match: {missing.map((f) => f.header).join(', ')}. Nothing is sent
                      until every column is.
                    </p>
                  ) : ready && preview && (
                    <p className="border-rule bg-surface-2 mb-3 rounded border-l-[3px] px-3 py-2 text-sm">
                      Applying will create <strong>{preview.creating}</strong>, update{' '}
                      <strong>{preview.updating}</strong> and reject{' '}
                      <strong>{preview.rejected}</strong> of {rows.length} rows.
                      {kind === 'sections' && (
                        <span className="text-graphite block text-xs">
                          A section that repeats per building type is one section with several
                          weightings. A blank in a later row never clears what an earlier row gave.
                        </span>
                      )}
                    </p>
                  )}

                  {ready && rejects.length > 0 && (
                    <>
                      <h3 className="mb-2 text-sm font-semibold">
                        Rejected rows ({rejects.length})
                      </h3>
                      <TableScroll>
                        <Table>
                          <THead>
                            <TR><TH className="w-[64px]">Row</TH><TH>Why</TH></TR>
                          </THead>
                          <TBody>
                            {rejects.slice(0, 30).map((v) => (
                              <TR key={v.line}>
                                <TD><Code className="text-xs">{v.line}</Code></TD>
                                <TD>{v.why}</TD>
                              </TR>
                            ))}
                          </TBody>
                        </Table>
                      </TableScroll>
                      <div className="mt-2">
                        <Button size="sm" variant="ghost" onClick={downloadRejects}>
                          Download rejected rows
                        </Button>
                      </div>
                    </>
                  )}
                </>
              )}

              {error && <p className="text-stop mt-3 text-sm">{error}</p>}
            </>
          )}
        </div>

        {!result && (
          <footer className="border-rule flex items-center justify-end gap-2 border-t px-5 py-3">
            <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              disabled={busy || !ready || !preview}
              onClick={() => void apply()}
            >
              {busy ? 'Applying…' : 'Apply'}
            </Button>
          </footer>
        )}
      </div>
    </div>
  )
}
