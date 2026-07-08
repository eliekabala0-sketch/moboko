import { getPdfSubscriptionAccess } from "@/lib/billing/subscriptions";
import { buildSimplePdf } from "@/lib/pdf/simple-pdf";
import { getUserFromApiRequest } from "@/lib/supabase/api-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type RequestedParagraph = {
  slug: string;
  paragraph_number: number;
};

function parseItems(raw: unknown): RequestedParagraph[] {
  if (!raw || typeof raw !== "object") return [];
  const items = (raw as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as RequestedParagraph;
      const slug = typeof row.slug === "string" ? row.slug.trim() : "";
      const n = typeof row.paragraph_number === "number" ? Math.floor(row.paragraph_number) : 0;
      if (!slug || n < 1) return null;
      return { slug, paragraph_number: n };
    })
    .filter((x): x is RequestedParagraph => x !== null)
    .slice(0, 80);
}

export async function POST(request: Request) {
  const admin = createSupabaseServiceClient();
  if (!admin) {
    return NextResponse.json({ error: "service_supabase_manquant" }, { status: 500 });
  }

  const { user, error: authErr } = await getUserFromApiRequest(request);
  if (authErr || !user) return NextResponse.json({ error: "non_authentifie" }, { status: 401 });

  const access = await getPdfSubscriptionAccess(admin, user.id);
  if (!access.active) {
    return NextResponse.json(
      { error: "abonnement_requis", message: "Un abonnement actif est requis pour telecharger le PDF." },
      { status: 402 },
    );
  }

  let items: RequestedParagraph[] = [];
  try {
    items = parseItems(await request.json());
  } catch {
    return NextResponse.json({ error: "json_invalide" }, { status: 400 });
  }
  if (items.length === 0) return NextResponse.json({ error: "paragraphes_requis" }, { status: 400 });

  const sections = [];
  for (const item of items) {
    const { data: sermon } = await admin
      .from("sermons")
      .select("id, slug, title, preached_on, year, location, is_published")
      .eq("slug", item.slug)
      .eq("is_published", true)
      .maybeSingle();
    if (!sermon?.id) continue;
    const { data: paragraph } = await admin
      .from("sermon_paragraphs")
      .select("paragraph_number, paragraph_text")
      .eq("sermon_id", sermon.id)
      .eq("paragraph_number", item.paragraph_number)
      .maybeSingle();
    if (!paragraph?.paragraph_text) continue;
    const meta = [sermon.preached_on, sermon.year, sermon.location].filter(Boolean).join(" - ");
    sections.push({
      title: `${sermon.title} - paragraphe ${paragraph.paragraph_number}${meta ? ` - ${meta}` : ""}`,
      lines: [paragraph.paragraph_text],
    });
  }

  if (sections.length === 0) return NextResponse.json({ error: "paragraphes_introuvables" }, { status: 404 });

  const pdf = buildSimplePdf("Compilation Moboko", sections);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="moboko-compilation.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
