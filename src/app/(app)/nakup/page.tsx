import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { inboxItems, purchases } from "@/db/schema";
import { getAuthContext } from "@/lib/auth";
import { PurchasesClient } from "@/components/PurchasesClient";

export const dynamic = "force-dynamic";

export default async function PurchasesPage() {
  const ctx = await getAuthContext();
  if (!ctx) return null;

  const [purchaseRows, inboxRows] = await Promise.all([
    db
      .select()
      .from(purchases)
      .where(eq(purchases.companyId, ctx.activeCompany.id))
      .orderBy(desc(purchases.issueDate), desc(purchases.createdAt)),
    db
      .select({
        id: inboxItems.id,
        filename: inboxItems.filename,
        sizeBytes: inboxItems.sizeBytes,
        status: inboxItems.status,
        extractedJson: inboxItems.extractedJson,
        createdAt: inboxItems.createdAt,
      })
      .from(inboxItems)
      .where(eq(inboxItems.companyId, ctx.activeCompany.id))
      .orderBy(desc(inboxItems.createdAt)),
  ]);

  return (
    <PurchasesClient
      initialPurchases={purchaseRows.map((p) => {
        const sup = JSON.parse(p.supplierSnapshotJson) as { name?: string; ico?: string };
        return {
          id: p.id,
          docType: p.docType,
          number: p.number,
          externalNumber: p.externalNumber,
          supplierName: sup.name || "—",
          supplierIco: sup.ico || "",
          description: p.description,
          issueDate: p.issueDate,
          dueDate: p.dueDate,
          variableSymbol: p.variableSymbol,
          currency: p.currency,
          subtotalMinor: p.subtotalMinor,
          vatTotalMinor: p.vatTotalMinor,
          totalMinor: p.totalMinor,
          paidMinor: p.paidMinor,
        };
      })}
      initialInbox={inboxRows.map((i) => ({
        id: i.id,
        filename: i.filename,
        sizeBytes: i.sizeBytes,
        status: i.status,
        createdAt: i.createdAt,
        extracted: JSON.parse(i.extractedJson),
      }))}
    />
  );
}
