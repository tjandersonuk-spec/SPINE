/**
 * Two small notes shared by every page. They used to live in the plain Shell,
 * which is gone: there is one shell now, and these are the two pieces of it
 * that every page still wanted.
 */
export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-graphite border-rule rounded-lg border border-dashed px-4 py-8 text-center text-sm">
      {children}
    </p>
  )
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p className="border-stop/40 bg-stop-bg text-stop rounded-md border px-3 py-2 text-sm">
      {message}
    </p>
  )
}
