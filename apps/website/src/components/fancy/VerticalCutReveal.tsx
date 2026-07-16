import { type ReactNode } from "react";

interface VerticalCutRevealProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  startAfter?: number;
}

export default function VerticalCutReveal({
  children,
  className,
  delay = 0,
}: VerticalCutRevealProps) {
  return (
    <div className={`overflow-hidden ${className ?? ""}`}>
      <div
        className="vertical-cut-reveal-inner"
        style={
          {
            animation: `vertical-cut-reveal 0.7s ${delay}s cubic-bezier(0.25, 0.1, 0.25, 1) both`,
          } as React.CSSProperties
        }
      >
        {children}
      </div>
    </div>
  );
}

export function StaggerReveal({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={className}>{children}</div>;
}

export function StaggerItem({
  children,
  index = 0,
  className,
}: {
  children: ReactNode;
  index?: number;
  className?: string;
}) {
  return (
    <div className={`overflow-hidden ${className ?? ""}`}>
      <div
        className="vertical-cut-reveal-inner"
        style={
          {
            animation: `vertical-cut-reveal 0.5s ${index * 0.08}s cubic-bezier(0.25, 0.1, 0.25, 1) both`,
          } as React.CSSProperties
        }
      >
        {children}
      </div>
    </div>
  );
}
