import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The same `@` alias vite.config.ts and tsconfig give the application, so a
  // test imports a module by the path the code under test uses. Without it a
  // client-side test fails to collect at all, which reads as "no tests" rather
  // than as a broken import.
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['supabase/tests/**/*.test.ts', 'src/**/*.test.ts'],
    globalSetup: ['supabase/tests/setup.ts'],
    testTimeout: 20000,
    pool: 'forks',
  },
})
