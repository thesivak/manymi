/**
 * Exporty účetních dokladů:
 * - ISDOC 6.0.2 XML (oficiální český standard e-fakturace)
 * - Stormware Pohoda XML (faktury vydané)
 * - CSV export (Excel-friendly UTF-8 s BOM)
 */

import { calculateInvoiceTotals, type VatMode } from "./money";

function escXml(val: string | number | null | undefined): string {
  return String(val ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escCsv(val: string | number | null | undefined): string {
  const s = String(val ?? "");
  if (s.includes(";") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export interface ExportableInvoice {
  id: string;
  number: string;
  docType: string;
  status: string;
  issueDate: string;
  duzp: string;
  dueDate: string;
  variableSymbol: string;
  constantSymbol: string;
  currency: string;
  exchangeRateMilli?: number;
  vatMode: VatMode;
  roundToWhole: boolean;
  discountPercent: number;
  subtotalMinor: number;
  vatTotalMinor: number;
  totalMinor: number;
  paidMinor: number;
  supplier: {
    name: string;
    ico: string;
    dic: string;
    street: string;
    city: string;
    zip: string;
    country?: string;
  };
  customer: {
    name: string;
    ico: string;
    dic: string;
    street: string;
    city: string;
    zip: string;
    country?: string;
    email?: string;
  };
  bank: {
    accountNumber: string;
    iban: string;
    swift: string;
  };
  items: Array<{
    description: string;
    quantityMilli: number;
    unit: string;
    unitPriceMinor: number;
    vatRate: number;
    subtotalMinor: number;
    vatMinor: number;
    totalMinor: number;
  }>;
}

/**
 * Generuje validní ISDOC 6.0.2 XML fakturu.
 */
export function buildIsdocXml(inv: ExportableInvoice): string {
  const docTypeCode = inv.docType === "credit_note" ? "2" : inv.docType === "proforma" ? "4" : "1";
  const totals = calculateInvoiceTotals({
    items: inv.items,
    vatMode: inv.vatMode,
    roundToWhole: inv.roundToWhole,
    discountPercent: inv.discountPercent,
  });

  const linesXml = inv.items
    .map(
      (it, idx) => `    <InvoiceLine>
      <ID>${idx + 1}</ID>
      <InvoicedQuantity unitCode="${escXml(it.unit)}">${(it.quantityMilli / 1000).toFixed(3)}</InvoicedQuantity>
      <LineExtensionAmount>${(it.subtotalMinor / 100).toFixed(2)}</LineExtensionAmount>
      <LineExtensionAmountTaxInclusive>${(it.totalMinor / 100).toFixed(2)}</LineExtensionAmountTaxInclusive>
      <LineExtensionTaxAmount>${(it.vatMinor / 100).toFixed(2)}</LineExtensionTaxAmount>
      <UnitPrice>${(it.unitPriceMinor / 100).toFixed(2)}</UnitPrice>
      <ClassifiedTaxCategory>
        <Percent>${inv.vatMode === "standard" ? it.vatRate : 0}</Percent>
        <VATCalculationMethod>0</VATCalculationMethod>
      </ClassifiedTaxCategory>
      <Item>
        <Description>${escXml(it.description)}</Description>
      </Item>
    </InvoiceLine>`,
    )
    .join("\n");

  const taxSubTotalsXml = totals.vatBreakdown
    .map(
      (b) => `    <TaxSubTotal>
      <TaxableAmount>${(b.baseMinor / 100).toFixed(2)}</TaxableAmount>
      <TaxAmount>${(b.vatMinor / 100).toFixed(2)}</TaxAmount>
      <TaxInclusiveAmount>${(b.totalMinor / 100).toFixed(2)}</TaxInclusiveAmount>
      <AlreadyClaimedTaxableAmount>0.00</AlreadyClaimedTaxableAmount>
      <AlreadyClaimedTaxAmount>0.00</AlreadyClaimedTaxAmount>
      <AlreadyClaimedTaxInclusiveAmount>0.00</AlreadyClaimedTaxInclusiveAmount>
      <DifferenceTaxableAmount>${(b.baseMinor / 100).toFixed(2)}</DifferenceTaxableAmount>
      <DifferenceTaxAmount>${(b.vatMinor / 100).toFixed(2)}</DifferenceTaxAmount>
      <DifferenceTaxInclusiveAmount>${(b.totalMinor / 100).toFixed(2)}</DifferenceTaxInclusiveAmount>
      <TaxCategory>
        <Percent>${b.rate}</Percent>
      </TaxCategory>
    </TaxSubTotal>`,
    )
    .join("\n");

  const isForeign = inv.currency.toUpperCase() !== "CZK";
  const currRate =
    isForeign && inv.exchangeRateMilli && inv.exchangeRateMilli > 0
      ? (inv.exchangeRateMilli / 1000).toFixed(3)
      : "1";

  return `<?xml version="1.0" encoding="utf-8"?>
<Invoice xmlns="http://isdoc.cz/namespace/2013" version="6.0.2">
  <DocumentType>${docTypeCode}</DocumentType>
  <ID>${escXml(inv.number)}</ID>
  <UUID>${escXml(inv.id)}</UUID>
  <IssueDate>${escXml(inv.issueDate)}</IssueDate>
  <TaxPointDate>${escXml(inv.duzp)}</TaxPointDate>
  <VATApplicable>${inv.vatMode === "standard" ? "true" : "false"}</VATApplicable>
  <ElectronicPossibilityAgreementReference />
  <LocalCurrencyCode>CZK</LocalCurrencyCode>
  ${isForeign ? `<ForeignCurrencyCode>${escXml(inv.currency.toUpperCase())}</ForeignCurrencyCode>` : ""}
  <CurrRate>${currRate}</CurrRate>
  <RefCurrRate>1</RefCurrRate>
  <AccountingSupplierParty>
    <Party>
      <PartyIdentification><ID>${escXml(inv.supplier.ico)}</ID></PartyIdentification>
      <PartyName><Name>${escXml(inv.supplier.name)}</Name></PartyName>
      <PostalAddress>
        <StreetName>${escXml(inv.supplier.street)}</StreetName>
        <CityName>${escXml(inv.supplier.city)}</CityName>
        <PostalZone>${escXml(inv.supplier.zip)}</PostalZone>
        <Country><IdentificationCode>CZ</IdentificationCode><Name>Česká republika</Name></Country>
      </PostalAddress>
      ${inv.supplier.dic ? `<PartyTaxScheme><CompanyID>${escXml(inv.supplier.dic)}</CompanyID><TaxScheme>VAT</TaxScheme></PartyTaxScheme>` : ""}
    </Party>
  </AccountingSupplierParty>
  <AccountingCustomerParty>
    <Party>
      <PartyIdentification><ID>${escXml(inv.customer.ico)}</ID></PartyIdentification>
      <PartyName><Name>${escXml(inv.customer.name)}</Name></PartyName>
      <PostalAddress>
        <StreetName>${escXml(inv.customer.street)}</StreetName>
        <CityName>${escXml(inv.customer.city)}</CityName>
        <PostalZone>${escXml(inv.customer.zip)}</PostalZone>
        <Country><IdentificationCode>CZ</IdentificationCode><Name>Česká republika</Name></Country>
      </PostalAddress>
      ${inv.customer.dic ? `<PartyTaxScheme><CompanyID>${escXml(inv.customer.dic)}</CompanyID><TaxScheme>VAT</TaxScheme></PartyTaxScheme>` : ""}
    </Party>
  </AccountingCustomerParty>
  <InvoiceLines>
${linesXml}
  </InvoiceLines>
  <TaxTotal>
${taxSubTotalsXml}
    <TaxAmount>${(totals.vatTotalMinor / 100).toFixed(2)}</TaxAmount>
  </TaxTotal>
  <LegalMonetaryTotal>
    <TaxExclusiveAmount>${(totals.subtotalMinor / 100).toFixed(2)}</TaxExclusiveAmount>
    <TaxInclusiveAmount>${(totals.totalMinor / 100).toFixed(2)}</TaxInclusiveAmount>
    <AlreadyClaimedTaxExclusiveAmount>0.00</AlreadyClaimedTaxExclusiveAmount>
    <AlreadyClaimedTaxInclusiveAmount>0.00</AlreadyClaimedTaxInclusiveAmount>
    <DifferenceTaxExclusiveAmount>${(totals.subtotalMinor / 100).toFixed(2)}</DifferenceTaxExclusiveAmount>
    <DifferenceTaxInclusiveAmount>${(totals.totalMinor / 100).toFixed(2)}</DifferenceTaxInclusiveAmount>
    <PayableRoundingAmount>${(totals.roundingMinor / 100).toFixed(2)}</PayableRoundingAmount>
    <PaidDepositsAmount>0.00</PaidDepositsAmount>
    <PayableAmount>${(totals.totalMinor / 100).toFixed(2)}</PayableAmount>
  </LegalMonetaryTotal>
  <PaymentMeans>
    <Payment>
      <PaidAmount>${(totals.totalMinor / 100).toFixed(2)}</PaidAmount>
      <PaymentMeansCode>42</PaymentMeansCode>
      <Details>
        <PaymentDueDate>${escXml(inv.dueDate)}</PaymentDueDate>
        <ID>${escXml(inv.bank.accountNumber)}</ID>
        <IBAN>${escXml(inv.bank.iban)}</IBAN>
        <BIC>${escXml(inv.bank.swift)}</BIC>
        <VariableSymbol>${escXml(inv.variableSymbol)}</VariableSymbol>
        <ConstantSymbol>${escXml(inv.constantSymbol)}</ConstantSymbol>
      </Details>
    </Payment>
  </PaymentMeans>
</Invoice>
`;
}

/**
 * Generuje Stormware Pohoda XML dávku vydaných faktur.
 */
export function buildPohodaXml(companyIco: string, list: ExportableInvoice[]): string {
  const itemsXml = list
    .map(
      (inv, idx) => `  <dat:dataPackItem id="INV-${idx + 1}" version="2.0">
    <inv:invoice version="2.0">
      <inv:invoiceHeader>
        <inv:invoiceType>${inv.docType === "credit_note" ? "issuedCorrectiveTax" : inv.docType === "proforma" ? "issuedAdvanceInvoice" : "issuedInvoice"}</inv:invoiceType>
        <inv:number><typ:numberRequested>${escXml(inv.number)}</typ:numberRequested></inv:number>
        <inv:symVar>${escXml(inv.variableSymbol)}</inv:symVar>
        <inv:date>${escXml(inv.issueDate)}</inv:date>
        <inv:dateTax>${escXml(inv.duzp)}</inv:dateTax>
        <inv:dateDue>${escXml(inv.dueDate)}</inv:dateDue>
        <inv:text>${escXml(inv.items[0]?.description || `Faktura ${inv.number}`)}</inv:text>
        <inv:partnerIdentity>
          <typ:address>
            <typ:company>${escXml(inv.customer.name)}</typ:company>
            <typ:city>${escXml(inv.customer.city)}</typ:city>
            <typ:street>${escXml(inv.customer.street)}</typ:street>
            <typ:zip>${escXml(inv.customer.zip)}</typ:zip>
            <typ:ico>${escXml(inv.customer.ico)}</typ:ico>
            <typ:dic>${escXml(inv.customer.dic)}</typ:dic>
          </typ:address>
        </inv:partnerIdentity>
      </inv:invoiceHeader>
      <inv:invoiceDetail>
${inv.items
  .map(
    (it) => `        <inv:invoiceItem>
          <inv:text>${escXml(it.description)}</inv:text>
          <inv:quantity>${(it.quantityMilli / 1000).toFixed(3)}</inv:quantity>
          <inv:unit>${escXml(it.unit)}</inv:unit>
          <inv:rateVAT>${it.vatRate === 21 ? "high" : it.vatRate === 12 ? "low" : "none"}</inv:rateVAT>
          <inv:homeCurrency>
            <typ:unitPrice>${(it.unitPriceMinor / 100).toFixed(2)}</typ:unitPrice>
            <typ:price>${(it.subtotalMinor / 100).toFixed(2)}</typ:price>
            <typ:priceVAT>${(it.vatMinor / 100).toFixed(2)}</typ:priceVAT>
            <typ:priceSum>${(it.totalMinor / 100).toFixed(2)}</typ:priceSum>
          </inv:homeCurrency>
        </inv:invoiceItem>`,
  )
  .join("\n")}
      </inv:invoiceDetail>
      <inv:invoiceSummary>
        <inv:homeCurrency>
          <typ:priceNone>${inv.vatMode !== "standard" ? (inv.subtotalMinor / 100).toFixed(2) : "0.00"}</typ:priceNone>
          <typ:priceHigh>${inv.vatMode === "standard" ? (inv.subtotalMinor / 100).toFixed(2) : "0.00"}</typ:priceHigh>
          <typ:priceHighVAT>${(inv.vatTotalMinor / 100).toFixed(2)}</typ:priceHighVAT>
          <typ:priceHighSum>${(inv.totalMinor / 100).toFixed(2)}</typ:priceHighSum>
        </inv:homeCurrency>
      </inv:invoiceSummary>
    </inv:invoice>
  </dat:dataPackItem>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<dat:dataPack id="manymi-export" ico="${escXml(companyIco)}" application="Manymi" version="2.0" note="Export vydaných faktur z Manymi"
  xmlns:dat="http://www.stormware.cz/schema/version_2/data.xsd"
  xmlns:inv="http://www.stormware.cz/schema/version_2/invoice.xsd"
  xmlns:typ="http://www.stormware.cz/schema/version_2/type.xsd">
${itemsXml}
</dat:dataPack>
`;
}

/**
 * Generuje CSV export (UTF-8 s BOM, oddělovač středník pro český Excel).
 */
export function buildInvoicesCsv(list: ExportableInvoice[]): string {
  const header = [
    "Číslo",
    "Typ",
    "Stav",
    "Odběratel",
    "IČO",
    "DIČ",
    "Vystaveno",
    "DUZP",
    "Splatnost",
    "VS",
    "Měna",
    "Základ",
    "DPH",
    "Celkem",
    "Uhrazeno",
  ].join(";");

  const rows = list.map((inv) =>
    [
      inv.number,
      inv.docType,
      inv.status,
      inv.customer.name,
      inv.customer.ico,
      inv.customer.dic,
      inv.issueDate,
      inv.duzp,
      inv.dueDate,
      inv.variableSymbol,
      inv.currency,
      (inv.subtotalMinor / 100).toFixed(2).replace(".", ","),
      (inv.vatTotalMinor / 100).toFixed(2).replace(".", ","),
      (inv.totalMinor / 100).toFixed(2).replace(".", ","),
      (inv.paidMinor / 100).toFixed(2).replace(".", ","),
    ]
      .map(escCsv)
      .join(";"),
  );

  return `\uFEFF${header}\n${rows.join("\n")}\n`;
}
