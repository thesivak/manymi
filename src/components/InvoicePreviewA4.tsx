"use client";

import { useEffect, useState } from "react";
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
import type { BankSnapshot, InvoicePdfItem, PartySnapshot } from "@/lib/pdf/invoice-pdf";

const PAYMENT_LABEL: Record<"cs" | "en", Record<string, string>> = {
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

const A4_LABELS = {
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
    vs: "Variabilní symbol",
    ks: "KS",
    item: "Položka",
    qty: "Množství",
    unitPrice: "Cena / MJ",
    vat: "DPH",
    exclVat: "Bez DPH",
    total: "Celkem",
    reverseCharge: "Daň odvede zákazník (režim přenesení daňové povinnosti).",
    qr: "QR Platba",
    discount: "Sleva",
    rate: "Sazba",
    base: "Základ",
    rounding: "Zaokrouhlení",
    totalDue: "Celkem k úhradě",
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
    vs: "Variable symbol",
    ks: "CS",
    item: "Item",
    qty: "Quantity",
    unitPrice: "Unit price",
    vat: "VAT",
    exclVat: "Excl. VAT",
    total: "Total",
    reverseCharge: "Reverse charge — VAT to be accounted for by the recipient.",
    qr: "QR Payment",
    discount: "Discount",
    rate: "Rate",
    base: "Base",
    rounding: "Rounding",
    totalDue: "Total due",
  },
};

interface InvoicePreviewA4Props {
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
  currency: string;
  vatMode: VatMode;
  roundToWhole: boolean;
  discountPercent?: number;
  showQr: boolean;
  spaydString: string;
  noteBefore: string;
  noteAfter: string;
  supplier: PartySnapshot;
  customer: PartySnapshot;
  bank: BankSnapshot;
  items: InvoicePdfItem[];
}

export function InvoicePreviewA4(props: InvoicePreviewA4Props) {
  const [qrSvg, setQrSvg] = useState<string>("");

  useEffect(() => {
    let active = true;
    if (props.showQr && props.spaydString) {
      QRCode.toString(props.spaydString, {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 0,
        color: { dark: "#0B1220", light: "#FFFFFF" },
      })
        .then((svg) => {
          if (active) setQrSvg(svg);
        })
        .catch(() => {
          if (active) setQrSvg("");
        });
    } else {
      setQrSvg("");
    }
    return () => {
      active = false;
    };
  }, [props.showQr, props.spaydString]);

  const totals = calculateInvoiceTotals({
    items: props.items,
    vatMode: props.vatMode,
    roundToWhole: props.roundToWhole,
    discountPercent: props.discountPercent ?? 0,
    priceType: props.priceType ?? "without_vat",
    proformaDeductionMinor: props.proformaDeductionMinor ?? 0,
  });

  const showVatCol = props.vatMode === "standard";
  const lang = props.printLanguage === "en" ? "en" : "cs";
  const t = A4_LABELS[lang];
  const docType: SalesDocType = props.docType ?? "invoice";
  const docTitle =
    docType === "invoice" && props.vatMode === "non_vat"
      ? lang === "en"
        ? "INVOICE"
        : "FAKTURA"
      : DOC_TYPE_LABELS[docType][lang];

  return (
    <div className="a4-paper" aria-label={`Náhled faktury ${props.number}`}>
      <div className="a4-head">
        <div>
          <p className="display" style={{ fontSize: 19 }}>
            {props.supplier.name || "Dodavatel"}
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", letterSpacing: "0.04em" }}>
            {docTitle}
          </p>
          <p className="display num" style={{ fontSize: 24, marginTop: 2 }}>
            {props.number || "—"}
          </p>
        </div>
      </div>

      <div className="a4-parties">
        <div>
          <p style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", marginBottom: 5 }}>
            {t.supplier}
          </p>
          <p style={{ fontWeight: 700, fontSize: 13 }}>{props.supplier.name || "—"}</p>
          {props.supplier.street && <p className="text-2">{props.supplier.street}</p>}
          {(props.supplier.zip || props.supplier.city) && (
            <p className="text-2">
              {[props.supplier.zip, props.supplier.city].filter(Boolean).join(" ")}
            </p>
          )}
          <p className="muted num" style={{ marginTop: 6, fontSize: 11.5 }}>
            {[
              props.supplier.ico ? `${t.ico}: ${props.supplier.ico}` : null,
              props.supplier.vatPayer && props.supplier.dic
                ? `${t.dic}: ${props.supplier.dic}`
                : !props.supplier.vatPayer
                  ? t.nonVat
                  : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        <div>
          <p style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", marginBottom: 5 }}>
            {t.customer}
          </p>
          <p style={{ fontWeight: 700, fontSize: 13 }}>
            {props.customer.name || <span className="muted">—</span>}
          </p>
          {props.customer.street && <p className="text-2">{props.customer.street}</p>}
          {(props.customer.zip || props.customer.city) && (
            <p className="text-2">
              {[props.customer.zip, props.customer.city].filter(Boolean).join(" ")}
            </p>
          )}
          <p className="muted num" style={{ marginTop: 6, fontSize: 11.5 }}>
            {[
              props.customer.ico ? `${t.ico}: ${props.customer.ico}` : null,
              props.customer.vatPayer && props.customer.dic
                ? `${t.dic}: ${props.customer.dic}`
                : props.customer.name && !props.customer.vatPayer
                  ? t.nonVat
                  : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>

      <div className="a4-band">
        <div>
          <p className="muted" style={{ fontSize: 10.5 }}>{t.issueDate}</p>
          <p className="num" style={{ fontWeight: 600 }}>{formatDateCz(props.issueDate)}</p>
        </div>
        {props.vatMode !== "non_vat" && (
          <div>
            <p className="muted" style={{ fontSize: 10.5 }}>{t.duzp}</p>
            <p className="num" style={{ fontWeight: 600 }}>{formatDateCz(props.duzp)}</p>
          </div>
        )}
        <div>
          <p className="muted" style={{ fontSize: 10.5 }}>{t.dueDate}</p>
          <p className="num" style={{ fontWeight: 700 }}>{formatDateCz(props.dueDate)}</p>
        </div>
        <div>
          <p className="muted" style={{ fontSize: 10.5 }}>{t.paymentMethod}</p>
          <p style={{ fontWeight: 600 }}>
            {PAYMENT_LABEL[lang][props.paymentMethod] ?? props.paymentMethod}
          </p>
        </div>
      </div>

      <div
        className="a4-band"
        style={{
          gridTemplateColumns: "1.05fr 1.85fr 0.85fr 0.45fr",
          borderBottom: "1px solid var(--ink)",
        }}
      >
        <div>
          <p className="muted" style={{ fontSize: 10.5 }}>{t.account}</p>
          <p className="num" style={{ fontWeight: 700 }}>{props.bank.accountNumber || "—"}</p>
        </div>
        <div>
          <p className="muted" style={{ fontSize: 10.5 }}>IBAN</p>
          <p className="num" style={{ fontWeight: 500, fontSize: 11.5 }}>
            {props.bank.iban ? formatIban(props.bank.iban) : "—"}
          </p>
        </div>
        <div>
          <p className="muted" style={{ fontSize: 10.5 }}>{t.vs}</p>
          <p className="num" style={{ fontWeight: 700 }}>{props.variableSymbol || "—"}</p>
        </div>
        <div>
          <p className="muted" style={{ fontSize: 10.5 }}>{t.ks}</p>
          <p className="num" style={{ fontWeight: 600 }}>{props.constantSymbol || "—"}</p>
        </div>
      </div>

      {props.noteBefore && (
        <p className="text-2" style={{ marginTop: 12 }}>
          {props.noteBefore}
        </p>
      )}

      <table className="a4-items">
        <thead>
          <tr>
            <th>{t.item}</th>
            <th className="align-right">{t.qty}</th>
            <th className="align-right">{t.unitPrice}</th>
            {showVatCol && <th className="align-right">{t.vat}</th>}
            <th className="align-right">{showVatCol ? t.exclVat : t.total}</th>
          </tr>
        </thead>
        <tbody>
          {props.items.map((item, idx) => {
            const calc = totals.items[idx];
            return (
              <tr key={idx}>
                <td>{item.description || <span className="muted">—</span>}</td>
                <td className="align-right num nowrap">
                  {formatQuantity(item.quantityMilli)} {item.unit}
                </td>
                <td className="align-right num nowrap">
                  {formatCzk(item.unitPriceMinor, { currency: props.currency })}
                </td>
                {showVatCol && (
                  <td className="align-right num nowrap">{calc.effectiveVatRate} %</td>
                )}
                <td className="align-right num nowrap" style={{ fontWeight: 600 }}>
                  {formatCzk(calc.subtotalMinor, { currency: props.currency })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {props.vatMode === "reverse_charge" && (
        <p style={{ marginTop: 10, fontWeight: 600, fontSize: 11.5 }}>
          {t.reverseCharge}
        </p>
      )}

      <div className="a4-bottom">
        {qrSvg ? (
          <div>
            <div className="a4-qr-box">
              <div
                style={{ width: 106, height: 106, margin: "0 auto" }}
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
              <p style={{ fontSize: 10.5, fontWeight: 700, marginTop: 6 }}>{t.qr}</p>
            </div>
            {props.bank.swift && (
              <p className="muted mono" style={{ fontSize: 10, marginTop: 6 }}>
                SWIFT: {props.bank.swift}
              </p>
            )}
          </div>
        ) : (
          <div />
        )}

        <div className="a4-totals">
          {totals.discountMinor > 0 && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 11.5,
                color: "var(--muted)",
                marginBottom: 6,
              }}
            >
              <span>{t.discount} ({props.discountPercent} %)</span>
              <span className="num">
                −{formatCzk(totals.discountMinor, { currency: props.currency })}
              </span>
            </div>
          )}

          {showVatCol && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
              <thead>
                <tr style={{ color: "var(--muted)", borderBottom: "1px solid var(--line)" }}>
                  <th style={{ textAlign: "left", padding: "3px 0", fontWeight: 600 }}>{t.rate}</th>
                  <th style={{ textAlign: "right", padding: "3px 0", fontWeight: 600 }}>{t.base}</th>
                  <th style={{ textAlign: "right", padding: "3px 0", fontWeight: 600 }}>{t.vat}</th>
                </tr>
              </thead>
              <tbody>
                {totals.vatBreakdown.map((b) => (
                  <tr key={b.rate}>
                    <td className="num" style={{ padding: "3px 0" }}>{b.rate} %</td>
                    <td className="align-right num" style={{ padding: "3px 0" }}>
                      {formatCzk(b.baseMinor, { currency: props.currency })}
                    </td>
                    <td className="align-right num" style={{ padding: "3px 0" }}>
                      {formatCzk(b.vatMinor, { currency: props.currency })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {totals.roundingMinor !== 0 && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 11.5,
                color: "var(--muted)",
                marginTop: 4,
              }}
            >
              <span>{t.rounding}</span>
              <span className="num">
                {formatCzk(totals.roundingMinor, {
                  alwaysDecimals: true,
                  currency: props.currency,
                })}
              </span>
            </div>
          )}

          <div className="a4-total-final">
            <span className="muted" style={{ fontWeight: 600, fontSize: 12 }}>
              {t.totalDue}
            </span>
            <span className="display num" style={{ fontSize: 22 }}>
              {formatCzk(totals.totalMinor, { currency: props.currency })}
            </span>
          </div>
        </div>
      </div>

      {props.noteAfter && (
        <div
          style={{
            borderLeft: "2px solid var(--ink)",
            paddingLeft: 12,
            marginTop: 18,
            color: "var(--text-2)",
          }}
        >
          {props.noteAfter}
        </div>
      )}

      <div
        style={{
          marginTop: 22,
          paddingTop: 10,
          borderTop: "1px solid var(--line)",
          fontSize: 10.5,
          color: "var(--muted)",
        }}
      >
        {[props.supplier.registryNote, props.supplier.email, props.supplier.phone]
          .filter(Boolean)
          .join(" · ") || "Vystaveno v aplikaci Manymi"}
      </div>
    </div>
  );
}
