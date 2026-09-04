import { type ButtonHTMLAttributes, type ReactNode, useRef, type MouseEvent } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline' | 'success' | 'warning';
type Size = 'sm' | 'md' | 'lg' | 'xl';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
  ripple?: boolean;
}

const variants: Record<Variant, string> = {
  primary: 'bg-ui-primary hover:bg-ui-primary-hover text-ui-primary-fg shadow-ui-sm ring-1 ring-ui-border-strong active:bg-ui-primary-active',
  secondary: 'bg-ui-page-alt hover:bg-ui-primary-soft text-ui-text',
  danger: 'bg-ui-danger hover:bg-ui-danger-hover text-white shadow-ui-sm active:bg-ui-danger-active',
  ghost: 'hover:bg-ui-page-alt text-ui-text',
  outline: 'border border-ui-border-strong hover:bg-ui-page-alt text-ui-text',
  success: 'bg-ui-success hover:bg-ui-success-hover text-white shadow-ui-sm active:bg-ui-success-active',
  warning: 'bg-ui-warning hover:bg-ui-warning-hover text-white shadow-ui-sm active:bg-ui-warning-active',
};

const sizes: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm rounded-ui',
  md: 'px-4 py-2 text-sm rounded-ui-lg',
  lg: 'px-6 py-3 text-base rounded-ui-lg',
  xl: 'px-8 py-4 text-lg rounded-ui-xl',
};

export function Button({ variant = 'primary', size = 'md', children, className = '', ripple = true, type = 'button', onClick, ...props }: ButtonProps) {
  const btnRef = useRef<HTMLButtonElement>(null);

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (ripple && btnRef.current) {
      const btn = btnRef.current;
      const rect = btn.getBoundingClientRect();
      const circle = document.createElement('span');
      const diameter = Math.max(btn.clientWidth, btn.clientHeight);
      const radius = diameter / 2;
      circle.style.width = circle.style.height = `${diameter}px`;
      circle.style.left = `${e.clientX - rect.left - radius}px`;
      circle.style.top = `${e.clientY - rect.top - radius}px`;
      circle.className = 'absolute rounded-full bg-white/30 pointer-events-none animate-ripple';
      btn.appendChild(circle);
      setTimeout(() => circle.remove(), 600);
    }
    onClick?.(e);
  };

  return (
    <button
      ref={btnRef}
      type={type}
      className={`relative overflow-hidden inline-flex items-center justify-center gap-2 font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-ring focus-visible:ring-offset-1 focus-visible:ring-offset-ui-page disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
      onClick={handleClick}
      {...props}
    >
      {children}
    </button>
  );
}
