export function CrosshairLogo({ size = 56 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 72 72"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="36" cy="36" r="30" stroke="var(--blue-cold)" strokeWidth="1.5" />
      <circle cx="36" cy="36" r="18" stroke="var(--blue-cold)" strokeWidth="1" opacity="0.6" />
      <circle cx="36" cy="36" r="2.5" fill="var(--blue-cold)" />
      <line x1="36" y1="0" x2="36" y2="14" stroke="var(--blue-cold)" strokeWidth="1.5" />
      <line x1="36" y1="58" x2="36" y2="72" stroke="var(--blue-cold)" strokeWidth="1.5" />
      <line x1="0" y1="36" x2="14" y2="36" stroke="var(--blue-cold)" strokeWidth="1.5" />
      <line x1="58" y1="36" x2="72" y2="36" stroke="var(--blue-cold)" strokeWidth="1.5" />
    </svg>
  );
}
