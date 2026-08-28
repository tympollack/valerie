import { createClient } from "@/lib/supabase/server";
import { BivariatePollCard } from "@/components/valerie/BivariatePollCard";
import { Sparkles, Shield, Compass, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function Page() {
  let pollId = "demo-poll-01";
  let questionText =
    "The municipal council should convert Main Street into a [[pedestrian-only zone]] to boost [[community sentiment]] and local commerce.";

  try {
    const supabase = await createClient();
    const { data: poll } = await supabase
      .schema("valerie")
      .from("polls")
      .select("id, question_text")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (poll) {
      pollId = poll.id;
      questionText = poll.question_text;
    }
  } catch {
    // Graceful fallback to default demo poll
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-cyan-500 selection:text-slate-950">
      {/* Background ambient cyan glows */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[350px] bg-gradient-to-b from-cyan-500/10 via-cyan-950/20 to-transparent blur-3xl opacity-70" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[300px] bg-teal-500/5 blur-3xl" />
      </div>

      {/* Top Navbar */}
      <header className="sticky top-0 z-40 border-b border-cyan-500/20 bg-slate-950/80 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-teal-500 text-slate-950 font-black shadow-[0_0_15px_rgba(6,182,212,0.4)]">
              V
            </div>
            <div>
              <span className="font-bold text-base tracking-tight text-slate-100">
                Project Valerie
              </span>
              <span className="ml-2 text-[10px] uppercase font-mono tracking-widest text-cyan-400 font-semibold px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-500/30">
                SunShade
              </span>
            </div>
          </div>

          {/* Badges / Status */}
          <div className="flex items-center gap-3 text-xs">
            <div className="hidden sm:flex items-center gap-1.5 text-slate-400">
              <Shield className="h-3.5 w-3.5 text-cyan-400" />
              <span>Anti-Bandwagoning</span>
            </div>
            <Badge
              variant="outline"
              className="border-cyan-500/40 bg-cyan-950/50 text-cyan-300 font-mono text-[11px] px-2.5 py-0.5"
            >
              SHA-256 AI Active
            </Badge>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="relative flex-1 flex flex-col items-center justify-center px-4 py-10 sm:py-14">
        <div className="w-full max-w-2xl space-y-6">
          {/* Hero Tagline */}
          <div className="text-center space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-cyan-500/30 bg-cyan-950/40 text-cyan-300 text-xs font-semibold shadow-[0_0_15px_rgba(6,182,212,0.15)]">
              <Compass className="h-3.5 w-3.5 text-cyan-400" />
              <span>Bivariate Civic Deliberation &amp; Sealed Commit Protocol</span>
            </div>
          </div>

          {/* Primary Bivariate Poll Card */}
          <BivariatePollCard
            pollId={pollId}
            questionText={questionText}
            category="Civic Transit & Urban Space"
          />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950/90 py-6 text-center text-xs text-slate-500">
        <p>
          Project Valerie • Dual-axis Likert (-2 to +2) &amp; Confidence (0% to 100%) bivariate architecture with real-time SHA-256 caching.
        </p>
      </footer>
    </div>
  );
}
