import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  bankAccounts,
  emailLogs,
  invoiceItems,
  invoices,
  numberSequences,
  recurringInvoices,
  type Company,
  type RecurringInvoice,
} from "@/db/schema";
import { getAuthContext } from "@/lib/auth";
import {
  addDaysIso,
  buildSpayd,
  czechAccountToIban,
  extractVariableSymbol,
  formatInvoiceNumber,
  todayIso,
} from "@/lib/domain/czech";
import {
  calculateInvoiceTotals,
  formatCzk,
  type PriceType,
  type VatMode,
} from "@/lib/domain/money";
import {
  advanceRecurringDate,
  computeRecurringDuzp,
  expandRecurringPlaceholders,
  isScheduleFinished,
  normalizeStartDate,
} from "@/lib/domain/recurring";
import { sendTransactionalEmail } from "@/lib/mailer";

interface RecurringItemInput {
  description: string;
  quantityMilli: number;
  unit: string;
  unitPriceMinor: number;
  priceType?: PriceType;
  vatRate: number;
  catalogItemId?: string | null;
}

async function generateInvoiceFromRecurring(
  rec: RecurringInvoice,
  company: Company,
  issueDate: string,
): Promise<{ invoiceId: string; number: string }> {
  const now = new Date().toISOString();
  const year = Number(issueDate.slice(0, 4));
  const docType = rec.docType === "proforma" ? "proforma" : "invoice";

  const sequences = await db
    .select()
    .from(numberSequences)
    .where(eq(numberSequences.companyId, company.id));

  const seq =
    (rec.sequenceId ? sequences.find((s) => s.id === rec.sequenceId) : null) ??
    sequences.find((s) => s.docType === docType) ??
    sequences.find((s) => s.docType === "invoice") ??
    null;

  let number = docType === "proforma" ? `Z-${year}-0001` : `${year}-0001`;
  if (seq) {
    number = formatInvoiceNumber(seq.prefix, seq.year, seq.nextNumber, seq.padding);
    await db
      .update(numberSequences)
      .set({ nextNumber: seq.nextNumber + 1 })
      .where(eq(numberSequences.id, seq.id));
  }

  const accounts = await db
    .select()
    .from(bankAccounts)
    .where(eq(bankAccounts.companyId, company.id));
  const bank =
    (rec.bankAccountId ? accounts.find((b) => b.id === rec.bankAccountId) : null) ??
    accounts.find((b) => b.isDefault) ??
    accounts[0];
  const iban = bank ? bank.iban || czechAccountToIban(bank.accountNumber, bank.bankCode) : "";

  const rawItems = JSON.parse(rec.itemsJson || "[]") as RecurringItemInput[];
  const expandedItems = rawItems.map((it) => ({
    ...it,
    description: expandRecurringPlaceholders(it.description, issueDate, number),
    priceType: (it.priceType ?? rec.priceType ?? "without_vat") as PriceType,
  }));

  const dueDate = addDaysIso(issueDate, rec.dueDays);
  const duzp =
    docType === "proforma"
      ? issueDate
      : computeRecurringDuzp(issueDate, rec.duzpMode || "issue_date");

  const totals = calculateInvoiceTotals({
    items: expandedItems,
    vatMode: rec.vatMode as VatMode,
    roundToWhole: company.defaultRounding,
    discountPercent: rec.discountPercent,
    priceType: (rec.priceType as PriceType) || "without_vat",
  });

  const vs = extractVariableSymbol(number);
  const spayd =
    iban && totals.totalMinor > 0
      ? buildSpayd({
          iban,
          amountMinor: totals.totalMinor,
          currency: rec.currency,
          dueDate,
          variableSymbol: vs,
          message: `${docType === "proforma" ? "Zálohová faktura" : "Faktura"} ${number}`,
        })
      : "";

  const description = expandRecurringPlaceholders(rec.description || rec.name, issueDate, number);
  const orderNumber = expandRecurringPlaceholders(rec.orderNumber || "", issueDate, number);
  const noteBefore = expandRecurringPlaceholders(rec.noteBefore || "", issueDate, number);
  const noteAfter = expandRecurringPlaceholders(
    rec.noteAfter || company.defaultNoteAfter || "Děkujeme za spolupráci.",
    issueDate,
    number,
  );

  const invId = crypto.randomUUID();
  await db.insert(invoices).values({
    id: invId,
    companyId: company.id,
    sequenceId: seq?.id ?? null,
    contactId: rec.contactId,
    docType,
    number,
    status: "issued",
    description,
    issueDate,
    duzp,
    dueDate,
    paymentMethod: rec.paymentMethod || "bank_transfer",
    variableSymbol: vs,
    constantSymbol: rec.constantSymbol || "0308",
    orderNumber,
    discountPercent: rec.discountPercent,
    currency: rec.currency,
    printLanguage: rec.printLanguage || "cs",
    priceType: rec.priceType || "without_vat",
    vatMode: rec.vatMode,
    roundToWhole: company.defaultRounding,
    showQr: Boolean(iban),
    noteBefore,
    noteAfter,
    tagsJson: rec.tagsJson || "[]",
    recurringId: rec.id,
    supplierSnapshotJson: JSON.stringify({
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
    }),
    customerSnapshotJson: rec.customerSnapshotJson,
    bankSnapshotJson: JSON.stringify(
      bank
        ? { label: bank.label, accountNumber: bank.accountNumber, iban, swift: bank.swift }
        : { label: "", accountNumber: "", iban: "", swift: "" },
    ),
    subtotalMinor: totals.subtotalMinor,
    vatTotalMinor: totals.vatTotalMinor,
    roundingMinor: totals.roundingMinor,
    totalMinor: totals.totalMinor,
    paidMinor: 0,
    spaydString: spayd,
    issuedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  if (expandedItems.length > 0) {
    await db.insert(invoiceItems).values(
      expandedItems.map((it, i) => {
        const calc = totals.items[i];
        return {
          id: crypto.randomUUID(),
          invoiceId: invId,
          position: i,
          description: it.description,
          quantityMilli: it.quantityMilli,
          unit: it.unit,
          unitPriceMinor: it.unitPriceMinor,
          priceType: it.priceType,
          catalogItemId: it.catalogItemId ?? null,
          vatRate: calc.effectiveVatRate,
          subtotalMinor: calc.subtotalMinor,
          vatMinor: calc.vatMinor,
          totalMinor: calc.totalMinor,
        };
      }),
    );
  }

  const newIssuedCount = (rec.issuedCount ?? 0) + 1;
  const nextRunDate = advanceRecurringDate(
    rec.nextRunDate || issueDate,
    rec.frequency,
    rec.intervalCount,
    rec.issueLastDayOfMonth,
  );
  const finished = isScheduleFinished({
    endMode: rec.endMode,
    endDate: rec.endDate,
    maxOccurrences: rec.maxOccurrences,
    issuedCount: newIssuedCount,
    nextRunDate,
  });

  await db
    .update(recurringInvoices)
    .set({
      lastRunAt: now,
      issuedCount: newIssuedCount,
      nextRunDate,
      active: finished ? false : rec.active,
      updatedAt: now,
    })
    .where(eq(recurringInvoices.id, rec.id));

  // Build recipient list matching iDoklad's 4 checkboxes
  const recipients = new Set<string>();
  const cust = JSON.parse(rec.customerSnapshotJson || "{}") as { email?: string; name?: string };
  if (rec.sendEmail && cust.email?.trim()) recipients.add(cust.email.trim());
  if (rec.sendCopyToSelf && company.email?.trim()) recipients.add(company.email.trim());
  if (rec.sendToAccountant && company.accountantEmail?.trim()) {
    recipients.add(company.accountantEmail.trim());
  }
  if (rec.sendToOtherEmails?.trim()) {
    for (const part of rec.sendToOtherEmails.split(/[,;\s]+/)) {
      const cleaned = part.trim();
      if (cleaned.includes("@")) recipients.add(cleaned);
    }
  }

  const subject = `${docType === "proforma" ? "Zálohová faktura" : "Faktura"} ${number} — ${company.name}`;
  const mailBody = `Dobrý den,\n\nvystavili jsme pravidelný doklad ${number} (${description}) na částku ${formatCzk(totals.totalMinor, { currency: rec.currency })} se splatností ${dueDate}.\n\nS pozdravem,\n${company.name}`;

  for (const to of recipients) {
    const result = await sendTransactionalEmail({
      to,
      subject,
      text: mailBody,
      fromName: company.name,
    });
    await db.insert(emailLogs).values({
      id: crypto.randomUUID(),
      companyId: company.id,
      documentId: invId,
      documentNumber: number,
      kind: "invoice",
      recipientEmail: to,
      subject,
      body: mailBody,
      status: result.status,
      sentAt: now,
    });
  }

  return { invoiceId: invId, number };
}

function parseSchedulePayload(body: Record<string, unknown>, company: Company, today: string) {
  const startDateRaw =
    typeof body.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.startDate)
      ? body.startDate
      : today;
  const issueLastDayOfMonth = Boolean(body.issueLastDayOfMonth);
  const startDate = normalizeStartDate(startDateRaw, issueLastDayOfMonth);
  const docType = body.docType === "proforma" ? "proforma" : "invoice";
  const endMode =
    body.endMode === "after_date" || body.endMode === "after_count" ? body.endMode : "never";
  const endDate =
    endMode === "after_date" &&
    typeof body.endDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(body.endDate)
      ? body.endDate
      : null;
  const maxOccurrences =
    endMode === "after_count" ? Math.max(1, Number(body.maxOccurrences) || 1) : null;

  const validVatModes: VatMode[] = ["standard", "non_vat", "reverse_charge"];
  const vatMode = validVatModes.includes(body.vatMode as VatMode)
    ? (body.vatMode as VatMode)
    : company.vatPayer
      ? "standard"
      : "non_vat";

  const tags = Array.isArray(body.tags)
    ? body.tags.map((t) => String(t).trim()).filter(Boolean)
    : [];

  return {
    name: typeof body.name === "string" ? body.name.trim() : "",
    docType,
    sequenceId: typeof body.sequenceId === "string" && body.sequenceId ? body.sequenceId : null,
    contactId: typeof body.contactId === "string" && body.contactId ? body.contactId : null,
    customerSnapshotJson: JSON.stringify(body.customer ?? {}),
    orderNumber: typeof body.orderNumber === "string" ? body.orderNumber.trim() : "",
    description: typeof body.description === "string" ? body.description.trim() : "",
    frequency:
      typeof body.frequency === "string" &&
      ["daily", "weekly", "monthly", "quarterly", "yearly"].includes(body.frequency)
        ? body.frequency
        : "monthly",
    intervalCount: Math.max(1, Math.floor(Number(body.intervalCount) || 1)),
    startDate,
    nextRunDate: startDate,
    issueLastDayOfMonth,
    endMode,
    endDate,
    maxOccurrences,
    duzpMode: body.duzpMode === "last_day_of_month" ? "last_day_of_month" : "issue_date",
    dueDays: Math.max(0, Math.min(365, Number(body.dueDays) ?? company.defaultDueDays)),
    paymentMethod:
      typeof body.paymentMethod === "string" && body.paymentMethod
        ? body.paymentMethod
        : "bank_transfer",
    bankAccountId:
      typeof body.bankAccountId === "string" && body.bankAccountId ? body.bankAccountId : null,
    constantSymbol:
      typeof body.constantSymbol === "string" ? body.constantSymbol.trim() : "0308",
    currency: typeof body.currency === "string" && body.currency ? body.currency : "CZK",
    vatMode,
    priceType: body.priceType === "with_vat" ? "with_vat" : "without_vat",
    printLanguage: body.printLanguage === "en" ? "en" : "cs",
    discountPercent: Math.max(0, Math.min(100, Number(body.discountPercent) || 0)),
    itemsJson: JSON.stringify(Array.isArray(body.items) ? body.items : []),
    noteBefore: typeof body.noteBefore === "string" ? body.noteBefore : "",
    noteAfter: typeof body.noteAfter === "string" ? body.noteAfter : "",
    internalNote: typeof body.internalNote === "string" ? body.internalNote : "",
    tagsJson: JSON.stringify(tags),
    sendEmail: Boolean(body.sendEmail),
    sendCopyToSelf: Boolean(body.sendCopyToSelf),
    sendToAccountant: Boolean(body.sendToAccountant),
    sendToOtherEmails:
      typeof body.sendToOtherEmails === "string" ? body.sendToOtherEmails.trim() : "",
  };
}

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });

  const list = await db
    .select()
    .from(recurringInvoices)
    .where(eq(recurringInvoices.companyId, ctx.activeCompany.id))
    .orderBy(desc(recurringInvoices.createdAt));

  return NextResponse.json({ data: list });
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });

  const now = new Date().toISOString();
  const today = todayIso();

  // 1. Run single recurring schedule now
  if (body.action === "run_now" && typeof body.id === "string") {
    const [rec] = await db
      .select()
      .from(recurringInvoices)
      .where(
        and(
          eq(recurringInvoices.id, body.id),
          eq(recurringInvoices.companyId, ctx.activeCompany.id),
        ),
      );
    if (!rec) {
      return NextResponse.json({ error: "Pravidelná faktura nenalezena." }, { status: 404 });
    }
    const created = await generateInvoiceFromRecurring(rec, ctx.activeCompany, today);
    return NextResponse.json({ ok: true, ...created }, { status: 201 });
  }

  // 2. Duplicate recurring template (iDoklad "Kopírovat vzor")
  if (body.action === "duplicate" && typeof body.id === "string") {
    const [rec] = await db
      .select()
      .from(recurringInvoices)
      .where(
        and(
          eq(recurringInvoices.id, body.id),
          eq(recurringInvoices.companyId, ctx.activeCompany.id),
        ),
      );
    if (!rec) {
      return NextResponse.json({ error: "Pravidelná faktura nenalezena." }, { status: 404 });
    }
    const copyId = crypto.randomUUID();
    await db.insert(recurringInvoices).values({
      ...rec,
      id: copyId,
      name: `${rec.name} (kopie)`,
      issuedCount: 0,
      lastRunAt: null,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    return NextResponse.json({ ok: true, id: copyId }, { status: 201 });
  }

  // 3. Run all due active recurring schedules (nextRunDate <= today)
  if (body.action === "run_due") {
    const all = await db
      .select()
      .from(recurringInvoices)
      .where(
        and(
          eq(recurringInvoices.companyId, ctx.activeCompany.id),
          eq(recurringInvoices.active, true),
        ),
      );
    const due = all.filter((r) => r.nextRunDate <= today && !isScheduleFinished(r));
    const generated: Array<{ invoiceId: string; number: string }> = [];
    for (const rec of due) {
      generated.push(await generateInvoiceFromRecurring(rec, ctx.activeCompany, today));
    }
    return NextResponse.json({ ok: true, count: generated.length, generated }, { status: 201 });
  }

  // 4. Create new recurring invoice schedule
  const payload = parseSchedulePayload(body, ctx.activeCompany, today);
  if (!payload.name) {
    return NextResponse.json({ error: "Zadejte název vzoru pravidelné faktury." }, { status: 400 });
  }

  const id = crypto.randomUUID();
  await db.insert(recurringInvoices).values({
    id,
    companyId: ctx.activeCompany.id,
    ...payload,
    description: payload.description || payload.name,
    issuedCount: 0,
    active: true,
    createdAt: now,
    updatedAt: now,
  });

  return NextResponse.json({ id }, { status: 201 });
}

export async function PATCH(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.id !== "string") {
    return NextResponse.json({ error: "Chybí id." }, { status: 400 });
  }

  const now = new Date().toISOString();

  // Quick toggle active/paused
  if (typeof body.active === "boolean" && Object.keys(body).length <= 2) {
    await db
      .update(recurringInvoices)
      .set({ active: body.active, updatedAt: now })
      .where(
        and(
          eq(recurringInvoices.id, body.id),
          eq(recurringInvoices.companyId, ctx.activeCompany.id),
        ),
      );
    return NextResponse.json({ ok: true });
  }

  // Full edit of recurring schedule
  const today = todayIso();
  const payload = parseSchedulePayload(body, ctx.activeCompany, today);
  if (!payload.name) {
    return NextResponse.json({ error: "Zadejte název vzoru pravidelné faktury." }, { status: 400 });
  }

  await db
    .update(recurringInvoices)
    .set({
      ...payload,
      description: payload.description || payload.name,
      active: typeof body.active === "boolean" ? body.active : true,
      updatedAt: now,
    })
    .where(
      and(
        eq(recurringInvoices.id, body.id),
        eq(recurringInvoices.companyId, ctx.activeCompany.id),
      ),
    );

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Chybí id." }, { status: 400 });

  await db
    .delete(recurringInvoices)
    .where(and(eq(recurringInvoices.id, id), eq(recurringInvoices.companyId, ctx.activeCompany.id)));
  return NextResponse.json({ ok: true });
}
