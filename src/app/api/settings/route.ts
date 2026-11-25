import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { bankAccounts, companies, numberSequences } from "@/db/schema";
import { getAuthContext } from "@/lib/auth";
import { czechAccountToIban } from "@/lib/domain/czech";

const companyPatchSchema = z.object({
  name: z.string().trim().min(1, "Název firmy nesmí být prázdný."),
  ico: z.string().trim().default(""),
  dic: z.string().trim().default(""),
  vatPayer: z.boolean().default(true),
  vatPeriod: z.enum(["monthly", "quarterly", "none"]).default("monthly"),
  street: z.string().trim().default(""),
  city: z.string().trim().default(""),
  zip: z.string().trim().default(""),
  country: z.string().trim().default("Česká republika"),
  email: z.string().trim().default(""),
  phone: z.string().trim().default(""),
  web: z.string().trim().default(""),
  registryNote: z.string().trim().default(""),
  defaultDueDays: z.number().int().min(0).max(365).default(14),
  defaultVatRate: z.number().int().refine((v) => v === 0 || v === 12 || v === 21).default(21),
  defaultRounding: z.boolean().default(false),
  defaultPriceType: z.enum(["without_vat", "with_vat"]).optional().default("without_vat"),
  defaultPrintLang: z.enum(["cs", "en"]).optional().default("cs"),
  defaultNoteBefore: z.string().optional().default(""),
  defaultNoteAfter: z.string().default(""),
  accountantEmail: z.string().trim().optional().default(""),
  reminderEnabled: z.boolean().optional().default(false),
  reminderDaysAfter: z.number().int().min(1).max(90).optional().default(7),
  thankYouEnabled: z.boolean().optional().default(false),
  annualPlanMinor: z.number().int().min(0).default(250000000),
  bankAccountNumber: z.string().trim().optional(),
  bankSwift: z.string().trim().optional(),
});

const settingsActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("add_bank"),
    label: z.string().trim().min(1, "Zadejte název účtu."),
    accountNumber: z.string().trim().min(3, "Zadejte číslo účtu."),
    iban: z.string().trim().optional().default(""),
    swift: z.string().trim().optional().default(""),
    currency: z.string().trim().default("CZK"),
    isDefault: z.boolean().optional().default(false),
  }),
  z.object({
    kind: z.literal("delete_bank"),
    id: z.string().min(1),
  }),
  z.object({
    kind: z.literal("set_default_bank"),
    id: z.string().min(1),
  }),
  z.object({
    kind: z.literal("upsert_sequence"),
    id: z.string().optional(),
    name: z.string().trim().min(1),
    prefix: z.string().trim().default(""),
    year: z.number().int().min(2000).max(2100),
    nextNumber: z.number().int().min(1),
    padding: z.number().int().min(2).max(6).default(4),
  }),
]);

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  }

  const [accounts, sequences] = await Promise.all([
    db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.companyId, ctx.activeCompany.id))
      .orderBy(asc(bankAccounts.createdAt)),
    db
      .select()
      .from(numberSequences)
      .where(eq(numberSequences.companyId, ctx.activeCompany.id))
      .orderBy(asc(numberSequences.year)),
  ]);

  return NextResponse.json({
    company: ctx.activeCompany,
    companies: ctx.companies,
    bankAccounts: accounts,
    numberSequences: sequences,
  });
}

export async function PATCH(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const parsed = companyPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Neplatná data firmy." },
      { status: 400 },
    );
  }

  const { bankAccountNumber, bankSwift, ...companyFields } = parsed.data;
  const now = new Date().toISOString();

  await db
    .update(companies)
    .set({
      ...companyFields,
      updatedAt: now,
    })
    .where(eq(companies.id, ctx.activeCompany.id));

  if (bankAccountNumber) {
    const bankCode = bankAccountNumber.includes("/")
      ? bankAccountNumber.split("/")[1] ?? ""
      : "";
    const iban = czechAccountToIban(bankAccountNumber, bankCode);
    await db
      .delete(bankAccounts)
      .where(
        and(
          eq(bankAccounts.companyId, ctx.activeCompany.id),
          eq(bankAccounts.accountNumber, "2100000000/2010"),
        ),
      );
    await db
      .update(bankAccounts)
      .set({ isDefault: false })
      .where(eq(bankAccounts.companyId, ctx.activeCompany.id));
    await db.insert(bankAccounts).values({
      id: crypto.randomUUID(),
      companyId: ctx.activeCompany.id,
      label: "Hlavní účet CZK",
      accountNumber: bankAccountNumber,
      bankCode,
      iban,
      swift: bankSwift ?? "",
      currency: "CZK",
      isDefault: true,
      createdAt: now,
    });
  }

  const [updated] = await db
    .select()
    .from(companies)
    .where(eq(companies.id, ctx.activeCompany.id));
  return NextResponse.json({ company: updated });
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const parsed = settingsActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Neplatný požadavek." },
      { status: 400 },
    );
  }

  const companyId = ctx.activeCompany.id;
  const now = new Date().toISOString();
  const data = parsed.data;

  if (data.kind === "add_bank") {
    const bankCode = data.accountNumber.includes("/")
      ? data.accountNumber.split("/")[1] ?? ""
      : "";
    const iban = data.iban || czechAccountToIban(data.accountNumber, bankCode);
    if (data.isDefault) {
      await db
        .update(bankAccounts)
        .set({ isDefault: false })
        .where(eq(bankAccounts.companyId, companyId));
    }
    const id = crypto.randomUUID();
    await db.insert(bankAccounts).values({
      id,
      companyId,
      label: data.label,
      accountNumber: data.accountNumber,
      bankCode,
      iban,
      swift: data.swift,
      currency: data.currency,
      isDefault: data.isDefault,
      createdAt: now,
    });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  }

  if (data.kind === "delete_bank") {
    await db
      .delete(bankAccounts)
      .where(and(eq(bankAccounts.id, data.id), eq(bankAccounts.companyId, companyId)));
    return NextResponse.json({ ok: true });
  }

  if (data.kind === "set_default_bank") {
    await db
      .update(bankAccounts)
      .set({ isDefault: false })
      .where(eq(bankAccounts.companyId, companyId));
    await db
      .update(bankAccounts)
      .set({ isDefault: true })
      .where(and(eq(bankAccounts.id, data.id), eq(bankAccounts.companyId, companyId)));
    return NextResponse.json({ ok: true });
  }

  if (data.kind === "upsert_sequence") {
    if (data.id) {
      await db
        .update(numberSequences)
        .set({
          name: data.name,
          prefix: data.prefix,
          year: data.year,
          nextNumber: data.nextNumber,
          padding: data.padding,
        })
        .where(and(eq(numberSequences.id, data.id), eq(numberSequences.companyId, companyId)));
      return NextResponse.json({ ok: true, id: data.id });
    }
    const id = crypto.randomUUID();
    await db.insert(numberSequences).values({
      id,
      companyId,
      docType: "invoice",
      name: data.name,
      prefix: data.prefix,
      year: data.year,
      nextNumber: data.nextNumber,
      padding: data.padding,
      isDefault: false,
      createdAt: now,
    });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  }

  return NextResponse.json({ error: "Neznámá akce." }, { status: 400 });
}
