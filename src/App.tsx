import { useState } from 'react'
import { Moon, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function App() {
  const [count, setCount] = useState(0)
  const [dark, setDark] = useState(false)

  const toggleTheme = () => {
    setDark((prev) => {
      document.documentElement.classList.toggle('dark', !prev)
      return !prev
    })
  }

  return (
    <main className="bg-background text-foreground flex min-h-svh flex-col items-center justify-center gap-6 p-6">
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleTheme}
        aria-label="Toggle theme"
        className="absolute top-4 right-4"
      >
        {dark ? <Sun /> : <Moon />}
      </Button>

      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Vite + React + shadcn/ui</CardTitle>
          <CardDescription>
            Tailwind CSS v4 and TypeScript, ready to build on.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" placeholder="Ada Lovelace" />
          </div>
          <p className="text-muted-foreground text-sm">
            Edit <code className="font-mono">src/App.tsx</code> and save to test HMR.
          </p>
        </CardContent>
        <CardFooter className="flex gap-2">
          <Button onClick={() => setCount((c) => c + 1)}>Count is {count}</Button>
          <Button variant="outline" onClick={() => setCount(0)}>
            Reset
          </Button>
        </CardFooter>
      </Card>
    </main>
  )
}

export default App
