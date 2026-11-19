import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-brand-700 text-white shadow-sm hover:bg-brand-800',
        secondary: 'border border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-50',
        ghost: 'text-slate-700 hover:bg-slate-100',
        danger: 'bg-red-700 text-white shadow-sm hover:bg-red-800',
        link: 'text-brand-700 underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3',
        md: 'h-10 px-4',
        // 44px touch target on coarse pointers (WCAG 2.5.8 target size).
        icon: 'size-10 pointer-coarse:size-11',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  pending?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild,
  pending,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot.Root : 'button';
  return (
    <Component
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={asChild ? undefined : disabled || pending}
      aria-busy={pending || undefined}
      {...props}
    >
      {children}
    </Component>
  );
}
