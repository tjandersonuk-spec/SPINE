import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import { Panel } from '@/components/ui/panel'
import { Pill } from '@/components/ui/table'
import { Section } from '@/pages/marketing/Layout'
import { PRICING } from '@/pages/marketing/tiers'

/**
 * Pricing, with no prices.
 *
 * The structure is decided — per account, tiered by module, unlimited people —
 * and the figures are not. A placeholder number on a public page is a number
 * somebody quotes back at you in a negotiation, so this asks rather than
 * invents. The brief says the same: "a placeholder structure, figures to be
 * set".
 */
export default function MarketingPricing() {
  return (
    <>
      <Section
        eyebrow="Pricing"
        title="Per account. Not per seat."
        lead="A design manager who has to think about the cost of adding a consultant will
              leave them out, and a directory with people missing is worse than no directory.
              So everybody on the job is included: your team, every consultant, the client,
              their advisers."
      >
        <div className="grid gap-5 lg:grid-cols-3">
          {PRICING.map((p) => (
            <Panel
              key={p.name}
              title={p.name}
              className="mb-0"
              active={p.featured}
              actions={p.featured ? <Pill tone="ok">Most taken</Pill> : undefined}
            >
              <p className="text-graphite mb-4 text-sm">{p.line}</p>
              <p className="font-mono text-3xl font-semibold tracking-tight">
                POA
              </p>
              <p className="text-graphite-light mb-4 text-xs">{p.per}</p>
              <ul className="mb-5 flex flex-col gap-1.5">
                {p.includes.map((i) => (
                  <li key={i} className="text-sm">
                    <span className="text-ok-ink mr-2">✓</span>
                    {i}
                  </li>
                ))}
              </ul>
              <Button asChild variant={p.featured ? 'default' : 'outline'} className="w-full">
                <Link to={p.cta === 'Talk to us' ? '/contact' : '/sign-up'}>{p.cta}</Link>
              </Button>
            </Panel>
          ))}
        </div>
        <p className="text-graphite-light mt-6 max-w-[62ch] text-xs">
          Figures are being set and are deliberately not shown here yet. Ask and you will get
          a real number rather than one this page invented.
        </p>
      </Section>

      <Section alt eyebrow="What is included whatever you take" title="The parts nobody should have to buy.">
        <div className="grid gap-5 md:grid-cols-3">
          {[
            ['Everybody on the job',
             'Your staff, every consultant, the client and their advisers. No seat count, so '
             + 'nobody is left out of the directory to save money.'],
            ['Unlimited projects',
             'Including the ones that never start. A job you priced and lost still taught you '
             + 'something, and the record of it costs nothing to keep.'],
            ['Your data, on your terms',
             'Exports of everything you can see, in CSV and JSON, whenever you want them — not '
             + 'as a retention lever.'],
          ].map(([t, d]) => (
            <Panel key={t} title={t} className="mb-0">
              <p className="text-graphite text-sm">{d}</p>
            </Panel>
          ))}
        </div>
      </Section>

      <Section eyebrow="Questions we get asked" title="Before you ask.">
        <dl className="grid gap-5 md:grid-cols-2">
          {[
            ['Can we start with one module?',
             'Yes, and most do. The core plus whichever tier answers the problem you have this '
             + 'year. Adding one later switches it on for every project, or for one.'],
            ['What happens if we stop?',
             'You export everything first, and the account is archived rather than deleted — it '
             + 'stays readable by its members. Deleting is a separate, deliberate act.'],
            ['Do you see our project data?',
             'No. We see that your account exists, how many projects and members it has, and '
             + 'nothing inside them. That is a billing fact; your design information is not.'],
            ['Does it replace our CDE?',
             'No, and it should not. Your CDE keeps the files. This keeps what is due, who owns '
             + 'it, and what nobody has been given.'],
          ].map(([q, a]) => (
            <div key={q}>
              <dt className="text-sm font-semibold">{q}</dt>
              <dd className="text-graphite mt-1 text-sm">{a}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </>
  )
}
