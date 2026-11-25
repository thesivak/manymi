import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { lookupAresByIco } from "../ares";
import { calculateInvoiceTotals } from "../money";
import { db, ensureDatabaseReady } from "@/db";
import {
  companies,
  companyMemberships,
  contacts,
  invoiceItems,
  invoices,
  paymentAllocations,
  payments,
  userPreferences,
} from "@/db/schema";
import { switchActiveCompany } from "@/lib/auth";

describe("sleva na fakturu a složené DPH výpočty", () => {
  it("správně aplikuje 10% slevu před výpočtem DPH ve dvou sazbách", () => {
    const totals = calculateInvoiceTotals({
      vatMode: "standard",
      roundToWhole: false,
      discountPercent: 10,
      items: [
        { quantityMilli: 1000, unitPriceMinor: 100000, vatRate: 21 }, // 1000 -> 900 + 189 DPH
        { quantityMilli: 2000, unitPriceMinor: 50000, vatRate: 12 }, // 1000 -> 900 + 108 DPH
      ],
    });
    expect(totals.rawSubtotalMinor).toBe(200000);
    expect(totals.discountMinor).toBe(20000);
    expect(totals.subtotalMinor).toBe(180000);
    expect(totals.vatTotalMinor).toBe(29700);
    expect(totals.totalMinor).toBe(209700);
  });
});

describe("živé veřejné ARES REST API (MFČR)", () => {
  it("načte reálný subjekt z ARES podle platného IČO", async () => {
    const subject = await lookupAresByIco("27082440");
    expect(subject.ico).toBe("27082440");
    expect(subject.name.toLowerCase()).toContain("alza");
    expect(subject.dic).toBe("CZ27082440");
    expect(subject.vatPayer).toBe(true);
    expect(subject.city.length).toBeGreaterThan(0);
  }, 15000);

  it("odmítne neplatné IČO ještě před voláním ARES", async () => {
    await expect(lookupAresByIco("27082441")).rejects.toThrow(/kontrolní součet/);
  });
});

describe("Supabase PostgreSQL end-to-end doménový průchod", () => {
  const hasPg = Boolean(process.env.DATABASE_URL?.startsWith("postgres"));

  it.skipIf(!hasPg)(
    "vytvoří firmu, kontakt, fakturu, částečnou i plnou úhradu a čistě uklidí",
    async () => {
      await ensureDatabaseReady();
      const now = new Date().toISOString();
      const companyId = `test-co-${crypto.randomUUID()}`;
      const contactId = `test-ct-${crypto.randomUUID()}`;
      const invoiceId = `test-inv-${crypto.randomUUID()}`;
      const paymentId = `test-pay-${crypto.randomUUID()}`;

      try {
        await db.insert(companies).values({
          id: companyId,
          name: "Test CleanRoom s.r.o.",
          ico: "27082440",
          dic: "CZ27082440",
          vatPayer: true,
          createdAt: now,
          updatedAt: now,
        });

        await db.insert(contacts).values({
          id: contactId,
          companyId,
          name: "Test Odběratel s.r.o.",
          ico: "00006947",
          createdAt: now,
          updatedAt: now,
        });

        await db.insert(invoices).values({
          id: invoiceId,
          companyId,
          contactId,
          number: "2026-9999",
          status: "issued",
          issueDate: "2026-11-24",
          duzp: "2026-11-24",
          dueDate: "2026-12-08",
          supplierSnapshotJson: JSON.stringify({ name: "Test CleanRoom s.r.o." }),
          customerSnapshotJson: JSON.stringify({ name: "Test Odběratel s.r.o." }),
          bankSnapshotJson: JSON.stringify({ accountNumber: "19-2000145399/0800" }),
          subtotalMinor: 100000,
          vatTotalMinor: 21000,
          roundingMinor: 0,
          totalMinor: 121000,
          paidMinor: 0,
          createdAt: now,
          updatedAt: now,
        });

        await db.insert(invoiceItems).values({
          id: crypto.randomUUID(),
          invoiceId,
          position: 0,
          description: "Konzultace",
          quantityMilli: 1000,
          unit: "ks",
          unitPriceMinor: 100000,
          vatRate: 21,
          subtotalMinor: 100000,
          vatMinor: 21000,
          totalMinor: 121000,
        });

        await db.insert(payments).values({
          id: paymentId,
          companyId,
          amountMinor: 50000,
          paidAt: "2026-11-24",
          createdAt: now,
        });

        await db.insert(paymentAllocations).values({
          id: crypto.randomUUID(),
          paymentId,
          invoiceId,
          amountMinor: 50000,
          createdAt: now,
        });

        const [saved] = await db
          .select()
          .from(invoices)
          .where(eq(invoices.id, invoiceId));
        expect(saved.number).toBe("2026-9999");
        expect(saved.totalMinor).toBe(121000);
      } finally {
        // Cascade deletes contacts, invoices, items, payments, allocations
        await db.delete(companies).where(eq(companies.id, companyId));
      }
    },
    20000,
  );

  it.skipIf(!hasPg)(
    "umožní jednomu uživateli vlastnit více firem (OSVČ + s.r.o.), přepínat mezi nimi a izolovat data",
    async () => {
      await ensureDatabaseReady();
      const now = new Date().toISOString();
      const clerkUserId = `test-user-${crypto.randomUUID()}`;
      const osvcId = `test-osvc-${crypto.randomUUID()}`;
      const sroId = `test-sro-${crypto.randomUUID()}`;

      try {
        await db.insert(companies).values([
          {
            id: osvcId,
            name: "Mirek Sivák — OSVČ",
            ico: "12345679",
            vatPayer: false,
            vatPeriod: "none",
            createdAt: now,
            updatedAt: now,
          },
          {
            id: sroId,
            name: "Sivák Studio s.r.o.",
            ico: "27082440",
            dic: "CZ27082440",
            vatPayer: true,
            vatPeriod: "monthly",
            createdAt: now,
            updatedAt: now,
          },
        ]);

        await db.insert(companyMemberships).values([
          { id: crypto.randomUUID(), companyId: osvcId, clerkUserId, role: "owner", createdAt: now },
          { id: crypto.randomUUID(), companyId: sroId, clerkUserId, role: "owner", createdAt: now },
        ]);

        const switchedToOsvc = await switchActiveCompany(clerkUserId, osvcId);
        expect(switchedToOsvc).toBe(true);
        const [pref1] = await db
          .select()
          .from(userPreferences)
          .where(eq(userPreferences.clerkUserId, clerkUserId));
        expect(pref1.activeCompanyId).toBe(osvcId);

        const switchedToSro = await switchActiveCompany(clerkUserId, sroId);
        expect(switchedToSro).toBe(true);
        const [pref2] = await db
          .select()
          .from(userPreferences)
          .where(eq(userPreferences.clerkUserId, clerkUserId));
        expect(pref2.activeCompanyId).toBe(sroId);

        const switchedToUnauthorized = await switchActiveCompany(
          clerkUserId,
          `foreign-${crypto.randomUUID()}`,
        );
        expect(switchedToUnauthorized).toBe(false);
      } finally {
        await db.delete(userPreferences).where(eq(userPreferences.clerkUserId, clerkUserId));
        await db.delete(companies).where(eq(companies.id, osvcId));
        await db.delete(companies).where(eq(companies.id, sroId));
      }
    },
    20000,
  );
});
