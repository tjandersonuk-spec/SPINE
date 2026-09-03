import { useState } from 'react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import { fieldClass } from '@/components/ui/input'
import { Panel } from '@/components/ui/panel'
import { Section } from '@/pages/marketing/Layout'

/**
 * Contact.
 *
 * No form handler yet — sending mail is Phase 16, and a form that silently
 * discards what somebody typed is worse than no form. So this composes a real
 * mailto with what they wrote, which works today and stops working the day
 * there is somewhere better to send it.
 */
const TO = 'hello@spine.example'

export default function MarketingContact() {
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [message, setMessage] = useState('')

  const href =
    `mailto:${TO}?subject=${encodeURIComponent(`Spine enquiry — ${company || name || 'a project'}`)}`
    + `&body=${encodeURIComponent(`${message}\n\n— ${name}${company ? `, ${company}` : ''}`)}`

  return (
    <Section
      eyebrow="Contact"
      title="Tell us about a job you are running now."
      lead="The useful conversation is about a real project — its stage, who is appointed, what
            is going wrong. We would rather look at that than give you a demonstration of
            somebody else’s."
    >
      <div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
        <Panel title="Send us a note" className="mb-0">
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-graphite text-xs">Your name</span>
              <input className={fieldClass} value={name}
                onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-graphite text-xs">Company</span>
              <input className={fieldClass} value={company}
                onChange={(e) => setCompany(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-graphite text-xs">What are you working on?</span>
              <textarea
                className={fieldClass + ' h-28 py-2'}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </label>
            <Button asChild disabled={!message.trim()} className="self-start">
              <a href={message.trim() ? href : undefined}>Open in your mail client</a>
            </Button>
            <p className="text-graphite-light text-xs">
              This opens your own mail client with the message in it, so nothing you type is
              held here and nothing is sent without you seeing it. Or write to{' '}
              <a className="text-primary underline-offset-2 hover:underline" href={`mailto:${TO}`}>
                {TO}
              </a>
              .
            </p>
          </div>
        </Panel>

        <div className="flex flex-col gap-5">
          <Panel title="Already have a login?" className="mb-0">
            <p className="text-graphite text-sm">
              Sign in and everything waiting for you — an invitation to an account, a project
              you have been added to — is on the first page.
            </p>
            <Button asChild variant="outline" className="mt-3">
              <Link to="/sign-in">Sign in</Link>
            </Button>
          </Panel>
          <Panel title="Want to look around first?" className="mb-0">
            <p className="text-graphite text-sm">
              Sign up, confirm your address and ask for an account. Once it is approved you
              can fill a project with a full worked example in one click and click through
              the whole product before putting a real job in it.
            </p>
            <Button asChild className="mt-3">
              <Link to="/sign-up">Start a trial</Link>
            </Button>
          </Panel>
        </div>
      </div>
    </Section>
  )
}
