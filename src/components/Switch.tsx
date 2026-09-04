import { useId } from 'react';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export function Switch({ checked, onChange, label, disabled = false, className = '' }: SwitchProps) {
  const id = useId();
  return (
    <label htmlFor={id} className={`inline-flex items-center gap-2.5 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${className}`}>
      <button
        id={id}
        role="switch"
        type="button"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-ring ${
          checked ? 'bg-ui-primary' : 'bg-ui-border-strong'
        }`}
      >
        <span className={`inline-block h-4 w-4 rounded-full bg-ui-surface shadow-sm transition-transform duration-200 ${
          checked ? 'translate-x-[22px]' : 'translate-x-1'
        }`} />
      </button>
      {label && <span className="text-sm font-medium text-ui-text">{label}</span>}
    </label>
  );
}
