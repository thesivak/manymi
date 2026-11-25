import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { invoiceItems, invoices } from "@/db/schema";
import { getAuthContext } from "@/lib/auth";
import { buildIsdocXml } from "@/lib/domain/exports";
import type { VatMode } from "@/lib/domain/money";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  const { id } = await context.params;

  const [inv] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.companyId, ctx.activeCompany.id)));
  if (!inv) return NextResponse.json({ error: "Faktura nenalezena." }, { status: 404 });

  const items = await db
    .select()
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, inv.id))
    .orderBy(asc(invoiceItems.position));

  const xml = buildIsdocXml({
    ...inv,
    vatMode: inv.vatMode as VatMode,
    supplier: JSON.parse(inv.supplierSnapshotJson),
    customer: JSON.parse(inv.customerSnapshotJson),
    bank: JSON.parse(inv.bankSnapshotJson),
    items,
  });

  const safeName = inv.number.replace(/[^A-Za-z0-9_-]/g, "_");
  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="faktura-${safeName}.isdoc"`,
    },
  });
}
