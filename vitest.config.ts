import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['supabase/tests/**/*.test.ts', 'src/**/*.test.ts'],
    globalSetup: ['supabase/tests/setup.ts'],
    testTimeout: 20000,
    pool: 'forks',
  },
})
