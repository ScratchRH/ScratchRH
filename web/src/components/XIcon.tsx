interface XIconProps {
  size?: number;
  className?: string;
}

export function XIcon({ size = 18, className }: XIconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M18.9 2H22l-7.6 8.7L23 22h-6.9l-5.4-6.9L4.3 22H1.2l8.1-9.3L1 2h7l4.9 6.3L18.9 2Zm-2.4 18h1.9L7.6 4H5.6l10.9 16Z"
      />
    </svg>
  );
}
