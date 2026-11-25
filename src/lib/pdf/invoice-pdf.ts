import path from "node:path";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { formatIban } from "@/lib/domain/czech";
import {
  calculateInvoiceTotals,
  DOC_TYPE_LABELS,
  formatCzk,
  formatDateCz,
  formatQuantity,
  type PriceType,
  type SalesDocType,
  type VatMode,
} from "@/lib/domain/money";

export interface PartySnapshot {
  name: string;
  ico: string;
  dic: string;
  vatPayer: boolean;
  street: string;
  city: string;
  zip: string;
  country?: string;
  email?: string;
  phone?: string;
  registryNote?: string;
}

export interface BankSnapshot {
  label?: string;
  accountNumber: string;
  iban: string;
  swift: string;
}

export interface InvoicePdfItem {
  description: string;
  quantityMilli: number;
  unit: string;
  unitPriceMinor: number;
  vatRate: number;
}

export interface InvoicePdfData {
  number: string;
  docType?: SalesDocType;
  printLanguage?: "cs" | "en";
  priceType?: PriceType;
  proformaDeductionMinor?: number;
  issueDate: string;
  duzp: string;
  dueDate: string;
  paymentMethod: string;
  variableSymbol: string;
  constantSymbol: string;
  orderNumber?: string;
  discountPercent?: number;
  currency: string;
  vatMode: VatMode;
  roundToWhole: boolean;
  showQr: boolean;
  spaydString: string;
  noteBefore: string;
  noteAfter: string;
  supplier: PartySnapshot;
  customer: PartySnapshot;
  bank: BankSnapshot;
  items: InvoicePdfItem[];
}

const PAYMENT_METHOD_LABEL: Record<"cs" | "en", Record<string, string>> = {
  cs: {
    bank_transfer: "Bankovní převod",
    cash: "Hotově",
    card: "Platební kartou",
  },
  en: {
    bank_transfer: "Bank transfer",
    cash: "Cash",
    card: "Card",
  },
};

const PDF_LABELS = {
  cs: {
    supplier: "DODAVATEL",
    customer: "ODBĚRATEL",
    ico: "IČO",
    dic: "DIČ",
    nonVat: "Neplátce DPH",
    issueDate: "Datum vystavení",
    duzp: "DUZP",
    dueDate: "Datum splatnosti",
    paymentMethod: "Forma úhrady",
    account: "Číslo účtu",
    iban: "IBAN",
    vs: "Variabilní symbol",
    ks: "Konstantní symbol",
    item: "Položka",
    qty: "Množství",
    unitPrice: "Cena / MJ",
    vat: "DPH",
    exclVat: "Bez DPH",
    total: "Celkem",
    reverseCharge: "Daň odvede zákazník (režim přenesení daňové povinnosti).",
    qrPayment: "QR Platba",
    rate: "Sazba",
    base: "Základ",
    rounding: "Zaokrouhlení",
    totalDue: "Celkem k úhradě",
    issuedBy: "Vystaveno v aplikaci Manymi",
  },
  en: {
    supplier: "SUPPLIER",
    customer: "CUSTOMER",
    ico: "Company ID",
    dic: "VAT ID",
    nonVat: "Non-VAT payer",
    issueDate: "Issue date",
    duzp: "Tax point date",
    dueDate: "Due date",
    paymentMethod: "Payment method",
    account: "Account number",
    iban: "IBAN",
    vs: "Variable symbol",
    ks: "Constant symbol",
    item: "Item",
    qty: "Quantity",
    unitPrice: "Unit price",
    vat: "VAT",
    exclVat: "Excl. VAT",
    total: "Total",
    reverseCharge: "Reverse charge — VAT to be accounted for by the recipient.",
    qrPayment: "QR Payment",
    rate: "Rate",
    base: "Base",
    rounding: "Rounding",
    totalDue: "Total due",
    issuedBy: "Issued with Manymi",
  },
};

const INK = "#0B1220";
const TEXT2 = "#4B5563";
const MUTED = "#6B7280";
const LINE = "#E5E7EB";
const LINE_STRONG = "#D1D5DB";

export async function generateInvoicePdfBuffer(data: InvoicePdfData): Promise<Buffer> {
  const fontsDir = path.resolve(process.cwd(), "src/assets/fonts");
  const interRegular = path.join(fontsDir, "Inter-400.ttf");
  const interSemi = path.join(fontsDir, "Inter-600.ttf");
  const interBold = path.join(fontsDir, "Inter-700.ttf");
  const archivoBold = path.join(fontsDir, "Archivo-800.ttf");

  const totals = calculateInvoiceTotals({
    items: data.items,
    vatMode: data.vatMode,
    roundToWhole: data.roundToWhole,
    discountPercent: data.discountPercent ?? 0,
    priceType: data.priceType ?? "without_vat",
    proformaDeductionMinor: data.proformaDeductionMinor ?? 0,
  });
  const lang = data.printLanguage === "en" ? "en" : "cs";
  const docType: SalesDocType = data.docType ?? "invoice";

  let qrPng: Buffer | null = null;
  if (data.showQr && data.spaydString) {
    qrPng = await QRCode.toBuffer(data.spaydString, {
      errorCorrectionLevel: "M",
      margin: 0,
      width: 220,
      color: { dark: INK, light: "#FFFFFF" },
    });
  }

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 44,
      info: {
        Title: `Faktura ${data.number}`,
        Author: data.supplier.name || "Manymi",
        Creator: "Manymi",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.registerFont("Inter", interRegular);
    doc.registerFont("Inter-Semi", interSemi);
    doc.registerFont("Inter-Bold", interBold);
    doc.registerFont("Archivo", archivoBold);

    const pageW = doc.page.width;
    const left = 44;
    const right = pageW - 44;
    const contentW = right - left;

    // 1. Header: Supplier brand left, Document title + number right
    let y = 44;
    doc
      .font("Archivo")
      .fontSize(15)
      .fillColor(INK)
      .text(data.supplier.name || "Dodavatel", left, y, { width: contentW * 0.52 });

    const docLabel =
      docType === "invoice" && data.vatMode === "non_vat"
        ? lang === "en"
          ? "INVOICE"
          : "FAKTURA"
        : DOC_TYPE_LABELS[docType][lang];
    doc
      .font("Inter-Semi")
      .fontSize(8)
      .fillColor(MUTED)
      .text(docLabel, left + contentW * 0.5, y, {
        width: contentW * 0.5,
        align: "right",
      });

    doc
      .font("Archivo")
      .fontSize(22)
      .fillColor(INK)
      .text(data.number, left + contentW * 0.5, y + 11, {
        width: contentW * 0.5,
        align: "right",
      });

    y = 84;
    // 2. Heavy ink rule (1.5pt)
    doc.strokeColor(INK).lineWidth(1.5).moveTo(left, y).lineTo(right, y).stroke();
    y += 16;

    // 3. Supplier | Customer columns
    const colGap = 24;
    const colW = (contentW - colGap) / 2;
    const rightColX = left + colW + colGap;

    const renderParty = (title: string, party: PartySnapshot, x: number, startY: number) => {
      let cy = startY;
      doc.font("Inter-Semi").fontSize(7.5).fillColor(MUTED).text(title.toUpperCase(), x, cy);
      cy += 12;
      doc
        .font("Inter-Bold")
        .fontSize(10.5)
        .fillColor(INK)
        .text(party.name || "—", x, cy, { width: colW });
      cy = doc.y + 3;

      const addrLines = [
        party.street,
        [party.zip, party.city].filter(Boolean).join(" "),
        party.country && party.country !== "Česká republika" ? party.country : "",
      ].filter(Boolean);

      if (addrLines.length > 0) {
        doc
          .font("Inter")
          .fontSize(9)
          .fillColor(TEXT2)
          .text(addrLines.join("\n"), x, cy, { width: colW, lineGap: 2 });
        cy = doc.y + 5;
      }

      const idLines: string[] = [];
      const t = PDF_LABELS[lang];
      if (party.ico) idLines.push(`${t.ico}: ${party.ico}`);
      if (party.vatPayer && party.dic) {
        idLines.push(`${t.dic}: ${party.dic}`);
      } else if (!party.vatPayer) {
        idLines.push(t.nonVat);
      }

      if (idLines.length > 0) {
        doc
          .font("Inter")
          .fontSize(8.5)
          .fillColor(MUTED)
          .text(idLines.join("   ·   "), x, cy, { width: colW });
        cy = doc.y;
      }

      return cy;
    };

    const t = PDF_LABELS[lang];
    const yLeft = renderParty(t.supplier, data.supplier, left, y);
    const yRight = renderParty(t.customer, data.customer, rightColX, y);
    y = Math.max(yLeft, yRight) + 16;

    // 4. Dates band
    doc.strokeColor(LINE).lineWidth(0.75).moveTo(left, y).lineTo(right, y).stroke();
    y += 9;

    const metaCells: Array<{ label: string; value: string; bold?: boolean }> = [
      { label: t.issueDate, value: formatDateCz(data.issueDate) },
      ...(data.vatMode !== "non_vat"
        ? [{ label: t.duzp, value: formatDateCz(data.duzp) }]
        : []),
      { label: t.dueDate, value: formatDateCz(data.dueDate), bold: true },
      {
        label: t.paymentMethod,
        value: PAYMENT_METHOD_LABEL[lang][data.paymentMethod] ?? data.paymentMethod,
      },
    ];

    const metaW = contentW / metaCells.length;
    metaCells.forEach((cell, i) => {
      const cx = left + i * metaW;
      doc.font("Inter").fontSize(7.5).fillColor(MUTED).text(cell.label, cx, y, { width: metaW - 6 });
      doc
        .font(cell.bold ? "Inter-Bold" : "Inter-Semi")
        .fontSize(9.5)
        .fillColor(INK)
        .text(cell.value, cx, y + 11, { width: metaW - 6 });
    });

    y += 32;

    // 5. Payment band
    doc.strokeColor(LINE).lineWidth(0.75).moveTo(left, y).lineTo(right, y).stroke();
    y += 9;

    const payCells: Array<{ label: string; value: string; bold?: boolean }> = [
      { label: t.account, value: data.bank.accountNumber || "—", bold: true },
      { label: t.iban, value: data.bank.iban ? formatIban(data.bank.iban) : "—" },
      { label: t.vs, value: data.variableSymbol || "—", bold: true },
      { label: t.ks, value: data.constantSymbol || "—" },
    ];
    const payWidths = [contentW * 0.27, contentW * 0.37, contentW * 0.2, contentW * 0.16];
    let px = left;
    payCells.forEach((cell, i) => {
      const w = payWidths[i];
      doc.font("Inter").fontSize(7.5).fillColor(MUTED).text(cell.label, px, y, { width: w - 6 });
      doc
        .font(cell.bold ? "Inter-Bold" : "Inter-Semi")
        .fontSize(9)
        .fillColor(INK)
        .text(cell.value, px, y + 11, { width: w - 6 });
      px += w;
    });

    y += 32;
    doc.strokeColor(INK).lineWidth(1).moveTo(left, y).lineTo(right, y).stroke();
    y += 12;

    if (data.noteBefore) {
      doc
        .font("Inter")
        .fontSize(8.8)
        .fillColor(TEXT2)
        .text(data.noteBefore, left, y, { width: contentW });
      y = doc.y + 12;
    }

    // 6. Items table
    const showVatCol = data.vatMode === "standard";
    const cols = showVatCol
      ? {
          desc: { x: left, w: contentW * 0.44 },
          qty: { x: left + contentW * 0.44, w: contentW * 0.13 },
          unit: { x: left + contentW * 0.57, w: contentW * 0.15 },
          vat: { x: left + contentW * 0.72, w: contentW * 0.1 },
          total: { x: left + contentW * 0.82, w: contentW * 0.18 },
        }
      : {
          desc: { x: left, w: contentW * 0.52 },
          qty: { x: left + contentW * 0.52, w: contentW * 0.14 },
          unit: { x: left + contentW * 0.66, w: contentW * 0.16 },
          vat: null,
          total: { x: left + contentW * 0.82, w: contentW * 0.18 },
        };

    doc.font("Inter-Semi").fontSize(8).fillColor(MUTED);
    doc.text(t.item, cols.desc.x, y, { width: cols.desc.w });
    doc.text(t.qty, cols.qty.x, y, { width: cols.qty.w, align: "right" });
    doc.text(t.unitPrice, cols.unit.x, y, { width: cols.unit.w, align: "right" });
    if (cols.vat) {
      doc.text(t.vat, cols.vat.x, y, { width: cols.vat.w, align: "right" });
    }
    doc.text(showVatCol ? t.exclVat : t.total, cols.total.x, y, {
      width: cols.total.w,
      align: "right",
    });

    y += 14;
    doc.strokeColor(INK).lineWidth(1).moveTo(left, y).lineTo(right, y).stroke();
    y += 8;

    data.items.forEach((item, idx) => {
      const calc = totals.items[idx];
      const startY = y;
      doc.font("Inter").fontSize(9.2).fillColor(INK);
      doc.text(item.description || "—", cols.desc.x, startY, {
        width: cols.desc.w - 8,
      });
      const rowBottom = Math.max(doc.y, startY + 13);

      doc.text(
        `${formatQuantity(item.quantityMilli)} ${item.unit}`,
        cols.qty.x,
        startY,
        { width: cols.qty.w, align: "right" },
      );
      doc.text(
        formatCzk(item.unitPriceMinor, { currency: data.currency }),
        cols.unit.x,
        startY,
        { width: cols.unit.w, align: "right" },
      );
      if (cols.vat) {
        doc.text(`${calc.effectiveVatRate} %`, cols.vat.x, startY, {
          width: cols.vat.w,
          align: "right",
        });
      }
      doc
        .font("Inter-Semi")
        .text(
          formatCzk(calc.subtotalMinor, { currency: data.currency }),
          cols.total.x,
          startY,
          { width: cols.total.w, align: "right" },
        );

      y = rowBottom + 7;
      doc.strokeColor(LINE).lineWidth(0.6).moveTo(left, y).lineTo(right, y).stroke();
      y += 7;
    });

    if (data.vatMode === "reverse_charge") {
      y += 4;
      doc
        .font("Inter-Semi")
        .fontSize(8.5)
        .fillColor(INK)
        .text(t.reverseCharge, left, y);
      y = doc.y + 8;
    }

    y += 10;

    // 7. Bottom split: QR Platba left, VAT summary + Total right
    const summaryStartY = y;

    if (qrPng) {
      const qrSize = 86;
      doc.rect(left, summaryStartY, qrSize + 12, qrSize + 24).strokeColor(LINE_STRONG).lineWidth(0.75).stroke();
      doc.image(qrPng, left + 6, summaryStartY + 6, { width: qrSize, height: qrSize });
      doc
        .font("Inter-Semi")
        .fontSize(7.5)
        .fillColor(INK)
        .text(t.qrPayment, left + 6, summaryStartY + qrSize + 10, {
          width: qrSize,
          align: "center",
        });
      if (data.bank.swift) {
        doc
          .font("Inter")
          .fontSize(7.5)
          .fillColor(MUTED)
          .text(`SWIFT: ${data.bank.swift}`, left, summaryStartY + qrSize + 30);
      }
    }

    const sumX = left + contentW * 0.48;
    const sumW = contentW * 0.52;
    let sy = summaryStartY;

    if (data.vatMode === "standard") {
      doc.font("Inter-Semi").fontSize(7.5).fillColor(MUTED);
      doc.text(t.rate, sumX, sy, { width: sumW * 0.22 });
      doc.text(t.base, sumX + sumW * 0.22, sy, { width: sumW * 0.26, align: "right" });
      doc.text(t.vat, sumX + sumW * 0.48, sy, { width: sumW * 0.24, align: "right" });
      doc.text(t.total, sumX + sumW * 0.72, sy, { width: sumW * 0.28, align: "right" });
      sy += 12;
      doc.strokeColor(LINE).lineWidth(0.75).moveTo(sumX, sy).lineTo(right, sy).stroke();
      sy += 6;

      for (const bucket of totals.vatBreakdown) {
        doc.font("Inter").fontSize(8.5).fillColor(TEXT2);
        doc.text(`${bucket.rate} %`, sumX, sy, { width: sumW * 0.22 });
        doc.text(formatCzk(bucket.baseMinor, { currency: data.currency }), sumX + sumW * 0.22, sy, {
          width: sumW * 0.26,
          align: "right",
        });
        doc.text(formatCzk(bucket.vatMinor, { currency: data.currency }), sumX + sumW * 0.48, sy, {
          width: sumW * 0.24,
          align: "right",
        });
        doc.text(formatCzk(bucket.totalMinor, { currency: data.currency }), sumX + sumW * 0.72, sy, {
          width: sumW * 0.28,
          align: "right",
        });
        sy += 14;
      }
    }

    if (totals.roundingMinor !== 0) {
      doc.font("Inter").fontSize(8.5).fillColor(MUTED);
      doc.text(t.rounding, sumX, sy, { width: sumW * 0.5 });
      doc.text(
        formatCzk(totals.roundingMinor, { alwaysDecimals: true, currency: data.currency }),
        sumX + sumW * 0.5,
        sy,
        { width: sumW * 0.5, align: "right" },
      );
      sy += 15;
    }

    sy += 4;
    doc.strokeColor(INK).lineWidth(1.5).moveTo(sumX, sy).lineTo(right, sy).stroke();
    sy += 10;

    doc.font("Inter-Semi").fontSize(9).fillColor(MUTED).text(t.totalDue, sumX, sy + 5);
    doc
      .font("Archivo")
      .fontSize(20)
      .fillColor(INK)
      .text(formatCzk(totals.totalMinor, { currency: data.currency }), sumX, sy, {
        width: sumW,
        align: "right",
      });

    y = Math.max(sy + 34, qrPng ? summaryStartY + 128 : sy + 34);

    // 8. Note after with left editorial ink bar
    if (data.noteAfter) {
      const noteStartY = y;
      doc
        .font("Inter")
        .fontSize(9)
        .fillColor(TEXT2)
        .text(data.noteAfter, left + 12, noteStartY + 1, { width: contentW - 12 });
      const noteEndY = doc.y;
      doc
        .strokeColor(INK)
        .lineWidth(2)
        .moveTo(left, noteStartY)
        .lineTo(left, noteEndY)
        .stroke();
    }

    // 9. Footer
    const footerY = doc.page.height - 56;
    doc.strokeColor(LINE).lineWidth(0.75).moveTo(left, footerY - 8).lineTo(right, footerY - 8).stroke();
    const footerParts = [
      data.supplier.registryNote,
      data.supplier.email,
      data.supplier.phone,
    ].filter(Boolean);
    doc
      .font("Inter")
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(
        footerParts.join("   ·   ") || `Vystaveno v aplikaci Manymi`,
        left,
        footerY,
        { width: contentW },
      );

    doc.end();
  });
}
