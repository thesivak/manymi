import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  bankAccounts,
  catalogItems,
  contacts,
  invoiceItems,
  invoices,
  numberSequences,
  stockMovements,
} from "@/db/schema";
import { getAuthContext } from "@/lib/auth";
import {
  buildSpayd,
  czechAccountToIban,
  extractVariableSymbol,
  formatInvoiceNumber,
} from "@/lib/domain/czech";
import {
  calculateInvoiceTotals,
  DOC_TYPE_LABELS,
  type PriceType,
  type SalesDocType,
  type VatMode,
} from "@/lib/domain/money";
import { deriveInvoiceStatus } from "@/lib/domain/invoice-status";

const itemSchema = z.object({
  description: z.string().trim().min(1, "Vyplňte popis položky."),
  quantityMilli: z.number().int().refine((v) => v !== 0, "Množství nesmí být nula."),
  unit: z.string().trim().min(1).default("ks"),
  unitPriceMinor: z.number().int(),
  priceType: z.enum(["without_vat", "with_vat"]).optional().default("without_vat"),
  catalogItemId: z.string().nullable().optional(),
  vatRate: z.number().int().refine((v) => v === 0 || v === 12 || v === 21, {
    message: "Podporované sazby DPH jsou 0 %, 12 % a 21 %.",
  }),
});

const customerSchema = z.object({
  name: z.string().trim().min(1, "Vyplňte název odběratele."),
  ico: z.string().trim().optional().default(""),
  dic: z.string().trim().optional().default(""),
  vatPayer: z.boolean().optional().default(false),
  street: z.string().trim().optional().default(""),
  city: z.string().trim().optional().default(""),
  zip: z.string().trim().optional().default(""),
  country: z.string().trim().optional().default("Česká republika"),
  email: z.string().trim().optional().default(""),
});

const createInvoiceSchema = z.object({
  action: z.enum(["draft", "issue"]).default("issue"),
  docType: z
    .enum(["invoice", "proforma", "tax_document", "credit_note", "quote", "sales_receipt"])
    .default("invoice"),
  sequenceId: z.string().optional().nullable(),
  number: z.string().trim().optional(),
  contactId: z.string().optional().nullable(),
  saveContact: z.boolean().optional().default(true),
  description: z.string().trim().optional().default(""),
  customer: customerSchema,
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  duzp: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paymentMethod: z.enum(["bank_transfer", "cash", "card"]).default("bank_transfer"),
  bankAccountId: z.string().optional().nullable(),
  bankAccountNumber: z.string().trim().optional().default(""),
  bankIban: z.string().trim().optional().default(""),
  bankSwift: z.string().trim().optional().default(""),
  variableSymbol: z.string().trim().optional().default(""),
  constantSymbol: z.string().trim().optional().default(""),
  orderNumber: z.string().trim().optional().default(""),
  discountPercent: z.number().int().min(0).max(100).default(0),
  currency: z.string().trim().default("CZK"),
  exchangeRateMilli: z.number().int().positive().optional().default(1000),
  printLanguage: z.enum(["cs", "en"]).optional().default("cs"),
  priceType: z.enum(["without_vat", "with_vat"]).optional().default("without_vat"),
  vatMode: z.enum(["standard", "reverse_charge", "non_vat"]).default("standard"),
  roundToWhole: z.boolean().default(false),
  showQr: z.boolean().default(true),
  proformaDeductionMinor: z.number().int().min(0).optional().default(0),
  relatedDocumentId: z.string().nullable().optional(),
  tags: z.array(z.string().trim()).optional().default([]),
  noteBefore: z.string().optional().default(""),
  noteAfter: z.string().optional().default(""),
  items: z.array(itemSchema).min(1, "Přidejte alespoň jednu položku dokladu."),
});

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  }

  const url = new URL(req.url);
  const docType = url.searchParams.get("docType");

  const rows = await db
    .select()
    .from(invoices)
    .where(
      docType
        ? and(eq(invoices.companyId, ctx.activeCompany.id), eq(invoices.docType, docType))
        : eq(invoices.companyId, ctx.activeCompany.id),
    )
    .orderBy(desc(invoices.issueDate), desc(invoices.createdAt));

  return NextResponse.json({
    data: rows.map((inv) => ({
      ...inv,
      customer: JSON.parse(inv.customerSnapshotJson),
      derivedStatus: deriveInvoiceStatus(inv),
    })),
  });
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createInvoiceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Neplatná data dokladu." },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const company = ctx.activeCompany;
  const now = new Date().toISOString();
  const docType = input.docType as SalesDocType;

  // Bank account snapshot
  let bankSnapshot = {
    label: "",
    accountNumber: input.bankAccountNumber,
    iban: input.bankIban || czechAccountToIban(input.bankAccountNumber),
    swift: input.bankSwift,
  };
  if (input.bankAccountId) {
    const [acc] = await db
      .select()
      .from(bankAccounts)
      .where(
        and(
          eq(bankAccounts.id, input.bankAccountId),
          eq(bankAccounts.companyId, company.id),
        ),
      );
    if (acc) {
      bankSnapshot = {
        label: acc.label,
        accountNumber: acc.accountNumber,
        iban: acc.iban || czechAccountToIban(acc.accountNumber, acc.bankCode),
        swift: acc.swift,
      };
    }
  }

  // Contact resolution
  let contactId = input.contactId ?? null;
  if (!contactId && input.saveContact && input.customer.name) {
    const existingByIco = input.customer.ico
      ? await db
          .select()
          .from(contacts)
          .where(
            and(
              eq(contacts.companyId, company.id),
              eq(contacts.ico, input.customer.ico),
            ),
          )
      : [];
    if (existingByIco[0]) {
      contactId = existingByIco[0].id;
    } else {
      contactId = crypto.randomUUID();
      await db.insert(contacts).values({
        id: contactId,
        companyId: company.id,
        name: input.customer.name,
        ico: input.customer.ico,
        dic: input.customer.dic,
        vatPayer: input.customer.vatPayer,
        street: input.customer.street,
        city: input.customer.city,
        zip: input.customer.zip,
        country: input.customer.country,
        email: input.customer.email,
        phone: "",
        web: "",
        defaultDueDays: null,
        note: "",
        aresVerifiedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // Number sequence resolution per docType
  const issueYear = Number(input.issueDate.slice(0, 4)) || new Date().getFullYear();
  let sequenceId = input.sequenceId ?? null;
  let finalNumber = input.number?.trim() ?? "";

  let [seqRow] = sequenceId
    ? await db
        .select()
        .from(numberSequences)
        .where(
          and(
            eq(numberSequences.id, sequenceId),
            eq(numberSequences.companyId, company.id),
          ),
        )
    : await db
        .select()
        .from(numberSequences)
        .where(
          and(
            eq(numberSequences.companyId, company.id),
            eq(numberSequences.docType, docType),
            eq(numberSequences.year, issueYear),
          ),
        );

  if (!seqRow) {
    const defaultPrefix = DOC_TYPE_LABELS[docType].prefix;
    const newSeqId = crypto.randomUUID();
    await db.insert(numberSequences).values({
      id: newSeqId,
      companyId: company.id,
      docType,
      name: DOC_TYPE_LABELS[docType].short,
      prefix: defaultPrefix,
      year: issueYear,
      nextNumber: 1,
      padding: 4,
      isDefault: true,
      createdAt: now,
    });
    const [createdSeq] = await db
      .select()
      .from(numberSequences)
      .where(eq(numberSequences.id, newSeqId));
    seqRow = createdSeq;
  }

  if (seqRow) {
    sequenceId = seqRow.id;
    const expectedNext = formatInvoiceNumber(
      seqRow.prefix,
      seqRow.year,
      seqRow.nextNumber,
      seqRow.padding,
    );
    if (!finalNumber) finalNumber = expectedNext;
    if (finalNumber === expectedNext) {
      await db
        .update(numberSequences)
        .set({ nextNumber: seqRow.nextNumber + 1 })
        .where(eq(numberSequences.id, seqRow.id));
    }
  }

  const [dup] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.companyId, company.id), eq(invoices.number, finalNumber)));
  if (dup) {
    return NextResponse.json(
      { error: `Doklad s číslem ${finalNumber} už existuje. Zvolte jiné číslo.` },
      { status: 409 },
    );
  }

  const effectiveVatMode: VatMode = company.vatPayer ? input.vatMode : "non_vat";
  const effectiveRound =
    input.paymentMethod === "cash" ? true : input.roundToWhole;

  const totals = calculateInvoiceTotals({
    items: input.items,
    vatMode: effectiveVatMode,
    roundToWhole: effectiveRound,
    discountPercent: input.discountPercent,
    priceType: input.priceType as PriceType,
    proformaDeductionMinor: input.proformaDeductionMinor,
  });

  const variableSymbol =
    input.variableSymbol.trim() || extractVariableSymbol(finalNumber);

  const spaydString =
    input.showQr &&
    bankSnapshot.iban &&
    totals.totalMinor > 0 &&
    docType !== "quote" &&
    docType !== "credit_note"
      ? buildSpayd({
          iban: bankSnapshot.iban,
          amountMinor: totals.totalMinor,
          currency: input.currency,
          dueDate: input.dueDate,
          variableSymbol,
          constantSymbol: input.constantSymbol,
          message: `${DOC_TYPE_LABELS[docType].short} ${finalNumber}`,
        })
      : "";

  const supplierSnapshot = {
    name: company.name,
    ico: company.ico,
    dic: company.dic,
    vatPayer: company.vatPayer,
    street: company.street,
    city: company.city,
    zip: company.zip,
    country: company.country,
    email: company.email,
    phone: company.phone,
    registryNote: company.registryNote,
  };

  const invoiceId = crypto.randomUUID();
  const status = input.action === "draft" ? "draft" : "issued";
  // Prodejky (sales receipts) are paid immediately on issue
  const immediatePaidMinor =
    docType === "sales_receipt" && status === "issued" ? totals.totalMinor : 0;

  await db.insert(invoices).values({
    id: invoiceId,
    companyId: company.id,
    sequenceId,
    contactId,
    docType,
    number: finalNumber,
    status,
    quoteStatus: "open",
    description: input.description || input.items[0]?.description || "",
    issueDate: input.issueDate,
    duzp: input.duzp,
    dueDate: input.dueDate,
    paymentMethod: input.paymentMethod,
    variableSymbol,
    constantSymbol: input.constantSymbol,
    orderNumber: input.orderNumber,
    discountPercent: input.discountPercent,
    currency: input.currency,
    exchangeRateMilli: input.exchangeRateMilli,
    printLanguage: input.printLanguage,
    priceType: input.priceType,
    vatMode: effectiveVatMode,
    roundToWhole: effectiveRound,
    showQr: input.showQr,
    noteBefore: input.noteBefore,
    noteAfter: input.noteAfter,
    tagsJson: JSON.stringify(input.tags),
    relatedDocumentId: input.relatedDocumentId ?? null,
    proformaDeductionMinor: totals.proformaDeductionMinor,
    supplierSnapshotJson: JSON.stringify(supplierSnapshot),
    customerSnapshotJson: JSON.stringify(input.customer),
    bankSnapshotJson: JSON.stringify(bankSnapshot),
    subtotalMinor: totals.subtotalMinor,
    vatTotalMinor: totals.vatTotalMinor,
    roundingMinor: totals.roundingMinor,
    totalMinor: totals.totalMinor,
    paidMinor: immediatePaidMinor,
    spaydString,
    issuedAt: status === "issued" ? now : null,
    paidAt: immediatePaidMinor > 0 ? input.issueDate : null,
    createdAt: now,
    updatedAt: now,
  });

  for (let i = 0; i < input.items.length; i++) {
    const it = input.items[i];
    const calc = totals.items[i];
    await db.insert(invoiceItems).values({
      id: crypto.randomUUID(),
      invoiceId,
      position: i,
      description: it.description,
      quantityMilli: it.quantityMilli,
      unit: it.unit,
      unitPriceMinor: it.unitPriceMinor,
      priceType: it.priceType ?? input.priceType,
      catalogItemId: it.catalogItemId ?? null,
      vatRate: calc.effectiveVatRate,
      subtotalMinor: calc.subtotalMinor,
      vatMinor: calc.vatMinor,
      totalMinor: calc.totalMinor,
    });

    // Auto stock out movement on issued invoice / sales receipt
    if (
      status === "issued" &&
      it.catalogItemId &&
      (docType === "invoice" || docType === "sales_receipt")
    ) {
      const [cat] = await db
        .select()
        .from(catalogItems)
        .where(
          and(
            eq(catalogItems.id, it.catalogItemId),
            eq(catalogItems.companyId, company.id),
          ),
        );
      if (cat && cat.trackStock) {
        await db.insert(stockMovements).values({
          id: crypto.randomUUID(),
          companyId: company.id,
          catalogItemId: cat.id,
          direction: "out",
          quantityMilli: Math.abs(it.quantityMilli),
          unitPriceMinor: it.unitPriceMinor,
          sourceDocType: docType,
          sourceDocId: invoiceId,
          note: `Výdej k dokladu ${finalNumber}`,
          movedAt: input.issueDate,
          createdAt: now,
        });
        await db
          .update(catalogItems)
          .set({
            stockQuantityMilli: cat.stockQuantityMilli - Math.abs(it.quantityMilli),
            updatedAt: now,
          })
          .where(eq(catalogItems.id, cat.id));
      }
    }
  }

  return NextResponse.json(
    { id: invoiceId, number: finalNumber, docType, status },
    { status: 201 },
  );
}
