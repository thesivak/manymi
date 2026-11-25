import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthContext, switchActiveCompany } from "@/lib/auth";

const switchSchema = z.object({
  companyId: z.string().min(1),
});

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = switchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Chybí ID firmy." }, { status: 400 });
  }

  const ok = await switchActiveCompany(ctx.clerkUserId, parsed.data.companyId);
  if (!ok) {
    return NextResponse.json({ error: "K této firmě nemáte přístup." }, { status: 403 });
  }

  return NextResponse.json({ ok: true });
}
