import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { emailLogs } from "@/db/schema";
import { getAuthContext } from "@/lib/auth";

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });

  const list = await db
    .select()
    .from(emailLogs)
    .where(eq(emailLogs.companyId, ctx.activeCompany.id))
    .orderBy(desc(emailLogs.sentAt));

  return NextResponse.json({ data: list });
}
