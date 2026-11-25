import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  bankAccounts,
  catalogItems,
  contacts,
  invoiceTemplates,
  numberSequences,
} from "@/db/schema";
import { getAuthContext } from "@/lib/auth";
import {
  addDaysIso,
  czechAccountToIban,
  extractVariableSymbol,
  formatInvoiceNumber,
  todayIso,
} from "@/lib/domain/czech";
import { DOC_TYPE_LABELS, type PriceType, type SalesDocType, type VatMode } from "@/lib/domain/money";
import { InvoiceEditorClient } from "@/components/InvoiceEditorClient";

export const dynamic = "force-dynamic";

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ contactId?: string; docType?: string; templateId?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) return null;

  const sp = await searchParams;
  const company = ctx.activeCompany;
  const requestedDocType: SalesDocType =
    sp.docType && sp.docType in DOC_TYPE_LABELS
      ? (sp.docType as SalesDocType)
      : "invoice";

  const [contactRows, bankRows, seqRows, catalogRows, templateRows] = await Promise.all([
    db
      .select()
      .from(contacts)
      .where(eq(contacts.companyId, company.id))
      .orderBy(asc(contacts.name)),
    db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.companyId, company.id))
      .orderBy(asc(bankAccounts.createdAt)),
    db
      .select()
      .from(numberSequences)
      .where(eq(numberSequences.companyId, company.id))
      .orderBy(asc(numberSequences.year)),
    db
      .select()
      .from(catalogItems)
      .where(eq(catalogItems.companyId, company.id))
      .orderBy(asc(catalogItems.name)),
    sp.templateId
      ? db
          .select()
          .from(invoiceTemplates)
          .where(
            and(
              eq(invoiceTemplates.id, sp.templateId),
              eq(invoiceTemplates.companyId, company.id),
            ),
          )
      : Promise.resolve([]),
  ]);

  const tpl = templateRows[0];
  const docType: SalesDocType = tpl ? ((tpl.docType as SalesDocType) || "invoice") : requestedDocType;

  const defaultBank = bankRows.find((b) => b.isDefault) ?? bankRows[0];
  const matchingSeq =
    seqRows.find((s) => s.docType === docType && s.isDefault) ??
    seqRows.find((s) => s.docType === docType);
  const today = todayIso();
  const year = Number(today.slice(0, 4));
  const nextNumber = matchingSeq
    ? formatInvoiceNumber(
        matchingSeq.prefix,
        matchingSeq.year,
        matchingSeq.nextNumber,
        matchingSeq.padding,
      )
    : `${DOC_TYPE_LABELS[docType].prefix}${year}-0001`;

  const preselectedContact = sp.contactId
    ? contactRows.find((c) => c.id === sp.contactId)
    : tpl?.contactId
      ? contactRows.find((c) => c.id === tpl.contactId)
      : undefined;

  const tplCustomer = tpl ? JSON.parse(tpl.customerSnapshotJson) : null;
  const tplItems = tpl
    ? (JSON.parse(tpl.itemsJson) as Array<{
        description: string;
        quantityMilli: number;
        unit: string;
        unitPriceMinor: number;
        vatRate: number;
      }>)
    : [];

  const dueDays =
    tpl?.dueDays ?? preselectedContact?.defaultDueDays ?? company.defaultDueDays ?? 14;

  return (
    <InvoiceEditorClient
      mode="create"
      supplier={{
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
      }}
      contacts={contactRows}
      bankAccounts={bankRows}
      catalogItems={catalogRows}
      sequences={seqRows
        .filter((s) => s.docType === docType)
        .map((s) => ({
          id: s.id,
          name: s.name,
          nextFormatted: formatInvoiceNumber(s.prefix, s.year, s.nextNumber, s.padding),
        }))}
      initialData={{
        docType,
        priceType: ((tpl?.priceType ?? company.defaultPriceType) as PriceType) || "without_vat",
        printLanguage: (company.defaultPrintLang === "en" ? "en" : "cs"),
        sequenceId: matchingSeq?.id ?? "",
        number: nextNumber,
        contactId: preselectedContact?.id ?? "",
        customer: preselectedContact
          ? {
              name: preselectedContact.name,
              ico: preselectedContact.ico,
              dic: preselectedContact.dic,
              vatPayer: preselectedContact.vatPayer,
              street: preselectedContact.street,
              city: preselectedContact.city,
              zip: preselectedContact.zip,
              country: preselectedContact.country,
              email: preselectedContact.email,
            }
          : tplCustomer?.name
            ? tplCustomer
            : {
                name: "",
                ico: "",
                dic: "",
                vatPayer: false,
                street: "",
                city: "",
                zip: "",
                country: "Česká republika",
                email: "",
              },
        issueDate: today,
        duzp: today,
        dueDays,
        dueDate: addDaysIso(today, dueDays),
        paymentMethod: (tpl?.paymentMethod as "bank_transfer" | "cash" | "card") || "bank_transfer",
        bankAccountId: defaultBank?.id ?? "",
        bankAccountNumber: defaultBank?.accountNumber ?? "",
        bankIban:
          defaultBank?.iban ||
          czechAccountToIban(defaultBank?.accountNumber ?? ""),
        bankSwift: defaultBank?.swift ?? "",
        variableSymbol: extractVariableSymbol(nextNumber),
        constantSymbol: "0308",
        orderNumber: "",
        discountPercent: tpl?.discountPercent ?? preselectedContact?.defaultDiscountPercent ?? 0,
        currency: tpl?.currency || company.defaultCurrency || "CZK",
        vatMode: company.vatPayer ? ((tpl?.vatMode as VatMode) || "standard") : "non_vat",
        roundToWhole: company.defaultRounding,
        showQr: docType !== "quote" && docType !== "credit_note",
        noteBefore: tpl?.noteBefore ?? company.defaultNoteBefore,
        noteAfter: tpl?.noteAfter ?? (company.defaultNoteAfter || "Děkujeme za spolupráci."),
        items:
          tplItems.length > 0
            ? tplItems.map((it, i) => ({
                id: `tpl-${i}`,
                description: it.description,
                quantityStr: String(it.quantityMilli / 1000).replace(".", ","),
                unit: it.unit,
                unitPriceStr: String(it.unitPriceMinor / 100).replace(".", ","),
                vatRate: it.vatRate,
              }))
            : [
                {
                  id: "row-1",
                  description: "",
                  quantityStr: "1",
                  unit: "ks",
                  unitPriceStr: "",
                  vatRate: company.vatPayer ? company.defaultVatRate : 0,
                },
              ],
      }}
    />
  );
}
