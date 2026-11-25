import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { contacts, invoiceItems, invoices } from "@/db/schema";
import { getAuthContext } from "@/lib/auth";
import {
  buildInvoicesCsv,
  buildPohodaXml,
  type ExportableInvoice,
} from "@/lib/domain/exports";
import type { VatMode } from "@/lib/domain/money";

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });

  const url = new URL(req.url);
  const format = url.searchParams.get("format") || "csv";
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";

  const allInv = await db
    .select()
    .from(invoices)
    .where(eq(invoices.companyId, ctx.activeCompany.id))
    .orderBy(desc(invoices.issueDate));

  const filtered = allInv.filter((inv) => {
    if (from && inv.issueDate < from) return false;
    if (to && inv.issueDate > to) return false;
    return true;
  });

  const ids = filtered.map((i) => i.id);
  const allItems =
    ids.length > 0
      ? await db
          .select()
          .from(invoiceItems)
          .where(inArray(invoiceItems.invoiceId, ids))
          .orderBy(asc(invoiceItems.position))
      : [];

  const itemsByInv = new Map<string, typeof allItems>();
  for (const it of allItems) {
    const arr = itemsByInv.get(it.invoiceId) ?? [];
    arr.push(it);
    itemsByInv.set(it.invoiceId, arr);
  }

  const exportable: ExportableInvoice[] = filtered.map((inv) => ({
    ...inv,
    vatMode: inv.vatMode as VatMode,
    supplier: JSON.parse(inv.supplierSnapshotJson),
    customer: JSON.parse(inv.customerSnapshotJson),
    bank: JSON.parse(inv.bankSnapshotJson),
    items: itemsByInv.get(inv.id) ?? [],
  }));

  const now = new Date().toISOString();
  if (ids.length > 0) {
    await db
      .update(invoices)
      .set({ exportedAt: now })
      .where(inArray(invoices.id, ids));
  }

  if (format === "pohoda") {
    const xml = buildPohodaXml(ctx.activeCompany.ico, exportable);
    return new NextResponse(xml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": 'attachment; filename="manymi-pohoda-export.xml"',
      },
    });
  }

  const csv = buildInvoicesCsv(exportable);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="manymi-faktury.csv"',
    },
  });
}

/**
 * Import kontaktů z CSV (Název;IČO;DIČ;Ulice;Město;PSČ;Email)
 */
export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { csvText?: string } | null;
  if (!body?.csvText?.trim()) {
    return NextResponse.json({ error: "Vložte CSV data k importu." }, { status: 400 });
  }

  const lines = body.csvText
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return NextResponse.json({ error: "CSV musí obsahovat hlavičku a alespoň jeden řádek." }, { status: 400 });
  }

  const sep = lines[0].includes(";") ? ";" : ",";
  const now = new Date().toISOString();
  let imported = 0;

  for (const line of lines.slice(1)) {
    const cols = line.split(sep).map((c) => c.replace(/^"|"$/g, "").trim());
    const name = cols[0] ?? "";
    if (!name) continue;
    const ico = cols[1] ?? "";
    const dic = cols[2] ?? "";
    await db.insert(contacts).values({
      id: crypto.randomUUID(),
      companyId: ctx.activeCompany.id,
      name,
      ico,
      dic,
      vatPayer: Boolean(dic),
      street: cols[3] ?? "",
      city: cols[4] ?? "",
      zip: cols[5] ?? "",
      country: "Česká republika",
      email: cols[6] ?? "",
      createdAt: now,
      updatedAt: now,
    });
    imported += 1;
  }

  return NextResponse.json({ ok: true, imported }, { status: 201 });
}
