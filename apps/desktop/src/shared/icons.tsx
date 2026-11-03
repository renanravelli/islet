// Stroke icons (2 px, round caps and joins), as drawn in the approved canvas. Decorative unless labelled.

import type { ReactNode } from "react";

function Icon({
  size = 20,
  stroke = 2,
  children,
}: {
  size?: number;
  stroke?: number;
  children: ReactNode;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

type P = { size?: number; stroke?: number };

export const MicIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <path d="M12 19v3" />
  </Icon>
);
export const MicOffIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <path d="M12 19v3" />
    <path d="M3 3l18 18" />
  </Icon>
);
export const CamIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M16 13l5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.75-.43L16 10.5" />
    <rect x="2" y="6" width="14" height="12" rx="2" />
  </Icon>
);
export const CamOffIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M16 13l5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.75-.43L16 10.5" />
    <rect x="2" y="6" width="14" height="12" rx="2" />
    <path d="M2 2l20 20" />
  </Icon>
);
export const HandIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M18 11V6a2 2 0 0 0-4 0" />
    <path d="M14 10V4a2 2 0 0 0-4 0v2" />
    <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
  </Icon>
);
export const TabIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </Icon>
);
export const LeaveIcon = ({ size }: P) => (
  <Icon size={size}>
    <g transform="rotate(135 12 12)">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </g>
  </Icon>
);
export const ChevronUpIcon = ({ size, stroke }: P) => (
  <Icon size={size} stroke={stroke}>
    <path d="M18 15l-6-6-6 6" />
  </Icon>
);
export const CheckIcon = ({ size, stroke }: P) => (
  <Icon size={size} stroke={stroke}>
    <path d="M20 6 9 17l-5-5" />
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
