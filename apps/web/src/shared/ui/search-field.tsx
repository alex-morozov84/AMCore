'use client'

import { type RefObject, useRef } from 'react'
import { Search, X } from 'lucide-react'

import { cn } from '@/shared/lib/utils'

import { Button } from './button'
import { Input } from './input'
import { Label } from './label'

export interface SearchFieldProps {
  id: string
  name: string
  value: string
  onValueChange: (value: string) => void
  onClear: () => void
  label: string
  placeholder: string
  clearLabel: string
  maxLength?: number
  className?: string
}

interface SearchTextInputProps extends Pick<
  SearchFieldProps,
  'id' | 'name' | 'value' | 'onValueChange' | 'placeholder' | 'maxLength'
> {
  inputRef: RefObject<HTMLInputElement | null>
}

function SearchFieldLabel({ id, label }: Pick<SearchFieldProps, 'id' | 'label'>) {
  return (
    <>
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-foreground-muted"
      />
    </>
  )
}

function SearchTextInput(props: SearchTextInputProps) {
  const { inputRef, id, name, value, onValueChange, placeholder, maxLength } = props
  return (
    <Input
      ref={inputRef}
      id={id}
      name={name}
      type="text"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      className="pr-8 pl-8"
      autoComplete="off"
    />
  )
}

function SearchClearButton({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={onClear}
      className="absolute top-1/2 right-1 -translate-y-1/2"
    >
      <X aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </Button>
  )
}

export function SearchField(props: SearchFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  function handleClear() {
    props.onClear()
    inputRef.current?.focus()
  }

  return (
    <div className={cn('relative flex-1', props.className)}>
      <SearchFieldLabel id={props.id} label={props.label} />
      <SearchTextInput
        inputRef={inputRef}
        id={props.id}
        name={props.name}
        value={props.value}
        onValueChange={props.onValueChange}
        placeholder={props.placeholder}
        maxLength={props.maxLength}
      />
      {props.value && <SearchClearButton label={props.clearLabel} onClear={handleClear} />}
    </div>
  )
}
