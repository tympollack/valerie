import Link from "next/link";
import { getCurrentUserContext } from "@/app/actions/auth";
import { getSystemSettings } from "@/app/actions/valerieSettingsActions";
import { AdminSettingsView } from "@/components/valerie/AdminSettingsView";
import { UserNav } from "@/components/valerie/UserNav";
import { ArrowLeft, Sliders, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const [userContext, settingsResult] = await Promise.all([
    getCurrentUserContext().catch(() => null),
    getSystemSettings().catch(() => ({ success: false, data: [] })),
  ]);

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100 selection:bg-cyan-500 selection:text-slate-950">
      {/* Background ambient lighting */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-0 left-1/2 h-[350px] w-[700px] -translate-x-1/2 bg-gradient-to-b from-cyan-500/10 via-cyan-950/20 to-transparent opacity-70 blur-3xl" />
        <div className="absolute right-1/4 bottom-0 h-[300px] w-[400px] bg-teal-500/5 blur-3xl" />
      </div>

      {/* Top Navbar */}
      <header className="sticky top-0 z-40 border-b border-cyan-500/20 bg-slate-950/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1 text-xs font-semibold text-slate-400 transition-colors hover:border-cyan-500/30 hover:text-cyan-300"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to Polls</span>
            </Link>

            <div className="hidden h-4 w-px bg-slate-800 sm:block" />

            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-teal-500 text-sm font-black text-slate-950 shadow-[0_0_12px_rgba(6,182,212,0.4)]">
                V
              </div>
              <span className="hidden text-sm font-bold tracking-tight text-slate-100 sm:inline">
                Project Valerie
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Badge
              variant="outline"
              className="hidden border-cyan-500/40 bg-cyan-950/50 px-2.5 py-1 font-mono text-[11px] text-cyan-300 sm:inline-flex items-center gap-1.5"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-cyan-400" />
              <span>Admin Console</span>
            </Badge>

            <UserNav initialUserContext={userContext ?? undefined} />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative flex flex-1 flex-col items-center justify-start px-4 py-8 sm:py-12">
        <div className="w-full max-w-4xl space-y-8">
          {/* Header */}
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 font-mono text-xs font-semibold tracking-wider text-cyan-400 uppercase">
              <Sliders className="h-3.5 w-3.5" />
              <span>Runtime Tuning &amp; Governor Controls</span>
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-100 sm:text-3xl">
              System Settings &amp; Dynamic Parameters
            </h1>
            <p className="text-xs text-slate-400 sm:text-sm max-w-2xl">
              Tuning panel for commit-and-reveal lock cooldowns, advocate 20-hour labor caps,
              Sovereign Citizen Decree compilation thresholds, and 60/30/10 AI bias Discovery.
            </p>
          </div>

          {/* Interactive Settings View */}
          <AdminSettingsView
            initialSettings={settingsResult.data}
            userContext={userContext}
          />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950/90 py-6 text-center text-xs text-slate-500">
        <p>
          Project Valerie • Dynamic Governance &amp; Operational Threshold Controls.
        </p>
      </footer>
    </div>
  );
}
