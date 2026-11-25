import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { invoices, paymentAllocations, payments } from "@/db/schema";
import { getAuthContext } from "@/lib/auth";
import { todayIso } from "@/lib/domain/czech";

const bulkSchema = z.object({
  action: z.enum(["mark_paid", "clear_export_flag"]),
  ids: z.array(z.string().min(1)).min(1),
});

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Neplatný hromadný požadavek." }, { status: 400 });
  }

  const rows = await db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.companyId, ctx.activeCompany.id),
        inArray(invoices.id, parsed.data.ids),
      ),
    );

  const now = new Date().toISOString();
  const today = todayIso();

  if (parsed.data.action === "clear_export_flag") {
    await db
      .update(invoices)
      .set({ exportedAt: null, updatedAt: now })
      .where(
        and(
          eq(invoices.companyId, ctx.activeCompany.id),
          inArray(invoices.id, parsed.data.ids),
        ),
      );
    return NextResponse.json({ ok: true, count: rows.length });
  }

  let updatedCount = 0;
  for (const inv of rows) {
    const remaining = Math.max(0, inv.totalMinor - inv.paidMinor);
    if (inv.status !== "issued" || remaining <= 0) continue;
    const payId = crypto.randomUUID();
    await db.insert(payments).values({
      id: payId,
      companyId: ctx.activeCompany.id,
      direction: "in",
      amountMinor: remaining,
      currency: inv.currency,
      paidAt: today,
      method: "bank_transfer",
      variableSymbol: inv.variableSymbol,
      note: "Hromadné označení jako zaplacené",
      createdAt: now,
    });
    await db.insert(paymentAllocations).values({
      id: crypto.randomUUID(),
      paymentId: payId,
      invoiceId: inv.id,
      amountMinor: remaining,
      createdAt: now,
    });
    await db
      .update(invoices)
      .set({ paidMinor: inv.totalMinor, paidAt: today, updatedAt: now })
      .where(eq(invoices.id, inv.id));
    updatedCount += 1;
  }

  return NextResponse.json({ ok: true, count: updatedCount });
}
