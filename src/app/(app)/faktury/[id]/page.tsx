import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  bankAccounts,
  catalogItems,
  contacts,
  documentAttachments,
  emailLogs,
  invoiceItems,
  invoices,
  numberSequences,
  paymentAllocations,
  payments,
} from "@/db/schema";
import { getAuthContext } from "@/lib/auth";
import { daysBetweenIso, formatInvoiceNumber } from "@/lib/domain/czech";
import { deriveInvoiceStatus } from "@/lib/domain/invoice-status";
import type { PriceType, SalesDocType, VatMode } from "@/lib/domain/money";
import { InvoiceEditorClient } from "@/components/InvoiceEditorClient";
import { InvoiceDetailClient } from "@/components/InvoiceDetailClient";

export const dynamic = "force-dynamic";

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) return null;

  const { id } = await params;
  const [inv] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.companyId, ctx.activeCompany.id)));

  if (!inv) notFound();

  const [items, allocs, attachments, emails] = await Promise.all([
    db
      .select()
      .from(invoiceItems)
      .where(eq(invoiceItems.invoiceId, inv.id))
      .orderBy(asc(invoiceItems.position)),
    db
      .select({
        paymentId: payments.id,
        amountMinor: paymentAllocations.amountMinor,
        paidAt: payments.paidAt,
        method: payments.method,
        note: payments.note,
      })
      .from(paymentAllocations)
      .innerJoin(payments, eq(paymentAllocations.paymentId, payments.id))
      .where(eq(paymentAllocations.invoiceId, inv.id)),
    db
      .select({
        id: documentAttachments.id,
        filename: documentAttachments.filename,
        mimeType: documentAttachments.mimeType,
        sizeBytes: documentAttachments.sizeBytes,
        createdAt: documentAttachments.createdAt,
      })
      .from(documentAttachments)
      .where(
        and(
          eq(documentAttachments.companyId, ctx.activeCompany.id),
          eq(documentAttachments.ownerType, "invoice"),
          eq(documentAttachments.ownerId, inv.id),
        ),
      )
      .orderBy(desc(documentAttachments.createdAt)),
    db
      .select({
        id: emailLogs.id,
        kind: emailLogs.kind,
        recipientEmail: emailLogs.recipientEmail,
        subject: emailLogs.subject,
        sentAt: emailLogs.sentAt,
      })
      .from(emailLogs)
      .where(
        and(
          eq(emailLogs.companyId, ctx.activeCompany.id),
          eq(emailLogs.documentId, inv.id),
        ),
      )
      .orderBy(desc(emailLogs.sentAt)),
  ]);

  const supplier = JSON.parse(inv.supplierSnapshotJson);
  const customer = JSON.parse(inv.customerSnapshotJson);
  const bank = JSON.parse(inv.bankSnapshotJson);

  if (inv.status === "draft") {
    const [contactRows, bankRows, seqRows, catalogRows] = await Promise.all([
      db
        .select()
        .from(contacts)
        .where(eq(contacts.companyId, ctx.activeCompany.id))
        .orderBy(asc(contacts.name)),
      db
        .select()
        .from(bankAccounts)
        .where(eq(bankAccounts.companyId, ctx.activeCompany.id))
        .orderBy(asc(bankAccounts.createdAt)),
      db
        .select()
        .from(numberSequences)
        .where(eq(numberSequences.companyId, ctx.activeCompany.id))
        .orderBy(asc(numberSequences.year)),
      db
        .select()
        .from(catalogItems)
        .where(eq(catalogItems.companyId, ctx.activeCompany.id))
        .orderBy(asc(catalogItems.name)),
    ]);

    return (
      <InvoiceEditorClient
        mode="edit"
        invoiceId={inv.id}
        supplier={supplier}
        contacts={contactRows}
        bankAccounts={bankRows}
        catalogItems={catalogRows}
        sequences={seqRows.map((s) => ({
          id: s.id,
          name: s.name,
          nextFormatted: formatInvoiceNumber(s.prefix, s.year, s.nextNumber, s.padding),
        }))}
        initialData={{
          docType: (inv.docType as SalesDocType) || "invoice",
          priceType: (inv.priceType as PriceType) || "without_vat",
          printLanguage: inv.printLanguage === "en" ? "en" : "cs",
          exchangeRateMilli: inv.exchangeRateMilli,
          sequenceId: inv.sequenceId ?? "",
          number: inv.number,
          contactId: inv.contactId ?? "",
          customer,
          issueDate: inv.issueDate,
          duzp: inv.duzp,
          dueDays: Math.max(0, daysBetweenIso(inv.issueDate, inv.dueDate)),
          dueDate: inv.dueDate,
          paymentMethod: inv.paymentMethod as "bank_transfer" | "cash" | "card",
          bankAccountId:
            bankRows.find((b) => b.accountNumber === bank.accountNumber)?.id ?? "",
          bankAccountNumber: bank.accountNumber ?? "",
          bankIban: bank.iban ?? "",
          bankSwift: bank.swift ?? "",
          variableSymbol: inv.variableSymbol,
          constantSymbol: inv.constantSymbol,
          orderNumber: inv.orderNumber,
          discountPercent: inv.discountPercent,
          currency: inv.currency,
          vatMode: inv.vatMode as VatMode,
          roundToWhole: inv.roundToWhole,
          showQr: inv.showQr,
          noteBefore: inv.noteBefore,
          noteAfter: inv.noteAfter,
          items: items.map((it) => ({
            id: it.id,
            description: it.description,
            quantityStr: String(it.quantityMilli / 1000).replace(".", ","),
            unit: it.unit,
            unitPriceStr: String(it.unitPriceMinor / 100).replace(".", ","),
            vatRate: it.vatRate,
            catalogItemId: it.catalogItemId,
          })),
        }}
      />
    );
  }

  return (
    <InvoiceDetailClient
      invoice={{
        id: inv.id,
        docType: (inv.docType as SalesDocType) || "invoice",
        number: inv.number,
        status: inv.status,
        quoteStatus: inv.quoteStatus || "open",
        printLanguage: inv.printLanguage === "en" ? "en" : "cs",
        priceType: (inv.priceType as PriceType) || "without_vat",
        proformaDeductionMinor: inv.proformaDeductionMinor,
        issueDate: inv.issueDate,
        duzp: inv.duzp,
        dueDate: inv.dueDate,
        paymentMethod: inv.paymentMethod,
        variableSymbol: inv.variableSymbol,
        constantSymbol: inv.constantSymbol,
        discountPercent: inv.discountPercent,
        currency: inv.currency,
        vatMode: inv.vatMode as VatMode,
        roundToWhole: inv.roundToWhole,
        showQr: inv.showQr,
        spaydString: inv.spaydString,
        noteBefore: inv.noteBefore,
        noteAfter: inv.noteAfter,
        totalMinor: inv.totalMinor,
        paidMinor: inv.paidMinor,
        supplier,
        customer,
        bank,
        items,
        payments: allocs,
        attachments,
        emails,
        derived: deriveInvoiceStatus(inv),
      }}
    />
  );
}
