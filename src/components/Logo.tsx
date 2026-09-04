import { type ReactNode } from 'react';

const NAVY = '#0F172A';
const GOLD = '#D4AF37';
const WHITE = '#FFFFFF';

export type LogoTone = 'navy' | 'white' | 'mono' | 'auto';
export type LogoVariant = 'mark' | 'horizontal' | 'vertical';

interface LogoProps {
  size?: number;
  variant?: LogoVariant;
  showTagline?: boolean;
  tone?: LogoTone;
  tagline?: string;
  className?: string;
}

function Mark({ stem, bowl, arrow, size }: { stem: string; bowl: string; arrow: string; size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="4.75" y="3" width="4.5" height="18" rx="2.25" fill={stem} />
      <path
        d="M9.25 4.5 A 6 6 0 0 1 9.25 16.5"
        stroke={bowl}
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <path d="M14.6 2.8 L17.4 2.8 L16 6.6 Z" fill={arrow} />
    </svg>
  );
}

export function Logo({
  size = 32,
  variant = 'mark',
  showTagline = true,
  tone = 'navy',
  tagline = 'Business Management Platform',
  className = '',
}: LogoProps) {
  const stem = tone === 'navy' ? NAVY : tone === 'white' ? WHITE : 'currentColor';
  const bowl = tone === 'mono' ? 'currentColor' : GOLD;
  const arrow = tone === 'mono' ? 'currentColor' : GOLD;
  const textCls =
    tone === 'white'
      ? 'text-white'
      : tone === 'mono'
        ? 'text-current'
        : 'text-ui-text';

  const mark = <Mark stem={stem} bowl={bowl} arrow={arrow} size={size} />;

  const textBlock = (
    <div className="flex flex-col" dir="ltr">
      <span
        className={`font-bold tracking-tight leading-none ${textCls}`}
        style={{ fontSize: Math.round(size * 0.42) }}
      >
        Premier
      </span>
      {showTagline && (
        <span
          className="uppercase tracking-[0.16em] text-ui-subtle mt-1 leading-none"
          style={{ fontSize: Math.max(8, Math.round(size * 0.125)) }}
        >
          {tagline}
        </span>
      )}
    </div>
  );

  let content: ReactNode;
  if (variant === 'mark') {
    content = <div className={className}>{mark}</div>;
  } else if (variant === 'horizontal') {
    content = (
      <div className={`flex items-center gap-3 ${className}`} dir="ltr">
        {mark}
        {textBlock}
      </div>
    );
  } else {
    content = (
      <div className={`flex flex-col items-center gap-2 ${className}`} dir="ltr">
        {mark}
        {textBlock}
      </div>
    );
  }

  return <>{content}</>;
}
