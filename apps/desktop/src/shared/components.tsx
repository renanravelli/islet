// The shared components of docs/design/ui-spec.md, section 2. Every control is a real
// <button>, <select> or link with a label.

import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./components.css";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "outline" | "text";
};

export function Button({
  variant = "primary",
  className = "",
  type = "button",
  ...rest
}: ButtonProps) {
  return <button type={type} className={`btn btn-${variant} ${className}`} {...rest} />;
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`switch ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="track" aria-hidden="true">
        <span className="knob" />
      </span>
    </button>
  );
}

export function Keycaps({ keys }: { keys: string[] }) {
  return (
    <span className="keycaps">
      {keys.map((k) => (
        <kbd key={k} className="keycap">
          {k}
        </kbd>
      ))}
    </span>
  );
}

export function Group({ children }: { children: ReactNode }) {
  return <div className="group">{children}</div>;
}

export function Row({
  label,
  description,
  leading,
  trailing,
  descriptionTone,
}: {
  label: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  descriptionTone?: "warning";
}) {
  return (
    <div className={`row ${description ? "tall" : ""}`}>
      {leading && <div className="row-leading">{leading}</div>}
      <div className="row-text">
        <div className="row-label">{label}</div>
        {description && (
          <div className={`row-description ${descriptionTone ?? ""}`}>{description}</div>
        )}
      </div>
      {trailing && <div className="row-trailing">{trailing}</div>}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="section-label">{children}</h3>;
}

export function StatusPill({
  tone,
  children,
}: {
  tone: "success" | "warning" | "neutral";
  children: ReactNode;
}) {
  return (
    <span className={`pill pill-${tone}`}>
      <span className="pill-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

export function Badge({ tone, children }: { tone: "experimental"; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function StepIndicator({
  step,
  total,
  label,
}: {
  step: number;
  total: number;
  label: string;
}) {
  return (
    <div className="steps">
      <span className="steps-dots" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed list of dots
          <span key={i} className={`step-dot ${i + 1 === step ? "active" : ""}`} />
        ))}
      </span>
      <span className="steps-text">{label}</span>
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

/** The success circle with a check, or the warning circle. */
export function StatusCircle({ tone, size = 28 }: { tone: "success" | "warning"; size?: number }) {
  return (
    <span
      className={`status-circle ${tone}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {tone === "success" ? <CheckMark size={size * 0.55} /> : <WarnMark size={size * 0.55} />}
    </span>
  );
}

function CheckMark({ size }: { size: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function WarnMark({ size }: { size: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 4l9 16H3ZM12 10v4M12 17.5v.01" />
    </svg>
  );
}
