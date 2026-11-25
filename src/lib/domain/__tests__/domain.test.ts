import { describe, it, expect } from "vitest";
import {
  validateIco,
  czechAccountToIban,
  buildSpayd,
  formatInvoiceNumber,
  extractVariableSymbol,
  addDaysIso,
} from "../czech";
import { calculateInvoiceTotals, formatCzk, parseCzechAmountToMinor } from "../money";
import { deriveInvoiceStatus } from "../invoice-status";
import { generateInvoicePdfBuffer } from "../../pdf/invoice-pdf";

describe("české fakturační pravidla", () => {
  it("validuje české IČO pomocí modulo 11", () => {
    expect(validateIco("27082440").valid).toBe(true); // Alza.cz a.s.
    expect(validateIco("00006947").valid).toBe(true); // MFČR
    expect(validateIco("27082441").valid).toBe(false);
    expect(validateIco("12345").valid).toBe(false);
  });

  it("převede české číslo účtu na správný IBAN (ISO 13616)", () => {
    expect(czechAccountToIban("19-2000145399/0800")).toBe("CZ6508000000192000145399");
    expect(czechAccountToIban("2104891234/2010")).toMatch(/^CZ\d{2}20100000002104891234$/);
    expect(czechAccountToIban("neplatny")).toBe("");
  });

  it("sestaví validní SPAYD 1.0 bez diakritiky", () => {
    const spayd = buildSpayd({
      iban: "CZ6508000000192000145399",
      amountMinor: 1210050,
      currency: "CZK",
      dueDate: "2026-12-08",
      variableSymbol: "20260149",
      constantSymbol: "0308",
      message: "Faktura č. 2026-0149 — vývoj",
    });
    expect(spayd).toBe(
      "SPD*1.0*ACC:CZ6508000000192000145399*AM:12100.50*CC:CZK*DT:20261208*X-VS:20260149*X-KS:0308*MSG:FAKTURA C. 2026-0149 VYVOJ",
    );
  });

  it("formátuje čísla řad, variabilní symbol a splatnost", () => {
    expect(formatInvoiceNumber("", 2026, 149, 4)).toBe("2026-0149");
    expect(extractVariableSymbol("2026-0149")).toBe("20260149");
    expect(addDaysIso("2026-11-24", 14)).toBe("2026-12-08");
  });
});

describe("haléřová aritmetika a DPH", () => {
  it("počítá přesně více sazeb DPH a zaokrouhlení", () => {
    const totals = calculateInvoiceTotals({
      vatMode: "standard",
      roundToWhole: true,
      items: [
        { quantityMilli: 1500, unitPriceMinor: 100000, vatRate: 21 }, // 1 500 Kč + 315 Kč
        { quantityMilli: 1000, unitPriceMinor: 33333, vatRate: 12 }, // 333,33 Kč + 40,00 Kč
      ],
    });
    expect(totals.subtotalMinor).toBe(183333);
    expect(totals.vatTotalMinor).toBe(35500);
    expect(totals.roundingMinor).toBe(-33);
    expect(totals.totalMinor).toBe(218800);
    expect(totals.vatBreakdown).toHaveLength(2);
  });

  it("v režimu přenesené daňové povinnosti a neplátce nevyčísluje DPH", () => {
    const rc = calculateInvoiceTotals({
      vatMode: "reverse_charge",
      roundToWhole: false,
      items: [{ quantityMilli: 2000, unitPriceMinor: 50000, vatRate: 21 }],
    });
    expect(rc.subtotalMinor).toBe(100000);
    expect(rc.vatTotalMinor).toBe(0);
    expect(rc.totalMinor).toBe(100000);
  });

  it("parsuje a formátuje české částky", () => {
    expect(parseCzechAmountToMinor("1 250,50")).toBe(125050);
    expect(formatCzk(46591000)).toBe("465\u00A0910\u00A0Kč");
  });
});

describe("odvození stavu faktury", () => {
  it("rozlišuje koncept, čeká na úhradu, částečnou úhradu, po splatnosti a zaplaceno", () => {
    expect(
      deriveInvoiceStatus(
        { status: "draft", totalMinor: 10000, paidMinor: 0, dueDate: "2026-11-10" },
        "2026-11-24",
      ).derived,
    ).toBe("draft");

    const overdue = deriveInvoiceStatus(
      { status: "issued", totalMinor: 10000, paidMinor: 0, dueDate: "2026-11-06" },
      "2026-11-24",
    );
    expect(overdue.derived).toBe("overdue");
    expect(overdue.daysOverdue).toBe(18);
    expect(overdue.dueSubtext).toBe("18 dní po splatnosti");

    const partial = deriveInvoiceStatus(
      { status: "issued", totalMinor: 10000, paidMinor: 4000, dueDate: "2026-12-01" },
      "2026-11-24",
    );
    expect(partial.derived).toBe("partial");
    expect(partial.remainingMinor).toBe(6000);

    const paid = deriveInvoiceStatus(
      {
        status: "issued",
        totalMinor: 10000,
        paidMinor: 10000,
        dueDate: "2026-11-01",
        paidAt: "2026-11-20",
      },
      "2026-11-24",
    );
    expect(paid.derived).toBe("paid");
  });
});

describe("vektorový A4 PDF export", () => {
  it("vygeneruje validní PDF s QR kódem a českými znaky", async () => {
    const buf = await generateInvoicePdfBuffer({
      number: "2026-0149",
      issueDate: "2026-11-24",
      duzp: "2026-11-24",
      dueDate: "2026-12-08",
      paymentMethod: "bank_transfer",
      variableSymbol: "20260149",
      constantSymbol: "0308",
      currency: "CZK",
      vatMode: "standard",
      roundToWhole: false,
      showQr: true,
      spaydString: "SPD*1.0*ACC:CZ6508000000192000145399*AM:12100.00*CC:CZK*X-VS:20260149",
      noteBefore: "Fakturujeme Vám provedené práce dle objednávky.",
      noteAfter: "Děkujeme za včasnou úhradu.",
      supplier: {
        name: "Studio Lípa s.r.o.",
        ico: "08765430",
        dic: "CZ08765430",
        vatPayer: true,
        street: "Vodičkova 710/31",
        city: "Praha 1",
        zip: "110 00",
        email: "fakturace@studiolipa.cz",
        registryNote: "Zapsána v OR u MS v Praze, oddíl C, vložka 321456",
      },
      customer: {
        name: "Kovárna Hrubý s.r.o.",
        ico: "27082440",
        dic: "CZ27082440",
        vatPayer: true,
        street: "Jankovcova 1522/53",
        city: "Praha 7",
        zip: "170 00",
      },
      bank: {
        accountNumber: "19-2000145399/0800",
        iban: "CZ6508000000192000145399",
        swift: "GIBACZPX",
      },
      items: [
        {
          description: "Návrh a vývoj webové aplikace — listopad 2026",
          quantityMilli: 1000,
          unit: "ks",
          unitPriceMinor: 1000000,
          vatRate: 21,
        },
      ],
    });
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(5000);
  });
});
