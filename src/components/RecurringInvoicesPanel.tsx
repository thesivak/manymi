"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar,
  Copy,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { formatIban, todayIso } from "@/lib/domain/czech";
import {
  calculateInvoiceTotals,
  formatCzk,
  formatDateCz,
  parseCzechAmountToMinor,
  parseCzechQuantityToMilli,
  type PriceType,
  type VatMode,
} from "@/lib/domain/money";
import {
  computeFutureRunDates,
  expandRecurringPlaceholders,
  formatRecurringIntervalCz,
  isScheduleFinished,
  RECURRING_PLACEHOLDERS,
} from "@/lib/domain/recurring";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { BankAccount, CatalogItem, NumberSequence, RecurringInvoice } from "@/db/schema";

interface ContactOption {
  id: string;
  name: string;
  ico: string;
  dic?: string;
  street?: string;
  city?: string;
  zip?: string;
  email: string;
}

interface CompanyMeta {
  email: string;
  accountantEmail: string;
  vatPayer: boolean;
  defaultDueDays: number;
  defaultRounding: boolean;
  defaultNoteAfter: string;
}

interface RecurringItemDraft {
  id: string;
  description: string;
  quantity: string;
  unit: string;
  unitPriceCzk: string;
  priceType: PriceType;
  vatRate: number;
  catalogItemId?: string | null;
}

interface RecurringFormState {
  id: string;
  name: string;
  docType: "invoice" | "proforma";
  sequenceId: string;
  contactId: string;
  orderNumber: string;
  description: string;
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  intervalCount: number;
  startDate: string;
  issueLastDayOfMonth: boolean;
  endMode: "never" | "after_date" | "after_count";
  endDate: string;
  maxOccurrences: number;
  issuedCount: number;
  duzpMode: "issue_date" | "last_day_of_month";
  dueDays: number;
  paymentMethod: string;
  bankAccountId: string;
  constantSymbol: string;
  currency: string;
  vatMode: VatMode;
  priceType: PriceType;
  printLanguage: "cs" | "en";
  discountPercent: number;
  noteBefore: string;
  noteAfter: string;
  internalNote: string;
  tagsText: string;
  sendEmail: boolean;
  sendCopyToSelf: boolean;
  sendToAccountant: boolean;
  sendToOtherEmails: string;
  items: RecurringItemDraft[];
}

const PAYMENT_METHODS = [
  { value: "bank_transfer", label: "Převodem" },
  { value: "card", label: "Kartou" },
  { value: "cash", label: "Hotově" },
  { value: "cod", label: "Dobírka" },
  { value: "offset", label: "Zápočtem" },
  { value: "advance", label: "Zálohou" },
  { value: "paypal", label: "PayPal" },
];

const CURRENCIES = ["CZK", "EUR", "USD", "GBP", "PLN"];

function createEmptyItem(vatPayer: boolean): RecurringItemDraft {
  return {
    id: Math.random().toString(36).slice(2, 10),
    description: "",
    quantity: "1",
    unit: "ks",
    unitPriceCzk: "",
    priceType: "without_vat",
    vatRate: vatPayer ? 21 : 0,
    catalogItemId: null,
  };
}

function buildInitialForm(
  contacts: ContactOption[],
  sequences: NumberSequence[],
  bankAccounts: BankAccount[],
  company: CompanyMeta,
): RecurringFormState {
  const today = todayIso();
  const defaultSeq = sequences.find((s) => s.docType === "invoice") ?? sequences[0];
  const defaultBank = bankAccounts.find((b) => b.isDefault) ?? bankAccounts[0];
  return {
    id: "",
    name: "",
    docType: "invoice",
    sequenceId: defaultSeq?.id ?? "",
    contactId: contacts[0]?.id ?? "",
    orderNumber: "",
    description: "Měsíční služby za {month/year}",
    frequency: "monthly",
    intervalCount: 1,
    startDate: today,
    issueLastDayOfMonth: false,
    endMode: "never",
    endDate: "",
    maxOccurrences: 12,
    issuedCount: 0,
    duzpMode: "issue_date",
    dueDays: company.defaultDueDays || 14,
    paymentMethod: "bank_transfer",
    bankAccountId: defaultBank?.id ?? "",
    constantSymbol: "0308",
    currency: "CZK",
    vatMode: company.vatPayer ? "standard" : "non_vat",
    priceType: "without_vat",
    printLanguage: "cs",
    discountPercent: 0,
    noteBefore: "",
    noteAfter: company.defaultNoteAfter || "Děkujeme za spolupráci.",
    internalNote: "",
    tagsText: "",
    sendEmail: true,
    sendCopyToSelf: true,
    sendToAccountant: false,
    sendToOtherEmails: "",
    items: [
      {
        ...createEmptyItem(company.vatPayer),
        description: "Pravidelná služba {month/year}",
        unitPriceCzk: "10000",
      },
    ],
  };
}

export function RecurringInvoicesPanel({
  initialRecurring,
  contacts,
  sequences,
  bankAccounts,
  catalogItems,
  company,
  onToast,
}: {
  initialRecurring: RecurringInvoice[];
  contacts: ContactOption[];
  sequences: NumberSequence[];
  bankAccounts: BankAccount[];
  catalogItems: CatalogItem[];
  company: CompanyMeta;
  onToast: (msg: string) => void;
}) {
  const router = useRouter();
  const today = todayIso();
  const [subTab, setSubTab] = useState<"all" | "invoice" | "proforma">("all");
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const [previewDatesId, setPreviewDatesId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState<RecurringFormState>(() =>
    buildInitialForm(contacts, sequences, bankAccounts, company),
  );

  const dueCount = useMemo(
    () =>
      initialRecurring.filter(
        (r) =>
          r.active &&
          r.nextRunDate <= today &&
          !isScheduleFinished({
            endMode: r.endMode,
            endDate: r.endDate,
            maxOccurrences: r.maxOccurrences,
            issuedCount: r.issuedCount,
            nextRunDate: r.nextRunDate,
          }),
      ).length,
    [initialRecurring, today],
  );

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const r of initialRecurring) {
      try {
        const parsed = JSON.parse(r.tagsJson || "[]") as string[];
        for (const t of parsed) if (t) s.add(t);
      } catch {
        // ignore
      }
    }
    return [...s].sort();
  }, [initialRecurring]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return initialRecurring.filter((r) => {
      const dt = r.docType === "proforma" ? "proforma" : "invoice";
      if (subTab !== "all" && dt !== subTab) return false;
      if (tagFilter) {
        const tags = (JSON.parse(r.tagsJson || "[]") as string[]) || [];
        if (!tags.includes(tagFilter)) return false;
      }
      if (!q) return true;
      const cust = JSON.parse(r.customerSnapshotJson || "{}") as { name?: string };
      return (
        r.name.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        (cust.name || "").toLowerCase().includes(q)
      );
    });
  }, [initialRecurring, subTab, query, tagFilter]);

  const formFutureDates = useMemo(
    () =>
      computeFutureRunDates(
        {
          frequency: form.frequency,
          intervalCount: form.intervalCount,
          startDate: form.startDate,
          nextRunDate: form.startDate,
          issueLastDayOfMonth: form.issueLastDayOfMonth,
          endMode: form.endMode,
          endDate: form.endDate || null,
          maxOccurrences: form.endMode === "after_count" ? form.maxOccurrences : null,
          issuedCount: form.issuedCount,
        },
        6,
      ),
    [form],
  );

  const formTotals = useMemo(
    () =>
      calculateInvoiceTotals({
        items: form.items.map((it) => ({
          quantityMilli: parseCzechQuantityToMilli(it.quantity) || 1000,
          unitPriceMinor: parseCzechAmountToMinor(it.unitPriceCzk),
          vatRate: it.vatRate,
          priceType: it.priceType,
        })),
        vatMode: form.vatMode,
        roundToWhole: company.defaultRounding,
        discountPercent: form.discountPercent,
        priceType: form.priceType,
      }),
    [form.items, form.vatMode, form.discountPercent, form.priceType, company.defaultRounding],
  );

  const selectedContact = contacts.find((c) => c.id === form.contactId) ?? null;
  const selectedBank = bankAccounts.find((b) => b.id === form.bankAccountId) ?? bankAccounts[0] ?? null;

  function openCreate() {
    setForm(buildInitialForm(contacts, sequences, bankAccounts, company));
    setShowMoreDetails(false);
    setShowForm(true);
  }

  function openEdit(r: RecurringInvoice) {
    const rawItems = JSON.parse(r.itemsJson || "[]") as Array<{
      description: string;
      quantityMilli: number;
      unit: string;
      unitPriceMinor: number;
      priceType?: PriceType;
      vatRate: number;
      catalogItemId?: string | null;
    }>;
    const tags = (JSON.parse(r.tagsJson || "[]") as string[]) || [];

    setForm({
      id: r.id,
      name: r.name,
      docType: r.docType === "proforma" ? "proforma" : "invoice",
      sequenceId: r.sequenceId || "",
      contactId: r.contactId || "",
      orderNumber: r.orderNumber || "",
      description: r.description || "",
      frequency:
        r.frequency === "daily" ||
        r.frequency === "weekly" ||
        r.frequency === "yearly"
          ? r.frequency
          : "monthly",
      intervalCount: r.intervalCount || 1,
      startDate: r.nextRunDate || r.startDate,
      issueLastDayOfMonth: Boolean(r.issueLastDayOfMonth),
      endMode:
        r.endMode === "after_date" || r.endMode === "after_count" ? r.endMode : "never",
      endDate: r.endDate || "",
      maxOccurrences: r.maxOccurrences || 12,
      issuedCount: r.issuedCount || 0,
      duzpMode: r.duzpMode === "last_day_of_month" ? "last_day_of_month" : "issue_date",
      dueDays: r.dueDays ?? company.defaultDueDays,
      paymentMethod: r.paymentMethod || "bank_transfer",
      bankAccountId: r.bankAccountId || "",
      constantSymbol: r.constantSymbol || "0308",
      currency: r.currency || "CZK",
      vatMode: (r.vatMode as VatMode) || (company.vatPayer ? "standard" : "non_vat"),
      priceType: r.priceType === "with_vat" ? "with_vat" : "without_vat",
      printLanguage: r.printLanguage === "en" ? "en" : "cs",
      discountPercent: r.discountPercent || 0,
      noteBefore: r.noteBefore || "",
      noteAfter: r.noteAfter || "",
      internalNote: r.internalNote || "",
      tagsText: tags.join(", "),
      sendEmail: Boolean(r.sendEmail),
      sendCopyToSelf: Boolean(r.sendCopyToSelf),
      sendToAccountant: Boolean(r.sendToAccountant),
      sendToOtherEmails: r.sendToOtherEmails || "",
      items:
        rawItems.length > 0
          ? rawItems.map((it) => ({
              id: Math.random().toString(36).slice(2, 10),
              description: it.description,
              quantity: String((it.quantityMilli || 1000) / 1000).replace(".", ","),
              unit: it.unit || "ks",
              unitPriceCzk: String((it.unitPriceMinor || 0) / 100).replace(".", ","),
              priceType: (it.priceType as PriceType) || "without_vat",
              vatRate: it.vatRate ?? (company.vatPayer ? 21 : 0),
              catalogItemId: it.catalogItemId ?? null,
            }))
          : [createEmptyItem(company.vatPayer)],
    });
    setShowForm(true);
  }

  async function saveSchedule(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      onToast("Zadejte název vzoru pravidelné faktury.");
      return;
    }
    const validItems = form.items
      .filter((it) => it.description.trim().length > 0)
      .map((it) => ({
        description: it.description.trim(),
        quantityMilli: Math.max(1, parseCzechQuantityToMilli(it.quantity) || 1000),
        unit: it.unit.trim() || "ks",
        unitPriceMinor: parseCzechAmountToMinor(it.unitPriceCzk),
        priceType: it.priceType,
        vatRate: form.vatMode === "non_vat" || form.vatMode === "reverse_charge" ? 0 : it.vatRate,
        catalogItemId: it.catalogItemId ?? null,
      }));
    if (validItems.length === 0) {
      onToast("Přidejte alespoň jednu položku faktury.");
      return;
    }

    const contact = contacts.find((c) => c.id === form.contactId);
    const tags = form.tagsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    setBusyId("save");
    try {
      const payload = {
        id: form.id || undefined,
        name: form.name.trim(),
        docType: form.docType,
        sequenceId: form.sequenceId || null,
        contactId: contact?.id ?? null,
        customer: contact
          ? {
              name: contact.name,
              ico: contact.ico,
              dic: contact.dic || "",
              street: contact.street || "",
              city: contact.city || "",
              zip: contact.zip || "",
              email: contact.email,
            }
          : { name: "Odběratel" },
        orderNumber: form.orderNumber,
        description: form.description.trim() || form.name.trim(),
        frequency: form.frequency,
        intervalCount: form.intervalCount,
        startDate: form.startDate,
        issueLastDayOfMonth: form.issueLastDayOfMonth,
        endMode: form.endMode,
        endDate: form.endMode === "after_date" ? form.endDate : null,
        maxOccurrences: form.endMode === "after_count" ? form.maxOccurrences : null,
        duzpMode: form.duzpMode,
        dueDays: form.dueDays,
        paymentMethod: form.paymentMethod,
        bankAccountId: form.bankAccountId || null,
        constantSymbol: form.constantSymbol,
        currency: form.currency,
        vatMode: form.vatMode,
        priceType: form.priceType,
        printLanguage: form.printLanguage,
        discountPercent: form.discountPercent,
        noteBefore: form.noteBefore,
        noteAfter: form.noteAfter,
        internalNote: form.internalNote,
        tags,
        sendEmail: form.sendEmail,
        sendCopyToSelf: form.sendCopyToSelf,
        sendToAccountant: form.sendToAccountant,
        sendToOtherEmails: form.sendToOtherEmails,
        items: validItems,
      };

      const isEdit = Boolean(form.id);
      const res = await fetch("/api/recurring", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        onToast(json.error ?? "Nepodařilo se uložit pravidelnou fakturu.");
        return;
      }
      setShowForm(false);
      onToast(
        isEdit
          ? `Vzor „${form.name}“ byl aktualizován.`
          : `Pravidelná faktura „${form.name}“ byla založena.`,
      );
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function runAction(
    id: string,
    action: "run_now" | "duplicate" | "toggle" | "delete" | "run_due",
    active?: boolean,
  ) {
    setBusyId(id);
    try {
      if (action === "run_now") {
        const res = await fetch("/api/recurring", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "run_now", id }),
        });
        const json = await res.json();
        if (res.ok) {
          onToast(`Vystaven doklad ${json.number} z pravidelného vzoru.`);
          router.refresh();
        }
      } else if (action === "duplicate") {
        const res = await fetch("/api/recurring", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "duplicate", id }),
        });
        if (res.ok) {
          onToast("Vzor byl zkopírován.");
          router.refresh();
        }
      } else if (action === "run_due") {
        const res = await fetch("/api/recurring", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "run_due" }),
        });
        const json = await res.json();
        if (res.ok) {
          onToast(`Vystaveno ${json.count} splatných pravidelných dokladů.`);
          router.refresh();
        }
      } else if (action === "toggle") {
        await fetch("/api/recurring", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, active }),
        });
        onToast(active ? "Pravidelná faktura aktivována." : "Pravidelná faktura pozastavena.");
        router.refresh();
      } else if (action === "delete") {
        await fetch(`/api/recurring?id=${id}`, { method: "DELETE" });
        onToast("Pravidelný vzor byl odstraněn.");
        router.refresh();
      }
    } finally {
      setBusyId(null);
    }
  }

  const freqUnitLabel =
    form.frequency === "daily"
      ? "den / dní"
      : form.frequency === "weekly"
        ? "týden / týdnů"
        : form.frequency === "yearly"
          ? "rok / let"
          : "měsíc / měsíců";

  const previewSchedule = previewDatesId
    ? initialRecurring.find((r) => r.id === previewDatesId) ?? null
    : null;

  return (
    <div className="space-y-6">
      {/* Top action bar + sub-tabs matching iDoklad */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Tabs value={subTab} onValueChange={(v) => setSubTab(v as typeof subTab)}>
          <TabsList>
            <TabsTrigger value="all">
              Všechny{" "}
              <span className="text-xs text-muted-foreground num">{initialRecurring.length}</span>
            </TabsTrigger>
            <TabsTrigger value="invoice">
              Vydané{" "}
              <span className="text-xs text-muted-foreground num">
                {initialRecurring.filter((r) => r.docType !== "proforma").length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="proforma">
              Zálohové{" "}
              <span className="text-xs text-muted-foreground num">
                {initialRecurring.filter((r) => r.docType === "proforma").length}
              </span>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap items-center gap-2.5">
          <Input
            type="search"
            placeholder="Zadejte hledaný výraz…"
            className="h-9 w-56"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {allTags.length > 0 && (
            <Select
              aria-label="Filtrovat podle štítku"
              className="h-9 w-40"
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
            >
              <option value="">Všechny štítky</option>
              {allTags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          )}
          {dueCount > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={busyId === "run_due"}
              onClick={() => void runAction("run_due", "run_due")}
            >
              <Play className="size-3.5" />
              Vystavit k dnešku ({dueCount})
            </Button>
          )}
          <Button type="button" size="sm" className="h-9" onClick={openCreate}>
            <Plus className="size-4" />
            Nová pravidelná faktura
          </Button>
        </div>
      </div>

      {/* Create / Edit form — full iDoklad parity */}
      {showForm && (
        <Card className="border-foreground">
          <CardHeader className="flex-row items-start justify-between space-y-0 pb-4">
            <div>
              <CardTitle className="text-xl">
                {form.id ? `Upravit pravidelnou fakturu: ${form.name}` : "Nová pravidelná faktura"}
              </CardTitle>
              <CardDescription>
                Nastavte opakování, zástupné znaky (např.{" "}
                <code className="mono text-xs">{`{month/year}`}</code>), automatické odesílání a
                položky dokladu.
              </CardDescription>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)}>
              <X className="size-4" />
              Zavřít
            </Button>
          </CardHeader>

          <CardContent>
            <form onSubmit={saveSchedule} className="space-y-6">
              {/* 1. Základní údaje */}
              <div className="space-y-4">
                <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  1. Základní údaje vzoru
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="rec-doctype">Typ faktury</Label>
                    <Select
                      id="rec-doctype"
                      value={form.docType}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          docType: e.target.value as "invoice" | "proforma",
                        }))
                      }
                    >
                      <option value="invoice">Faktura vydaná</option>
                      <option value="proforma">Zálohová faktura</option>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rec-seq">Číselná řada</Label>
                    <Select
                      id="rec-seq"
                      value={form.sequenceId}
                      onChange={(e) => setForm((p) => ({ ...p, sequenceId: e.target.value }))}
                    >
                      <option value="">Výchozí řada</option>
                      {sequences.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.prefix}
                          {s.year})
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rec-tags">Štítky (oddělené čárkou)</Label>
                    <Input
                      id="rec-tags"
                      placeholder="paušál, hosting"
                      value={form.tagsText}
                      onChange={(e) => setForm((p) => ({ ...p, tagsText: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="rec-name">Název vzoru *</Label>
                    <Input
                      id="rec-name"
                      required
                      placeholder="Měsíční správa serveru — Firma s.r.o."
                      value={form.name}
                      onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rec-contact">Odběratel *</Label>
                    <Select
                      id="rec-contact"
                      value={form.contactId}
                      onChange={(e) => setForm((p) => ({ ...p, contactId: e.target.value }))}
                    >
                      <option value="">— Vyberte odběratele z adresáře —</option>
                      {contacts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {c.ico ? ` (IČO ${c.ico})` : ""}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="rec-desc">Popis dokladu *</Label>
                    <Input
                      id="rec-desc"
                      required
                      placeholder="Služby za {month/year}"
                      value={form.description}
                      onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                    />
                    <p className="text-xs text-muted-foreground">
                      Náhled pro {formatDateCz(form.startDate)}:{" "}
                      <strong className="text-foreground">
                        {expandRecurringPlaceholders(form.description, form.startDate, "2026-0001")}
                      </strong>
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rec-order">Číslo objednávky</Label>
                    <Input
                      id="rec-order"
                      placeholder="OBJ-{year}-{month}"
                      value={form.orderNumber}
                      onChange={(e) => setForm((p) => ({ ...p, orderNumber: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              <Separator />

              {/* 2. Nastavení opakování */}
              <div className="space-y-4">
                <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  2. Nastavení opakování
                </p>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="rec-freq">Opakování</Label>
                    <Select
                      id="rec-freq"
                      value={form.frequency}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          frequency: e.target.value as RecurringFormState["frequency"],
                        }))
                      }
                    >
                      <option value="daily">Denně</option>
                      <option value="weekly">Týdně</option>
                      <option value="monthly">Měsíčně</option>
                      <option value="yearly">Ročně</option>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rec-interval">Opakovat každý ({freqUnitLabel})</Label>
                    <Input
                      id="rec-interval"
                      type="number"
                      min={1}
                      max={365}
                      className="num"
                      value={form.intervalCount}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          intervalCount: Math.max(1, Number(e.target.value) || 1),
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rec-start">První / příští vystavení</Label>
                    <Input
                      id="rec-start"
                      type="date"
                      className="num"
                      value={form.startDate}
                      onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rec-endmode">Ukončit opakování</Label>
                    <Select
                      id="rec-endmode"
                      value={form.endMode}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          endMode: e.target.value as RecurringFormState["endMode"],
                        }))
                      }
                    >
                      <option value="never">Nikdy</option>
                      <option value="after_date">Po určitém datu</option>
                      <option value="after_count">Po počtu vystavení</option>
                    </Select>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-6">
                  <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.issueLastDayOfMonth}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, issueLastDayOfMonth: e.target.checked }))
                      }
                    />
                    Vystavovat poslední den v měsíci
                  </label>

                  {form.endMode === "after_date" && (
                    <div className="inline-flex items-center gap-2">
                      <Label htmlFor="rec-enddate">Datum ukončení:</Label>
                      <Input
                        id="rec-enddate"
                        type="date"
                        className="h-9 w-44 num"
                        value={form.endDate}
                        onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))}
                      />
                    </div>
                  )}

                  {form.endMode === "after_count" && (
                    <div className="inline-flex items-center gap-3">
                      <Label htmlFor="rec-maxocc">Počet vystavení:</Label>
                      <Input
                        id="rec-maxocc"
                        type="number"
                        min={1}
                        className="h-9 w-24 num"
                        value={form.maxOccurrences}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            maxOccurrences: Math.max(1, Number(e.target.value) || 1),
                          }))
                        }
                      />
                      <span className="text-xs text-muted-foreground num">
                        Aktuálně vystaveno: {form.issuedCount}×
                      </span>
                    </div>
                  )}
                </div>

                {/* Přehled budoucích vystavení */}
                {formFutureDates.length > 0 && (
                  <Alert>
                    <AlertTitle className="flex items-center gap-1.5 text-xs uppercase tracking-[0.05em]">
                      <Calendar className="size-3.5" />
                      Přehled budoucích vystavení
                    </AlertTitle>
                    <AlertDescription className="flex flex-wrap gap-2 pt-1">
                      {formFutureDates.map((d) => (
                        <Badge key={d} variant="secondary" className="num">
                          {formatDateCz(d)}
                        </Badge>
                      ))}
                    </AlertDescription>
                  </Alert>
                )}
              </div>

              <Separator />

              {/* 3. Odesílání faktury po vystavení */}
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  3. Po vystavení odeslat e-mailem
                </p>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <label className="flex items-center gap-2.5 rounded-[3px] border border-border bg-background px-3 py-2.5 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.sendEmail}
                      onChange={(e) => setForm((p) => ({ ...p, sendEmail: e.target.checked }))}
                    />
                    <span>
                      <strong>Odběrateli</strong>{" "}
                      <span className="text-xs text-muted-foreground">
                        ({selectedContact?.email || "e-mail není vyplněn"})
                      </span>
                    </span>
                  </label>

                  <label className="flex items-center gap-2.5 rounded-[3px] border border-border bg-background px-3 py-2.5 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.sendCopyToSelf}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, sendCopyToSelf: e.target.checked }))
                      }
                    />
                    <span>
                      <strong>Kopie na můj e-mail</strong>{" "}
                      <span className="text-xs text-muted-foreground">
                        ({company.email || "e-mail není vyplněn"})
                      </span>
                    </span>
                  </label>

                  <label className="flex items-center gap-2.5 rounded-[3px] border border-border bg-background px-3 py-2.5 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.sendToAccountant}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, sendToAccountant: e.target.checked }))
                      }
                    />
                    <span>
                      <strong>Účetnímu</strong>{" "}
                      <span className="text-xs text-muted-foreground">
                        ({company.accountantEmail || "e-mail není vyplněn"})
                      </span>
                    </span>
                  </label>

                  <div className="flex items-center gap-2 rounded-[3px] border border-border bg-background px-3 py-1.5">
                    <Input
                      className="h-8 border-0 bg-transparent px-0 text-sm focus-visible:ring-0"
                      placeholder="Další příjemci (e-maily oddělené čárkou)"
                      value={form.sendToOtherEmails}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, sendToOtherEmails: e.target.value }))
                      }
                    />
                  </div>
                </div>
              </div>

              <Separator />

              {/* 4. Platební údaje & datumy (s rozbalením více detailů jako v iDokladu) */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                    4. Platební údaje a datumy
                  </p>
                  <Button
                    type="button"
                    variant="link"
                    className="text-xs"
                    onClick={() => setShowMoreDetails((v) => !v)}
                  >
                    {showMoreDetails ? "Skrýt další detaily" : "Zobrazit více detailů"}
                  </Button>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="rec-due">Splatnost (dní)</Label>
                    <Input
                      id="rec-due"
                      type="number"
                      min={0}
                      max={365}
                      className="num"
                      value={form.dueDays}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, dueDays: Math.max(0, Number(e.target.value) || 0) }))
                      }
                    />
                  </div>

                  {form.docType === "invoice" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="rec-duzp">DUZP</Label>
                      <Select
                        id="rec-duzp"
                        value={form.duzpMode}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            duzpMode: e.target.value as "issue_date" | "last_day_of_month",
                          }))
                        }
                      >
                        <option value="issue_date">V den vystavení</option>
                        <option value="last_day_of_month">Poslední den v měsíci</option>
                      </Select>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="rec-pm">Způsob úhrady</Label>
                    <Select
                      id="rec-pm"
                      value={form.paymentMethod}
                      onChange={(e) => setForm((p) => ({ ...p, paymentMethod: e.target.value }))}
                    >
                      {PAYMENT_METHODS.map((pm) => (
                        <option key={pm.value} value={pm.value}>
                          {pm.label}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="rec-curr">Měna</Label>
                    <Select
                      id="rec-curr"
                      className="num"
                      value={form.currency}
                      onChange={(e) => setForm((p) => ({ ...p, currency: e.target.value }))}
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>

                {showMoreDetails && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-4 pt-1">
                    <div className="space-y-1.5">
                      <Label htmlFor="rec-bank">Bankovní účet</Label>
                      <Select
                        id="rec-bank"
                        value={form.bankAccountId}
                        onChange={(e) => setForm((p) => ({ ...p, bankAccountId: e.target.value }))}
                      >
                        <option value="">Výchozí účet firmy</option>
                        {bankAccounts.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.label} ({b.accountNumber})
                          </option>
                        ))}
                      </Select>
                      {selectedBank && (
                        <p className="text-[11px] text-muted-foreground mono">
                          {selectedBank.iban ? formatIban(selectedBank.iban) : selectedBank.accountNumber}
                        </p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="rec-ks">Konstantní symbol</Label>
                      <Input
                        id="rec-ks"
                        className="num"
                        value={form.constantSymbol}
                        onChange={(e) => setForm((p) => ({ ...p, constantSymbol: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="rec-lang">Jazyk tiskové sestavy</Label>
                      <Select
                        id="rec-lang"
                        value={form.printLanguage}
                        onChange={(e) =>
                          setForm((p) => ({ ...p, printLanguage: e.target.value as "cs" | "en" }))
                        }
                      >
                        <option value="cs">Čeština</option>
                        <option value="en">Angličtina</option>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="rec-vatmode">Režim DPH</Label>
                      <Select
                        id="rec-vatmode"
                        value={form.vatMode}
                        onChange={(e) =>
                          setForm((p) => ({ ...p, vatMode: e.target.value as VatMode }))
                        }
                      >
                        <option value="standard">Standardní DPH</option>
                        <option value="non_vat">Neplátce DPH</option>
                        <option value="reverse_charge">Přenesená daňová povinnost</option>
                      </Select>
                    </div>
                  </div>
                )}
              </div>

              <Separator />

              {/* 5. Položky faktury + Ceník + Zástupné znaky */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                    5. Položky faktury
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {catalogItems.length > 0 && (
                      <Select
                        aria-label="Přidat položku z ceníku"
                        className="h-8 w-52 text-xs"
                        value=""
                        onChange={(e) => {
                          const found = catalogItems.find((c) => c.id === e.target.value);
                          if (!found) return;
                          setForm((p) => ({
                            ...p,
                            items: [
                              ...p.items,
                              {
                                id: Math.random().toString(36).slice(2, 10),
                                description: found.name,
                                quantity: "1",
                                unit: found.unit || "ks",
                                unitPriceCzk: String(found.unitPriceMinor / 100).replace(".", ","),
                                priceType: (found.priceType as PriceType) || "without_vat",
                                vatRate: found.vatRate,
                                catalogItemId: found.id,
                              },
                            ],
                          }));
                        }}
                      >
                        <option value="">+ Přidat z ceníku…</option>
                        {catalogItems.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({formatCzk(c.unitPriceMinor, { currency: c.currency })})
                          </option>
                        ))}
                      </Select>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() =>
                        setForm((p) => ({
                          ...p,
                          items: [...p.items, createEmptyItem(company.vatPayer)],
                        }))
                      }
                    >
                      <Plus className="size-3.5" />
                      Nový řádek
                    </Button>
                  </div>
                </div>

                {/* Clickable placeholders bar (iDoklad zástupné znaky) */}
                <div className="flex flex-wrap items-center gap-1.5 rounded-[3px] border border-border bg-background px-3 py-2 text-xs">
                  <span className="font-semibold text-muted-foreground mr-1">
                    Zástupné znaky (kliknutím vložíte do 1. položky):
                  </span>
                  {RECURRING_PLACEHOLDERS.map((ph) => (
                    <button
                      key={ph.token}
                      type="button"
                      title={ph.label}
                      className="rounded-[2px] border border-border bg-card px-1.5 py-0.5 mono text-[11px] hover:border-foreground cursor-pointer"
                      onClick={() =>
                        setForm((p) => ({
                          ...p,
                          items: p.items.map((it, idx) =>
                            idx === 0
                              ? { ...it, description: `${it.description} ${ph.token}`.trim() }
                              : it,
                          ),
                        }))
                      }
                    >
                      {ph.token}
                    </button>
                  ))}
                </div>

                <div className="space-y-2.5">
                  {form.items.map((item, idx) => (
                    <div
                      key={item.id}
                      className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_80px_70px_120px_115px_85px_36px] items-center"
                    >
                      <Input
                        placeholder="Název položky (lze použít {month/year})"
                        required={idx === 0}
                        value={item.description}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            items: p.items.map((x) =>
                              x.id === item.id ? { ...x, description: e.target.value } : x,
                            ),
                          }))
                        }
                      />
                      <Input
                        className="num text-right"
                        placeholder="Mn."
                        value={item.quantity}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            items: p.items.map((x) =>
                              x.id === item.id ? { ...x, quantity: e.target.value } : x,
                            ),
                          }))
                        }
                      />
                      <Input
                        placeholder="MJ"
                        value={item.unit}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            items: p.items.map((x) =>
                              x.id === item.id ? { ...x, unit: e.target.value } : x,
                            ),
                          }))
                        }
                      />
                      <Input
                        className="num text-right"
                        placeholder="Cena"
                        value={item.unitPriceCzk}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            items: p.items.map((x) =>
                              x.id === item.id ? { ...x, unitPriceCzk: e.target.value } : x,
                            ),
                          }))
                        }
                      />
                      <Select
                        value={item.priceType}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            items: p.items.map((x) =>
                              x.id === item.id
                                ? { ...x, priceType: e.target.value as PriceType }
                                : x,
                            ),
                          }))
                        }
                      >
                        <option value="without_vat">Bez DPH</option>
                        <option value="with_vat">S DPH</option>
                      </Select>
                      <Select
                        className="num"
                        value={item.vatRate}
                        disabled={form.vatMode === "non_vat" || form.vatMode === "reverse_charge"}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            items: p.items.map((x) =>
                              x.id === item.id ? { ...x, vatRate: Number(e.target.value) } : x,
                            ),
                          }))
                        }
                      >
                        <option value={21}>21 %</option>
                        <option value={12}>12 %</option>
                        <option value={0}>0 %</option>
                      </Select>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={form.items.length <= 1}
                        aria-label="Smazat položku"
                        onClick={() =>
                          setForm((p) => ({
                            ...p,
                            items: p.items.filter((x) => x.id !== item.id),
                          }))
                        }
                      >
                        <Trash2 className="size-4 text-muted-foreground" />
                      </Button>
                    </div>
                  ))}
                </div>

                {/* Sleva + texty + souhrn */}
                <div className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="rec-disc">Sleva na fakturu (%)</Label>
                    <Input
                      id="rec-disc"
                      type="number"
                      min={0}
                      max={100}
                      className="num"
                      value={form.discountPercent}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          discountPercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rec-nb">Text před položkami</Label>
                    <Textarea
                      id="rec-nb"
                      rows={2}
                      placeholder="Volitelný text před položkami…"
                      value={form.noteBefore}
                      onChange={(e) => setForm((p) => ({ ...p, noteBefore: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rec-na">Text za položkami</Label>
                    <Textarea
                      id="rec-na"
                      rows={2}
                      placeholder="Děkujeme za spolupráci."
                      value={form.noteAfter}
                      onChange={(e) => setForm((p) => ({ ...p, noteAfter: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4 rounded-[3px] border border-border bg-background px-4 py-3 text-sm num">
                  <div className="flex flex-wrap gap-6">
                    <span>
                      Bez DPH:{" "}
                      <strong>{formatCzk(formTotals.subtotalMinor, { currency: form.currency })}</strong>
                    </span>
                    <span>
                      DPH:{" "}
                      <strong>{formatCzk(formTotals.vatTotalMinor, { currency: form.currency })}</strong>
                    </span>
                    <span>
                      Celkem:{" "}
                      <strong className="text-base">
                        {formatCzk(formTotals.totalMinor, { currency: form.currency })}
                      </strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
                      Zrušit
                    </Button>
                    <Button type="submit" disabled={busyId === "save"}>
                      {busyId === "save"
                        ? "Ukládám…"
                        : form.id
                          ? "Uložit změny vzoru"
                          : "Uložit pravidelnou fakturu"}
                    </Button>
                  </div>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Future run dates preview panel */}
      {previewSchedule && (
        <Alert>
          <div className="flex items-start justify-between gap-4">
            <div>
              <AlertTitle>
                Přehled budoucích vystavení — {previewSchedule.name}
              </AlertTitle>
              <AlertDescription className="mt-2 flex flex-wrap gap-2">
                {computeFutureRunDates(previewSchedule, 12).length === 0 ? (
                  <span>Žádná další budoucí vystavení (vzor je ukončený).</span>
                ) : (
                  computeFutureRunDates(previewSchedule, 12).map((d) => (
                    <Badge key={d} variant="secondary" className="num">
                      {formatDateCz(d)}
                    </Badge>
                  ))
                )}
              </AlertDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setPreviewDatesId(null)}
            >
              <X className="size-4" />
            </Button>
          </div>
        </Alert>
      )}

      {/* Recurring invoices list table */}
      {filtered.length === 0 ? (
        <Card className="p-9">
          <p className="mb-3 text-sm text-muted-foreground">
            {initialRecurring.length === 0
              ? "Zatím nemáte nastavenou žádnou pravidelnou fakturu."
              : "Žádný pravidelný vzor neodpovídá filtru."}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={openCreate}>
            <Plus className="size-3.5" />
            Založit pravidelnou fakturu
          </Button>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Název vzoru / Popis</TableHead>
              <TableHead>Stav</TableHead>
              <TableHead>Odběratel</TableHead>
              <TableHead>Opakovat</TableHead>
              <TableHead>Naposledy / Příští</TableHead>
              <TableHead className="text-right">Bez DPH</TableHead>
              <TableHead className="text-right">Celkem s DPH</TableHead>
              <TableHead className="text-right">Akce</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => {
              const cust = JSON.parse(r.customerSnapshotJson || "{}") as { name?: string };
              const items = JSON.parse(r.itemsJson || "[]") as Array<{
                quantityMilli: number;
                unitPriceMinor: number;
                vatRate: number;
                priceType?: PriceType;
              }>;
              const totals = calculateInvoiceTotals({
                items,
                vatMode: (r.vatMode as VatMode) || "standard",
                roundToWhole: company.defaultRounding,
                discountPercent: r.discountPercent || 0,
                priceType: (r.priceType as PriceType) || "without_vat",
              });
              const finished = isScheduleFinished(r);
              return (
                <TableRow key={r.id}>
                  <TableCell>
                    <button
                      type="button"
                      className="block text-left font-semibold hover:underline cursor-pointer"
                      onClick={() => openEdit(r)}
                    >
                      {r.name}
                    </button>
                    <span className="block text-xs text-muted-foreground">
                      {r.docType === "proforma" ? "Zálohová · " : ""}
                      {r.description}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={finished ? "muted" : r.active ? "default" : "outline"}
                    >
                      {finished ? "Ukončeno" : r.active ? "Aktivní" : "Pozastaveno"}
                    </Badge>
                  </TableCell>
                  <TableCell>{cust.name || "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    <span className="block font-medium">
                      {formatRecurringIntervalCz(r.frequency, r.intervalCount)}
                    </span>
                    {r.issueLastDayOfMonth && (
                      <span className="block text-muted-foreground">Poslední den v měsíci</span>
                    )}
                    {r.endMode === "after_count" && r.maxOccurrences && (
                      <span className="block text-muted-foreground num">
                        {r.issuedCount}/{r.maxOccurrences}×
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="num whitespace-nowrap text-xs">
                    <span className="block text-muted-foreground">
                      Naposledy: {r.lastRunAt ? formatDateCz(r.lastRunAt) : "Nikdy"}
                    </span>
                    <span className="block font-semibold text-foreground">
                      Příští: {finished ? "—" : formatDateCz(r.nextRunDate)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right num whitespace-nowrap">
                    {formatCzk(totals.subtotalMinor, { currency: r.currency })}
                  </TableCell>
                  <TableCell className="text-right font-bold num whitespace-nowrap">
                    {formatCzk(totals.totalMinor, { currency: r.currency })}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={busyId === r.id}
                        onClick={() => void runAction(r.id, "run_now")}
                      >
                        <Play className="size-3" />
                        Vystavit
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Přehled budoucích vystavení"
                        onClick={() => setPreviewDatesId(previewDatesId === r.id ? null : r.id)}
                      >
                        <Calendar className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Upravit vzor"
                        onClick={() => openEdit(r)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Kopírovat vzor"
                        disabled={busyId === r.id}
                        onClick={() => void runAction(r.id, "duplicate")}
                      >
                        <Copy className="size-3.5" />
                      </Button>
                      {!finished && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title={r.active ? "Pozastavit" : "Aktivovat"}
                          onClick={() => void runAction(r.id, "toggle", !r.active)}
                        >
                          {r.active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 hover:text-destructive"
                        title="Smazat vzor"
                        onClick={() => void runAction(r.id, "delete")}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
