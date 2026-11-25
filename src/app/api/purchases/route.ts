import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { payments, purchases } from "@/db/schema";
import { getAuthContext } from "@/lib/auth";
import { todayIso } from "@/lib/domain/czech";
import { calculateInvoiceTotals, type VatMode } from "@/lib/domain/money";

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  const docType = new URL(req.url).searchParams.get("docType");

  const list = await db
    .select()
    .from(purchases)
    .where(
      docType
        ? and(eq(purchases.companyId, ctx.activeCompany.id), eq(purchases.docType, docType))
        : eq(purchases.companyId, ctx.activeCompany.id),
    )
    .orderBy(desc(purchases.issueDate), desc(purchases.createdAt));

  return NextResponse.json({
    data: list.map((p) => ({
      ...p,
      supplier: JSON.parse(p.supplierSnapshotJson),
      items: JSON.parse(p.itemsJson),
    })),
  });
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Neplatná data dokladu." }, { status: 400 });

  const today = todayIso();
  const now = new Date().toISOString();
  const docType = body.docType === "receipt" ? "receipt" : "received_invoice";
  const supplier = (body.supplier ?? {}) as Record<string, string>;
  const supplierName = (supplier.name ?? "").trim();
  if (!supplierName) {
    return NextResponse.json({ error: "Vyplňte dodavatele." }, { status: 400 });
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items =
    rawItems.length > 0
      ? rawItems.map((raw) => {
          const it = raw as Record<string, unknown>;
          return {
            description: String(it.description ?? body.description ?? "Nákup").trim(),
            quantityMilli: Math.max(1, Number(it.quantityMilli) || 1000),
            unit: String(it.unit ?? "ks"),
            unitPriceMinor: Math.max(0, Number(it.unitPriceMinor) || 0),
            vatRate: Number(it.vatRate) === 0 || Number(it.vatRate) === 12 ? Number(it.vatRate) : 21,
          };
        })
      : [
          {
            description: String(body.description ?? "Nákup"),
            quantityMilli: 1000,
            unit: "ks",
            unitPriceMinor: Math.max(0, Number(body.unitPriceMinor) || 0),
            vatRate: Number(body.vatRate ?? 21),
          },
        ];

  const vatMode = (body.vatMode as VatMode) || "standard";
  const totals = calculateInvoiceTotals({ items, vatMode, roundToWhole: false });

  const existing = await db
    .select({ id: purchases.id })
    .from(purchases)
    .where(eq(purchases.companyId, ctx.activeCompany.id));
  const prefix = docType === "receipt" ? "UC-" : "PF-";
  const number =
    typeof body.number === "string" && body.number.trim()
      ? body.number.trim()
      : `${prefix}${today.slice(0, 4)}-${String(existing.length + 1).padStart(4, "0")}`;

  const paid = docType === "receipt" || Boolean(body.paid);
  const id = crypto.randomUUID();
  const issueDate =
    typeof body.issueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.issueDate)
      ? body.issueDate
      : today;
  const dueDate =
    typeof body.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)
      ? body.dueDate
      : issueDate;

  await db.insert(purchases).values({
    id,
    companyId: ctx.activeCompany.id,
    docType,
    number,
    externalNumber: typeof body.externalNumber === "string" ? body.externalNumber.trim() : "",
    supplierId: typeof body.supplierId === "string" ? body.supplierId : null,
    supplierSnapshotJson: JSON.stringify({
      name: supplierName,
      ico: supplier.ico ?? "",
      dic: supplier.dic ?? "",
      street: supplier.street ?? "",
      city: supplier.city ?? "",
      zip: supplier.zip ?? "",
    }),
    description: typeof body.description === "string" ? body.description.trim() : items[0].description,
    receivedDate: today,
    issueDate,
    duzp: typeof body.duzp === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.duzp) ? body.duzp : issueDate,
    dueDate,
    variableSymbol: typeof body.variableSymbol === "string" ? body.variableSymbol.trim() : "",
    paymentMethod: typeof body.paymentMethod === "string" ? body.paymentMethod : docType === "receipt" ? "card" : "bank_transfer",
    currency: typeof body.currency === "string" ? body.currency : "CZK",
    vatMode,
    subtotalMinor: totals.subtotalMinor,
    vatTotalMinor: totals.vatTotalMinor,
    totalMinor: totals.totalMinor,
    paidMinor: paid ? totals.totalMinor : 0,
    paidAt: paid ? issueDate : null,
    itemsJson: JSON.stringify(items),
    note: typeof body.note === "string" ? body.note : "",
    createdAt: now,
    updatedAt: now,
  });

  if (paid && totals.totalMinor > 0) {
    await db.insert(payments).values({
      id: crypto.randomUUID(),
      companyId: ctx.activeCompany.id,
      direction: "out",
      amountMinor: totals.totalMinor,
      currency: typeof body.currency === "string" ? body.currency : "CZK",
      paidAt: issueDate,
      method: docType === "receipt" ? "card" : "bank_transfer",
      variableSymbol: typeof body.variableSymbol === "string" ? body.variableSymbol.trim() : "",
      note: `Úhrada nákupu ${number} (${supplierName})`,
      createdAt: now,
    });
  }

  return NextResponse.json({ id, number }, { status: 201 });
}

export async function PATCH(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as {
    id?: string;
    action?: string;
    amountMinor?: number;
  } | null;
  if (!body?.id) return NextResponse.json({ error: "Chybí id dokladu." }, { status: 400 });

  const [p] = await db
    .select()
    .from(purchases)
    .where(and(eq(purchases.id, body.id), eq(purchases.companyId, ctx.activeCompany.id)));
  if (!p) return NextResponse.json({ error: "Doklad nenalezen." }, { status: 404 });

  if (body.action === "mark_paid") {
    const remaining = Math.max(0, p.totalMinor - p.paidMinor);
    const amount = body.amountMinor && body.amountMinor > 0 ? body.amountMinor : remaining;
    const today = todayIso();
    const now = new Date().toISOString();
    const nextPaid = p.paidMinor + amount;
    await db
      .update(purchases)
      .set({ paidMinor: nextPaid, paidAt: today, updatedAt: now })
      .where(eq(purchases.id, p.id));

    if (amount > 0) {
      await db.insert(payments).values({
        id: crypto.randomUUID(),
        companyId: ctx.activeCompany.id,
        direction: "out",
        amountMinor: amount,
        currency: p.currency,
        paidAt: today,
        method: p.paymentMethod,
        variableSymbol: p.variableSymbol,
        note: `Úhrada přijatého dokladu ${p.number}`,
        createdAt: now,
      });
    }
    return NextResponse.json({ ok: true, paidMinor: nextPaid });
  }

  return NextResponse.json({ error: "Neznámá akce." }, { status: 400 });
}

export async function DELETE(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Chybí id." }, { status: 400 });

  await db
    .delete(purchases)
    .where(and(eq(purchases.id, id), eq(purchases.companyId, ctx.activeCompany.id)));
  return NextResponse.json({ ok: true });
}
