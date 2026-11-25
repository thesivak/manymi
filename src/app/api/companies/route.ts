import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, ensureDatabaseReady } from "@/db";
import {
  companies,
  companyMemberships,
  bankAccounts,
  numberSequences,
  userPreferences,
} from "@/db/schema";
import { getAuthContext } from "@/lib/auth";
import { czechAccountToIban } from "@/lib/domain/czech";

const createCompanySchema = z.object({
  name: z.string().trim().min(1, "Zadejte název firmy."),
  ico: z.string().trim().optional().default(""),
  dic: z.string().trim().optional().default(""),
  vatPayer: z.boolean().optional().default(true),
  vatPeriod: z.enum(["monthly", "quarterly", "none"]).optional(),
  street: z.string().trim().optional().default(""),
  city: z.string().trim().optional().default(""),
  zip: z.string().trim().optional().default(""),
  email: z.string().trim().optional().default(""),
  registryNote: z.string().trim().optional().default(""),
  accountNumber: z.string().trim().optional().default(""),
  swift: z.string().trim().optional().default(""),
});

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  }
  return NextResponse.json({
    activeCompanyId: ctx.activeCompany.id,
    companies: ctx.companies,
  });
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createCompanySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Neplatná data firmy." },
      { status: 400 },
    );
  }

  await ensureDatabaseReady();
  const now = new Date().toISOString();
  const year = new Date().getFullYear();
  const companyId = crypto.randomUUID();
  const input = parsed.data;

  await db.insert(companies).values({
    id: companyId,
    name: input.name,
    ico: input.ico,
    dic: input.vatPayer ? input.dic : "",
    vatPayer: input.vatPayer,
    vatPeriod: !input.vatPayer ? "none" : input.vatPeriod && input.vatPeriod !== "none" ? input.vatPeriod : "monthly",
    street: input.street,
    city: input.city,
    zip: input.zip,
    country: "Česká republika",
    email: input.email || ctx.userEmail,
    phone: "",
    web: "",
    registryNote: input.registryNote,
    defaultDueDays: 14,
    defaultVatRate: input.vatPayer ? 21 : 0,
    defaultCurrency: "CZK",
    defaultRounding: false,
    defaultNoteBefore: "",
    defaultNoteAfter: "Děkujeme za spolupráci.",
    annualPlanMinor: 250000000,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(companyMemberships).values({
    id: crypto.randomUUID(),
    companyId,
    clerkUserId: ctx.clerkUserId,
    role: "owner",
    createdAt: now,
  });

  if (input.accountNumber) {
    const bankCode = input.accountNumber.includes("/")
      ? input.accountNumber.split("/")[1] ?? ""
      : "";
    await db.insert(bankAccounts).values({
      id: crypto.randomUUID(),
      companyId,
      label: "Hlavní účet CZK",
      accountNumber: input.accountNumber,
      bankCode,
      iban: czechAccountToIban(input.accountNumber),
      swift: input.swift,
      currency: "CZK",
      isDefault: true,
      createdAt: now,
    });
  }

  await db.insert(numberSequences).values({
    id: crypto.randomUUID(),
    companyId,
    docType: "invoice",
    name: "Vydané faktury",
    prefix: "",
    year,
    nextNumber: 1,
    padding: 4,
    isDefault: true,
    createdAt: now,
  });

  await db
    .insert(userPreferences)
    .values({
      clerkUserId: ctx.clerkUserId,
      activeCompanyId: companyId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userPreferences.clerkUserId,
      set: { activeCompanyId: companyId, updatedAt: now },
    });

  return NextResponse.json({ id: companyId }, { status: 201 });
}
