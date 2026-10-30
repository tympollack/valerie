import { getCurrentUserContext } from "@/app/actions/auth"
import { SettingsView } from "@/components/valerie/SettingsView"
import { Header } from "@/components/nav/Header"
import { Sliders } from "lucide-react"

export const dynamic = "force-dynamic"

export default async function SettingsPage() {
  const userContext = await getCurrentUserContext()

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100 selection:bg-cyan-500 selection:text-slate-950">
      {/* Background ambient cyan glows */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-0 left-1/2 h-[350px] w-[700px] -translate-x-1/2 bg-gradient-to-b from-cyan-500/10 via-cyan-950/20 to-transparent opacity-70 blur-3xl" />
        <div className="absolute right-1/4 bottom-0 h-[300px] w-[400px] bg-teal-500/5 blur-3xl" />
      </div>

      {/* Top Navbar */}
      <Header
        userContext={userContext}
        showBackButton
        backButtonHref="/"
        backButtonLabel="Back to Deliberation"
        activeNav="Settings"
      />

      {/* Main Content Area */}
      <main className="relative flex flex-1 flex-col items-center justify-start px-4 py-8 sm:py-12">
        <div className="w-full max-w-3xl space-y-6">
          {/* Page Heading */}
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 font-mono text-xs font-semibold tracking-wider text-cyan-400 uppercase">
              <Sliders className="h-3.5 w-3.5" />
              <span>The Votary Civic Protocol</span>
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-100 sm:text-3xl">
              Account &amp; Citizen Identity
            </h1>
            <p className="text-xs text-slate-400 sm:text-sm">
              Manage your authenticated SunShade Hub session, verify citizen credentials, or log out.
            </p>
          </div>

          {/* Settings View Component */}
          <SettingsView userContext={userContext} />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950/90 py-6 text-center text-xs text-slate-500">
        <p>
          The Votary · Verified Civic Consensus Platform · votary.app
        </p>
      </footer>
    </div>
  )
}
