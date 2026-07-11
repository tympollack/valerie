import { createClient } from "@/lib/supabase/server";
import { VotingCard } from "@/components/voting/VotingCard";

export default async function Page() {
  const supabase = await createClient();

  const { data: poll } = await supabase
    .schema("valerie")
    .from("polls")
    .select("id, question_text")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!poll) {
    return (
      <main className="flex min-h-svh items-center justify-center p-6">
        <p className="text-muted-foreground">
          No active polls found. Create a poll in the Supabase dashboard to get started.
        </p>
      </main>
    );
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <VotingCard pollId={poll.id} questionText={poll.question_text} />
    </main>
  );
}
