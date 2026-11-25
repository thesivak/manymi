/**
 * Čistá česká fakturační pravidla: IČO, DIČ, IBAN (ISO 13616),
 * SPAYD QR platba (ČBA 1.0), masky číselných řad a práce s daty.
 */

export function normalizeIco(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return digits.length <= 8 ? digits.padStart(8, "0") : digits.slice(0, 8);
}

/**
 * Ověří 8místné české IČO kontrolním součtem modulo 11.
 */
export function validateIco(raw: string): { valid: boolean; normalized: string; error?: string } {
  const digits = raw.replace(/\s+/g, "");
  if (!/^\d{8}$/.test(digits)) {
    return {
      valid: false,
      normalized: digits,
      error: "IČO musí obsahovat přesně 8 číslic.",
    };
  }

  let sum = 0;
  for (let i = 0; i < 7; i++) {
    sum += Number(digits[i]) * (8 - i);
  }
  const mod = sum % 11;
  const expected = mod === 0 ? 1 : mod === 1 ? 0 : 11 - mod;
  const actual = Number(digits[7]);

  if (actual !== expected) {
    return {
      valid: false,
      normalized: digits,
      error: "IČO nemá platný kontrolní součet. Zkontrolujte poslední číslici.",
    };
  }

  return { valid: true, normalized: digits };
}

export function validateDic(raw: string): boolean {
  const clean = raw.replace(/\s+/g, "").toUpperCase();
  if (!clean) return true;
  return /^[A-Z]{2}\d{8,10}$/.test(clean);
}

/**
 * Převede české číslo účtu (`[předčíslí-]číslo/kód`) na 24znakový IBAN dle ISO 13616.
 */
export function czechAccountToIban(accountNumber: string, bankCodeOverride?: string): string {
  const trimmed = accountNumber.trim().replace(/\s+/g, "");
  if (!trimmed) return "";

  let accountPart = trimmed;
  let bankCode = (bankCodeOverride ?? "").trim().replace(/\D/g, "");

  if (trimmed.includes("/")) {
    const [left, right] = trimmed.split("/");
    accountPart = left ?? "";
    if (!bankCode) bankCode = (right ?? "").replace(/\D/g, "");
  }

  if (!/^\d{4}$/.test(bankCode)) return "";

  let prefix = "";
  let number = accountPart;
  if (accountPart.includes("-")) {
    const [p, n] = accountPart.split("-");
    prefix = (p ?? "").replace(/\D/g, "");
    number = (n ?? "").replace(/\D/g, "");
  } else {
    number = accountPart.replace(/\D/g, "");
  }

  if (!number || number.length > 10 || prefix.length > 6) return "";

  const bban = bankCode.padStart(4, "0") + prefix.padStart(6, "0") + number.padStart(10, "0");
  // CZ = 12 35, check digits placeholder 00
  const numeric = `${bban}123500`;
  let remainder = 0;
  for (const ch of numeric) {
    remainder = (remainder * 10 + Number(ch)) % 97;
  }
  const checkDigits = String(98 - remainder).padStart(2, "0");
  return `CZ${checkDigits}${bban}`;
}

export function formatIban(iban: string): string {
  const clean = iban.replace(/\s+/g, "").toUpperCase();
  return clean.replace(/(.{4})(?=.)/g, "$1 ");
}

export function stripDiacriticsAscii(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 .,\-/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface SpaydInput {
  iban: string;
  amountMinor: number;
  currency?: string;
  dueDate?: string; // YYYY-MM-DD
  variableSymbol?: string;
  constantSymbol?: string;
  message?: string;
}

/**
 * Sestaví platební řetězec SPAYD 1.0 dle specifikace ČBA pro QR Platbu.
 */
export function buildSpayd(input: SpaydInput): string {
  const iban = input.iban.replace(/\s+/g, "").toUpperCase();
  if (!iban || input.amountMinor <= 0) return "";

  const amount = (input.amountMinor / 100).toFixed(2);
  const currency = (input.currency ?? "CZK").toUpperCase();
  const parts: string[] = [
    "SPD*1.0",
    `ACC:${iban}`,
    `AM:${amount}`,
    `CC:${currency}`,
  ];

  if (input.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) {
    parts.push(`DT:${input.dueDate.replace(/-/g, "")}`);
  }

  const vs = (input.variableSymbol ?? "").replace(/\D/g, "").slice(0, 10);
  if (vs) parts.push(`X-VS:${vs}`);

  const ks = (input.constantSymbol ?? "").replace(/\D/g, "").slice(0, 4);
  if (ks) parts.push(`X-KS:${ks}`);

  if (input.message) {
    const cleanMsg = stripDiacriticsAscii(input.message).toUpperCase().slice(0, 60);
    if (cleanMsg) parts.push(`MSG:${cleanMsg}`);
  }

  return parts.join("*");
}

export function formatInvoiceNumber(
  prefix: string,
  year: number,
  sequenceNumber: number,
  padding = 4,
): string {
  const padded = String(sequenceNumber).padStart(padding, "0");
  return `${prefix}${year}-${padded}`;
}

export function extractVariableSymbol(invoiceNumber: string): string {
  return invoiceNumber.replace(/\D/g, "").slice(0, 10);
}

export function todayIso(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetweenIso(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  const a = Date.UTC(fy, (fm ?? 1) - 1, fd ?? 1);
  const b = Date.UTC(ty, (tm ?? 1) - 1, td ?? 1);
  return Math.round((b - a) / 86_400_000);
}
