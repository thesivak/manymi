import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { invoiceItems, invoices } from "@/db/schema";
import { getAuthContext } from "@/lib/auth";
import { generateInvoicePdfBuffer } from "@/lib/pdf/invoice-pdf";
import type { VatMode } from "@/lib/domain/money";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  }

  const { id } = await context.params;
  const [inv] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.companyId, ctx.activeCompany.id)));
  if (!inv) {
    return NextResponse.json({ error: "Faktura nenalezena." }, { status: 404 });
  }

  const items = await db
    .select()
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, inv.id))
    .orderBy(asc(invoiceItems.position));

  const pdfBuffer = await generateInvoicePdfBuffer({
    number: inv.number,
    docType: inv.docType as "invoice" | "proforma" | "tax_document" | "credit_note" | "quote" | "sales_receipt",
    printLanguage: inv.printLanguage === "en" ? "en" : "cs",
    priceType: inv.priceType === "with_vat" ? "with_vat" : "without_vat",
    proformaDeductionMinor: inv.proformaDeductionMinor,
    issueDate: inv.issueDate,
    duzp: inv.duzp,
    dueDate: inv.dueDate,
    paymentMethod: inv.paymentMethod,
    variableSymbol: inv.variableSymbol,
    constantSymbol: inv.constantSymbol,
    orderNumber: inv.orderNumber,
    discountPercent: inv.discountPercent,
    currency: inv.currency,
    vatMode: inv.vatMode as VatMode,
    roundToWhole: inv.roundToWhole,
    showQr: inv.showQr,
    spaydString: inv.spaydString,
    noteBefore: inv.noteBefore,
    noteAfter: inv.noteAfter,
    supplier: JSON.parse(inv.supplierSnapshotJson),
    customer: JSON.parse(inv.customerSnapshotJson),
    bank: JSON.parse(inv.bankSnapshotJson),
    items,
  });

  const url = new URL(req.url);
  const download = url.searchParams.get("download") === "1";
  const safeName = inv.number.replace(/[^A-Za-z0-9_-]/g, "_");

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="faktura-${safeName}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
