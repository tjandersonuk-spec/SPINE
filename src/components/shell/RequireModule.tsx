import { useOutletContext } from 'react-router'

import { Panel, PageHead } from '@/components/ui/panel'
import type { ProjectContext } from '@/pages/project/ProjectLayout'

/**
 * A page whose module is off says so rather than rendering.
 *
 * Hiding the nav entry is not enough on its own: a bookmark, a link in an
 * email or a typed URL all reach the route directly. The database refuses the
 * data either way — this is what the person sees instead of an empty page that
 * looks broken.
 */
export function RequireModule({
  module, children,
}: { module: string; children: React.ReactNode }) {
  const ctx = useOutletContext<ProjectContext>()

  // Still loading: the shell has not answered yet, and flashing "not included"
  // at someone who is entitled would be worse than a blank moment.
  if (!ctx.shell) return null

  if (!ctx.moduleOn(module)) {
    return (
      <>
        <PageHead title="Not part of this project" />
        <Panel title="This module is not switched on">
          <p className="text-graphite max-w-prose text-sm">
            {ctx.isAccountAdmin
              ? 'You can switch it on for the account, or for this project alone, in project settings.'
              : 'Someone who administers this account can switch it on. Until then the pages behind it do not open, and the data behind them is refused by the database rather than merely hidden.'}
          </p>
        </Panel>
      </>
    )
  }
  return <>{children}</>
}
