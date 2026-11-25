import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { contacts } from "@/db/schema";
import { getAuthContext } from "@/lib/auth";

const updateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  ico: z.string().trim().optional(),
  dic: z.string().trim().optional(),
  vatPayer: z.boolean().optional(),
  street: z.string().trim().optional(),
  city: z.string().trim().optional(),
  zip: z.string().trim().optional(),
  country: z.string().trim().optional(),
  email: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  web: z.string().trim().optional(),
  defaultDueDays: z.number().int().min(0).max(365).nullable().optional(),
  note: z.string().trim().optional(),
  aresVerifiedAt: z.string().nullable().optional(),
});

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  }
  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Neplatná data kontaktu." },
      { status: 400 },
    );
  }

  const [existing] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.companyId, ctx.activeCompany.id)));
  if (!existing) {
    return NextResponse.json({ error: "Kontakt nenalezen." }, { status: 404 });
  }

  await db
    .update(contacts)
    .set({ ...parsed.data, updatedAt: new Date().toISOString() })
    .where(and(eq(contacts.id, id), eq(contacts.companyId, ctx.activeCompany.id)));

  const [updated] = await db.select().from(contacts).where(eq(contacts.id, id));
  return NextResponse.json({ data: updated });
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  }
  const { id } = await context.params;
  await db
    .delete(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.companyId, ctx.activeCompany.id)));
  return NextResponse.json({ ok: true });
}
