import * as React from 'react'

import { fieldClass } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/** A plain select, styled to match the rest. Nothing here needs a listbox. */
export function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(fieldClass, 'w-auto disabled:cursor-not-allowed', className)}
      {...props}
    />
  )
}
