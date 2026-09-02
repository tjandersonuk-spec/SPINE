/**
 * Shown instead of the app when it has not been configured. Deliberately plain:
 * it must render with no data, no session and no network, because the whole
 * point is that the connection to Supabase is not working.
 */
export default function SetupNeeded({ problem }: { problem: string }) {
  return (
    <main className="mx-auto flex min-h-svh max-w-xl flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">This copy is not configured yet</h1>
      <p className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm">
        {problem}
      </p>
      <div className="text-muted-foreground flex flex-col gap-3 text-sm">
        <p>
          Running locally: create a file called <code className="font-mono">.env.local</code> in
          the project folder with these two lines, then <strong>restart the dev server</strong> —
          the values are read once at start-up, so a running server will not pick up a new file.
        </p>
        <pre className="bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs">
{`VITE_SUPABASE_URL=https://<your-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your anon key>`}
        </pre>
        <p>
          Both come from your Supabase dashboard under{' '}
          <strong>Project Settings → API Keys</strong>. Use the key labelled{' '}
          <strong>anon / public</strong> — never <strong>service_role</strong>, which bypasses
          every security policy.
        </p>
        <p>
          Deployed on Netlify: set the same two under{' '}
          <strong>Site configuration → Environment variables</strong>, then redeploy. They are
          compiled into the build, so adding them without rebuilding changes nothing.
        </p>
      </div>
    </main>
  )
}
