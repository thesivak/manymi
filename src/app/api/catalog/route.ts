import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { catalogItems, invoiceItems, invoices, stockMovements } from "@/db/schema";
import { getAuthContext } from "@/lib/auth";
import { todayIso } from "@/lib/domain/czech";

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });

  const [items, movements, soldRows] = await Promise.all([
    db
      .select()
      .from(catalogItems)
      .where(eq(catalogItems.companyId, ctx.activeCompany.id))
      .orderBy(asc(catalogItems.name)),
    db
      .select({
        id: stockMovements.id,
        catalogItemId: stockMovements.catalogItemId,
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
        and(
          eq(invoices.companyId, ctx.activeCompany.id),
          eq(invoices.status, "issued"),
        ),
      ),
  ]);

  // Aggregate sales overview per item description
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

  return NextResponse.json({
    items,
    movements,
    salesOverview: [...salesMap.values()].sort((a, b) => b.totalMinor - a.totalMinor),
  });
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });

  const now = new Date().toISOString();

  // Manual stock movement
  if (body.kind === "stock_movement") {
    const itemId = String(body.catalogItemId ?? "");
    const direction = body.direction === "out" ? "out" : "in";
    const quantityMilli = Math.max(1, Number(body.quantityMilli) || 1000);
    const [item] = await db
      .select()
      .from(catalogItems)
      .where(and(eq(catalogItems.id, itemId), eq(catalogItems.companyId, ctx.activeCompany.id)));
    if (!item) return NextResponse.json({ error: "Položka ceníku nenalezena." }, { status: 404 });

    const delta = direction === "in" ? quantityMilli : -quantityMilli;
    await db.insert(stockMovements).values({
      id: crypto.randomUUID(),
      companyId: ctx.activeCompany.id,
      catalogItemId: item.id,
      direction,
      quantityMilli,
      unitPriceMinor: item.unitPriceMinor,
      sourceDocType: "manual",
      note: String(body.note ?? (direction === "in" ? "Ruční příjem na sklad" : "Ruční výdej ze skladu")),
      movedAt: typeof body.movedAt === "string" && body.movedAt ? body.movedAt : todayIso(),
      createdAt: now,
    });
    await db
      .update(catalogItems)
      .set({
        trackStock: true,
        stockQuantityMilli: item.stockQuantityMilli + delta,
        updatedAt: now,
      })
      .where(eq(catalogItems.id, item.id));
    return NextResponse.json({ ok: true }, { status: 201 });
  }

  // Create catalog item
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Zadejte název položky ceníku." }, { status: 400 });

  const id = crypto.randomUUID();
  const initialStock = Number(body.stockQuantityMilli) || 0;
  await db.insert(catalogItems).values({
    id,
    companyId: ctx.activeCompany.id,
    name,
    sku: typeof body.sku === "string" ? body.sku.trim() : "",
    ean: typeof body.ean === "string" ? body.ean.trim() : "",
    unit: typeof body.unit === "string" && body.unit.trim() ? body.unit.trim() : "ks",
    unitPriceMinor: Math.max(0, Number(body.unitPriceMinor) || 0),
    priceType: body.priceType === "with_vat" ? "with_vat" : "without_vat",
    vatRate: Number(body.vatRate) === 0 || Number(body.vatRate) === 12 ? Number(body.vatRate) : 21,
    currency: typeof body.currency === "string" ? body.currency : "CZK",
    trackStock: Boolean(body.trackStock),
    stockQuantityMilli: initialStock,
    note: typeof body.note === "string" ? body.note : "",
    createdAt: now,
    updatedAt: now,
  });

  if (Boolean(body.trackStock) && initialStock > 0) {
    await db.insert(stockMovements).values({
      id: crypto.randomUUID(),
      companyId: ctx.activeCompany.id,
      catalogItemId: id,
      direction: "in",
      quantityMilli: initialStock,
      unitPriceMinor: Math.max(0, Number(body.unitPriceMinor) || 0),
      sourceDocType: "initial",
      note: "Počáteční stav skladu",
      movedAt: todayIso(),
      createdAt: now,
    });
  }

  return NextResponse.json({ id }, { status: 201 });
}

export async function DELETE(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Chybí id." }, { status: 400 });

  await db
    .delete(catalogItems)
    .where(and(eq(catalogItems.id, id), eq(catalogItems.companyId, ctx.activeCompany.id)));
  return NextResponse.json({ ok: true });
}
