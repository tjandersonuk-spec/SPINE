# Database

Migrations are the source of truth for the schema. They are applied in filename
order and are written to run unchanged against a hosted Supabase project.

| File | What it holds |
| --- | --- |
| `…_phase1_identity.sql` | Tables: profiles, organisations, catalogue_companies, memberships, projects, account_requests, invitations, platform_audit |
| `…_phase1_functions.sql` | Guards and derived reads (`is_account_admin`, `my_projects`, `module_on`, …) |
| `…_phase1_actions.sql` | Actions that create membership or move an account's lifecycle |
| `…_phase1_rls.sql` | Row Level Security on every table |
| `…_phase1_grants.sql` | Table and column privileges, and the platform owner's amend and project-removal functions |

Filenames are `<timestamp>_<name>.sql`, which is the format the Supabase CLI
expects; it reads the leading digits as the version and applies them in order.

## Applying to Supabase

```bash
supabase link --project-ref <ref>
supabase db push
```

That is the whole of it. The migrations are self-contained and order-dependent
only on each other: the grants migration states the blanket grants itself before
narrowing them, so it produces the same result on a hosted project and on a
plain PostgreSQL, whichever way the database was set up.

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

### RLS decides rows; GRANTs decide columns

The two are separate mechanisms and the second is easy to forget. A policy that
lets an account admin edit their own account row lets them edit *every column of
it* — including `modules`, which is what they are paying you for. `0005` revokes
the blanket update on every table that has an update policy and re-grants only
the columns that role has any business writing. `phase1.test.ts` proves three
escalations are closed: a person changing their own email and then redeeming
somebody else's invitation, an account admin switching on a module, and a
project admin doing the same through `modules_override`.

### One shape to remember when reading the tests

An `insert` or `update` that violates a `with check` clause **raises**. An
`update` or `delete` whose `using` clause matches no row is a **silent no-op**
that reports zero rows affected. The UI must never read "no error" as success —
`phase1.test.ts` asserts both shapes where they apply.
