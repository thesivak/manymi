import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  bankAccounts,
  bankTransactions,
  invoices,
  paymentAllocations,
  payments,
  purchases,
} from "@/db/schema";
import { getAuthContext } from "@/lib/auth";
import { parseBankCsvStatement } from "@/lib/domain/bank-and-inbox";
import { todayIso } from "@/lib/domain/czech";

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });

  const [txs, accounts, openInvoices, openPurchases] = await Promise.all([
    db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.companyId, ctx.activeCompany.id))
      .orderBy(desc(bankTransactions.bookedAt), desc(bankTransactions.createdAt)),
    db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.companyId, ctx.activeCompany.id)),
    db
      .select()
      .from(invoices)
      .where(and(eq(invoices.companyId, ctx.activeCompany.id), eq(invoices.status, "issued"))),
    db
      .select()
      .from(purchases)
      .where(eq(purchases.companyId, ctx.activeCompany.id)),
  ]);

  return NextResponse.json({
    transactions: txs,
    bankAccounts: accounts,
    unpaidInvoices: openInvoices
      .filter((i) => i.totalMinor > i.paidMinor)
      .map((i) => ({
        id: i.id,
        number: i.number,
        variableSymbol: i.variableSymbol,
        remainingMinor: i.totalMinor - i.paidMinor,
        customerName: (JSON.parse(i.customerSnapshotJson) as { name?: string }).name ?? "",
      })),
    unpaidPurchases: openPurchases
      .filter((p) => p.totalMinor > p.paidMinor)
      .map((p) => ({
        id: p.id,
        number: p.number,
        variableSymbol: p.variableSymbol,
        remainingMinor: p.totalMinor - p.paidMinor,
        supplierName: (JSON.parse(p.supplierSnapshotJson) as { name?: string }).name ?? "",
      })),
  });
}

async function pairTransactionWithInvoice(
  companyId: string,
  tx: typeof bankTransactions.$inferSelect,
  inv: typeof invoices.$inferSelect,
) {
  const now = new Date().toISOString();
  const payId = crypto.randomUUID();
  const allocAmount = Math.min(tx.amountMinor, Math.max(0, inv.totalMinor - inv.paidMinor)) || tx.amountMinor;

  await db.insert(payments).values({
    id: payId,
    companyId,
    direction: "in",
    amountMinor: tx.amountMinor,
    currency: tx.currency,
    paidAt: tx.bookedAt,
    method: "bank_transfer",
    variableSymbol: tx.variableSymbol || inv.variableSymbol,
    note: `Bankovní pohyb: ${tx.counterpartyName || tx.note || "párování"}`,
    createdAt: now,
  });

  await db.insert(paymentAllocations).values({
    id: crypto.randomUUID(),
    paymentId: payId,
    invoiceId: inv.id,
    amountMinor: allocAmount,
    createdAt: now,
  });

  await db
    .update(invoices)
    .set({
      paidMinor: inv.paidMinor + allocAmount,
      paidAt: tx.bookedAt,
      updatedAt: now,
    })
    .where(eq(invoices.id, inv.id));

  await db
    .update(bankTransactions)
    .set({
      matchStatus: "matched",
      matchedInvoiceId: inv.id,
      paymentId: payId,
    })
    .where(eq(bankTransactions.id, tx.id));
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });

  const now = new Date().toISOString();
  const companyId = ctx.activeCompany.id;

  if (body.kind === "add_manual") {
    const amountMinor = Math.max(1, Number(body.amountMinor) || 0);
    const id = crypto.randomUUID();
    await db.insert(bankTransactions).values({
      id,
      companyId,
      bankAccountId: typeof body.bankAccountId === "string" && body.bankAccountId ? body.bankAccountId : null,
      direction: body.direction === "debit" ? "debit" : "credit",
      amountMinor,
      currency: typeof body.currency === "string" ? body.currency : "CZK",
      bookedAt: typeof body.bookedAt === "string" && body.bookedAt ? body.bookedAt : todayIso(),
      counterpartyName: String(body.counterpartyName ?? "").trim(),
      counterpartyAccount: String(body.counterpartyAccount ?? "").trim(),
      variableSymbol: String(body.variableSymbol ?? "").replace(/\D/g, "").slice(0, 10),
      note: String(body.note ?? "").trim(),
      matchStatus: "unmatched",
      createdAt: now,
    });
    return NextResponse.json({ id }, { status: 201 });
  }

  if (body.kind === "import_csv") {
    const csvText = typeof body.csvText === "string" ? body.csvText : "";
    const parsed = parseBankCsvStatement(csvText);
    if (parsed.length === 0) {
      return NextResponse.json(
        { error: "V CSV výpisu nebyly rozpoznány žádné platné pohyby." },
        { status: 400 },
      );
    }
    for (const row of parsed) {
      await db.insert(bankTransactions).values({
        id: crypto.randomUUID(),
        companyId,
        bankAccountId: typeof body.bankAccountId === "string" && body.bankAccountId ? body.bankAccountId : null,
        direction: row.direction,
        amountMinor: row.amountMinor,
        currency: row.currency,
        bookedAt: row.bookedAt,
        counterpartyName: row.counterpartyName,
        counterpartyAccount: row.counterpartyAccount,
        variableSymbol: row.variableSymbol,
        note: row.note,
        matchStatus: "unmatched",
        createdAt: now,
      });
    }
    return NextResponse.json({ ok: true, imported: parsed.length }, { status: 201 });
  }

  if (body.kind === "auto_pair") {
    const [unmatched, openInvs, openPurch] = await Promise.all([
      db
        .select()
        .from(bankTransactions)
        .where(
          and(
            eq(bankTransactions.companyId, companyId),
            eq(bankTransactions.matchStatus, "unmatched"),
          ),
        ),
      db
        .select()
        .from(invoices)
        .where(and(eq(invoices.companyId, companyId), eq(invoices.status, "issued"))),
      db
        .select()
        .from(purchases)
        .where(eq(purchases.companyId, companyId)),
    ]);

    let matchedCount = 0;
    const usedInv = new Set<string>();
    const usedPurch = new Set<string>();

    for (const tx of unmatched) {
      if (!tx.variableSymbol) continue;

      if (tx.direction === "credit") {
        const match = openInvs.find(
          (i) =>
            !usedInv.has(i.id) &&
            i.variableSymbol === tx.variableSymbol &&
            i.totalMinor - i.paidMinor > 0 &&
            Math.abs(i.totalMinor - i.paidMinor - tx.amountMinor) <= 100,
        );
        if (match) {
          usedInv.add(match.id);
          await pairTransactionWithInvoice(companyId, tx, match);
          matchedCount += 1;
        }
      } else {
        const matchP = openPurch.find(
          (p) =>
            !usedPurch.has(p.id) &&
            p.variableSymbol === tx.variableSymbol &&
            p.totalMinor - p.paidMinor > 0 &&
            Math.abs(p.totalMinor - p.paidMinor - tx.amountMinor) <= 100,
        );
        if (matchP) {
          usedPurch.add(matchP.id);
          const payId = crypto.randomUUID();
          await db.insert(payments).values({
            id: payId,
            companyId,
            direction: "out",
            amountMinor: tx.amountMinor,
            currency: tx.currency,
            paidAt: tx.bookedAt,
            method: "bank_transfer",
            variableSymbol: tx.variableSymbol,
            note: `Spárováno s nákupem ${matchP.number}`,
            createdAt: now,
          });
          await db
            .update(purchases)
            .set({
              paidMinor: matchP.paidMinor + tx.amountMinor,
              paidAt: tx.bookedAt,
              updatedAt: now,
            })
            .where(eq(purchases.id, matchP.id));
          await db
            .update(bankTransactions)
            .set({
              matchStatus: "matched",
              matchedPurchaseId: matchP.id,
              paymentId: payId,
            })
            .where(eq(bankTransactions.id, tx.id));
          matchedCount += 1;
        }
      }
    }

    return NextResponse.json({ ok: true, matchedCount });
  }

  if (body.kind === "pair_manual" && typeof body.transactionId === "string" && typeof body.invoiceId === "string") {
    const [tx] = await db
      .select()
      .from(bankTransactions)
      .where(and(eq(bankTransactions.id, body.transactionId), eq(bankTransactions.companyId, companyId)));
    const [inv] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, body.invoiceId), eq(invoices.companyId, companyId)));
    if (!tx || !inv) return NextResponse.json({ error: "Pohyb nebo faktura nenalezena." }, { status: 404 });

    await pairTransactionWithInvoice(companyId, tx, inv);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Neznámá bankovní akce." }, { status: 400 });
}

export async function DELETE(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Chybí id." }, { status: 400 });

  await db
    .delete(bankTransactions)
    .where(and(eq(bankTransactions.id, id), eq(bankTransactions.companyId, ctx.activeCompany.id)));
  return NextResponse.json({ ok: true });
}
