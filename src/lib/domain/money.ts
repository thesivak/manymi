/**
 * Přesná haléřová aritmetika a české formátování částek i dat.
 * Podporuje zadání ceny „Bez DPH“ i „S DPH“ (zpětný výpočet dle § 37 ZDPH),
 * slevy, odpočet zálohy, zaokrouhlení na celé Kč a více měn.
 */

export type VatMode = "standard" | "reverse_charge" | "non_vat";
export type PriceType = "without_vat" | "with_vat";
export type SalesDocType =
  | "invoice"
  | "proforma"
  | "tax_document"
  | "credit_note"
  | "quote"
  | "sales_receipt";

export interface LineItemCalcInput {
  quantityMilli: number; // 1000 = 1.000 MJ
  unitPriceMinor: number; // haléře za 1 MJ (bez DPH nebo s DPH dle priceType)
  vatRate: number; // 21 | 12 | 0
  priceType?: PriceType;
}

export interface LineItemCalcResult {
  subtotalMinor: number;
  vatMinor: number;
  totalMinor: number;
  effectiveVatRate: number;
}

export interface VatBucket {
  rate: number;
  baseMinor: number;
  vatMinor: number;
  totalMinor: number;
}

export interface InvoiceTotals {
  items: LineItemCalcResult[];
  vatBreakdown: VatBucket[];
  rawSubtotalMinor: number;
  discountMinor: number;
  subtotalMinor: number;
  vatTotalMinor: number;
  proformaDeductionMinor: number;
  roundingMinor: number;
  totalMinor: number;
}

export function calculateLineItem(
  item: LineItemCalcInput,
  vatMode: VatMode,
  defaultPriceType: PriceType = "without_vat",
): LineItemCalcResult {
  const effectiveVatRate = vatMode === "standard" ? item.vatRate : 0;
  const mode = item.priceType ?? defaultPriceType;
  const rawLineMinor = Math.round((item.quantityMilli * item.unitPriceMinor) / 1000);

  if (mode === "with_vat" && effectiveVatRate > 0) {
    // § 37 ZDPH: daň = celkem - celkem / (1 + sazba/100)
    const subtotalMinor = Math.round((rawLineMinor * 100) / (100 + effectiveVatRate));
    const vatMinor = rawLineMinor - subtotalMinor;
    return {
      subtotalMinor,
      vatMinor,
      totalMinor: rawLineMinor,
      effectiveVatRate,
    };
  }

  const subtotalMinor = rawLineMinor;
  const vatMinor = Math.round((subtotalMinor * effectiveVatRate) / 100);
  return {
    subtotalMinor,
    vatMinor,
    totalMinor: subtotalMinor + vatMinor,
    effectiveVatRate,
  };
}

export function calculateInvoiceTotals(params: {
  items: LineItemCalcInput[];
  vatMode: VatMode;
  roundToWhole: boolean;
  discountPercent?: number;
  priceType?: PriceType;
  proformaDeductionMinor?: number;
}): InvoiceTotals {
  const discountPct = Math.min(100, Math.max(0, Math.round(params.discountPercent ?? 0)));
  const defaultPriceType = params.priceType ?? "without_vat";
  const calculated = params.items.map((it) =>
    calculateLineItem(it, params.vatMode, defaultPriceType),
  );
  const rawSubtotalMinor = calculated.reduce((acc, r) => acc + r.subtotalMinor, 0);

  const byRate = new Map<number, number>();
  for (const row of calculated) {
    const discountedBase =
      discountPct > 0
        ? Math.round((row.subtotalMinor * (100 - discountPct)) / 100)
        : row.subtotalMinor;
    byRate.set(
      row.effectiveVatRate,
      (byRate.get(row.effectiveVatRate) ?? 0) + discountedBase,
    );
  }

  const vatBreakdown: VatBucket[] = Array.from(byRate.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([rate, baseMinor]) => {
      const vatMinor = Math.round((baseMinor * rate) / 100);
      return {
        rate,
        baseMinor,
        vatMinor,
        totalMinor: baseMinor + vatMinor,
      };
    });

  const subtotalMinor = vatBreakdown.reduce((acc, b) => acc + b.baseMinor, 0);
  const discountMinor = rawSubtotalMinor - subtotalMinor;
  const vatTotalMinor = vatBreakdown.reduce((acc, b) => acc + b.vatMinor, 0);
  const proformaDeductionMinor = Math.max(0, Math.round(params.proformaDeductionMinor ?? 0));
  const rawTotalMinor = subtotalMinor + vatTotalMinor - proformaDeductionMinor;

  let roundingMinor = 0;
  let totalMinor = rawTotalMinor;

  if (params.roundToWhole) {
    const roundedCzk = Math.round(rawTotalMinor / 100) * 100;
    roundingMinor = roundedCzk - rawTotalMinor;
    totalMinor = roundedCzk;
  }

  return {
    items: calculated,
    vatBreakdown,
    rawSubtotalMinor,
    discountMinor,
    subtotalMinor,
    vatTotalMinor,
    proformaDeductionMinor,
    roundingMinor,
    totalMinor,
  };
}

const NBSP = "\u00A0";

const czIntFmt = new Intl.NumberFormat("cs-CZ", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const czDecFmt = new Intl.NumberFormat("cs-CZ", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCzk(
  minor: number,
  options?: { alwaysDecimals?: boolean; currency?: string; includeCurrency?: boolean },
): string {
  const includeCurrency = options?.includeCurrency ?? true;
  const currency = (options?.currency ?? "CZK").toUpperCase();
  const amount = minor / 100;
  const hasFraction = Math.abs(minor % 100) !== 0;
  const formatted =
    options?.alwaysDecimals || hasFraction
      ? czDecFmt.format(amount)
      : czIntFmt.format(amount);
  const safe = formatted.replace(/\s/g, NBSP);
  if (!includeCurrency) return safe;
  const symbol =
    currency === "CZK"
      ? "Kč"
      : currency === "EUR"
        ? "€"
        : currency === "USD"
          ? "$"
          : currency;
  return `${safe}${NBSP}${symbol}`;
}

export function parseCzechAmountToMinor(raw: string | number): number {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? Math.round(raw * 100) : 0;
  }
  const normalized = raw.replace(/\s+/g, "").replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
}

export function parseCzechQuantityToMilli(raw: string | number): number {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? Math.round(raw * 1000) : 1000;
  }
  const normalized = raw.replace(/\s+/g, "").replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 1000);
}

export function formatQuantity(quantityMilli: number): string {
  const val = quantityMilli / 1000;
  return new Intl.NumberFormat("cs-CZ", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  })
    .format(val)
    .replace(/\s/g, NBSP);
}

export function formatDateCz(isoDate: string): string {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}/.test(isoDate)) return "—";
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  return `${d}.${NBSP}${m}.${NBSP}${y}`;
}

export function formatShortDateCz(isoDate: string): string {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}/.test(isoDate)) return "—";
  const [, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  return `${d}.${NBSP}${m}.`;
}

const CZECH_MONTHS_NOM = [
  "Leden",
  "Únor",
  "Březen",
  "Duben",
  "Květen",
  "Červen",
  "Červenec",
  "Srpen",
  "Září",
  "Říjen",
  "Listopad",
  "Prosinec",
];

const CZECH_MONTHS_SHORT = [
  "Led",
  "Úno",
  "Bře",
  "Dub",
  "Kvě",
  "Čvn",
  "Čvc",
  "Srp",
  "Zář",
  "Říj",
  "Lis",
  "Pro",
];

export function czechMonthName(monthIndex0: number): string {
  return CZECH_MONTHS_NOM[monthIndex0] ?? "";
}

export function czechMonthShort(monthIndex0: number): string {
  return CZECH_MONTHS_SHORT[monthIndex0] ?? "";
}

export function formatLongTodayCz(now = new Date()): string {
  const s = new Intl.DateTimeFormat("cs-CZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function pluralCz(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n);
  if (abs === 1) return `${n} ${one}`;
  if (abs >= 2 && abs <= 4) return `${n} ${few}`;
  return `${n} ${many}`;
}

export const DOC_TYPE_LABELS: Record<
  SalesDocType,
  { cs: string; en: string; short: string; prefix: string }
> = {
  invoice: {
    cs: "FAKTURA — DAŇOVÝ DOKLAD",
    en: "INVOICE — TAX DOCUMENT",
    short: "Faktura",
    prefix: "",
  },
  proforma: {
    cs: "ZÁLOHOVÁ FAKTURA (NENÍ DAŇOVÝ DOKLAD)",
    en: "PROFORMA INVOICE",
    short: "Zálohová faktura",
    prefix: "Z-",
  },
  tax_document: {
    cs: "DAŇOVÝ DOKLAD K PŘIJATÉ PLATBĚ",
    en: "TAX DOCUMENT FOR RECEIVED PAYMENT",
    short: "Daňový doklad",
    prefix: "DD-",
  },
  credit_note: {
    cs: "OPRAVNÝ DAŇOVÝ DOKLAD — DOBROPIS",
    en: "CREDIT NOTE",
    short: "Dobropis",
    prefix: "D-",
  },
  quote: {
    cs: "CENOVÁ NABÍDKA",
    en: "PRICE QUOTE",
    short: "Cenová nabídka",
    prefix: "N-",
  },
  sales_receipt: {
    cs: "PRODEJKA — ZJEDNODUŠENÝ DAŇOVÝ DOKLAD",
    en: "SALES RECEIPT",
    short: "Prodejka",
    prefix: "P-",
  },
};
