import { createClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/app/actions/auth";
import { Header } from "@/components/nav/Header";
import { BivariatePollCard } from "@/components/valerie/BivariatePollCard";
import { Compass, AlertCircle } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function PollPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let userContext;
  try {
    userContext = await getCurrentUserContext();
  } catch {
    userContext = {
      authenticated: false,
      userId: null,
      email: null,
      displayName: null,
      isHumanVerified: false,
      verificationTier: "UNVERIFIED" as const,
      trustState: "active" as const,
    };
  }

  let activePoll: {
    id: string;
    question_text: string;
    axis_category?: string | null;
    detected_locales?: string[] | null;
    target_locale_code?: string | null;
    related_ecosystem_refs?: Record<string, unknown> | null;
  } | null = null;
  let historicalZScore: number | null = null;
  let historicalBaseline: { mean: number; stddev: number } | null = null;

  try {
    const supabase = await createClient();
    const { data: poll } = await supabase
      .schema("valerie")
      .from("polls")
      .select(
        "id, question_text, axis_category, detected_locales, target_locale_code, related_ecosystem_refs"
      )
      .eq("id", id)
      .maybeSingle();

    if (poll) {
      activePoll = poll;
    }

    if (userContext.authenticated && userContext.userId) {
      const { data: metrics } = await supabase
        .schema("valerie")
        .rpc("calculate_user_stance_metrics", {
          p_user_id: userContext.userId,
          p_confidence: 75,
        });
      if (
        Array.isArray(metrics) &&
        metrics.length > 0 &&
        typeof metrics[0].z_score === "number"
      ) {
        historicalZScore = metrics[0].z_score;
        if (
          typeof metrics[0].historical_mean === "number" &&
          typeof metrics[0].historical_stddev === "number"
        ) {
          historicalBaseline = {
            mean: metrics[0].historical_mean,
            stddev: metrics[0].historical_stddev,
          };
        }
      }
    }
  } catch {
    activePoll = null;
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100 selection:bg-cyan-500 selection:text-slate-950">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-0 left-1/2 h-[350px] w-[700px] -translate-x-1/2 bg-gradient-to-b from-cyan-500/10 via-cyan-950/20 to-transparent opacity-70 blur-3xl" />
        <div className="absolute right-1/4 bottom-0 h-[300px] w-[400px] bg-teal-500/5 blur-3xl" />
      </div>

      <Header userContext={userContext} activeNav="Deliberation" />

      <main className="relative flex flex-1 flex-col items-center justify-center px-4 py-10 sm:py-14">
        <div className="w-full max-w-2xl space-y-6">
          <div className="space-y-2 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-950/40 px-3 py-1 text-xs font-semibold text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.15)]">
              <Compass className="h-3.5 w-3.5 text-cyan-400" />
              <span>
                The Votary &bull; Sealed Bivariate Deliberation &amp; Consensus
              </span>
            </div>
          </div>

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
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center text-slate-400 backdrop-blur-md">
              <AlertCircle className="mx-auto mb-3 h-8 w-8 text-amber-400" />
              <p className="text-base font-semibold text-slate-200">
                Poll Not Found
              </p>
              <p className="mt-1 text-sm text-slate-400">
                This deliberation item is either unavailable or has concluded.
              </p>
              <div className="mt-5">
                <Link
                  href="/"
                  className="inline-flex items-center rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-cyan-500"
                >
                  View Active Polls
                </Link>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
