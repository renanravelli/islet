// Stroke icons (2 px, round caps and joins), drawn for Islet. Decorative unless labelled.

import type { ReactNode } from "react";

function Icon({ size = 20, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

type P = { size?: number };

export const MicIcon = ({ size }: P) => (
  <Icon size={size}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Icon>
);
export const MicOffIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M15 9.5V6a3 3 0 0 0-5.8-1M9 9v2a3 3 0 0 0 5.1 2.1M5 11a7 7 0 0 0 11.8 5.1M19 11a7 7 0 0 1-.4 2.3M12 18v3M3 3l18 18" />
  </Icon>
);
export const CamIcon = ({ size }: P) => (
  <Icon size={size}>
    <rect x="2" y="6" width="14" height="12" rx="2" />
    <path d="M16 10l6-3v10l-6-3" />
  </Icon>
);
export const CamOffIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M10 6h4a2 2 0 0 1 2 2v4M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2M16 10l6-3v10l-4-2M3 3l18 18" />
  </Icon>
);
export const HandIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M8 13V5a1.5 1.5 0 0 1 3 0v6M11 10V3.5a1.5 1.5 0 0 1 3 0V10M14 10V5a1.5 1.5 0 0 1 3 0v8c0 4-2.5 8-7 8-3 0-4.5-1.5-6-4l-1.5-3a1.5 1.5 0 0 1 2.6-1.5L8 15" />
  </Icon>
);
export const TabIcon = ({ size }: P) => (
  <Icon size={size}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9h18M13 13l3 3M16 13v3h-3" />
  </Icon>
);
export const LeaveIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M3 15c5-5 13-5 18 0l-2.5 2.5-3-1.5v-3a12 12 0 0 0-7 0v3l-3 1.5Z" />
  </Icon>
);
export const ChevronUpIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M6 15l6-6 6 6" />
  </Icon>
);
export const CheckIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);
export const WarningIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M12 3l9.5 17h-19ZM12 10v4M12 17.5v.01" />
  </Icon>
);
export const InfoIcon = ({ size }: P) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8v.01" />
  </Icon>
);
export const LockIcon = ({ size }: P) => (
  <Icon size={size}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Icon>
);
export const VideoIcon = ({ size }: P) => <CamIcon size={size} />;
export const SlidersIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  </Icon>
);
export const PillIcon = ({ size }: P) => (
  <Icon size={size}>
    <rect x="3" y="8" width="18" height="8" rx="4" />
  </Icon>
);
export const PlugIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0ZM12 17v4" />
  </Icon>
);
export const PersonIcon = ({ size }: P) => (
  <Icon size={size}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </Icon>
);
