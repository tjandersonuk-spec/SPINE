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
| `…_phase1_new_user_trigger.sql` | Creates the `profiles` row when Auth creates a login, and keeps its address in step |

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

### Handing a migration over to be applied

The person applying these is working on Windows with the SQL editor, so every
migration is handed over as a pair, in this order and this shape:

1. A PowerShell line that puts the file on the clipboard:

   ```powershell
   Get-Content supabase\migrations\<file>.sql | Set-Clipboard
   ```

2. What to do with it: **SQL Editor → New query → Ctrl+V → Run**, and what a
   successful result looks like.

3. **Always finish the set with the check.** However many migrations went out,
   the last thing handed over is:

   ```powershell
   Get-Content supabase\check-applied.sql | Set-Clipboard
   ```

   Not optional and not "if you want to be sure". Two migrations from a merged
   PR silently never got applied once, and nothing surfaced it until a page
   failed weeks later — the check is what turns "I think I did those" into an
   answer. Say how many rows to expect, so a short table is obvious.

Copy the SQL into the chat as well only when it is short enough to check by eye.
For anything long — a seed especially — the clipboard is the safer route,
because a data insert that pastes forty rows short looks exactly like one that
worked. Where that risk exists, follow the pair with a count query that proves
it landed whole.

### Which migrations have been applied?

Applying by hand leaves no history table. `check-applied.sql` reads the
catalogue for one object per migration and returns a true/false column, so it is
always answerable:

```sql
-- paste supabase/check-applied.sql into the SQL editor
```

Run whatever still shows false, in the order listed. Every migration is written
to be safe to re-run except the first, which creates tables.

### When the CLI cannot reach the database

`supabase db push` opens a direct PostgreSQL connection on port 5432 (or 6543
for the pooler). Corporate networks commonly block both, and the CLI then hangs
on "Initialising login role...". The dashboard's SQL editor goes over HTTPS and
is unaffected, so:

```bash
npm run db:bundle
```

That writes `supabase/bundle.sql` — every migration, in order, wrapped in a
single transaction. Paste the whole file into the SQL editor and press Run. If
anything fails the transaction rolls back and the database is untouched, so a
failure is safe to read and re-run.

The file is generated on demand and gitignored: the migrations remain the source
of truth and the bundle cannot drift from them.

Note that the CLI will not know these migrations ran, because its history table
lives in the database it could not reach. If you later get onto a network that
allows the connection, tell it with:

```bash
supabase migration repair --status applied <version>
```

for each version, or it will try to apply them a second time.

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


## Making yourself the platform owner

Nothing in the application can grant platform ownership — there is no insert
policy on `platform_owners`, deliberately. The first owner is made once, by
hand, in the dashboard's SQL editor, after signing up through the app:

```sql
insert into platform_owners (profile_id)
select id from profiles where lower(email) = lower('you@example.com');
```

Check it took:

```sql
select p.email from platform_owners o join profiles p on p.id = o.profile_id;
```

Sign out and back in, and the Accounts and People links appear on the landing
page.

## The nightly snapshot job

`snapshots` is the only stored derived table in the product, and it exists for
trend charts alone — no live page reads from it, and `supabase/tests/phase14.test.ts`
scans `pg_proc` to keep it that way.

One row per live project per day. Deploy the function and schedule it:

```bash
supabase functions deploy nightly-snapshots
```

Then in the dashboard, **Integrations → Cron**, add a job that runs a little
after midnight in the project's own timezone:

```sql
select cron.schedule(
  'nightly-snapshots',
  '15 1 * * *',
  $$select net.http_post(
      url    := 'https://<project-ref>.supabase.co/functions/v1/nightly-snapshots',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key', true))
    )$$);
```

`take_daily_snapshots()` is `security definer` and is deliberately **not**
granted to `authenticated`: the job runs with no session and must see every
project, and a snapshot somebody could take by hand is one they could take twice
on a good day and never on a bad one.

Missed a night? The function accepts `{"date":"2026-09-01"}` and
`take_snapshot()` upserts on `(project, date)`, so a backfill or a rerun
replaces rather than duplicating. A job that cannot be safely retried is a job
that eventually leaves a hole in a chart.
