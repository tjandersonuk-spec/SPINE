import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import { Eyebrow, Panel } from '@/components/ui/panel'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { Section } from '@/pages/marketing/Layout'

/**
 * The home page.
 *
 * The pitch is the two invariants, because they are the product: everything
 * else in the application is a consequence of them, and a contractor who has
 * run a job recognises both problems immediately. The hero shows a real slice
 * of the matrix rather than a stock photograph — including a gap row, which is
 * the single most recognisable thing the product does.
 */
export default function MarketingHome() {
  return (
    <>
      <section className="py-16 sm:py-20">
        <div className="mx-auto grid max-w-[1080px] items-center gap-12 px-6 lg:grid-cols-[1.05fr_.95fr]">
          <div>
            <Eyebrow>Design management for main contractors</Eyebrow>
            <h1 className="mt-2 text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">
              What is due, who owns it, and what nobody has been given.
            </h1>
            <p className="text-graphite mt-5 max-w-[54ch] text-lg">
              The layer above your common data environment. Not another place to store
              files — a place that knows every deliverable belongs to a discipline and
              every date comes from the programme, so when the job moves, everything
              moves with it.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/sign-up">Start a trial</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/product">See the product</Link>
              </Button>
            </div>
            <p className="text-graphite-light mt-5 text-xs">
              Built by a main contractor’s design management team, on live higher-risk
              building projects.
            </p>
          </div>

          <Panel title="Responsibility matrix" className="mb-0 shadow-glass">
            <TableScroll className="border-0 shadow-none">
              <Table>
                <THead>
                  <TR>
                    <TH className="w-[74px]">Ref</TH>
                    <TH>Duty</TH>
                    <TH className="w-[92px]">Lead</TH>
                    <TH className="w-[104px]">Holder</TH>
                  </TR>
                </THead>
                <TBody>
                  <TR>
                    <TD><Code>04.010</Code></TD>
                    <TD>Facade system design</TD>
                    <TD><Code>FE</Code></TD>
                    <TD>Ashgrove</TD>
                  </TR>
                  <TR>
                    <TD><Code>04.100</Code></TD>
                    <TD>Cavity barriers in facade</TD>
                    <TD><Code>FS</Code></TD>
                    <TD>Ridley Fire</TD>
                  </TR>
                  <TR gap>
                    <TD><Code>06.160</Code></TD>
                    <TD>Lifts and vertical transportation</TD>
                    <TD><Code>VT</Code></TD>
                    <TD><Pill tone="gap">Nobody</Pill></TD>
                  </TR>
                  <TR>
                    <TD><Code>08.010</Code></TD>
                    <TD>Fire strategy</TD>
                    <TD><Code>FS</Code></TD>
                    <TD>Ridley Fire</TD>
                  </TR>
                  <TR>
                    <TD><Code>09.030</Code></TD>
                    <TD>Service penetrations and fire stopping</TD>
                    <TD><Code>FS</Code></TD>
                    <TD>Ridley Fire</TD>
                  </TR>
                </TBody>
              </Table>
            </TableScroll>
            <p className="text-graphite mt-3 text-xs">
              One row is hi-vis, and it means one thing: a duty nobody has been given. It
              falls to the contractor by default, which is usually the first anybody hears
              of it.
            </p>
          </Panel>
        </div>
      </section>

      <Section
        alt
        eyebrow="The two ideas everything is built on"
        title="Two spines. Every module hangs off them."
      >
        <div className="grid gap-5 md:grid-cols-2">
          <Panel title="Nothing is assigned to a company" kind="evidence" className="mb-0">
            <p className="text-graphite text-sm">
              It is assigned to a <strong className="text-foreground">discipline</strong>, and
              companies hold disciplines. Novate the architect and every drawing, every
              warranty and every scope line follows, because nothing was ever pinned to the
              old firm in the first place. The gap the matrix shows is the same gap the
              warranty register shows — they are the same lookup, not two lists somebody
              keeps in step.
            </p>
          </Panel>
          <Panel title="No date is ever typed" kind="money" className="mb-0">
            <p className="text-graphite text-sm">
              Every date is a{' '}
              <strong className="text-foreground">programme line plus an offset</strong>.
              Re-import a revision and the whole project reschedules: drawings, instalments,
              conditions, credits, change-request decisions. Slip the Stage 4 freeze and four
              payment instalments move with it — a cashflow consequence of a design delay
              that nobody usually connects to the delay.
            </p>
          </Panel>
        </div>
      </Section>

      <Section
        eyebrow="Why it is different"
        title="It infers. It does not count."
        lead="Three decisions that are unusual, and that everything else follows from."
      >
        <div className="grid gap-5 md:grid-cols-3">
          <Panel title="Derived, never stored" className="mb-0">
            <p className="text-graphite text-sm">
              Construction status, overdue counts, risk exposure, BREEAM scores, whether a
              change may proceed — computed on read, every time. A stored figure that could
              disagree with reality eventually will, quietly, and usually in front of
              somebody who has the other screen open.
            </p>
          </Panel>
          <Panel title="The trail is not yours to edit" className="mb-0">
            <p className="text-graphite text-sm">
              The change log is written by the database on every write, one row per field
              that genuinely moved. Nobody can insert, amend or delete a line of it — not an
              administrator, not us. Every member of the project reads all of it.
            </p>
          </Panel>
          <Panel title="A report is a query" className="mb-0">
            <p className="text-graphite text-sm">
              Nothing is drafted, saved or versioned, so there is never a stale copy to
              reconcile against the live job. What a client sees is missing because the
              query returned nothing, not because a template hid it.
            </p>
          </Panel>
        </div>
      </Section>

      <Section alt eyebrow="Getting started" title="Fifteen minutes to something real.">
        <ol className="grid gap-5 md:grid-cols-3">
          {[
            ['Create your account',
             'Sign up, confirm your address, and ask for an account. We review it and switch '
             + 'on the modules you have taken.'],
            ['Import the programme',
             'A CSV from whatever your planner uses. Map the columns once; every date in the '
             + 'project comes from it afterwards.'],
            ['Build the directory',
             'The firms, the people, and the disciplines each holds. The matrix tells you '
             + 'what is left over on the same afternoon.'],
          ].map(([t, d], i) => (
            <li key={t} className="glass rounded-lg p-5">
              <span className="text-primary font-mono text-3xl font-semibold">{i + 1}</span>
              <h3 className="mt-2 text-sm font-semibold">{t}</h3>
              <p className="text-graphite mt-1 text-sm">{d}</p>
            </li>
          ))}
        </ol>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button asChild size="lg">
            <Link to="/sign-up">Start a trial</Link>
          </Button>
          <span className="text-graphite text-sm">
            Or <Link to="/contact" className="text-primary underline-offset-2 hover:underline">
              talk to us
            </Link>{' '}
            about a project you are running now.
          </span>
        </div>
      </Section>
    </>
  )
}
