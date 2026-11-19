export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 font-semibold text-slate-900">
      <svg aria-hidden="true" viewBox="0 0 32 32" className="size-8">
        <rect width="32" height="32" rx="8" className="fill-brand-700" />
        <path
          d="M9 22l7-13 7 13M12.5 17h7"
          fill="none"
          stroke="white"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {compact ? <span className="sr-only">ACME People</span> : <span>ACME People</span>}
    </span>
  );
}
