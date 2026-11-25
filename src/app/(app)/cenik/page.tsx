import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { catalogItems, invoiceItems, invoices, stockMovements } from "@/db/schema";
import { getAuthContext } from "@/lib/auth";
import { CatalogClient } from "@/components/CatalogClient";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const ctx = await getAuthContext();
  if (!ctx) return null;

  const [items, movements, soldRows] = await Promise.all([
    db
      .select()
      .from(catalogItems)
      .where(eq(catalogItems.companyId, ctx.activeCompany.id))
      .orderBy(asc(catalogItems.name)),
    db
      .select({
        id: stockMovements.id,
        itemName: catalogItems.name,
        unit: catalogItems.unit,
        direction: stockMovements.direction,
        quantityMilli: stockMovements.quantityMilli,
        unitPriceMinor: stockMovements.unitPriceMinor,
        sourceDocType: stockMovements.sourceDocType,
        note: stockMovements.note,
        movedAt: stockMovements.movedAt,
      })
      .from(stockMovements)
      .innerJoin(catalogItems, eq(stockMovements.catalogItemId, catalogItems.id))
      .where(eq(stockMovements.companyId, ctx.activeCompany.id))
      .orderBy(desc(stockMovements.movedAt), desc(stockMovements.createdAt)),
    db
      .select({
        description: invoiceItems.description,
        unit: invoiceItems.unit,
        quantityMilli: invoiceItems.quantityMilli,
        subtotalMinor: invoiceItems.subtotalMinor,
        totalMinor: invoiceItems.totalMinor,
      })
      .from(invoiceItems)
      .innerJoin(invoices, eq(invoiceItems.invoiceId, invoices.id))
      .where(
        and(eq(invoices.companyId, ctx.activeCompany.id), eq(invoices.status, "issued")),
      ),
  ]);

  const salesMap = new Map<
    string,
    { name: string; unit: string; quantityMilli: number; subtotalMinor: number; totalMinor: number }
  >();
  for (const row of soldRows) {
    const key = `${row.description.trim().toLowerCase()}|${row.unit}`;
    const prev = salesMap.get(key) ?? {
      name: row.description,
      unit: row.unit,
      quantityMilli: 0,
      subtotalMinor: 0,
      totalMinor: 0,
    };
    prev.quantityMilli += row.quantityMilli;
    prev.subtotalMinor += row.subtotalMinor;
    prev.totalMinor += row.totalMinor;
    salesMap.set(key, prev);
  }

  return (
    <CatalogClient
      items={items}
      movements={movements}
      salesOverview={[...salesMap.values()].sort((a, b) => b.totalMinor - a.totalMinor)}
    />
  );
}
