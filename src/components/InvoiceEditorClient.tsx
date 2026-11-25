"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Plus, Printer, Search, Trash2 } from "lucide-react";
import {
  addDaysIso,
  buildSpayd,
  czechAccountToIban,
  daysBetweenIso,
  extractVariableSymbol,
  formatIban,
  validateIco,
} from "@/lib/domain/czech";
import {
  calculateInvoiceTotals,
  DOC_TYPE_LABELS,
  formatCzk,
  formatDateCz,
  parseCzechAmountToMinor,
  parseCzechQuantityToMilli,
  type PriceType,
  type SalesDocType,
  type VatMode,
} from "@/lib/domain/money";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { InvoicePreviewA4 } from "./InvoicePreviewA4";
import type { BankSnapshot, PartySnapshot } from "@/lib/pdf/invoice-pdf";

interface ContactOption {
  id: string;
  name: string;
  ico: string;
  dic: string;
  vatPayer: boolean;
  street: string;
  city: string;
  zip: string;
  country: string;
  email: string;
  defaultDueDays: number | null;
}

interface BankOption {
  id: string;
  label: string;
  accountNumber: string;
  iban: string;
  swift: string;
  isDefault: boolean;
}

interface SequenceOption {
  id: string;
  name: string;
  nextFormatted: string;
}

interface CatalogOption {
  id: string;
  name: string;
  unit: string;
  unitPriceMinor: number;
  priceType: string;
  vatRate: number;
}

interface EditableItem {
  id: string;
  description: string;
  quantityStr: string;
  unit: string;
  unitPriceStr: string;
  vatRate: number;
  catalogItemId?: string | null;
}

export interface InvoiceEditorProps {
  mode: "create" | "edit";
  invoiceId?: string;
  supplier: PartySnapshot;
  contacts: ContactOption[];
  bankAccounts: BankOption[];
  sequences: SequenceOption[];
  catalogItems?: CatalogOption[];
  initialData: {
    docType?: SalesDocType;
    priceType?: PriceType;
    printLanguage?: "cs" | "en";
    exchangeRateMilli?: number;
    sequenceId: string;
    number: string;
    contactId: string;
    customer: PartySnapshot;
    issueDate: string;
    duzp: string;
    dueDays: number;
    dueDate: string;
    paymentMethod: "bank_transfer" | "cash" | "card";
    bankAccountId: string;
    bankAccountNumber: string;
    bankIban: string;
    bankSwift: string;
    variableSymbol: string;
    constantSymbol: string;
    orderNumber: string;
    discountPercent: number;
    currency: string;
    vatMode: VatMode;
    roundToWhole: boolean;
    showQr: boolean;
    noteBefore: string;
    noteAfter: string;
    items: EditableItem[];
  };
}

const DUE_PRESETS = [7, 14, 30, 60];

export function InvoiceEditorClient({
  mode,
  invoiceId,
  supplier,
  contacts,
  bankAccounts,
  sequences,
  catalogItems = [],
  initialData,
}: InvoiceEditorProps) {
  const router = useRouter();
  const [docType, setDocType] = useState<SalesDocType>(initialData.docType ?? "invoice");
  const [currency, setCurrency] = useState(initialData.currency || "CZK");
  const [exchangeRateMilli, setExchangeRateMilli] = useState(
    initialData.exchangeRateMilli ?? 1000,
  );
  const [cnbDate, setCnbDate] = useState<string>("");
  const [priceType, setPriceType] = useState<PriceType>(
    initialData.priceType ?? "without_vat",
  );
  const [printLanguage, setPrintLanguage] = useState<"cs" | "en">(
    initialData.printLanguage ?? "cs",
  );
  const [sequenceId, setSequenceId] = useState(initialData.sequenceId);
  const [number, setNumber] = useState(initialData.number);
  const [contactId, setContactId] = useState(initialData.contactId);
  const [customer, setCustomer] = useState<PartySnapshot>(initialData.customer);
  const [issueDate, setIssueDate] = useState(initialData.issueDate);
  const [duzp, setDuzp] = useState(initialData.duzp);
  const [dueDays, setDueDays] = useState<number>(initialData.dueDays);
  const [dueDate, setDueDate] = useState(initialData.dueDate);
  const [paymentMethod, setPaymentMethod] = useState(initialData.paymentMethod);
  const [bankAccountId, setBankAccountId] = useState(initialData.bankAccountId);
  const [bankAccountNumber, setBankAccountNumber] = useState(initialData.bankAccountNumber);
  const [bankIban, setBankIban] = useState(initialData.bankIban);
  const [bankSwift, setBankSwift] = useState(initialData.bankSwift);
  const [vsTouched, setVsTouched] = useState(false);
  const [variableSymbol, setVariableSymbol] = useState(initialData.variableSymbol);
  const [constantSymbol, setConstantSymbol] = useState(initialData.constantSymbol);
  const [orderNumber, setOrderNumber] = useState(initialData.orderNumber);
  const [discountPercent, setDiscountPercent] = useState(initialData.discountPercent);
  const [vatMode, setVatMode] = useState<VatMode>(
    supplier.vatPayer ? initialData.vatMode : "non_vat",
  );
  const [roundToWhole, setRoundToWhole] = useState(initialData.roundToWhole);
  const [showQr, setShowQr] = useState(initialData.showQr);
  const [noteBefore, setNoteBefore] = useState(initialData.noteBefore);
  const [noteAfter, setNoteAfter] = useState(initialData.noteAfter);
  const [items, setItems] = useState<EditableItem[]>(initialData.items);

  const [aresLoading, setAresLoading] = useState(false);
  const [aresStatus, setAresStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [aresFlash, setAresFlash] = useState(false);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState<"draft" | "issue" | null>(null);

  const effectiveRound = paymentMethod === "cash" ? true : roundToWhole;

  const parsedItems = useMemo(
    () =>
      items.map((it) => ({
        description: it.description,
        quantityMilli: Math.max(0, parseCzechQuantityToMilli(it.quantityStr)),
        unit: it.unit || "ks",
        unitPriceMinor: Math.max(0, parseCzechAmountToMinor(it.unitPriceStr)),
        priceType,
        catalogItemId: it.catalogItemId ?? null,
        vatRate: it.vatRate,
      })),
    [items, priceType],
  );

  const totals = useMemo(
    () =>
      calculateInvoiceTotals({
        items: parsedItems,
        vatMode,
        roundToWhole: effectiveRound,
        discountPercent,
        priceType,
      }),
    [parsedItems, vatMode, effectiveRound, discountPercent, priceType],
  );

  const computedIban = useMemo(
    () => bankIban || czechAccountToIban(bankAccountNumber),
    [bankIban, bankAccountNumber],
  );

  const effectiveVs = vsTouched ? variableSymbol : extractVariableSymbol(number);

  const spaydString = useMemo(
    () =>
      showQr && computedIban && totals.totalMinor > 0 && docType !== "quote" && docType !== "credit_note"
        ? buildSpayd({
            iban: computedIban,
            amountMinor: totals.totalMinor,
            currency,
            dueDate,
            variableSymbol: effectiveVs,
            constantSymbol,
            message: `${DOC_TYPE_LABELS[docType].short} ${number}`,
          })
        : "",
    [
      showQr,
      computedIban,
      totals.totalMinor,
      currency,
      docType,
      dueDate,
      effectiveVs,
      constantSymbol,
      number,
    ],
  );

  async function handleCurrencyChange(nextCurrency: string) {
    setCurrency(nextCurrency);
    if (nextCurrency === "CZK") {
      setExchangeRateMilli(1000);
      setCnbDate("");
      return;
    }
    try {
      const res = await fetch("/api/cnb");
      const json = await res.json();
      const rate = json.rates?.[nextCurrency];
      if (typeof rate === "number" && rate > 0) {
        setExchangeRateMilli(Math.round(rate * 1000));
        setCnbDate(json.date || "");
      }
    } catch {
      // keep existing rate
    }
  }

  function addCatalogItem(catId: string) {
    const cat = catalogItems.find((c) => c.id === catId);
    if (!cat) return;
    setItems((prev) => {
      const isFirstEmpty =
        prev.length === 1 && !prev[0].description.trim() && !prev[0].unitPriceStr.trim();
      const nextRow: EditableItem = {
        id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        description: cat.name,
        quantityStr: "1",
        unit: cat.unit,
        unitPriceStr: String((cat.unitPriceMinor / 100).toFixed(2)).replace(".", ","),
        vatRate: supplier.vatPayer ? cat.vatRate : 0,
        catalogItemId: cat.id,
      };
      return isFirstEmpty ? [nextRow] : [...prev, nextRow];
    });
  }

  const duzpGapDays = daysBetweenIso(duzp, issueDate);

  function handleSelectContact(id: string) {
    setContactId(id);
    const found = contacts.find((c) => c.id === id);
    if (!found) return;
    setCustomer({
      name: found.name,
      ico: found.ico,
      dic: found.dic,
      vatPayer: found.vatPayer,
      street: found.street,
      city: found.city,
      zip: found.zip,
      country: found.country,
      email: found.email,
    });
    if (found.defaultDueDays != null) {
      setDueDays(found.defaultDueDays);
      setDueDate(addDaysIso(issueDate, found.defaultDueDays));
    }
    setAresStatus(null);
  }

  function handleSelectBank(id: string) {
    setBankAccountId(id);
    const found = bankAccounts.find((b) => b.id === id);
    if (!found) return;
    setBankAccountNumber(found.accountNumber);
    setBankIban(found.iban || czechAccountToIban(found.accountNumber));
    setBankSwift(found.swift);
  }

  async function handleAresLookup() {
    const check = validateIco(customer.ico);
    if (!check.valid) {
      setAresStatus({ ok: false, text: check.error ?? "Neplatné IČO." });
      return;
    }
    setAresLoading(true);
    setAresStatus(null);
    try {
      const res = await fetch(`/api/ares/${check.normalized}`);
      const json = await res.json();
      if (!res.ok) {
        setAresStatus({ ok: false, text: json.error ?? "Subjekt nebyl v ARES nalezen." });
        return;
      }
      const d = json.data;
      setCustomer((prev) => ({
        ...prev,
        ico: d.ico,
        name: d.name || prev.name,
        dic: d.dic || "",
        vatPayer: Boolean(d.vatPayer),
        street: d.street || prev.street,
        city: d.city || prev.city,
        zip: d.zip || prev.zip,
        country: d.country || "Česká republika",
      }));
      setContactId("");
      setAresFlash(true);
      setTimeout(() => setAresFlash(false), 900);
      setAresStatus({
        ok: true,
        text: `Ověřeno v ARES ${formatDateCz(d.verifiedAt)} · ${
          d.vatPayer ? "plátce DPH" : "neplátce DPH"
        }${d.city ? ` · ${d.city}` : ""}`,
      });
    } catch {
      setAresStatus({ ok: false, text: "Chyba komunikace s ARES." });
    } finally {
      setAresLoading(false);
    }
  }

  function updateItem(id: string, patch: Partial<EditableItem>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  function addItem() {
    setItems((prev) => [
      ...prev,
      {
        id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        description: "",
        quantityStr: "1",
        unit: "ks",
        unitPriceStr: "",
        vatRate: supplier.vatPayer ? 21 : 0,
      },
    ]);
  }

  function removeItem(id: string) {
    setItems((prev) => (prev.length > 1 ? prev.filter((it) => it.id !== id) : prev));
  }

  async function handleSubmit(action: "draft" | "issue") {
    setFormError("");
    if (!customer.name.trim()) {
      setFormError("Vyplňte odběratele (nebo jej načtěte podle IČO z ARES).");
      return;
    }
    const validItems = parsedItems.filter((it) => it.description.trim().length > 0);
    if (validItems.length === 0) {
      setFormError("Vyplňte popis alespoň jedné položky faktury.");
      return;
    }

    setSubmitting(action);
    try {
      const payload = {
        action: mode === "create" ? action : action === "issue" ? "issue" : "update",
        docType,
        sequenceId: sequenceId || null,
        number: number.trim(),
        contactId: contactId || null,
        saveContact: true,
        customer,
        issueDate,
        duzp,
        dueDate,
        paymentMethod,
        bankAccountId: bankAccountId || null,
        bankAccountNumber,
        bankIban: computedIban,
        bankSwift,
        variableSymbol: effectiveVs,
        constantSymbol,
        orderNumber,
        discountPercent,
        currency,
        exchangeRateMilli,
        printLanguage,
        priceType,
        vatMode,
        roundToWhole: effectiveRound,
        showQr,
        noteBefore,
        noteAfter,
        items: validItems,
      };

      const url = mode === "create" ? "/api/invoices" : `/api/invoices/${invoiceId}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setFormError(json.error ?? "Nepodařilo se uložit fakturu.");
        return;
      }

      const targetId = mode === "create" ? json.id : invoiceId;
      router.push(`/faktury/${targetId}`);
      router.refresh();
    } catch {
      setFormError("Chyba spojení se serverem.");
    } finally {
      setSubmitting(null);
    }
  }

  const bankSnapshot: BankSnapshot = {
    accountNumber: bankAccountNumber,
    iban: computedIban,
    swift: bankSwift,
  };

  return (
    <div className="container">
      <div className="page-head no-print">
        <div>
          <p className="eyebrow">
            <Link
              href="/faktury"
              className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
            >
              Faktury
            </Link>{" "}
            / {mode === "create" ? "Nová faktura" : `Koncept ${number}`}
          </p>
          <h1 className="display h-page num">
            {mode === "create"
              ? `${DOC_TYPE_LABELS[docType].short} ${number}`
              : `Upravit ${number}`}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button type="button" variant="ghost" size="sm" onClick={() => window.print()}>
            <Printer className="size-3.5" />
            Tisk náhledu
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={submitting !== null}
            onClick={() => handleSubmit("draft")}
          >
            {submitting === "draft" ? "Ukládám…" : "Uložit koncept"}
          </Button>
          <Button
            type="button"
            disabled={submitting !== null}
            onClick={() => handleSubmit("issue")}
          >
            {submitting === "issue" ? "Vystavuji…" : "Vystavit fakturu"}
          </Button>
        </div>
      </div>

      {formError && (
        <Alert variant="destructive" className="mb-6 no-print">
          <AlertTitle>Fakturu nelze vystavit</AlertTitle>
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <div className="editor-layout">
        {/* LEFT COLUMN: NUMBERED FORM */}
        <div className="no-print">
          {/* 01 Odběratel */}
          <section className="editor-section">
            <div className="editor-section__head">
              <span className="editor-section__num">01</span>
              <h2 className="h3">Odběratel</h2>
            </div>

            <div className="space-y-4">
              {contacts.length > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor="contact-picker">Vybrat z adresáře (volitelné)</Label>
                  <Select
                    id="contact-picker"
                    value={contactId}
                    onChange={(e) => handleSelectContact(e.target.value)}
                  >
                    <option value="">Nový nebo ručně zadaný odběratel</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.ico ? `(IČO ${c.ico})` : ""}
                      </option>
                    ))}
                  </Select>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="cust-ico">IČO — zadejte 8 číslic a načtěte z ARES</Label>
                <div className="flex gap-2.5">
                  <Input
                    id="cust-ico"
                    className={`num ${aresStatus && !aresStatus.ok ? "border-destructive" : ""}`}
                    inputMode="numeric"
                    placeholder="např. 27082440"
                    value={customer.ico}
                    onChange={(e) => {
                      setCustomer((prev) => ({ ...prev, ico: e.target.value }));
                      setAresStatus(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleAresLookup();
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={aresLoading}
                    onClick={() => void handleAresLookup()}
                  >
                    {aresLoading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Search className="size-4" />
                    )}
                    {aresLoading ? "Načítám ARES…" : "Načíst z ARES"}
                  </Button>
                </div>
                {aresStatus && (
                  <p
                    className={`flex items-center gap-1.5 text-xs ${
                      aresStatus.ok ? "text-muted-foreground" : "text-destructive"
                    }`}
                  >
                    {aresStatus.ok && <CheckCircle2 className="size-3.5 text-emerald-700" />}
                    {aresStatus.text}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cust-name">Název firmy nebo jméno</Label>
                <Input
                  id="cust-name"
                  className={aresFlash ? "input--flash" : ""}
                  value={customer.name}
                  onChange={(e) => setCustomer((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Nordbyte a.s."
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="cust-dic">DIČ (volitelné)</Label>
                  <Input
                    id="cust-dic"
                    className={`num ${aresFlash ? "input--flash" : ""}`}
                    value={customer.dic}
                    onChange={(e) =>
                      setCustomer((p) => ({
                        ...p,
                        dic: e.target.value,
                        vatPayer: Boolean(e.target.value.trim()),
                      }))
                    }
                    placeholder="CZ27082440"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cust-email">E-mail (volitelné)</Label>
                  <Input
                    id="cust-email"
                    type="email"
                    value={customer.email ?? ""}
                    onChange={(e) => setCustomer((p) => ({ ...p, email: e.target.value }))}
                    placeholder="fakturace@firma.cz"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cust-street">Ulice</Label>
                  <Input
                    id="cust-street"
                    className={aresFlash ? "input--flash" : ""}
                    value={customer.street}
                    onChange={(e) => setCustomer((p) => ({ ...p, street: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cust-city">Obec</Label>
                  <Input
                    id="cust-city"
                    className={aresFlash ? "input--flash" : ""}
                    value={customer.city}
                    onChange={(e) => setCustomer((p) => ({ ...p, city: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cust-zip">PSČ</Label>
                  <Input
                    id="cust-zip"
                    className={`num ${aresFlash ? "input--flash" : ""}`}
                    value={customer.zip}
                    onChange={(e) => setCustomer((p) => ({ ...p, zip: e.target.value }))}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* 02 Doklad */}
          <section className="editor-section">
            <div className="editor-section__head">
              <span className="editor-section__num">02</span>
              <h2 className="h3">Doklad</h2>
            </div>

            <div className="space-y-4">
              {mode === "create" && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="inv-doctype">Typ dokladu</Label>
                    <Select
                      id="inv-doctype"
                      value={docType}
                      onChange={(e) => {
                        const nextType = e.target.value as SalesDocType;
                        setDocType(nextType);
                        const prefix = DOC_TYPE_LABELS[nextType].prefix;
                        const yr = issueDate.slice(0, 4);
                        if (nextType !== "invoice") {
                          setNumber(`${prefix}${yr}-0001`);
                          setSequenceId("");
                        } else if (sequences[0]) {
                          setNumber(sequences[0].nextFormatted);
                          setSequenceId(sequences[0].id);
                        }
                      }}
                    >
                      <option value="invoice">Vydaná faktura</option>
                      <option value="proforma">Zálohová faktura</option>
                      <option value="tax_document">Daňový doklad k platbě</option>
                      <option value="credit_note">Dobropis</option>
                      <option value="quote">Cenová nabídka</option>
                      <option value="sales_receipt">Prodejka</option>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="inv-currency">Měna (kurz ČNB)</Label>
                    <Select
                      id="inv-currency"
                      className="num"
                      value={currency}
                      onChange={(e) => void handleCurrencyChange(e.target.value)}
                    >
                      <option value="CZK">CZK (Kč)</option>
                      <option value="EUR">EUR (€)</option>
                      <option value="USD">USD ($)</option>
                      <option value="GBP">GBP (£)</option>
                      <option value="PLN">PLN (zł)</option>
                    </Select>
                    {currency !== "CZK" && (
                      <p className="text-xs text-muted-foreground num">
                        Kurz ČNB: {(exchangeRateMilli / 1000).toFixed(3)} Kč/{currency}
                        {cnbDate ? ` (${cnbDate})` : ""}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="inv-lang">Jazyk tisku PDF</Label>
                    <Select
                      id="inv-lang"
                      value={printLanguage}
                      onChange={(e) => setPrintLanguage(e.target.value as "cs" | "en")}
                    >
                      <option value="cs">Čeština</option>
                      <option value="en">Angličtina (EN)</option>
                    </Select>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="inv-num">Číslo dokladu</Label>
                  <Input
                    id="inv-num"
                    className="num"
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                  />
                </div>
                {sequences.length > 0 && mode === "create" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="inv-seq">Číselná řada</Label>
                    <Select
                      id="inv-seq"
                      value={sequenceId}
                      onChange={(e) => {
                        setSequenceId(e.target.value);
                        const s = sequences.find((x) => x.id === e.target.value);
                        if (s) setNumber(s.nextFormatted);
                      }}
                    >
                      {sequences.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.nextFormatted})
                        </option>
                      ))}
                    </Select>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="inv-order">Číslo objednávky (volitelné)</Label>
                    <Input
                      id="inv-order"
                      className="num"
                      value={orderNumber}
                      onChange={(e) => setOrderNumber(e.target.value)}
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="inv-issue">Datum vystavení</Label>
                  <Input
                    id="inv-issue"
                    type="date"
                    className="num"
                    value={issueDate}
                    onChange={(e) => {
                      const next = e.target.value;
                      setIssueDate(next);
                      setDuzp(next);
                      setDueDate(addDaysIso(next, dueDays));
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inv-duzp">DUZP</Label>
                  <Input
                    id="inv-duzp"
                    type="date"
                    className="num"
                    value={duzp}
                    onChange={(e) => setDuzp(e.target.value)}
                  />
                  {duzpGapDays > 15 && (
                    <p className="text-xs text-destructive">
                      Upozornění: daňový doklad má být vystaven do 15 dnů od DUZP ({duzpGapDays} dní).
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Splatnost</Label>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="inline-flex rounded-[3px] border border-border bg-card p-0.5" role="group" aria-label="Splatnost ve dnech">
                    {DUE_PRESETS.map((d) => (
                      <Button
                        key={d}
                        type="button"
                        variant={dueDays === d ? "default" : "ghost"}
                        size="sm"
                        className="h-8 px-3 num"
                        aria-pressed={dueDays === d}
                        onClick={() => {
                          setDueDays(d);
                          setDueDate(addDaysIso(issueDate, d));
                        }}
                      >
                        {d} dní
                      </Button>
                    ))}
                  </div>
                  <span className="num text-xs text-muted-foreground">→ {formatDateCz(dueDate)}</span>
                </div>
              </div>

              {supplier.vatPayer && (
                <div className="space-y-1.5">
                  <Label htmlFor="inv-vatmode">Daňový režim</Label>
                  <Select
                    id="inv-vatmode"
                    value={vatMode}
                    onChange={(e) => setVatMode(e.target.value as VatMode)}
                  >
                    <option value="standard">Standardní plátce DPH</option>
                    <option value="reverse_charge">
                      Přenesená daňová povinnost (daň odvede zákazník)
                    </option>
                    <option value="non_vat">Bez DPH (osvobozené / neplátce)</option>
                  </Select>
                </div>
              )}
            </div>
          </section>

          {/* 03 Platba */}
          <section className="editor-section">
            <div className="editor-section__head">
              <span className="editor-section__num">03</span>
              <h2 className="h3">Platba</h2>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pay-method">Forma úhrady</Label>
                  <Select
                    id="pay-method"
                    value={paymentMethod}
                    onChange={(e) =>
                      setPaymentMethod(e.target.value as "bank_transfer" | "cash" | "card")
                    }
                  >
                    <option value="bank_transfer">Bankovní převod</option>
                    <option value="card">Platební kartou</option>
                    <option value="cash">Hotově</option>
                  </Select>
                </div>

                {bankAccounts.length > 0 ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="pay-bank">Bankovní účet</Label>
                    <Select
                      id="pay-bank"
                      className="num"
                      value={bankAccountId}
                      onChange={(e) => handleSelectBank(e.target.value)}
                    >
                      {bankAccounts.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.label} ({b.accountNumber})
                        </option>
                      ))}
                    </Select>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="pay-acc-raw">Číslo účtu</Label>
                    <Input
                      id="pay-acc-raw"
                      className="num"
                      value={bankAccountNumber}
                      onChange={(e) => {
                        setBankAccountNumber(e.target.value);
                        setBankIban(czechAccountToIban(e.target.value));
                      }}
                      placeholder="2104891234/2010"
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pay-vs">Variabilní symbol</Label>
                  <Input
                    id="pay-vs"
                    className="num"
                    inputMode="numeric"
                    value={effectiveVs}
                    onChange={(e) => {
                      setVsTouched(true);
                      setVariableSymbol(e.target.value.replace(/\D/g, "").slice(0, 10));
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pay-ks">Konstantní symbol (volitelné)</Label>
                  <Input
                    id="pay-ks"
                    className="num"
                    inputMode="numeric"
                    value={constantSymbol}
                    onChange={(e) => setConstantSymbol(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    placeholder="0308"
                  />
                </div>
              </div>

              <label className="inline-flex items-center gap-2.5 text-sm font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={showQr}
                  onChange={(e) => setShowQr(e.target.checked)}
                />
                Zobrazit QR Platbu (SPAYD) na faktuře
              </label>

              {computedIban && (
                <p className="text-xs text-muted-foreground mono break-all">
                  IBAN: {formatIban(computedIban)}
                  {spaydString ? ` · ${spaydString}` : ""}
                </p>
              )}
            </div>
          </section>

          {/* 04 Položky */}
          <section className="editor-section">
            <div className="editor-section__head">
              <span className="editor-section__num">04</span>
              <h2 className="h3">Položky</h2>
            </div>

            <div className="space-y-3">
              {items.map((item, idx) => {
                const calc = totals.items[idx];
                return (
                  <Card key={item.id} className="p-3.5 space-y-2.5">
                    <div className="flex gap-2">
                      <Input
                        className="h-9"
                        placeholder="Popis položky nebo služby…"
                        aria-label={`Popis položky ${idx + 1}`}
                        value={item.description}
                        onChange={(e) => updateItem(item.id, { description: e.target.value })}
                      />
                      {items.length > 1 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-9 w-9 shrink-0"
                          aria-label="Odebrat položku"
                          onClick={() => removeItem(item.id)}
                        >
                          <Trash2 className="size-4 text-muted-foreground" />
                        </Button>
                      )}
                    </div>

                    <div
                      className={`grid gap-2 items-center ${
                        vatMode === "standard"
                          ? "grid-cols-[72px_72px_1fr_82px_auto]"
                          : "grid-cols-[80px_80px_1fr_auto]"
                      }`}
                    >
                      <Input
                        className="h-9 num text-right"
                        inputMode="decimal"
                        aria-label="Množství"
                        value={item.quantityStr}
                        onChange={(e) => updateItem(item.id, { quantityStr: e.target.value })}
                      />
                      <Input
                        className="h-9"
                        aria-label="Jednotka"
                        value={item.unit}
                        onChange={(e) => updateItem(item.id, { unit: e.target.value })}
                      />
                      <Input
                        className="h-9 num text-right"
                        inputMode="decimal"
                        aria-label="Cena za jednotku bez DPH"
                        placeholder="Cena bez DPH"
                        value={item.unitPriceStr}
                        onChange={(e) => updateItem(item.id, { unitPriceStr: e.target.value })}
                      />
                      {vatMode === "standard" && (
                        <Select
                          className="h-9 num"
                          aria-label="Sazba DPH"
                          value={item.vatRate}
                          onChange={(e) =>
                            updateItem(item.id, { vatRate: Number(e.target.value) })
                          }
                        >
                          <option value={21}>21 %</option>
                          <option value={12}>12 %</option>
                          <option value={0}>0 %</option>
                        </Select>
                      )}
                      <span className="num whitespace-nowrap text-right font-bold text-sm min-w-[88px]">
                        {formatCzk(calc.subtotalMinor, { currency })}
                      </span>
                    </div>
                  </Card>
                );
              })}
            </div>

            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <Button type="button" variant="outline" size="sm" onClick={addItem}>
                  <Plus className="size-3.5" />
                  Přidat položku
                </Button>
                {catalogItems.length > 0 && (
                  <Select
                    aria-label="Přidat z ceníku"
                    className="h-8 w-52 text-xs"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) addCatalogItem(e.target.value);
                    }}
                  >
                    <option value="">+ Přidat z ceníku…</option>
                    {catalogItems.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name} ({formatCzk(cat.unitPriceMinor)})
                      </option>
                    ))}
                  </Select>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-4">
                {vatMode === "standard" && (
                  <Select
                    aria-label="Typ zadávané ceny"
                    className="h-8 w-36 text-xs"
                    value={priceType}
                    onChange={(e) => setPriceType(e.target.value as PriceType)}
                  >
                    <option value="without_vat">Ceny bez DPH</option>
                    <option value="with_vat">Ceny s DPH</option>
                  </Select>
                )}
                <label className="inline-flex items-center gap-1.5 text-xs font-medium">
                  Sleva %
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    className="h-8 w-16 num text-right"
                    value={discountPercent}
                    onChange={(e) =>
                      setDiscountPercent(Math.min(100, Math.max(0, Number(e.target.value) || 0)))
                    }
                  />
                </label>

                <label className="inline-flex items-center gap-2 text-xs font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={effectiveRound}
                    disabled={paymentMethod === "cash"}
                    onChange={(e) => setRoundToWhole(e.target.checked)}
                  />
                  Zaokrouhlit
                </label>
              </div>
            </div>

            <div className="mt-5 flex items-baseline justify-between border-t border-border pt-4">
              <span className="font-semibold text-muted-foreground">Celkem k úhradě</span>
              <span className="display num text-3xl">
                {formatCzk(totals.totalMinor, { currency })}
              </span>
            </div>
          </section>

          {/* 05 Text na faktuře */}
          <section className="editor-section">
            <div className="editor-section__head">
              <span className="editor-section__num">05</span>
              <h2 className="h3">Text na faktuře</h2>
            </div>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="note-before">Úvodní text nad položkami (volitelné)</Label>
                <Textarea
                  id="note-before"
                  value={noteBefore}
                  onChange={(e) => setNoteBefore(e.target.value)}
                  placeholder="Fakturujeme Vám provedené práce dle smlouvy…"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="note-after">Text pod položkami (volitelné)</Label>
                <Textarea
                  id="note-after"
                  value={noteAfter}
                  onChange={(e) => setNoteAfter(e.target.value)}
                  placeholder="Děkujeme za spolupráci."
                />
              </div>
            </div>
          </section>
        </div>

        {/* RIGHT COLUMN: LIVE A4 PREVIEW */}
        <aside className="preview-sticky">
          <InvoicePreviewA4
            number={number}
            docType={docType}
            printLanguage={printLanguage}
            priceType={priceType}
            issueDate={issueDate}
            duzp={duzp}
            dueDate={dueDate}
            paymentMethod={paymentMethod}
            variableSymbol={effectiveVs}
            constantSymbol={constantSymbol}
            currency={currency}
            vatMode={vatMode}
            roundToWhole={effectiveRound}
            discountPercent={discountPercent}
            showQr={showQr}
            spaydString={spaydString}
            noteBefore={noteBefore}
            noteAfter={noteAfter}
            supplier={supplier}
            customer={customer}
            bank={bankSnapshot}
            items={parsedItems}
          />
          <p className="mt-2.5 text-xs text-muted-foreground no-print">
            Náhled A4 · aktualizuje se při psaní
          </p>
        </aside>
      </div>
    </div>
  );
}
