import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { companyInvitations } from "@/db/schema";
import { getAuthContext } from "@/lib/auth";
import { sendTransactionalEmail } from "@/lib/mailer";

const inviteSchema = z.object({
  email: z.string().trim().email("Zadejte platný e-mail."),
  role: z.enum(["owner", "accountant"]).default("accountant"),
});

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });

  const list = await db
    .select()
    .from(companyInvitations)
    .where(eq(companyInvitations.companyId, ctx.activeCompany.id))
    .orderBy(desc(companyInvitations.createdAt));

  return NextResponse.json({ data: list });
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Neplatná pozvánka." },
      { status: 400 },
    );
  }

  const id = crypto.randomUUID();
  const normalizedEmail = parsed.data.email.toLowerCase();
  await db.insert(companyInvitations).values({
    id,
    companyId: ctx.activeCompany.id,
    email: normalizedEmail,
    role: parsed.data.role,
    status: "pending",
    createdAt: new Date().toISOString(),
  });
  const mail = await sendTransactionalEmail({
    to: normalizedEmail,
    subject: `Pozvánka do firmy ${ctx.activeCompany.name} v Manymi`,
    text: `Byli jste pozváni do firmy ${ctx.activeCompany.name} s rolí ${
      parsed.data.role === "owner" ? "vlastník" : "účetní"
    }. Po přihlášení do Manymi pod e-mailem ${normalizedEmail} se vám firma automaticky připojí.`,
    fromName: ctx.activeCompany.name,
  });
  return NextResponse.json({ id, mailStatus: mail.status, detail: mail.detail }, { status: 201 });
}

export async function DELETE(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Chybí id." }, { status: 400 });

  await db
    .delete(companyInvitations)
    .where(and(eq(companyInvitations.id, id), eq(companyInvitations.companyId, ctx.activeCompany.id)));
  return NextResponse.json({ ok: true });
}
