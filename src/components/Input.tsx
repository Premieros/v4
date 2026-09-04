import { useId, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, type ReactNode } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className = '', id, ...props }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label htmlFor={inputId} className="text-sm font-medium text-ui-text">{label}</label>}
      <input
        id={inputId}
        className={`rounded-ui border border-ui-border bg-ui-surface-raised px-3.5 py-2.5 text-sm text-ui-text placeholder-ui-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-ring focus-visible:border-ui-border-strong transition-all ${error ? 'border-ui-danger focus-visible:ring-ui-danger' : ''} ${className}`}
        {...props}
      />
      {error && <span className="text-xs text-ui-danger font-medium">{error}</span>}
    </div>
  );
}

interface SelectOption {
  value: string | number;
  label: string;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options?: SelectOption[];
  children?: ReactNode;
}

export function Select({ label, className = '', id, children, options, ...props }: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label htmlFor={selectId} className="text-sm font-medium text-ui-text">{label}</label>}
      <select
        id={selectId}
        className={`rounded-ui border border-ui-border bg-ui-surface-raised px-3.5 py-2.5 text-sm text-ui-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-ring focus-visible:border-ui-border-strong transition-all ${className}`}
        {...props}
      >
        {options
          ? options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))
          : children}
      </select>
    </div>
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

export function Textarea({ label, className = '', id, ...props }: TextareaProps) {
  const generatedId = useId();
  const textareaId = id ?? generatedId;
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label htmlFor={textareaId} className="text-sm font-medium text-ui-text">{label}</label>}
      <textarea
        id={textareaId}
        className={`rounded-ui border border-ui-border bg-ui-surface-raised px-3.5 py-2.5 text-sm text-ui-text placeholder-ui-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-ring focus-visible:border-ui-border-strong transition-all ${className}`}
        {...props}
      />
    </div>
  );
}
