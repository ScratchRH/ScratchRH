interface LogoMarkProps {
  size?: number;
  className?: string;
}

export function LogoMark({ size = 26, className }: LogoMarkProps) {
  return (
    <svg
      className={className ? `logo-mark ${className}` : "logo-mark"}
      width={size}
      height={size}
      viewBox="0 0 60 60"
      role="img"
      aria-hidden="true"
    >
      <g stroke="var(--accent)" strokeWidth="7" strokeLinecap="round" fill="none">
        <path d="M12 12 L26 48" />
        <path d="M24 8 L38 52" />
        <path d="M36 12 L50 44" />
      </g>
    </svg>
  );
}
