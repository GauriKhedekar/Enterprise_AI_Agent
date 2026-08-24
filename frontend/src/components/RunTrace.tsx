import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { STAGE_LABELS } from "@/lib/types";
import type { CitedEvidence, TraceStage } from "@/lib/types";

const STATUS_DOT: Record<string, string> = {
  ok: "bg-[#34d399]",
  skipped: "bg-[#64748b]",
  failed: "bg-[#f87171]",
  blocked: "bg-[#fbbf24]",
  running: "bg-[#818cf8] animate-pulse",
};

const STATUS_TEXT: Record<string, string> = {
  ok: "text-[#34d399]",
  skipped: "text-[#64748b]",
  failed: "text-[#f87171]",
  blocked: "text-[#fbbf24]",
  running: "text-[#818cf8]",
};

function StageRow({ stage, testId }: { stage: TraceStage; testId: string }) {
  const [open, setOpen] = useState(false);
  const hasOutput = Object.keys(stage.output ?? {}).length > 0;

  return (
    <li className="border-t border-[#1c2230] first:border-t-0" data-testid={testId}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={!hasOutput}
        data-testid={`${testId}-toggle`}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-[#161b26] disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${STATUS_DOT[stage.status] ?? "bg-zinc-600"}`} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-zinc-200">
              {STAGE_LABELS[stage.name] ?? stage.name}
            </span>
            <span className={`font-mono text-[10px] uppercase tracking-widest ${STATUS_TEXT[stage.status] ?? "text-zinc-500"}`}>
              {stage.status}
            </span>
            {stage.latency_ms > 0 ? (
              <span className="font-mono text-[10px] text-zinc-600">{stage.latency_ms}ms</span>
            ) : null}
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
            {stage.summary}
          </span>
        </span>
        {hasOutput ? (
          <ChevronRight
            className={`mt-1 size-3.5 shrink-0 text-zinc-600 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
          />
        ) : null}
      </button>
      {open && hasOutput ? (
        <pre
          className="mx-4 mb-3 max-h-72 overflow-auto rounded-md border border-[#1f2636] bg-[#0a0c12] p-3 font-mono text-[11px] leading-relaxed text-zinc-400"
          data-testid={`${testId}-output`}
        >
          {JSON.stringify(stage.output, null, 2)}
        </pre>
      ) : null}
    </li>
  );
}

interface RunTraceProps {
  trace: TraceStage[];
  citedEvidence: CitedEvidence[];
  reasoning: string;
  latencyMs: number | null;
  idPrefix: string;
}

export default function RunTrace({
  trace,
  citedEvidence,
  reasoning,
  latencyMs,
  idPrefix,
}: RunTraceProps) {
  return (
    <div className="space-y-4">
      {reasoning ? (
        <div className="rounded-lg border border-[#1e2433] bg-[#0e1118] p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Reasoning</p>
          <p className="mt-2 text-xs leading-relaxed text-zinc-300" data-testid={`${idPrefix}-reasoning`}>
            {reasoning}
          </p>
        </div>
      ) : null}

      <div className="rounded-lg border border-[#1e2433] bg-[#0e1118] p-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          Cited evidence ({citedEvidence.length})
        </p>
        {citedEvidence.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground" data-testid={`${idPrefix}-no-evidence`}>
            No citation survived server-side grounding validation.
          </p>
        ) : (
          <ul className="mt-3 space-y-2.5" data-testid={`${idPrefix}-evidence-list`}>
            {citedEvidence.map((c, i) => (
              <li key={i} className="border-l-2 border-primary pl-3">
                <p className="font-mono text-[10px] uppercase tracking-widest text-[#818cf8]">
                  {c.source}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-zinc-300">{c.text}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-[#1c2230] bg-[#11141d]">
        <div className="flex items-center justify-between border-b border-[#1c2230] px-4 py-2.5">
          <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            Pipeline stages
          </p>
          {latencyMs !== null ? (
            <span className="font-mono text-[10px] text-zinc-600">total {latencyMs}ms</span>
          ) : null}
        </div>
        <ul>
          {trace.map((stage, i) => (
            <StageRow key={`${stage.name}-${i}`} stage={stage} testId={`${idPrefix}-stage-${stage.name}`} />
          ))}
        </ul>
      </div>
    </div>
  );
}
