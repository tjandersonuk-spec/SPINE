import { useEffect, useState } from 'react'

import { Code } from '@/components/ui/table'
import { fetchModuleCatalogue, type ModuleEntry } from '@/lib/queries'

/**
 * The platform owner's entitlement editor: which modules an account has been
 * sold. Rendered straight from module_catalogue(), so a bolt-on added later
 * appears here without a change to this file.
 *
 * A module nobody has decided about is ON. The map therefore only ever needs
 * to name what is OFF -- an empty map is the complete product -- and that is
 * what this writes, so an account that has bought everything has nothing to
 * say about it.
 */
export function ModuleEditor({
  value, onChange, disabled,
}: {
  value: Record<string, boolean>
  onChange: (next: Record<string, boolean>) => void
  disabled?: boolean
}) {
  const [catalogue, setCatalogue] = useState<ModuleEntry[]>([])
  useEffect(() => { fetchModuleCatalogue().then(setCatalogue).catch(() => setCatalogue([])) }, [])
  const groups = [...new Set(catalogue.map((m) => m.group))]
  const isOn = (k: string) => value[k] !== false

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {groups.map((g) => (
        <div key={g}>
          <p className="text-graphite mb-1 text-[10px] font-bold tracking-[0.13em] uppercase">{g}</p>
          {catalogue.filter((m) => m.group === g).map((m) => (
            <label key={m.key} className="flex items-center gap-2 py-0.5 text-sm">
              <input
                type="checkbox"
                checked={isOn(m.key)}
                disabled={disabled}
                onChange={(e) => {
                  const next = { ...value }
                  if (e.target.checked) delete next[m.key]; else next[m.key] = false
                  onChange(next)
                }}
              />
              <span className={isOn(m.key) ? '' : 'text-graphite line-through'}>{m.label}</span>
              <Code className="text-graphite ml-auto text-[10px]">{m.key}</Code>
            </label>
          ))}
        </div>
      ))}
    </div>
  )
}
