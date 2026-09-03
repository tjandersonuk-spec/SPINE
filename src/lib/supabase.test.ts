/**
 * The one setup mistake worth absorbing.
 *
 * The Supabase dashboard shows the project address twice: bare in Project
 * Settings, and as the REST endpoint on the API documentation pages. The second
 * is the one on screen while somebody is copying values into Netlify, and
 * pasting it used to produce a deployed site that refused to start.
 */
import { describe, expect, test } from 'vitest'

import { normaliseProjectUrl } from '@/lib/supabase'

describe('the project URL tolerates the form people actually paste', () => {
  test('an endpoint suffix is trimmed rather than rejected', () => {
    for (const given of [
      'https://abcdefghijklm.supabase.co/rest/v1/',
      'https://abcdefghijklm.supabase.co/rest/v1',
      'https://abcdefghijklm.supabase.co/auth/v1/',
      'https://abcdefghijklm.supabase.co/storage/v1',
      'https://abcdefghijklm.supabase.co/',
      '  https://abcdefghijklm.supabase.co  ',
    ]) {
      expect(normaliseProjectUrl(given)).toBe('https://abcdefghijklm.supabase.co')
    }
  })

  test('it fixes one predictable mistake and does not guess at others', () => {
    // A wrong host, a missing scheme or somebody's own domain must still fail
    // the check that follows, with the value they actually typed quoted back.
    expect(normaliseProjectUrl('http://localhost:54321')).toBe('http://localhost:54321')
    expect(normaliseProjectUrl('abcdefghijklm.supabase.co')).toBe('abcdefghijklm.supabase.co')
    expect(normaliseProjectUrl('https://example.com/rest/v1/')).toBe('https://example.com')
    expect(normaliseProjectUrl(undefined)).toBeUndefined()
    expect(normaliseProjectUrl('')).toBe('')
  })

  test('a path that is not an endpoint is left alone', () => {
    // Only the known API prefixes are trimmed. Anything else stays, so it is
    // reported rather than silently turned into something that half works.
    expect(normaliseProjectUrl('https://abcdefghijklm.supabase.co/project/ref'))
      .toBe('https://abcdefghijklm.supabase.co/project/ref')
  })
})
