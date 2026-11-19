'use client';

import { ToggleGroup as TG } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/**
 * Wide tables scroll inside their own region. The region is focusable and named so keyboard users
 * can scroll it too (WCAG 2.1.1, axe scrollable-region-focusable). `relative` keeps absolutely
 * positioned descendants (sr-only text) inside the clip so they cannot widen the page on phones.
 */
export function Table({
  className,
  label = 'Table',
  ...props
}: ComponentProps<'table'> & { label?: string }) {
  return (
    <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label={label}>
      <table className={cn('w-full border-collapse text-left text-sm', className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-semibold tracking-wide text-slate-600 uppercase',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: ComponentProps<'td'>) {
  return (
    <td
      className={cn('border-b border-slate-100 px-3 py-2.5 align-middle text-slate-800', className)}
      {...props}
    />
  );
}

/** Single-choice segmented control (Radix ToggleGroup: arrow-key navigation, aria-pressed state). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <TG.Root
      type="single"
      value={value}
      onValueChange={(next) => next && onChange(next as T)}
      aria-label={label}
      className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 shadow-xs"
    >
      {options.map((option) => (
        <TG.Item
          key={option.value}
          value={option.value}
          className="rounded px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 data-[state=on]:bg-brand-700 data-[state=on]:text-white"
        >
          {option.label}
        </TG.Item>
      ))}
    </TG.Root>
  );
}
