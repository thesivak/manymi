import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { contacts, emailLogs, invoices } from "@/db/schema";
import { getAuthContext } from "@/lib/auth";
import { ContactsClient, type ContactListItem } from "@/components/ContactsClient";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const ctx = await getAuthContext();
  if (!ctx) return null;

  const [list, companyInvoices, emails] = await Promise.all([
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
    db
      .select()
      .from(emailLogs)
      .where(eq(emailLogs.companyId, ctx.activeCompany.id))
      .orderBy(desc(emailLogs.sentAt)),
  ]);

  const statsMap = new Map<
    string,
    { invoiceCount: number; turnoverMinor: number; unpaidMinor: number }
  >();
  for (const inv of companyInvoices) {
    if (!inv.contactId || inv.status !== "issued") continue;
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

  const enriched: ContactListItem[] = list.map((c) => ({
    ...c,
    stats: statsMap.get(c.id) ?? {
      invoiceCount: 0,
      turnoverMinor: 0,
      unpaidMinor: 0,
    },
  }));

  return <ContactsClient initialContacts={enriched} emailLogs={emails} />;
}
