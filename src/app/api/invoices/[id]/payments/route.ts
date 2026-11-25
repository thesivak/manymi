import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { invoices, paymentAllocations, payments } from "@/db/schema";
import { getAuthContext } from "@/lib/auth";
import { todayIso } from "@/lib/domain/czech";

const createPaymentSchema = z.object({
  amountMinor: z.number().int().positive("Částka úhrady musí být kladná."),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  method: z.enum(["bank_transfer", "cash", "card"]).default("bank_transfer"),
  note: z.string().trim().optional().default(""),
});

async function recomputeInvoicePaid(invoiceId: string) {
  const allocs = await db
    .select({
      amountMinor: paymentAllocations.amountMinor,
      paidAt: payments.paidAt,
    })
    .from(paymentAllocations)
    .innerJoin(payments, eq(paymentAllocations.paymentId, payments.id))
    .where(eq(paymentAllocations.invoiceId, invoiceId));

  const paidMinor = allocs.reduce((acc, a) => acc + a.amountMinor, 0);
  const latestPaidAt =
    allocs.length > 0
      ? allocs
          .map((a) => a.paidAt)
          .sort()
          .at(-1) ?? null
      : null;

  await db
    .update(invoices)
    .set({
      paidMinor,
      paidAt: paidMinor > 0 ? latestPaidAt : null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(invoices.id, invoiceId));

  return { paidMinor, paidAt: latestPaidAt };
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  }

  const { id } = await context.params;
  const [inv] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.companyId, ctx.activeCompany.id)));
  if (!inv) {
    return NextResponse.json({ error: "Faktura nenalezena." }, { status: 404 });
  }
  if (inv.status !== "issued") {
    return NextResponse.json(
      { error: "Úhradu lze zapsat pouze k vystavené faktuře." },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = createPaymentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Neplatná data úhrady." },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const paymentId = crypto.randomUUID();
  const paidAt = parsed.data.paidAt ?? todayIso();

  await db.insert(payments).values({
    id: paymentId,
    companyId: ctx.activeCompany.id,
    amountMinor: parsed.data.amountMinor,
    currency: inv.currency,
    paidAt,
    method: parsed.data.method,
    variableSymbol: inv.variableSymbol,
    note: parsed.data.note,
    createdAt: now,
  });

  await db.insert(paymentAllocations).values({
    id: crypto.randomUUID(),
    paymentId,
    invoiceId: inv.id,
    amountMinor: parsed.data.amountMinor,
    createdAt: now,
  });

  const summary = await recomputeInvoicePaid(inv.id);
  return NextResponse.json({ ok: true, paymentId, ...summary }, { status: 201 });
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  }
  const { id } = await context.params;
  const url = new URL(req.url);
  const paymentId = url.searchParams.get("paymentId");
  if (!paymentId) {
    return NextResponse.json({ error: "Chybí paymentId." }, { status: 400 });
  }

  const [inv] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.companyId, ctx.activeCompany.id)));
  if (!inv) {
    return NextResponse.json({ error: "Faktura nenalezena." }, { status: 404 });
  }

  await db
    .delete(payments)
    .where(
      and(eq(payments.id, paymentId), eq(payments.companyId, ctx.activeCompany.id)),
    );

  const summary = await recomputeInvoicePaid(inv.id);
  return NextResponse.json({ ok: true, ...summary });
}
