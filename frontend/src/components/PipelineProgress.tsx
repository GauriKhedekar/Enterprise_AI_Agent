import { PIPELINE_ORDER, STAGE_LABELS } from "@/lib/types";
import type { TraceStage } from "@/lib/types";

const DOT: Record<string, string> = {
  ok: "bg-[#34d399]",
  skipped: "bg-[#64748b]",
  failed: "bg-[#f87171]",
  blocked: "bg-[#fbbf24]",
};

/** Real progress: stages already persisted by the backend, plus the one currently running. */
export default function PipelineProgress({
  active,
  trace,
}: {
  active: boolean;
  trace: TraceStage[];
}) {
  if (!active) return null;

  const doneNames = new Set(trace.map((s) => s.name));
  const remaining = PIPELINE_ORDER.filter((n) => !doneNames.has(n));
  const current = remaining[0];

  return (
    <div
      className="animate-rise mt-6 rounded-lg border border-[#1e2433] bg-[#0e1118] p-4"
      data-testid="pipeline-progress"
    >
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          Running compliance pipeline
        </p>
        <span className="font-mono text-[10px] text-zinc-600">
          {trace.length}/{PIPELINE_ORDER.length}
        </span>
      </div>
      <ul className="mt-3 space-y-2">
        {trace.map((s, i) => (
          <li
            key={`${s.name}-${i}`}
            className="flex items-start gap-2.5 text-xs"
            data-testid={`progress-stage-${s.name}`}
          >
            <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${DOT[s.status] ?? "bg-zinc-600"}`} />
            <span className="min-w-0 flex-1">
              <span className="text-zinc-300">{STAGE_LABELS[s.name] ?? s.name}</span>
              <span className="ml-2 font-mono text-[10px] text-zinc-600">{s.latency_ms}ms</span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-zinc-500">
                {s.summary}
              </span>
            </span>
          </li>
        ))}
        {current ? (
          <li className="flex items-center gap-2.5 text-xs" data-testid="progress-current-stage">
            <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-[#818cf8]" />
            <span className="text-zinc-300">{STAGE_LABELS[current] ?? current}</span>
            <span className="font-mono text-[10px] text-[#818cf8]">working…</span>
          </li>
        ) : null}
        {remaining.slice(1).map((n) => (
          <li key={n} className="flex items-center gap-2.5 text-xs">
            <span className="size-1.5 shrink-0 rounded-full bg-zinc-700" />
            <span className="text-zinc-600">{STAGE_LABELS[n] ?? n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
