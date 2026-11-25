import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { inboxItems, purchases } from "@/db/schema";
import { getAuthContext } from "@/lib/auth";
import { lookupAresByIco } from "@/lib/domain/ares";
import { extractDocumentMetadata, type InboxExtractedData } from "@/lib/domain/bank-and-inbox";
import { todayIso } from "@/lib/domain/czech";

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });

  const list = await db
    .select({
      id: inboxItems.id,
      filename: inboxItems.filename,
      mimeType: inboxItems.mimeType,
      sizeBytes: inboxItems.sizeBytes,
      status: inboxItems.status,
      extractedJson: inboxItems.extractedJson,
      convertedPurchaseId: inboxItems.convertedPurchaseId,
      createdAt: inboxItems.createdAt,
    })
    .from(inboxItems)
    .where(eq(inboxItems.companyId, ctx.activeCompany.id))
    .orderBy(desc(inboxItems.createdAt));

  return NextResponse.json({
    data: list.map((item) => ({
      ...item,
      extracted: JSON.parse(item.extractedJson) as InboxExtractedData,
    })),
  });
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Nahrajte soubor (PDF, ISDOC XML, obrázek nebo text)." }, { status: 400 });
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "Maximální velikost souboru pro Inbox je 5 MB." }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const textSample = buf.toString("utf8");
  const extracted = extractDocumentMetadata(file.name, textSample);

  // Enrich supplier name from live ARES if IČO was extracted
  if (extracted.supplierIco && !extracted.supplierName) {
    try {
      const ares = await lookupAresByIco(extracted.supplierIco);
      extracted.supplierName = ares.name;
    } catch {
      // ignore ARES lookup failure during extraction
    }
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(inboxItems).values({
    id,
    companyId: ctx.activeCompany.id,
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    contentBase64: buf.toString("base64"),
    status: "pending",
    extractedJson: JSON.stringify(extracted),
    createdAt: now,
  });

  return NextResponse.json({ id, extracted }, { status: 201 });
}

export async function PATCH(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    id?: string;
    docType?: "received_invoice" | "receipt";
  } | null;
  if (!body?.id) return NextResponse.json({ error: "Chybí id položky Inboxu." }, { status: 400 });

  const [item] = await db
    .select()
    .from(inboxItems)
    .where(and(eq(inboxItems.id, body.id), eq(inboxItems.companyId, ctx.activeCompany.id)));
  if (!item) return NextResponse.json({ error: "Položka Inboxu nenalezena." }, { status: 404 });

  const ext = JSON.parse(item.extractedJson) as InboxExtractedData;
  const today = todayIso();
  const now = new Date().toISOString();
  const docType = body.docType === "receipt" ? "receipt" : "received_invoice";
  const existing = await db
    .select({ id: purchases.id })
    .from(purchases)
    .where(eq(purchases.companyId, ctx.activeCompany.id));
  const number = `${docType === "receipt" ? "UC-" : "PF-"}${today.slice(0, 4)}-${String(
    existing.length + 1,
  ).padStart(4, "0")}`;

  const totalMinor = ext.totalMinor > 0 ? ext.totalMinor : 0;
  const subtotalMinor = Math.round((totalMinor * 100) / 121);
  const vatTotalMinor = totalMinor - subtotalMinor;
  const purchaseId = crypto.randomUUID();

  await db.insert(purchases).values({
    id: purchaseId,
    companyId: ctx.activeCompany.id,
    docType,
    number,
    externalNumber: ext.externalNumber || item.filename,
    supplierId: null,
    supplierSnapshotJson: JSON.stringify({
      name: ext.supplierName || "Dodavatel z Inboxu",
      ico: ext.supplierIco || "",
      dic: "",
    }),
    description: ext.description || item.filename,
    receivedDate: today,
    issueDate: ext.issueDate || today,
    duzp: ext.issueDate || today,
    dueDate: ext.dueDate || today,
    variableSymbol: ext.variableSymbol || "",
    paymentMethod: docType === "receipt" ? "card" : "bank_transfer",
    currency: ext.currency || "CZK",
    vatMode: "standard",
    subtotalMinor,
    vatTotalMinor,
    totalMinor,
    paidMinor: docType === "receipt" ? totalMinor : 0,
    paidAt: docType === "receipt" ? today : null,
    itemsJson: JSON.stringify([
      {
        description: ext.description || item.filename,
        quantityMilli: 1000,
        unit: "ks",
        unitPriceMinor: subtotalMinor,
        vatRate: 21,
      },
    ]),
    note: `Vytěženo z Inboxu (${item.filename})`,
    createdAt: now,
    updatedAt: now,
  });

  await db
    .update(inboxItems)
    .set({ status: "processed", convertedPurchaseId: purchaseId })
    .where(eq(inboxItems.id, item.id));

  return NextResponse.json({ ok: true, purchaseId, number });
}

export async function DELETE(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Chybí id." }, { status: 400 });

  await db
    .delete(inboxItems)
    .where(and(eq(inboxItems.id, id), eq(inboxItems.companyId, ctx.activeCompany.id)));
  return NextResponse.json({ ok: true });
}
