import type { CSSProperties } from 'react';

interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
  lines?: number;
}

function SkeletonLine({ className = '', width, height }: { className?: string; width?: string | number; height?: string | number }) {
  const style: CSSProperties = {};
  if (width) style.width = typeof width === 'number' ? `${width}px` : width;
  if (height) style.height = typeof height === 'number' ? `${height}px` : height;
  return <div className={`animate-pulse rounded-lg bg-ui-page-alt ${className}`} style={style} />;
}

export function Skeleton({ className = '', variant = 'text', width, height, lines }: SkeletonProps) {
  if (variant === 'circular') {
    return <SkeletonLine className={`rounded-full ${className}`} width={width ?? 40} height={height ?? 40} />;
  }
  if (variant === 'rectangular') {
    return <SkeletonLine className={`rounded-xl ${className}`} width={width} height={height ?? 200} />;
  }
  if (lines && lines > 1) {
    return (
      <div className={`space-y-2 ${className}`}>
        {Array.from({ length: lines }).map((_, i) => (
          <SkeletonLine key={i} width={i === lines - 1 ? '60%' : '100%'} height={14} />
        ))}
      </div>
    );
  }
  return <SkeletonLine className={className} width={width} height={height ?? 14} />;
}

export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`rounded-2xl border border-ui-border bg-ui-surface p-5 space-y-3 ${className}`}>
      <Skeleton variant="circular" width={44} height={44} />
      <Skeleton width="60%" height={16} />
      <Skeleton lines={2} />
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4, className = '' }: { rows?: number; cols?: number; className?: string }) {
  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex gap-4">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} width="100%" height={12} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} width={c === 0 ? '40%' : '100%'} height={14} />
          ))}
        </div>
      ))}
    </div>
  );
}
