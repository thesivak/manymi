import crypto from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  bankTransactions,
  cashRegisters,
  cashVouchers,
  invoices,
  payments,
} from "@/db/schema";
import { getAuthContext } from "@/lib/auth";
import { FinanceClient } from "@/components/FinanceClient";

export const dynamic = "force-dynamic";

export default async function FinancePage() {
  const ctx = await getAuthContext();
  if (!ctx) return null;

  const [initialRegisters, txs, openInvoices, vouchers, allPayments] = await Promise.all([
    db
      .select()
      .from(cashRegisters)
      .where(eq(cashRegisters.companyId, ctx.activeCompany.id))
      .orderBy(asc(cashRegisters.createdAt)),
    db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.companyId, ctx.activeCompany.id))
      .orderBy(desc(bankTransactions.bookedAt), desc(bankTransactions.createdAt)),
    db
      .select({
        id: invoices.id,
        number: invoices.number,
        variableSymbol: invoices.variableSymbol,
        totalMinor: invoices.totalMinor,
        paidMinor: invoices.paidMinor,
        customerSnapshotJson: invoices.customerSnapshotJson,
      })
      .from(invoices)
      .where(and(eq(invoices.companyId, ctx.activeCompany.id), eq(invoices.status, "issued"))),
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

  let registers = initialRegisters;
  if (registers.length === 0) {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const newReg = {
      id,
      companyId: ctx.activeCompany.id,
      name: "Hlavní pokladna CZK",
      currency: "CZK",
      initialBalanceMinor: 0,
      isDefault: true,
      createdAt,
    };
    await db.insert(cashRegisters).values(newReg);
    registers = [newReg];
  }

  const balMap = new Map<string, number>();
  for (const r of registers) balMap.set(r.id, r.initialBalanceMinor);
  for (const v of vouchers) {
    const cur = balMap.get(v.cashRegisterId) ?? 0;
    balMap.set(v.cashRegisterId, v.direction === "in" ? cur + v.amountMinor : cur - v.amountMinor);
  }

  return (
    <FinanceClient
      transactions={txs}
      unpaidInvoices={openInvoices
        .filter((i) => i.totalMinor > i.paidMinor)
        .map((i) => ({
          id: i.id,
          number: i.number,
          variableSymbol: i.variableSymbol,
          remainingMinor: i.totalMinor - i.paidMinor,
          customerName: (JSON.parse(i.customerSnapshotJson) as { name?: string }).name ?? "",
        }))}
      registers={registers.map((r) => ({
        id: r.id,
        name: r.name,
        currency: r.currency,
        currentBalanceMinor: balMap.get(r.id) ?? r.initialBalanceMinor,
      }))}
      vouchers={vouchers}
      payments={allPayments}
    />
  );
}
