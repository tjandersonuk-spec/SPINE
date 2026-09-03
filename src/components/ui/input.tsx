import * as React from "react"

import { cn } from "@/lib/utils"

/** One field treatment, shared with the native select: a faint glass well
 *  that lights at its edge on focus rather than growing a heavy ring. */
export const fieldClass =
  "border-input bg-white/[0.03] placeholder:text-graphite-light flex h-9 w-full min-w-0 rounded-md border px-3 py-1 text-sm shadow-specular transition-[color,box-shadow,border-color] duration-150 outline-none " +
  "focus-visible:border-primary/60 focus-visible:ring-primary/20 focus-visible:ring-[3px] focus-visible:shadow-brand " +
  "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 " +
  "aria-invalid:border-destructive aria-invalid:ring-destructive/20"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        fieldClass,
        "file:text-foreground selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium",
        className
      )}
      {...props}
    />
  )
}

export { Input }
