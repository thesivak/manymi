import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { cashRegisters, cashVouchers, payments } from "@/db/schema";
import { getAuthContext } from "@/lib/auth";
import { todayIso } from "@/lib/domain/czech";

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });

  let registers = await db
    .select()
    .from(cashRegisters)
    .where(eq(cashRegisters.companyId, ctx.activeCompany.id))
    .orderBy(asc(cashRegisters.createdAt));

  if (registers.length === 0) {
    const id = crypto.randomUUID();
    await db.insert(cashRegisters).values({
      id,
      companyId: ctx.activeCompany.id,
      name: "Hlavní pokladna CZK",
      currency: "CZK",
      initialBalanceMinor: 0,
      isDefault: true,
      createdAt: new Date().toISOString(),
    });
    registers = await db
      .select()
      .from(cashRegisters)
      .where(eq(cashRegisters.companyId, ctx.activeCompany.id));
  }

  const [vouchers, allPayments] = await Promise.all([
    db
      .select()
      .from(cashVouchers)
      .where(eq(cashVouchers.companyId, ctx.activeCompany.id))
      .orderBy(desc(cashVouchers.issuedAt), desc(cashVouchers.createdAt)),
    db
      .select()
      .from(payments)
      .where(eq(payments.companyId, ctx.activeCompany.id))
      .orderBy(desc(payments.paidAt), desc(payments.createdAt)),
  ]);

  const balanceByReg = new Map<string, number>();
  for (const r of registers) balanceByReg.set(r.id, r.initialBalanceMinor);
  for (const v of vouchers) {
    const cur = balanceByReg.get(v.cashRegisterId) ?? 0;
    balanceByReg.set(
      v.cashRegisterId,
      v.direction === "in" ? cur + v.amountMinor : cur - v.amountMinor,
    );
  }

  return NextResponse.json({
    registers: registers.map((r) => ({
      ...r,
      currentBalanceMinor: balanceByReg.get(r.id) ?? r.initialBalanceMinor,
    })),
    vouchers,
    payments: allPayments,
  });
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });

  const now = new Date().toISOString();
  const today = todayIso();

  if (body.kind === "add_register") {
    const name = String(body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "Zadejte název pokladny." }, { status: 400 });
    const id = crypto.randomUUID();
    await db.insert(cashRegisters).values({
      id,
      companyId: ctx.activeCompany.id,
      name,
      currency: String(body.currency ?? "CZK"),
      initialBalanceMinor: Number(body.initialBalanceMinor) || 0,
      isDefault: false,
      createdAt: now,
    });
    return NextResponse.json({ id }, { status: 201 });
  }

  const registerId = String(body.cashRegisterId ?? "");
  const direction = body.direction === "out" ? "out" : "in";
  const amountMinor = Math.max(1, Number(body.amountMinor) || 0);
  if (!registerId || amountMinor <= 0) {
    return NextResponse.json({ error: "Vyberte pokladnu a zadejte kladnou částku." }, { status: 400 });
  }

  const existing = await db
    .select({ id: cashVouchers.id })
    .from(cashVouchers)
    .where(eq(cashVouchers.companyId, ctx.activeCompany.id));
  const prefix = direction === "in" ? "PPD-" : "VPD-";
  const number = `${prefix}${today.slice(0, 4)}-${String(existing.length + 1).padStart(4, "0")}`;
  const id = crypto.randomUUID();

  await db.insert(cashVouchers).values({
    id,
    companyId: ctx.activeCompany.id,
    cashRegisterId: registerId,
    number,
    direction,
    amountMinor,
    currency: String(body.currency ?? "CZK"),
    issuedAt: typeof body.issuedAt === "string" && body.issuedAt ? body.issuedAt : today,
    counterpartyName: String(body.counterpartyName ?? "").trim(),
    description: String(body.description ?? "").trim() || (direction === "in" ? "Příjmový pokladní doklad" : "Výdajový pokladní doklad"),
    createdAt: now,
  });

  return NextResponse.json({ id, number }, { status: 201 });
}

export async function DELETE(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Chybí id." }, { status: 400 });

  await db
    .delete(cashVouchers)
    .where(and(eq(cashVouchers.id, id), eq(cashVouchers.companyId, ctx.activeCompany.id)));
  return NextResponse.json({ ok: true });
}
