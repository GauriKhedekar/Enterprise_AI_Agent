import type { ReactNode } from "react";

interface AuthLayoutProps {
  eyebrow: string;
  headline: string;
  blurb: string;
  bullets: string[];
  children: ReactNode;
}

export default function AuthLayout({ eyebrow, headline, blurb, bullets, children }: AuthLayoutProps) {
  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden overflow-hidden border-r border-[#1c2230] bg-[#0e1118] lg:block">
        <img
          src="https://images.pexels.com/photos/7827838/pexels-photo-7827838.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"
          alt=""
          className="absolute inset-0 size-full object-cover opacity-[0.15]"
        />
        <div className="absolute inset-0 bg-gradient-to-tr from-[#0b0d13] via-[#0b0d13]/70 to-transparent" />
        <div className="relative flex h-full flex-col justify-between p-14">
          <div className="flex items-center gap-2.5">
            <span className="size-2 rounded-full bg-primary shadow-[0_0_10px_2px_rgba(79,70,229,0.6)]" />
            <span className="font-heading text-sm font-semibold tracking-tight text-white">
              Adaptive Enterprise Agent
            </span>
          </div>
          <div className="max-w-md">
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#818cf8]">{eyebrow}</p>
            <h2 className="mt-4 text-4xl font-semibold leading-[1.1] text-white">{headline}</h2>
            <p className="mt-5 text-sm leading-relaxed text-zinc-400">{blurb}</p>
            <ul className="mt-8 space-y-3">
              {bullets.map((b) => (
                <li key={b} className="flex gap-3 text-sm text-zinc-300">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                  {b}
                </li>
              ))}
            </ul>
          </div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
            Tenant-isolated · Encrypted credentials
          </p>
        </div>
      </div>

      <div className="flex items-center justify-center px-6 py-14">
        <div className="animate-rise w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
