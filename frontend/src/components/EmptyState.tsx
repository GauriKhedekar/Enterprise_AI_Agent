import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  testId: string;
}

export default function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  testId,
}: EmptyStateProps) {
  return (
    <div
      data-testid={testId}
      className="animate-rise flex flex-col items-center rounded-xl border border-dashed border-[#232b3d] bg-[#0c0f16] px-6 py-16 text-center"
    >
      <div className="mb-4 flex size-11 items-center justify-center rounded-lg bg-[#1e2235] text-[#c7d2fe]">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-white/95">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
      {actionLabel && onAction ? (
        <Button
          className="mt-6 active:scale-[0.98] transition-transform duration-100"
          onClick={onAction}
          data-testid={`${testId}-action`}
        >
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
