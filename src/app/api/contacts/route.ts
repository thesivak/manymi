import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { eq, asc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { contacts, invoices } from "@/db/schema";
import { getAuthContext } from "@/lib/auth";

const contactSchema = z.object({
  name: z.string().trim().min(1, "Vyplňte název odběratele."),
  ico: z.string().trim().optional().default(""),
  dic: z.string().trim().optional().default(""),
  vatPayer: z.boolean().optional().default(false),
  street: z.string().trim().optional().default(""),
  city: z.string().trim().optional().default(""),
  zip: z.string().trim().optional().default(""),
  country: z.string().trim().optional().default("Česká republika"),
  email: z.string().trim().optional().default(""),
  phone: z.string().trim().optional().default(""),
  web: z.string().trim().optional().default(""),
  defaultDueDays: z.number().int().min(0).max(365).nullable().optional(),
  note: z.string().trim().optional().default(""),
  aresVerifiedAt: z.string().nullable().optional(),
});

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  }

  const [list, companyInvoices] = await Promise.all([
    db
      .select()
      .from(contacts)
      .where(eq(contacts.companyId, ctx.activeCompany.id))
      .orderBy(asc(contacts.name)),
    db
      .select({
        contactId: invoices.contactId,
        status: invoices.status,
        totalMinor: invoices.totalMinor,
        paidMinor: invoices.paidMinor,
      })
      .from(invoices)
      .where(eq(invoices.companyId, ctx.activeCompany.id)),
  ]);

  const statsMap = new Map<
    string,
    { invoiceCount: number; turnoverMinor: number; unpaidMinor: number }
  >();
  for (const inv of companyInvoices) {
    if (!inv.contactId || inv.status === "cancelled" || inv.status === "draft") continue;
    const prev = statsMap.get(inv.contactId) ?? {
      invoiceCount: 0,
      turnoverMinor: 0,
      unpaidMinor: 0,
    };
    prev.invoiceCount += 1;
    prev.turnoverMinor += inv.totalMinor;
    prev.unpaidMinor += Math.max(0, inv.totalMinor - inv.paidMinor);
    statsMap.set(inv.contactId, prev);
  }

  return NextResponse.json({
    data: list.map((c) => ({
      ...c,
      stats: statsMap.get(c.id) ?? {
        invoiceCount: 0,
        turnoverMinor: 0,
        unpaidMinor: 0,
      },
    })),
  });
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = contactSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Neplatná data kontaktu." },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const d = parsed.data;

  await db.insert(contacts).values({
    id,
    companyId: ctx.activeCompany.id,
    name: d.name,
    ico: d.ico,
    dic: d.dic,
    vatPayer: d.vatPayer,
    street: d.street,
    city: d.city,
    zip: d.zip,
    country: d.country,
    email: d.email,
    phone: d.phone,
    web: d.web,
    defaultDueDays: d.defaultDueDays ?? null,
    note: d.note,
    aresVerifiedAt: d.aresVerifiedAt ?? null,
    createdAt: now,
    updatedAt: now,
  });

  const [created] = await db.select().from(contacts).where(eq(contacts.id, id));
  return NextResponse.json({ data: created }, { status: 201 });
}
