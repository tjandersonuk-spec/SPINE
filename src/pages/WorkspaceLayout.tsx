import { useEffect } from 'react'
import { Outlet } from 'react-router'

import { AppShell } from '@/components/shell/AppShell'
import { fetchAccountBranding, fetchMyAccounts } from '@/lib/queries'
import { applyBrand, applyTheme } from '@/lib/theme'

/**
 * Everything signed-in that is not inside a project: the portfolio, the
 * accounts, your details, account admin, the platform pages. Same shell as a
 * project, with the workspace nav.
 *
 * Branding outside a project is the first account's. One colour, light or
 * dark, and nothing else -- the whole customiser -- applied before the sidebar
 * paints so it never flashes the default and then corrects itself. A person
 * with no account gets the default, which is fine: there is nothing to brand.
 */
export default function WorkspaceLayout() {
  useEffect(() => {
    let live = true
    fetchMyAccounts()
      .then((accounts) => accounts[0] ? fetchAccountBranding(accounts[0].id) : null)
      .then((b) => {
        if (!live || !b) return
        applyBrand(b.brand_colour)
        applyTheme(b.theme)
      })
      .catch(() => { /* default branding is a fine answer */ })
    return () => { live = false }
  }, [])

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}
