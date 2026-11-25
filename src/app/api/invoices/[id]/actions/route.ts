import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  emailLogs,
  invoiceItems,
  invoices,
  invoiceTemplates,
  numberSequences,
} from "@/db/schema";
import { getAuthContext } from "@/lib/auth";
import {
  addDaysIso,
  buildSpayd,
  extractVariableSymbol,
  formatInvoiceNumber,
  todayIso,
} from "@/lib/domain/czech";
import {
  calculateInvoiceTotals,
  DOC_TYPE_LABELS,
  formatCzk,
  type PriceType,
  type SalesDocType,
  type VatMode,
} from "@/lib/domain/money";
import { sendTransactionalEmail } from "@/lib/mailer";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("duplicate") }),
  z.object({ action: z.literal("credit_note"), reason: z.string().optional().default("Opravný daňový doklad") }),
  z.object({ action: z.literal("convert_to_invoice") }),
  z.object({ action: z.literal("tax_document") }),
  z.object({ action: z.literal("save_template"), name: z.string().trim().min(1) }),
  z.object({
    action: z.literal("send_email"),
    kind: z.enum(["invoice", "reminder", "thank_you", "quote", "accountant"]).default("invoice"),
    recipientEmail: z.string().trim().email("Zadejte platný e-mail příjemce."),
    subject: z.string().trim().optional(),
    body: z.string().trim().optional(),
  }),
  z.object({
    action: z.literal("quote_status"),
    quoteStatus: z.enum(["open", "accepted", "rejected", "converted"]),
  }),
]);

async function allocateSequenceNumber(companyId: string, docType: SalesDocType, year: number) {
  const now = new Date().toISOString();
  let [seq] = await db
    .select()
    .from(numberSequences)
    .where(
      and(
        eq(numberSequences.companyId, companyId),
        eq(numberSequences.docType, docType),
        eq(numberSequences.year, year),
      ),
    );
  if (!seq) {
    const id = crypto.randomUUID();
    await db.insert(numberSequences).values({
      id,
      companyId,
      docType,
      name: DOC_TYPE_LABELS[docType].short,
      prefix: DOC_TYPE_LABELS[docType].prefix,
      year,
      nextNumber: 1,
      padding: 4,
      isDefault: true,
      createdAt: now,
    });
    const [created] = await db.select().from(numberSequences).where(eq(numberSequences.id, id));
    seq = created;
  }
  const number = formatInvoiceNumber(seq.prefix, seq.year, seq.nextNumber, seq.padding);
  await db
    .update(numberSequences)
    .set({ nextNumber: seq.nextNumber + 1 })
    .where(eq(numberSequences.id, seq.id));
  return { sequenceId: seq.id, number };
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  }
  const { id } = await context.params;
  const [src] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.companyId, ctx.activeCompany.id)));
  if (!src) {
    return NextResponse.json({ error: "Doklad nenalezen." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Neplatný požadavek." },
      { status: 400 },
    );
  }

  const items = await db
    .select()
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, src.id))
    .orderBy(asc(invoiceItems.position));

  const today = todayIso();
  const year = Number(today.slice(0, 4));
  const now = new Date().toISOString();
  const input = parsed.data;

  if (input.action === "quote_status") {
    await db
      .update(invoices)
      .set({ quoteStatus: input.quoteStatus, updatedAt: now })
      .where(eq(invoices.id, src.id));
    return NextResponse.json({ ok: true, quoteStatus: input.quoteStatus });
  }

  if (input.action === "save_template") {
    const tplId = crypto.randomUUID();
    await db.insert(invoiceTemplates).values({
      id: tplId,
      companyId: ctx.activeCompany.id,
      name: input.name,
      docType: src.docType,
      contactId: src.contactId,
      customerSnapshotJson: src.customerSnapshotJson,
      description: src.description,
      dueDays: ctx.activeCompany.defaultDueDays,
      paymentMethod: src.paymentMethod,
      currency: src.currency,
      vatMode: src.vatMode,
      priceType: src.priceType,
      discountPercent: src.discountPercent,
      itemsJson: JSON.stringify(
        items.map((it) => ({
          description: it.description,
          quantityMilli: it.quantityMilli,
          unit: it.unit,
          unitPriceMinor: it.unitPriceMinor,
          priceType: it.priceType,
          vatRate: it.vatRate,
        })),
      ),
      noteBefore: src.noteBefore,
      noteAfter: src.noteAfter,
      createdAt: now,
    });
    return NextResponse.json({ ok: true, templateId: tplId }, { status: 201 });
  }

  if (input.action === "send_email") {
    const customer = JSON.parse(src.customerSnapshotJson) as { name?: string };
    const defaultSubject =
      input.kind === "reminder"
        ? `Upomínka k úhradě faktury ${src.number}`
        : input.kind === "thank_you"
          ? `Děkujeme za úhradu faktury ${src.number}`
          : `${DOC_TYPE_LABELS[(src.docType as SalesDocType) ?? "invoice"].short} ${src.number} — ${ctx.activeCompany.name}`;
    const defaultBody =
      input.kind === "reminder"
        ? `Dobrý den,\n\ndovolujeme si připomenout neuhrazenou fakturu ${src.number} na částku ${formatCzk(src.totalMinor, { currency: src.currency })} (VS ${src.variableSymbol}).\n\nS pozdravem,\n${ctx.activeCompany.name}`
        : `Dobrý den${customer.name ? ` (${customer.name})` : ""},\n\nzasíláme doklad ${src.number} na částku ${formatCzk(src.totalMinor, { currency: src.currency })}.\n\nS pozdravem,\n${ctx.activeCompany.name}`;

    const finalSubject = input.subject || defaultSubject;
    const finalBody = input.body || defaultBody;
    const delivery = await sendTransactionalEmail({
      to: input.recipientEmail,
      subject: finalSubject,
      text: finalBody,
      fromName: ctx.activeCompany.name,
    });

    const logId = crypto.randomUUID();
    await db.insert(emailLogs).values({
      id: logId,
      companyId: ctx.activeCompany.id,
      documentId: src.id,
      documentNumber: src.number,
      kind: input.kind,
      recipientEmail: input.recipientEmail,
      subject: finalSubject,
      body: finalBody,
      status: delivery.status,
      sentAt: now,
    });
    return NextResponse.json(
      {
        ok: true,
        emailLogId: logId,
        delivered: delivery.delivered,
        status: delivery.status,
        detail: delivery.detail,
      },
      { status: 201 },
    );
  }

  // Document derivation actions: duplicate | credit_note | convert_to_invoice | tax_document
  const targetDocType: SalesDocType =
    input.action === "duplicate"
      ? (src.docType as SalesDocType)
      : input.action === "credit_note"
        ? "credit_note"
        : input.action === "tax_document"
          ? "tax_document"
          : "invoice";

  const { sequenceId, number } = await allocateSequenceNumber(
    ctx.activeCompany.id,
    targetDocType,
    year,
  );
  const newId = crypto.randomUUID();
  const dueDate = addDaysIso(today, ctx.activeCompany.defaultDueDays);
  const vs = extractVariableSymbol(number);
  const bank = JSON.parse(src.bankSnapshotJson) as { iban?: string };

  const derivedItems = items.map((it) => ({
    description: it.description,
    quantityMilli: it.quantityMilli,
    unit: it.unit,
    unitPriceMinor: input.action === "credit_note" ? -Math.abs(it.unitPriceMinor) : it.unitPriceMinor,
    priceType: (it.priceType as PriceType) ?? "without_vat",
    vatRate: it.vatRate,
    catalogItemId: it.catalogItemId,
  }));

  const proformaDeductionMinor =
    input.action === "convert_to_invoice" && src.docType === "proforma" && src.paidMinor > 0
      ? src.paidMinor
      : 0;

  const totals = calculateInvoiceTotals({
    items: derivedItems,
    vatMode: src.vatMode as VatMode,
    roundToWhole: src.roundToWhole,
    discountPercent: src.discountPercent,
    priceType: (src.priceType as PriceType) ?? "without_vat",
    proformaDeductionMinor,
  });

  const spayd =
    bank.iban && totals.totalMinor > 0 && targetDocType !== "credit_note" && targetDocType !== "quote"
      ? buildSpayd({
          iban: bank.iban,
          amountMinor: totals.totalMinor,
          currency: src.currency,
          dueDate,
          variableSymbol: vs,
          constantSymbol: src.constantSymbol,
          message: `${DOC_TYPE_LABELS[targetDocType].short} ${number}`,
        })
      : "";

  const newStatus = input.action === "duplicate" ? "draft" : "issued";

  await db.insert(invoices).values({
    id: newId,
    companyId: ctx.activeCompany.id,
    sequenceId,
    contactId: src.contactId,
    docType: targetDocType,
    number,
    status: newStatus,
    quoteStatus: "open",
    description:
      input.action === "credit_note"
        ? `Dobropis k faktuře ${src.number}`
        : input.action === "tax_document"
          ? `Daňový doklad k záloze ${src.number}`
          : src.description,
    issueDate: today,
    duzp: today,
    dueDate,
    paymentMethod: src.paymentMethod,
    variableSymbol: vs,
    constantSymbol: src.constantSymbol,
    orderNumber: src.orderNumber,
    discountPercent: src.discountPercent,
    currency: src.currency,
    exchangeRateMilli: src.exchangeRateMilli,
    printLanguage: src.printLanguage,
    priceType: src.priceType,
    vatMode: src.vatMode,
    roundToWhole: src.roundToWhole,
    showQr: targetDocType !== "credit_note" && targetDocType !== "quote",
    noteBefore:
      input.action === "credit_note"
        ? `Opravný daňový doklad k původní faktuře č. ${src.number}. ${input.reason}`
        : proformaDeductionMinor > 0
          ? `Vyúčtování zálohové faktury č. ${src.number} (odpočet zaplacené zálohy ${formatCzk(proformaDeductionMinor, { currency: src.currency })}).`
          : src.noteBefore,
    noteAfter: src.noteAfter,
    tagsJson: src.tagsJson,
    relatedDocumentId: input.action === "duplicate" ? null : src.id,
    proformaDeductionMinor,
    supplierSnapshotJson: src.supplierSnapshotJson,
    customerSnapshotJson: src.customerSnapshotJson,
    bankSnapshotJson: src.bankSnapshotJson,
    subtotalMinor: totals.subtotalMinor,
    vatTotalMinor: totals.vatTotalMinor,
    roundingMinor: totals.roundingMinor,
    totalMinor: totals.totalMinor,
    paidMinor: targetDocType === "tax_document" ? totals.totalMinor : 0,
    spaydString: spayd,
    issuedAt: newStatus === "issued" ? now : null,
    paidAt: targetDocType === "tax_document" ? today : null,
    createdAt: now,
    updatedAt: now,
  });

  for (let i = 0; i < derivedItems.length; i++) {
    const it = derivedItems[i];
    const calc = totals.items[i];
    await db.insert(invoiceItems).values({
      id: crypto.randomUUID(),
      invoiceId: newId,
      position: i,
      description: it.description,
      quantityMilli: it.quantityMilli,
      unit: it.unit,
      unitPriceMinor: it.unitPriceMinor,
      priceType: it.priceType,
      catalogItemId: it.catalogItemId,
      vatRate: calc.effectiveVatRate,
      subtotalMinor: calc.subtotalMinor,
      vatMinor: calc.vatMinor,
      totalMinor: calc.totalMinor,
    });
  }

  if (input.action === "convert_to_invoice" && src.docType === "quote") {
    await db
      .update(invoices)
      .set({ quoteStatus: "converted", updatedAt: now })
      .where(eq(invoices.id, src.id));
  }

  return NextResponse.json({ ok: true, id: newId, number, docType: targetDocType }, { status: 201 });
}
