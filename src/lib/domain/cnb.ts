/**
 * Živý kurzovní lístek České národní banky (ČNB) pro cizí měny (EUR, USD, GBP, PLN).
 */

export interface CnbRatesSnapshot {
  date: string;
  rates: Record<string, number>; // 1 unit of currency in CZK
  source: "cnb" | "fallback";
}

const FALLBACK_RATES: Record<string, number> = {
  CZK: 1,
  EUR: 25.15,
  USD: 23.4,
  GBP: 29.8,
  PLN: 5.85,
  CHF: 26.9,
};

let cachedRates: { data: CnbRatesSnapshot; expiresAt: number } | null = null;

export async function getCnbExchangeRates(): Promise<CnbRatesSnapshot> {
  if (cachedRates && cachedRates.expiresAt > Date.now()) {
    return cachedRates.data;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(
      "https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt",
      { signal: controller.signal, cache: "no-store" },
    );
    if (!res.ok) throw new Error(`CNB HTTP ${res.status}`);
    const text = await res.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    const headerDate = lines[0]?.split(" ")[0] ?? "";
    const rates: Record<string, number> = { CZK: 1 };

    for (const line of lines.slice(2)) {
      const parts = line.split("|");
      if (parts.length < 5) continue;
      const amount = Number(parts[2].replace(",", "."));
      const code = parts[3].trim().toUpperCase();
      const rate = Number(parts[4].replace(",", "."));
      if (code && Number.isFinite(amount) && amount > 0 && Number.isFinite(rate)) {
        rates[code] = Number((rate / amount).toFixed(4));
      }
    }

    const data: CnbRatesSnapshot = {
      date: headerDate,
      rates,
      source: "cnb",
    };
    cachedRates = { data, expiresAt: Date.now() + 6 * 60 * 60 * 1000 };
    return data;
  } catch {
    return {
      date: new Date().toISOString().slice(0, 10),
      rates: { ...FALLBACK_RATES },
      source: "fallback",
    };
  } finally {
    clearTimeout(timer);
  }
}

export function getRateForCurrency(rates: Record<string, number>, currency: string): number {
  const code = currency.toUpperCase();
  if (code === "CZK") return 1;
  return rates[code] ?? FALLBACK_RATES[code] ?? 1;
}
