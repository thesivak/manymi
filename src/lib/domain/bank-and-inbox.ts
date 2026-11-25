/**
 * Čistá pravidla pro automatické párování bankovních pohybů a import výpisů (CSV)
 * a heuristické vytěžení údajů dokladu z nahraných souborů v Inboxu (ISDOC XML / text).
 */

import { parseCzechAmountToMinor } from "./money";
import { validateIco } from "./czech";

export interface ParsedBankRow {
  bookedAt: string;
  direction: "credit" | "debit";
  amountMinor: number;
  currency: string;
  variableSymbol: string;
  counterpartyName: string;
  counterpartyAccount: string;
  note: string;
}

/**
 * Parsuje český bankovní CSV výpis (Fio / ČSOB / obecné CSV se středníkem nebo čárkou).
 * Očekávané sloupce (flexibilní dle hlavičky): Datum;Částka;Měna;VS;Protiúčet;Název protiúčtu;Poznámka
 */
export function parseBankCsvStatement(csvText: string): ParsedBankRow[] {
  const lines = csvText
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const sep = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(sep).map((h) => h.replace(/^"|"$/g, "").trim().toLowerCase());

  const idxDate = headers.findIndex((h) => h.includes("datum") || h.includes("date"));
  const idxAmount = headers.findIndex((h) => h.includes("částka") || h.includes("castka") || h.includes("amount") || h.includes("objem"));
  const idxCurrency = headers.findIndex((h) => h.includes("měna") || h.includes("mena") || h.includes("currency"));
  const idxVs = headers.findIndex((h) => h === "vs" || h.includes("variabil"));
  const idxAcc = headers.findIndex((h) => h.includes("protiúčet") || h.includes("protiucet") || h.includes("účet") || h.includes("account"));
  const idxName = headers.findIndex((h) => h.includes("název") || h.includes("nazev") || h.includes("partner") || h.includes("jméno"));
  const idxNote = headers.findIndex((h) => h.includes("poznám") || h.includes("poznam") || h.includes("zpráva") || h.includes("note"));

  const rows: ParsedBankRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(sep).map((c) => c.replace(/^"|"$/g, "").trim());
    const rawAmount = cols[idxAmount >= 0 ? idxAmount : 1] ?? "";
    const signedMinor = parseCzechAmountToMinor(rawAmount);
    if (signedMinor === 0) continue;

    const rawDate = cols[idxDate >= 0 ? idxDate : 0] ?? "";
    let bookedAt = new Date().toISOString().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}/.test(rawDate)) {
      bookedAt = rawDate.slice(0, 10);
    } else if (/^\d{1,2}\.\s*\d{1,2}\.\s*\d{4}/.test(rawDate)) {
      const m = rawDate.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
      if (m) bookedAt = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }

    rows.push({
      bookedAt,
      direction: signedMinor > 0 ? "credit" : "debit",
      amountMinor: Math.abs(signedMinor),
      currency: (cols[idxCurrency >= 0 ? idxCurrency : 2] || "CZK").toUpperCase(),
      variableSymbol: (cols[idxVs >= 0 ? idxVs : 3] ?? "").replace(/\D/g, "").slice(0, 10),
      counterpartyAccount: cols[idxAcc >= 0 ? idxAcc : 4] ?? "",
      counterpartyName: cols[idxName >= 0 ? idxName : 5] ?? "",
      note: cols[idxNote >= 0 ? idxNote : 6] ?? "",
    });
  }
  return rows;
}

export interface InboxExtractedData {
  supplierName: string;
  supplierIco: string;
  externalNumber: string;
  variableSymbol: string;
  issueDate: string;
  dueDate: string;
  totalMinor: number;
  currency: string;
  description: string;
}

/**
 * Vytěží strukturované fakturační údaje z ISDOC XML nebo textového/PDF obsahu v Inboxu.
 */
export function extractDocumentMetadata(
  filename: string,
  rawText: string,
): InboxExtractedData {
  const today = new Date().toISOString().slice(0, 10);
  const res: InboxExtractedData = {
    supplierName: "",
    supplierIco: "",
    externalNumber: "",
    variableSymbol: "",
    issueDate: today,
    dueDate: today,
    totalMinor: 0,
    currency: "CZK",
    description: filename.replace(/\.[^.]+$/, ""),
  };

  // 1. ISDOC XML extraction
  if (rawText.includes("<Invoice") && rawText.includes("isdoc")) {
    const tag = (name: string) => {
      const m = rawText.match(new RegExp(`<${name}[^>]*>([^<]+)</${name}>`, "i"));
      return m ? m[1].trim() : "";
    };
    res.externalNumber = tag("ID");
    res.variableSymbol = tag("VariableSymbol") || res.externalNumber.replace(/\D/g, "").slice(0, 10);
    res.issueDate = tag("IssueDate") || today;
    res.dueDate = tag("PaymentDueDate") || res.issueDate;
    res.currency = tag("LocalCurrencyCode") || "CZK";
    const payable = tag("PayableAmount") || tag("TaxInclusiveAmount");
    if (payable) res.totalMinor = parseCzechAmountToMinor(payable);
    const supBlock = rawText.match(/<AccountingSupplierParty>[\s\S]*?<\/AccountingSupplierParty>/i)?.[0] ?? "";
    const supName = supBlock.match(/<Name>([^<]+)<\/Name>/i)?.[1]?.trim();
    const supIco = supBlock.match(/<ID>(\d{8})<\/ID>/i)?.[1]?.trim();
    if (supName) res.supplierName = supName;
    if (supIco) res.supplierIco = supIco;
    const lineDesc = rawText.match(/<Description>([^<]+)<\/Description>/i)?.[1]?.trim();
    if (lineDesc) res.description = lineDesc;
    return res;
  }

  // 2. Generic text heuristic (IČO, VS, datum, částka)
  const icoMatch = rawText.match(/(?:IČO?|IC)\s*[:.]?\s*(\d{8})/i);
  if (icoMatch && validateIco(icoMatch[1]).valid) {
    res.supplierIco = icoMatch[1];
  }
  const vsMatch = rawText.match(/(?:VS|variabiln[íi]\s*symbol)\s*[:.]?\s*(\d{4,10})/i);
  if (vsMatch) res.variableSymbol = vsMatch[1];

  const amountMatch = rawText.match(/(?:celkem|k\s*[úu]hrad[ěe]|total)\s*[:.]?\s*([\d\s]+[,.]\d{2}|\d[\d\s]*)/i);
  if (amountMatch) res.totalMinor = parseCzechAmountToMinor(amountMatch[1]);

  return res;
}
