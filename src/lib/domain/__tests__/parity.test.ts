import { describe, it, expect } from "vitest";
import { calculateInvoiceTotals } from "../money";
import {
  buildInvoicesCsv,
  buildIsdocXml,
  buildPohodaXml,
  type ExportableInvoice,
} from "../exports";
import { extractDocumentMetadata, parseBankCsvStatement } from "../bank-and-inbox";

const SAMPLE_INVOICE: ExportableInvoice = {
  id: "11111111-2222-3333-4444-555555555555",
  number: "2026-0042",
  docType: "invoice",
  status: "issued",
  issueDate: "2026-11-24",
  duzp: "2026-11-24",
  dueDate: "2026-12-08",
  variableSymbol: "20260042",
  constantSymbol: "0308",
  currency: "CZK",
  vatMode: "standard",
  roundToWhole: false,
  discountPercent: 0,
  subtotalMinor: 100000,
  vatTotalMinor: 21000,
  totalMinor: 121000,
  paidMinor: 0,
  supplier: {
    name: "Studio Lípa s.r.o.",
    ico: "08765430",
    dic: "CZ08765430",
    street: "Vodičkova 710/31",
    city: "Praha 1",
    zip: "110 00",
  },
  customer: {
    name: "Alza.cz a.s.",
    ico: "27082440",
    dic: "CZ27082440",
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
      description: "Vývoj fakturačního modulu",
      quantityMilli: 1000,
      unit: "ks",
      unitPriceMinor: 100000,
      vatRate: 21,
      subtotalMinor: 100000,
      vatMinor: 21000,
      totalMinor: 121000,
    },
  ],
};

describe("parita výpočtů s iDoklad (cena S DPH, odpočet zálohy)", () => {
  it("správně počítá základ a DPH u položky zadané S DPH (§ 37 ZDPH)", () => {
    const totals = calculateInvoiceTotals({
      vatMode: "standard",
      roundToWhole: false,
      priceType: "with_vat",
      items: [{ quantityMilli: 1000, unitPriceMinor: 121000, vatRate: 21 }],
    });
    expect(totals.subtotalMinor).toBe(100000);
    expect(totals.vatTotalMinor).toBe(21000);
    expect(totals.totalMinor).toBe(121000);
  });

  it("odečte uhrazenou zálohu na konečné vyúčtovací faktuře", () => {
    const totals = calculateInvoiceTotals({
      vatMode: "standard",
      roundToWhole: false,
      proformaDeductionMinor: 50000,
      items: [{ quantityMilli: 1000, unitPriceMinor: 100000, vatRate: 21 }],
    });
    expect(totals.subtotalMinor).toBe(100000);
    expect(totals.vatTotalMinor).toBe(21000);
    expect(totals.totalMinor).toBe(71000);
  });
});

describe("účetní exporty (ISDOC 6.0.2, Pohoda XML, CSV)", () => {
  it("generuje validní ISDOC 6.0.2 XML a vytěží jej zpět v Inboxu", () => {
    const xml = buildIsdocXml(SAMPLE_INVOICE);
    expect(xml).toContain('xmlns="http://isdoc.cz/namespace/2013" version="6.0.2"');
    expect(xml).toContain("<ID>2026-0042</ID>");
    expect(xml).toContain("<PayableAmount>1210.00</PayableAmount>");

    const extracted = extractDocumentMetadata("faktura-2026-0042.isdoc", xml);
    expect(extracted.externalNumber).toBe("2026-0042");
    expect(extracted.variableSymbol).toBe("20260042");
    expect(extracted.supplierIco).toBe("08765430");
    expect(extracted.supplierName).toBe("Studio Lípa s.r.o.");
    expect(extracted.totalMinor).toBe(121000);
  });

  it("přenese cizí měnu a reálný kurz ČNB do ISDOC 6.0.2 XML", () => {
    const eurXml = buildIsdocXml({
      ...SAMPLE_INVOICE,
      currency: "EUR",
      exchangeRateMilli: 24455,
    });
    expect(eurXml).toContain("<LocalCurrencyCode>CZK</LocalCurrencyCode>");
    expect(eurXml).toContain("<ForeignCurrencyCode>EUR</ForeignCurrencyCode>");
    expect(eurXml).toContain("<CurrRate>24.455</CurrRate>");
  });

  it("generuje Pohoda XML a CSV se středníkem a BOM", () => {
    const pohoda = buildPohodaXml("08765430", [SAMPLE_INVOICE]);
    expect(pohoda).toContain("stormware.cz/schema/version_2/data.xsd");
    expect(pohoda).toContain("<typ:numberRequested>2026-0042</typ:numberRequested>");

    const csv = buildInvoicesCsv([SAMPLE_INVOICE]);
    expect(csv.startsWith("\uFEFFČíslo;Typ;")).toBe(true);
    expect(csv).toContain("2026-0042;invoice;issued;Alza.cz a.s.");
  });
});

describe("bankovní CSV import", () => {
  it("parsuje příchozí a odchozí platby s VS a českým datem", () => {
    const csv = [
      "Datum;Částka;Měna;VS;Protiúčet;Název protiúčtu;Poznámka",
      "24. 11. 2026;36300,00;CZK;20260017;123456/0800;Alza.cz a.s.;Úhrada faktury",
      "2026-11-23;-4500,50;CZK;998877;987654/2010;Hosting s.r.o.;Server",
    ].join("\n");
    const rows = parseBankCsvStatement(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      bookedAt: "2026-11-24",
      direction: "credit",
      amountMinor: 3630000,
      variableSymbol: "20260017",
    });
    expect(rows[1]).toMatchObject({
      bookedAt: "2026-11-23",
      direction: "debit",
      amountMinor: 450050,
      variableSymbol: "998877",
    });
  });
});
