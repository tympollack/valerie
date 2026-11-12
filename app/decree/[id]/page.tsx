import { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { compileDecreeDossierData } from "@/lib/services/decreeDossierService";
import { DecreePublicView } from "@/components/decree/DecreePublicView";
import { Header } from "@/components/nav/Header";
import { getCurrentUserContext } from "@/app/actions/auth";

export const dynamic = "force-dynamic";

interface DecreePageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ embed?: string }>;
}

export async function generateMetadata({ params }: DecreePageProps): Promise<Metadata> {
  const { id } = await params;
  const oembedUrl = `https://valerie.sunshade.icu/api/v1/oembed/decree?url=https://valerie.sunshade.icu/decree/${id}`;

  return {
    title: `Sovereign Citizen Decree · Audit Dossier ${id.slice(0, 8)}`,
    description: "Tamper-evident sovereign citizen consensus decree, parcel zoning proofs, and certified landowner dossier.",
    alternates: {
      types: {
        "application/json+oembed": oembedUrl,
      },
    },
  };
}

export default async function DecreePage({ params, searchParams }: DecreePageProps) {
  const { id } = await params;
  const { embed } = (await searchParams) ?? {};
  const isCompactEmbed = embed === "badge" || embed === "1";

  const supabase = await createClient();
  const dossier = await compileDecreeDossierData(supabase, id);

  if (!dossier) {
    notFound();
  }

  if (isCompactEmbed) {
    return (
      <div className="min-h-screen bg-transparent text-zinc-900 dark:text-zinc-100 flex items-center justify-center p-2">
        <DecreePublicView dossier={dossier} compact />
      </div>
    );
  }

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

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black text-zinc-900 dark:text-zinc-100 flex flex-col">
      <Header userContext={userContext} />
      <main className="flex-1 py-6">
        <DecreePublicView dossier={dossier} />
      </main>
    </div>
  );
}
