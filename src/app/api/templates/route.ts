import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { invoiceTemplates } from "@/db/schema";
import { getAuthContext } from "@/lib/auth";

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });

  const list = await db
    .select()
    .from(invoiceTemplates)
    .where(eq(invoiceTemplates.companyId, ctx.activeCompany.id))
    .orderBy(desc(invoiceTemplates.createdAt));

  return NextResponse.json({ data: list });
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Zadejte název šablony." }, { status: 400 });

  const id = crypto.randomUUID();
  await db.insert(invoiceTemplates).values({
    id,
    companyId: ctx.activeCompany.id,
    name,
    docType: typeof body?.docType === "string" ? body.docType : "invoice",
    contactId: typeof body?.contactId === "string" ? body.contactId : null,
    customerSnapshotJson: JSON.stringify(body?.customer ?? {}),
    description: typeof body?.description === "string" ? body.description : "",
    dueDays: Number(body?.dueDays) || ctx.activeCompany.defaultDueDays,
    paymentMethod: typeof body?.paymentMethod === "string" ? body.paymentMethod : "bank_transfer",
    currency: typeof body?.currency === "string" ? body.currency : "CZK",
    vatMode: typeof body?.vatMode === "string" ? body.vatMode : "standard",
    priceType: typeof body?.priceType === "string" ? body.priceType : "without_vat",
    discountPercent: Number(body?.discountPercent) || 0,
    itemsJson: JSON.stringify(body?.items ?? []),
    noteBefore: typeof body?.noteBefore === "string" ? body.noteBefore : "",
    noteAfter: typeof body?.noteAfter === "string" ? body.noteAfter : "",
    createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ id }, { status: 201 });
}

export async function DELETE(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Chybí id." }, { status: 400 });

  await db
    .delete(invoiceTemplates)
    .where(and(eq(invoiceTemplates.id, id), eq(invoiceTemplates.companyId, ctx.activeCompany.id)));
  return NextResponse.json({ ok: true });
}
