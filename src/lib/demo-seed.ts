import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  bankAccounts,
  companies,
  contacts,
  invoiceItems,
  invoices,
  numberSequences,
  paymentAllocations,
  payments,
  type Company,
} from "@/db/schema";
import {
  addDaysIso,
  buildSpayd,
  czechAccountToIban,
  extractVariableSymbol,
  formatInvoiceNumber,
  todayIso,
} from "@/lib/domain/czech";
import { calculateInvoiceTotals } from "@/lib/domain/money";

export async function seedDemoDataForCompany(company: Company) {
  const now = new Date().toISOString();
  const today = todayIso();
  const year = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7));

  // Ensure rich supplier identity if blank
  if (!company.ico) {
    await db
      .update(companies)
      .set({
        name: "Studio Lípa s.r.o.",
        ico: "08765430",
        dic: "CZ08765430",
        vatPayer: true,
        vatPeriod: "monthly",
        street: "Vodičkova 710/31",
        city: "Praha 1",
        zip: "110 00",
        email: company.email || "fakturace@studiolipa.cz",
        phone: "+420 222 104 890",
        registryNote: "Zapsána v OR u Městského soudu v Praze, oddíl C, vložka 321456",
        annualPlanMinor: 450000000,
        updatedAt: now,
      })
      .where(eq(companies.id, company.id));
  }

  const [freshCompany] = await db
    .select()
    .from(companies)
    .where(eq(companies.id, company.id));

  const accounts = await db
    .select()
    .from(bankAccounts)
    .where(eq(bankAccounts.companyId, company.id));

  const primaryAcc = accounts[0] ?? {
    label: "Hlavní účet CZK",
    accountNumber: "19-2000145399/0800",
    iban: czechAccountToIban("19-2000145399/0800"),
    swift: "GIBACZPX",
  };

  const demoContacts = [
    {
      name: "Nordbyte a.s.",
      ico: "19876548",
      dic: "CZ19876548",
      vatPayer: true,
      street: "Rohanské nábřeží 678/23",
      city: "Praha 8",
      zip: "186 00",
      email: "ucetni@nordbyte.cz",
    },
    {
      name: "Dvořák Consulting s.r.o.",
      ico: "28639049",
      dic: "CZ28639049",
      vatPayer: true,
      street: "Veveří 111",
      city: "Brno",
      zip: "616 00",
      email: "fakturace@dvorakconsulting.cz",
    },
    {
      name: "Studio Kalich s.r.o.",
      ico: "09451277",
      dic: "CZ09451277",
      vatPayer: true,
      street: "Jungmannova 26/15",
      city: "Praha 1",
      zip: "110 00",
      email: "billing@studiokalich.cz",
    },
    {
      name: "Kovárna Hrubý s.r.o.",
      ico: "06234178",
      dic: "CZ06234178",
      vatPayer: true,
      street: "Nádražní 42",
      city: "Plzeň",
      zip: "301 00",
      email: "faktury@kovarnahruby.cz",
    },
    {
      name: "Vinařství Horák & syn s.r.o.",
      ico: "27190536",
      dic: "CZ27190536",
      vatPayer: true,
      street: "Sklepní 18",
      city: "Velké Bílovice",
      zip: "691 02",
      email: "obchod@vinarstvihorak.cz",
    },
    {
      name: "Pekárna U Mlýna s.r.o.",
      ico: "07318260",
      dic: "",
      vatPayer: false,
      street: "Mlýnská 5",
      city: "Olomouc",
      zip: "779 00",
      email: "objednavky@pekarnamlyn.cz",
    },
  ];

  const insertedContacts: Array<typeof demoContacts[number] & { id: string }> = [];
  for (const c of demoContacts) {
    const id = crypto.randomUUID();
    await db.insert(contacts).values({
      id,
      companyId: company.id,
      ...c,
      country: "Česká republika",
      phone: "",
      web: "",
      defaultDueDays: 14,
      note: "",
      aresVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    insertedContacts.push({ ...c, id });
  }

  const supplierSnapshot = {
    name: freshCompany.name,
    ico: freshCompany.ico,
    dic: freshCompany.dic,
    vatPayer: freshCompany.vatPayer,
    street: freshCompany.street,
    city: freshCompany.city,
    zip: freshCompany.zip,
    country: freshCompany.country,
    email: freshCompany.email,
    phone: freshCompany.phone,
    registryNote: freshCompany.registryNote,
  };

  const bankSnapshot = {
    label: primaryAcc.label,
    accountNumber: primaryAcc.accountNumber,
    iban: primaryAcc.iban,
    swift: primaryAcc.swift,
  };

  // Create monthly invoices across the year so chart + KPIs + filters look rich & authentic
  const monthlySpecs = [
    { month: 1, day: 15, cIdx: 0, desc: "Produktový design a UX audit", baseCzk: 248000, state: "paid" as const },
    { month: 2, day: 18, cIdx: 1, desc: "Vývoj webové platformy — fáze 1", baseCzk: 235000, state: "paid" as const },
    { month: 3, day: 20, cIdx: 2, desc: "Design systém a knihovna komponent", baseCzk: 325000, state: "paid" as const },
    { month: 4, day: 14, cIdx: 3, desc: "B2B klientský portál — analýza", baseCzk: 290000, state: "paid" as const },
    { month: 5, day: 22, cIdx: 4, desc: "E-shop na míru a integrace skladu", baseCzk: 315000, state: "paid" as const },
    { month: 6, day: 19, cIdx: 0, desc: "Rozšíření API a automatizace", baseCzk: 278000, state: "paid" as const },
    { month: 7, day: 16, cIdx: 1, desc: "Konzultace architektury a výkonu", baseCzk: 242000, state: "paid" as const },
    { month: 8, day: 21, cIdx: 2, desc: "Mobilní zobrazení a přístupnost", baseCzk: 215000, state: "paid" as const },
    { month: 9, day: 18, cIdx: 3, desc: "Implementace fakturačního modulu", baseCzk: 340000, state: "paid" as const },
    { month: 10, day: 12, cIdx: 0, desc: "Říjnový vývojový sprint — frontend", baseCzk: 410000, state: "paid" as const },
    // Current month & overdue mix
    { month: currentMonth, day: 2, cIdx: 0, desc: "Integrace účetních exportů — etapa 2", baseCzk: 38000, state: "overdue" as const },
    { month: currentMonth, day: 5, cIdx: 1, desc: "Bezpečnostní audit a pen-test", baseCzk: 29000, state: "overdue" as const },
    { month: currentMonth, day: 8, cIdx: 2, desc: "Redesign klientské sekce", baseCzk: 18000, state: "partial" as const },
    { month: currentMonth, day: Math.min(20, Number(today.slice(8, 10))), cIdx: 3, desc: "Měsíční správa infrastruktury", baseCzk: 26000, state: "sent" as const },
    { month: currentMonth, day: Math.min(22, Number(today.slice(8, 10))), cIdx: 4, desc: "Konzultace a školení týmu", baseCzk: 31000, state: "sent" as const },
    { month: currentMonth, day: Math.min(24, Number(today.slice(8, 10))), cIdx: 5, desc: "Grafické podklady pro katalog", baseCzk: 8000, state: "draft" as const },
  ].filter((spec) => spec.month <= currentMonth);

  const [seq] = await db
    .select()
    .from(numberSequences)
    .where(eq(numberSequences.companyId, company.id));

  let nextNum = seq?.nextNumber ?? 1;

  for (const spec of monthlySpecs) {
    const invId = crypto.randomUUID();
    const numStr = formatInvoiceNumber("", year, nextNum++, 4);
    const contact = insertedContacts[spec.cIdx];
    const issueDate = `${year}-${String(spec.month).padStart(2, "0")}-${String(spec.day).padStart(2, "0")}`;
    const dueDate =
      spec.state === "overdue"
        ? addDaysIso(today, -12)
        : addDaysIso(issueDate, 14);

    const items = [
      {
        description: spec.desc,
        quantityMilli: 1000,
        unit: "ks",
        unitPriceMinor: spec.baseCzk * 100,
        vatRate: 21,
      },
    ];
    const totals = calculateInvoiceTotals({
      items,
      vatMode: "standard",
      roundToWhole: false,
    });
    const vs = extractVariableSymbol(numStr);
    const spayd = buildSpayd({
      iban: bankSnapshot.iban,
      amountMinor: totals.totalMinor,
      currency: "CZK",
      dueDate,
      variableSymbol: vs,
      message: `Faktura ${numStr}`,
    });

    const paidMinor =
      spec.state === "paid"
        ? totals.totalMinor
        : spec.state === "partial"
          ? Math.round(totals.totalMinor / 2)
          : 0;
    const paidAt = paidMinor > 0 ? addDaysIso(issueDate, 6) : null;

    await db.insert(invoices).values({
      id: invId,
      companyId: company.id,
      sequenceId: seq?.id ?? null,
      contactId: contact.id,
      docType: "invoice",
      number: numStr,
      status: spec.state === "draft" ? "draft" : "issued",
      issueDate,
      duzp: issueDate,
      dueDate,
      paymentMethod: "bank_transfer",
      variableSymbol: vs,
      constantSymbol: "0308",
      orderNumber: "",
      discountPercent: 0,
      currency: "CZK",
      vatMode: "standard",
      roundToWhole: false,
      showQr: true,
      noteBefore: "",
      noteAfter: "Děkujeme za spolupráci.",
      supplierSnapshotJson: JSON.stringify(supplierSnapshot),
      customerSnapshotJson: JSON.stringify(contact),
      bankSnapshotJson: JSON.stringify(bankSnapshot),
      subtotalMinor: totals.subtotalMinor,
      vatTotalMinor: totals.vatTotalMinor,
      roundingMinor: totals.roundingMinor,
      totalMinor: totals.totalMinor,
      paidMinor,
      spaydString: spayd,
      issuedAt: spec.state === "draft" ? null : now,
      paidAt,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(invoiceItems).values({
      id: crypto.randomUUID(),
      invoiceId: invId,
      position: 0,
      description: spec.desc,
      quantityMilli: 1000,
      unit: "ks",
      unitPriceMinor: spec.baseCzk * 100,
      vatRate: 21,
      subtotalMinor: totals.items[0].subtotalMinor,
      vatMinor: totals.items[0].vatMinor,
      totalMinor: totals.items[0].totalMinor,
    });

    if (paidMinor > 0 && paidAt) {
      const payId = crypto.randomUUID();
      await db.insert(payments).values({
        id: payId,
        companyId: company.id,
        amountMinor: paidMinor,
        currency: "CZK",
        paidAt,
        method: "bank_transfer",
        variableSymbol: vs,
        note: spec.state === "partial" ? "Částečná úhrada" : "Bankovní převod",
        createdAt: now,
      });
      await db.insert(paymentAllocations).values({
        id: crypto.randomUUID(),
        paymentId: payId,
        invoiceId: invId,
        amountMinor: paidMinor,
        createdAt: now,
      });
    }
  }

  if (seq) {
    await db
      .update(numberSequences)
      .set({ nextNumber: nextNum })
      .where(eq(numberSequences.id, seq.id));
  }

  return { seededInvoices: monthlySpecs.length, seededContacts: insertedContacts.length };
}
