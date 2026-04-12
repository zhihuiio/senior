import * as React from 'react'
import { cn } from '../../lib/utils'

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  onValueChange?: (value: string) => void
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ className, onValueChange, ...props }, ref) => {
  return (
    <select
      ref={ref}
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-background px-2 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      onChange={(event) => {
        onValueChange?.(event.target.value)
      }}
      {...props}
    />
  )
})
Select.displayName = 'Select'

export interface SelectItemProps extends React.OptionHTMLAttributes<HTMLOptionElement> {
  value: string
}

function SelectItem({ children, ...props }: SelectItemProps) {
  return <option {...props}>{children}</option>
}

export { Select, SelectItem }
