import { Button } from '@/shared/ui/button'

interface FilterButtonsProps<Value extends string> {
  label: string
  value: Value
  options: readonly { value: Value; label: string }[]
  onChange(value: Value): void
}

/** Single-choice filters retain button semantics and visibly identify the active choice. */
export function FilterButtons<Value extends string>({
  label,
  value,
  options,
  onChange,
}: FilterButtonsProps<Value>) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((option) => (
        <Button
          key={option.value}
          size="sm"
          variant={value === option.value ? 'selection' : 'outline'}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}
