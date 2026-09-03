import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import { Panel } from '@/components/ui/panel'
import { Section } from '@/pages/marketing/Layout'

export default function MarketingAbout() {
  return (
    <>
      <Section
        eyebrow="About"
        title="Built by the people who were doing it on spreadsheets."
        lead="Spine started inside a main contractor’s design management team, on live
              higher-risk building projects, because the tools available answered the wrong
              question. A common data environment tells you what has arrived. It cannot tell
              you what has not, whose job it was, or what moves when the programme does."
      >
        <div className="grid gap-5 md:grid-cols-2">
          <Panel title="What we kept from the spreadsheets" className="mb-0">
            <p className="text-graphite text-sm">
              The density. A design manager reads four hundred register rows down a column,
              not across a sentence, and a product that hides that behind cards and whitespace
              is slower than the thing it replaced. Every table here is the dense one, every
              code is monospace, and the only decoration that means anything is the one that
              marks a gap.
            </p>
          </Panel>
          <Panel title="What we would not carry over" className="mb-0">
            <p className="text-graphite text-sm">
              Typed dates, and totals nobody can reproduce. A spreadsheet lets you write a
              date that no longer relates to the programme and a figure that no longer
              relates to its parts. Both are how a tracker quietly stops being believed. This
              refuses to hold either.
            </p>
          </Panel>
        </div>
      </Section>

      <Section alt eyebrow="How it is built" title="Decisions we will not trade away.">
        <div className="grid gap-5 md:grid-cols-3">
          {[
            ['The trail is not editable',
             'Not by an administrator, not by us. The change log is written by the database on '
             + 'every write and nobody holds permission to amend it.'],
            ['Licensed content is not ours to ship',
             'BREEAM criteria, BG6, the CIC schedules — those tables start empty and are loaded '
             + 'by whoever holds the licence. We do not pass on somebody else’s work.'],
            ['One colour, and legibility is not a preference',
             'You set a brand colour and light or dark. Everything readable on top is worked out '
             + 'from it, so no tenant can configure their way to text nobody can read.'],
          ].map(([t, d]) => (
            <Panel key={t} title={t} className="mb-0">
              <p className="text-graphite text-sm">{d}</p>
            </Panel>
          ))}
        </div>
      </Section>

      <Section eyebrow="Where the name comes from" title="Two spines.">
        <p className="text-graphite max-w-[62ch] text-base">
          One is the discipline: every duty belongs to a discipline, and companies hold
          disciplines, so the org chart can change without the work changing hands. The other
          is the programme: every date is a line on it plus an offset, so the whole job
          reschedules from one import. Everything else in the product hangs off those two.
        </p>
        <p className="text-graphite-light mt-4 max-w-[62ch] text-xs">
          “Spine” is a working name and will be replaced before launch.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/sign-up">Start a trial</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/contact">Talk to us</Link>
          </Button>
        </div>
      </Section>
    </>
  )
}
