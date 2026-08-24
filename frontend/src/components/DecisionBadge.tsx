import { Badge } from "@/components/ui/badge";
import type { Decision } from "@/lib/types";

const STYLES: Record<Decision, string> = {
  ALLOW: "border-[#0f5f4a] bg-[#10b98122] text-[#34d399]",
  DENY: "border-[#5f1f1f] bg-[#f8717122] text-[#f87171]",
  NOT_ELIGIBLE: "border-[#3d3011] bg-[#f59e0b22] text-[#fbbf24]",
  INSUFFICIENT_INFO: "border-[#2c3348] bg-[#94a3b81f] text-[#cbd5e1]",
  BLOCKED: "border-[#3f2740] bg-[#a855f722] text-[#d8b4fe]",
};

const LABELS: Record<Decision, string> = {
  ALLOW: "Allowed",
  DENY: "Denied",
  NOT_ELIGIBLE: "Not eligible",
  INSUFFICIENT_INFO: "Insufficient info",
  BLOCKED: "Off-topic / blocked",
};

export default function DecisionBadge({
  decision,
  testId,
}: {
  decision: Decision | null;
  testId: string;
}) {
  const key: Decision = decision ?? "INSUFFICIENT_INFO";
  return (
    <Badge
      variant="outline"
      data-testid={testId}
      data-decision={key}
      className={`font-mono text-[11px] tracking-tight ${STYLES[key]}`}
    >
      <span className="mr-1.5 inline-block size-1.5 rounded-full bg-current" />
      {LABELS[key]}
    </Badge>
  );
}
