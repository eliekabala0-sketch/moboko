import { ChatExperience } from "@/components/chat/ChatExperience";
import { Masthead } from "@/components/layout/Masthead";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

type ChatPageProps = {
  searchParams?: Promise<{ conversationId?: string; payment?: string; status?: string }>;
};

export default async function ChatPage({ searchParams }: ChatPageProps) {
  const sp = searchParams ? await searchParams : {};
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/auth");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth");

  return (
    <div className="flex min-h-full flex-col">
      <Masthead />
      <ChatExperience
        userId={user.id}
        initialConversationId={sp.conversationId ?? null}
        paymentStatus={sp.payment ?? sp.status ?? null}
      />
    </div>
  );
}
