import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import { Panel } from '@/components/ui/panel'
import { Pill } from '@/components/ui/table'
import { Section } from '@/pages/marketing/Layout'
import { TIERS } from '@/pages/marketing/tiers'

/**
 * What the product contains, described in the three tiers of the brief.
 *
 * The lists come from `tiers.ts` so that a module named here is a module the
 * database knows: a marketing page is the easiest place for a claim to go
 * stale, because nothing breaks when it does.
 */
export default function MarketingProduct() {
  return (
    <>
      <Section
        eyebrow="What it does"
        title="Three tiers. One codebase. Switch modules on per project."
        lead="The core is always on, because nothing works without the directory and the
              programme. Everything else is an entitlement — which is also how a toolkit gets
              phased in, one module at a time, rather than arriving all at once and being
              used by nobody."
      >
        <div className="grid gap-5 lg:grid-cols-3">
          {TIERS.map((tier) => (
            <Panel
              key={tier.key}
              title={tier.name}
              kind={tier.key === 'core' ? 'evidence' : tier.key === 'compliance' ? 'comply' : 'money'}
              className="mb-0"
              actions={<Pill tone={tier.key === 'core' ? 'ok' : 'neutral'}>{tier.eyebrow}</Pill>}
            >
              <p className="text-graphite mb-4 text-sm">{tier.line}</p>
              <ul className="flex flex-col gap-3">
                {tier.items.map((item, i) => (
                  <li key={`${item.key}-${i}`}>
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="text-graphite text-xs">{item.note}</p>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      </Section>

      <Section
        alt
        eyebrow="What a module being off means"
        title="Absent, not greyed out."
        lead="A module your account has not taken does not appear in the navigation, and its
              page refuses rather than rendering empty. Showing a locked door would tell a
              consultant what their client has and has not paid for, which is not theirs to
              know."
      >
        <div className="grid gap-5 md:grid-cols-2">
          <Panel title="Switching one off deletes nothing" className="mb-0">
            <p className="text-graphite text-sm">
              Entitlements are packaging, never permission — what a person may read is decided
              somewhere else entirely and is untouched by any of this. Take a module back and
              everything that was there is still there, exactly as it was left.
            </p>
          </Panel>
          <Panel title="Per project, as well as per account" className="mb-0">
            <p className="text-graphite text-sm">
              An account administrator can switch a module off for one job — a scheme with no
              BREEAM assessment does not need the tab — and clear the override to put it back.
              An override can only narrow: nobody can switch on a module the account has not
              taken.
            </p>
          </Panel>
        </div>
      </Section>

      <Section eyebrow="Where it sits" title="Above the CDE, not instead of it.">
        <div className="grid gap-5 md:grid-cols-2">
          <Panel title="Your CDE keeps the files" className="mb-0">
            <p className="text-graphite text-sm">
              Asite, Aconex, Viewpoint — whichever you use stays where it is, and stays the
              record of the documents themselves. Spine holds a link to each one, never a
              copy, so there is only ever one current revision and it is not here.
            </p>
          </Panel>
          <Panel title="Spine keeps what the CDE cannot" className="mb-0">
            <p className="text-graphite text-sm">
              What is due and has not arrived. Whose duty it was. What slips when the
              programme moves. What nobody has been given at all. A file store cannot answer
              any of those, because none of them is a file.
            </p>
          </Panel>
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button asChild size="lg">
            <Link to="/sign-up">Start a trial</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/pricing">See pricing</Link>
          </Button>
        </div>
      </Section>
    </>
  )
}
