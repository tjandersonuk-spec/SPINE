# Database

Migrations are the source of truth for the schema. They are applied in filename
order and are written to run unchanged against a hosted Supabase project.

| File | What it holds |
| --- | --- |
| `migrations/0001_phase1_identity.sql` | Tables: profiles, organisations, catalogue_companies, memberships, projects, account_requests, invitations, platform_audit |
| `migrations/0002_phase1_functions.sql` | Guards and derived reads (`is_account_admin`, `my_projects`, `module_on`, …) |
| `migrations/0003_phase1_actions.sql` | Actions that create membership or move an account's lifecycle |
| `migrations/0004_phase1_rls.sql` | Row Level Security on every table |

## Applying to Supabase

```bash
supabase link --project-ref <ref>
supabase db push
```

Then apply `tests/grants.sql`, which grants the `authenticated` role the table
and function access the policies then filter.

**Auth settings that are not in these files.** Email confirmation must be
required in the project's Auth settings. The sign-up flow assumes it: a login is
worthless until the address is proved, and the whole invitation model rests on
an address proving control of that address.

## Testing locally

The policies are tested against a real PostgreSQL rather than mocked. The
harness in `tests/local-harness.sql` recreates only what Supabase itself
supplies — the `auth` schema, `auth.uid()` reading the JWT claim GUC, and the
`anon` / `authenticated` roles — so the migrations under `migrations/` are the
same bytes that run in production.

```bash
npm run db:start   # starts a local PostgreSQL on port 5433
npm test           # rebuilds the test database from the migrations, then runs
```

`npm test` drops and recreates the test database on every run, so the suite
never passes because of a leftover row.

Tests connect as the `authenticated` role with `request.jwt.claims` set, exactly
as PostgREST does. That role holds no `BYPASSRLS`, so the policies genuinely
apply — which is the whole point. Seeding uses a superuser connection and is the
only place RLS is bypassed.

### One shape to remember when reading the tests

An `insert` or `update` that violates a `with check` clause **raises**. An
`update` or `delete` whose `using` clause matches no row is a **silent no-op**
that reports zero rows affected. The UI must never read "no error" as success —
`phase1.test.ts` asserts both shapes where they apply.
