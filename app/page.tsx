import { createClient } from "@/lib/supabase/server"
import { getCurrentUserContext } from "@/app/actions/auth"
import { Header } from "@/components/nav/Header"
import { BivariatePollCard } from "@/components/valerie/BivariatePollCard"
import { Compass } from "lucide-react"

export const dynamic = "force-dynamic"

export default async function Page() {
  let userContext
  try {
    userContext = await getCurrentUserContext()
  } catch {
    userContext = {
      authenticated: false,
      userId: null,
      email: null,
      displayName: null,
      isHumanVerified: false,
      verificationTier: "UNVERIFIED" as const,
      trustState: "active" as const,
    }
  }
  let activePoll: {
    id: string
    question_text: string
    axis_category?: string | null
    detected_locales?: string[] | null
    target_locale_code?: string | null
    related_ecosystem_refs?: Record<string, unknown> | null
  } | null = null
  let historicalZScore: number | null = null
  let historicalBaseline: { mean: number; stddev: number } | null = null

  try {
    const supabase = await createClient()
    const { data: poll } = await supabase
      .schema("valerie")
      .from("polls")
      .select("id, question_text, axis_category, detected_locales, target_locale_code, related_ecosystem_refs")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (poll) {
      activePoll = poll
    }

    if (userContext.authenticated && userContext.userId) {
      const { data: metrics } = await supabase
        .schema("valerie")
        .rpc("calculate_user_stance_metrics", {
          p_user_id: userContext.userId,
          p_confidence: 75,
        })
      if (
        Array.isArray(metrics) &&
        metrics.length > 0 &&
        typeof metrics[0].z_score === "number"
      ) {
        historicalZScore = metrics[0].z_score
        if (
          typeof metrics[0].historical_mean === "number" &&
          typeof metrics[0].historical_stddev === "number"
        ) {
          historicalBaseline = {
            mean: metrics[0].historical_mean,
            stddev: metrics[0].historical_stddev,
          }
        }
      }
    }
  } catch {
    activePoll = null
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100 selection:bg-cyan-500 selection:text-slate-950">
      {/* Background ambient cyan glows */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-0 left-1/2 h-[350px] w-[700px] -translate-x-1/2 bg-gradient-to-b from-cyan-500/10 via-cyan-950/20 to-transparent opacity-70 blur-3xl" />
        <div className="absolute right-1/4 bottom-0 h-[300px] w-[400px] bg-teal-500/5 blur-3xl" />
      </div>

      {/* Top Navbar */}
      <Header userContext={userContext} activeNav="Deliberation" />

      {/* Main Content Area */}
      <main className="relative flex flex-1 flex-col items-center justify-center px-4 py-10 sm:py-14">
        <div className="w-full max-w-2xl space-y-6">
          {/* Hero Tagline */}
          <div className="space-y-2 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-950/40 px-3 py-1 text-xs font-semibold text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.15)]">
              <Compass className="h-3.5 w-3.5 text-cyan-400" />
              <span>
                The Votary • Sealed Bivariate Deliberation &amp; Consensus
              </span>
            </div>
          </div>

          {/* Primary Bivariate Poll Card or Empty State */}
          {activePoll ? (
            <BivariatePollCard
              pollId={activePoll.id}
              questionText={activePoll.question_text}
              category={activePoll.axis_category || "Civic Deliberation & Policy"}
              relatedEcosystemRefs={activePoll.related_ecosystem_refs}
              detectedLocales={activePoll.detected_locales ?? undefined}
              targetLocaleCode={activePoll.target_locale_code ?? undefined}
              historicalZScore={historicalZScore}
              historicalBaseline={historicalBaseline}
            />
          ) : (
            <div className="rounded-2xl border border-slate-800/80 bg-slate-950/80 p-8 text-center backdrop-blur-xl space-y-4 shadow-[0_0_25px_rgba(6,182,212,0.05)]">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-500/30 bg-cyan-950/50 text-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.15)]">
                <Compass className="h-6 w-6" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-bold text-slate-100">
                  No Active Civic Polls
                </h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                  There are currently no active civic polls open for deliberation. New propositions are dynamically published by the autonomous news pipeline as controversial civic topics break.
                </p>
              </div>
              <div className="pt-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-cyan-400/80">
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
                  Awaiting autonomous herald ingest
                </span>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950/90 py-6 text-center text-xs text-slate-500">
        <p>
          The Votary • Powered by Project Valerie • Dual-axis Likert (-2 to +2) &amp; Confidence (0% to
          100%) bivariate architecture with real-time SHA-256 caching.
        </p>
      </footer>
    </div>
  )
}
