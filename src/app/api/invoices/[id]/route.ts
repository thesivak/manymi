import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  invoiceItems,
  invoices,
  paymentAllocations,
  payments,
} from "@/db/schema";
import { getAuthContext } from "@/lib/auth";
import { buildSpayd, czechAccountToIban, extractVariableSymbol } from "@/lib/domain/czech";
import { calculateInvoiceTotals, type PriceType, type VatMode } from "@/lib/domain/money";
import { deriveInvoiceStatus } from "@/lib/domain/invoice-status";

const itemSchema = z.object({
  description: z.string().trim().min(1),
  quantityMilli: z.number().int().positive(),
  unit: z.string().trim().min(1).default("ks"),
  unitPriceMinor: z.number().int().min(0),
  vatRate: z.number().int().refine((v) => v === 0 || v === 12 || v === 21),
});

const patchSchema = z.object({
  action: z.enum(["update", "issue", "cancel", "restore"]).optional().default("update"),
  number: z.string().trim().optional(),
  customer: z
    .object({
      name: z.string().trim().min(1),
      ico: z.string().trim().optional().default(""),
      dic: z.string().trim().optional().default(""),
      vatPayer: z.boolean().optional().default(false),
      street: z.string().trim().optional().default(""),
      city: z.string().trim().optional().default(""),
      zip: z.string().trim().optional().default(""),
      country: z.string().trim().optional().default("Česká republika"),
      email: z.string().trim().optional().default(""),
    })
    .optional(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  duzp: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  paymentMethod: z.enum(["bank_transfer", "cash", "card"]).optional(),
  bankAccountNumber: z.string().trim().optional(),
  bankIban: z.string().trim().optional(),
  bankSwift: z.string().trim().optional(),
  variableSymbol: z.string().trim().optional(),
  constantSymbol: z.string().trim().optional(),
  orderNumber: z.string().trim().optional(),
  discountPercent: z.number().int().min(0).max(100).optional(),
  vatMode: z.enum(["standard", "reverse_charge", "non_vat"]).optional(),
  roundToWhole: z.boolean().optional(),
  showQr: z.boolean().optional(),
  noteBefore: z.string().optional(),
  noteAfter: z.string().optional(),
  items: z.array(itemSchema).min(1).optional(),
});

export async function GET(
  _req: Request,
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

  const [items, allocs] = await Promise.all([
    db
      .select()
      .from(invoiceItems)
      .where(eq(invoiceItems.invoiceId, inv.id))
      .orderBy(asc(invoiceItems.position)),
    db
      .select({
        allocationId: paymentAllocations.id,
        amountMinor: paymentAllocations.amountMinor,
        paymentId: payments.id,
        paidAt: payments.paidAt,
        method: payments.method,
        note: payments.note,
      })
      .from(paymentAllocations)
      .innerJoin(payments, eq(paymentAllocations.paymentId, payments.id))
      .where(eq(paymentAllocations.invoiceId, inv.id)),
  ]);

  return NextResponse.json({
    data: {
      ...inv,
      supplier: JSON.parse(inv.supplierSnapshotJson),
      customer: JSON.parse(inv.customerSnapshotJson),
      bank: JSON.parse(inv.bankSnapshotJson),
      items,
      payments: allocs,
      derivedStatus: deriveInvoiceStatus(inv),
    },
  });
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  }
  const { id } = await context.params;
  const [existing] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.companyId, ctx.activeCompany.id)));
  if (!existing) {
    return NextResponse.json({ error: "Faktura nenalezena." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Neplatná data faktury." },
      { status: 400 },
    );
  }
  const input = parsed.data;
  const now = new Date().toISOString();

  if (input.action === "cancel") {
    await db
      .update(invoices)
      .set({ status: "cancelled", updatedAt: now })
      .where(eq(invoices.id, existing.id));
    return NextResponse.json({ ok: true, status: "cancelled" });
  }

  if (input.action === "restore") {
    await db
      .update(invoices)
      .set({ status: "issued", updatedAt: now })
      .where(eq(invoices.id, existing.id));
    return NextResponse.json({ ok: true, status: "issued" });
  }

  const currentBank = JSON.parse(existing.bankSnapshotJson);
  const nextBank =
    input.bankAccountNumber !== undefined
      ? {
          ...currentBank,
          accountNumber: input.bankAccountNumber,
          iban: input.bankIban || czechAccountToIban(input.bankAccountNumber),
          swift: input.bankSwift ?? currentBank.swift,
        }
      : currentBank;

  const nextNumber = input.number?.trim() || existing.number;
  const nextVatMode = (input.vatMode ?? existing.vatMode) as VatMode;
  const nextPaymentMethod = input.paymentMethod ?? existing.paymentMethod;
  const nextRound =
    nextPaymentMethod === "cash"
      ? true
      : (input.roundToWhole ?? existing.roundToWhole);
  const nextDiscount = input.discountPercent ?? existing.discountPercent;
  const nextShowQr = input.showQr ?? existing.showQr;
  const nextDueDate = input.dueDate ?? existing.dueDate;
  const nextVs =
    input.variableSymbol !== undefined
      ? input.variableSymbol || extractVariableSymbol(nextNumber)
      : existing.variableSymbol;
  const nextKs = input.constantSymbol ?? existing.constantSymbol;

  const currentItems = input.items
    ? input.items
    : await db
        .select()
        .from(invoiceItems)
        .where(eq(invoiceItems.invoiceId, existing.id))
        .orderBy(asc(invoiceItems.position));

  const totals = calculateInvoiceTotals({
    items: currentItems.map((it) => ({
      quantityMilli: it.quantityMilli,
      unitPriceMinor: it.unitPriceMinor,
      vatRate: it.vatRate,
      priceType: (existing.priceType === "with_vat" ? "with_vat" : "without_vat") as PriceType,
    })),
    vatMode: nextVatMode,
    roundToWhole: nextRound,
    discountPercent: nextDiscount,
    priceType: (existing.priceType === "with_vat" ? "with_vat" : "without_vat") as PriceType,
    proformaDeductionMinor: existing.proformaDeductionMinor,
  });

  const spaydString =
    nextShowQr && nextBank.iban && totals.totalMinor > 0
      ? buildSpayd({
          iban: nextBank.iban,
          amountMinor: totals.totalMinor,
          currency: existing.currency,
          dueDate: nextDueDate,
          variableSymbol: nextVs,
          constantSymbol: nextKs,
          message: `Faktura ${nextNumber}`,
        })
      : "";

  const nextStatus =
    input.action === "issue" ? "issued" : existing.status;

  await db
    .update(invoices)
    .set({
      number: nextNumber,
      status: nextStatus,
      issueDate: input.issueDate ?? existing.issueDate,
      duzp: input.duzp ?? existing.duzp,
      dueDate: nextDueDate,
      paymentMethod: nextPaymentMethod,
      variableSymbol: nextVs,
      constantSymbol: nextKs,
      orderNumber: input.orderNumber ?? existing.orderNumber,
      discountPercent: nextDiscount,
      vatMode: nextVatMode,
      roundToWhole: nextRound,
      showQr: nextShowQr,
      noteBefore: input.noteBefore ?? existing.noteBefore,
      noteAfter: input.noteAfter ?? existing.noteAfter,
      customerSnapshotJson: input.customer
        ? JSON.stringify(input.customer)
        : existing.customerSnapshotJson,
      bankSnapshotJson: JSON.stringify(nextBank),
      subtotalMinor: totals.subtotalMinor,
      vatTotalMinor: totals.vatTotalMinor,
      roundingMinor: totals.roundingMinor,
      totalMinor: totals.totalMinor,
      spaydString,
      issuedAt:
        nextStatus === "issued" && !existing.issuedAt ? now : existing.issuedAt,
      updatedAt: now,
    })
    .where(eq(invoices.id, existing.id));

  if (input.items) {
    await db.delete(invoiceItems).where(eq(invoiceItems.invoiceId, existing.id));
    for (let i = 0; i < input.items.length; i++) {
      const it = input.items[i];
      const calc = totals.items[i];
      await db.insert(invoiceItems).values({
        id: crypto.randomUUID(),
        invoiceId: existing.id,
        position: i,
        description: it.description,
        quantityMilli: it.quantityMilli,
        unit: it.unit,
        unitPriceMinor: it.unitPriceMinor,
        vatRate: calc.effectiveVatRate,
        subtotalMinor: calc.subtotalMinor,
        vatMinor: calc.vatMinor,
        totalMinor: calc.totalMinor,
      });
    }
  }

  return NextResponse.json({ ok: true, id: existing.id, status: nextStatus });
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
  const [existing] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.companyId, ctx.activeCompany.id)));
  if (!existing) {
    return NextResponse.json({ error: "Faktura nenalezena." }, { status: 404 });
  }
  if (existing.status !== "draft") {
    return NextResponse.json(
      { error: "Vystavenou fakturu nelze smazat — použijte storno." },
      { status: 400 },
    );
  }
  await db.delete(invoices).where(eq(invoices.id, existing.id));
  return NextResponse.json({ ok: true });
}
