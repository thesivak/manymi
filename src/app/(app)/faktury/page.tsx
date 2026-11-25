import { Suspense } from "react";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  bankAccounts,
  catalogItems,
  contacts,
  invoices,
  invoiceTemplates,
  numberSequences,
  recurringInvoices,
} from "@/db/schema";
import { getAuthContext } from "@/lib/auth";
import { deriveInvoiceStatus } from "@/lib/domain/invoice-status";
import type { SalesDocType } from "@/lib/domain/money";
import { InvoicesClient, type InvoiceListRow } from "@/components/InvoicesClient";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const ctx = await getAuthContext();
  if (!ctx) return null;

  const companyId = ctx.activeCompany.id;
  const [list, recurring, templates, contactRows, sequenceRows, bankRows, catalogRows] =
    await Promise.all([
      db
        .select({
          id: invoices.id,
          docType: invoices.docType,
          number: invoices.number,
          description: invoices.description,
          status: invoices.status,
          quoteStatus: invoices.quoteStatus,
          issueDate: invoices.issueDate,
          dueDate: invoices.dueDate,
          currency: invoices.currency,
          totalMinor: invoices.totalMinor,
          paidMinor: invoices.paidMinor,
          exportedAt: invoices.exportedAt,
          customerSnapshotJson: invoices.customerSnapshotJson,
        })
        .from(invoices)
        .where(eq(invoices.companyId, companyId))
        .orderBy(desc(invoices.issueDate), desc(invoices.createdAt)),
      db
        .select()
        .from(recurringInvoices)
        .where(eq(recurringInvoices.companyId, companyId))
        .orderBy(desc(recurringInvoices.createdAt)),
      db
        .select()
        .from(invoiceTemplates)
        .where(eq(invoiceTemplates.companyId, companyId))
        .orderBy(desc(invoiceTemplates.createdAt)),
      db
        .select({
          id: contacts.id,
          name: contacts.name,
          ico: contacts.ico,
          dic: contacts.dic,
          street: contacts.street,
          city: contacts.city,
          zip: contacts.zip,
          email: contacts.email,
        })
        .from(contacts)
        .where(eq(contacts.companyId, companyId))
        .orderBy(asc(contacts.name)),
      db
        .select()
        .from(numberSequences)
        .where(eq(numberSequences.companyId, companyId))
        .orderBy(asc(numberSequences.year)),
      db
        .select()
        .from(bankAccounts)
        .where(eq(bankAccounts.companyId, companyId))
        .orderBy(asc(bankAccounts.createdAt)),
      db
        .select()
        .from(catalogItems)
        .where(eq(catalogItems.companyId, companyId))
        .orderBy(asc(catalogItems.name)),
    ]);

  const rows: InvoiceListRow[] = list.map((inv) => {
    const customer = JSON.parse(inv.customerSnapshotJson) as {
      name: string;
      ico?: string;
      email?: string;
    };
    return {
      id: inv.id,
      docType: (inv.docType as SalesDocType) || "invoice",
      number: inv.number,
      description: inv.description || "",
      status: inv.status,
      quoteStatus: inv.quoteStatus || "open",
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      currency: inv.currency,
      totalMinor: inv.totalMinor,
      paidMinor: inv.paidMinor,
      exportedAt: inv.exportedAt,
      customerName: customer.name || "—",
      customerIco: customer.ico || "",
      customerEmail: customer.email || "",
      derived: deriveInvoiceStatus(inv),
    };
  });

  return (
    <Suspense fallback={<div className="container section muted">Načítám prodejní doklady…</div>}>
      <InvoicesClient
        initialRows={rows}
        initialRecurring={recurring}
        initialTemplates={templates}
        contacts={contactRows}
        sequences={sequenceRows}
        bankAccounts={bankRows}
        catalogItems={catalogRows}
        company={{
          email: ctx.activeCompany.email,
          accountantEmail: ctx.activeCompany.accountantEmail,
          vatPayer: ctx.activeCompany.vatPayer,
          defaultDueDays: ctx.activeCompany.defaultDueDays,
          defaultRounding: ctx.activeCompany.defaultRounding,
          defaultNoteAfter: ctx.activeCompany.defaultNoteAfter,
        }}
      />
    </Suspense>
  );
}
