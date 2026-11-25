"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, Plus } from "lucide-react";
import {
  DOC_TYPE_LABELS,
  formatCzk,
  formatDateCz,
  type SalesDocType,
} from "@/lib/domain/money";
import type { DerivedInvoiceStatus, InvoiceStatusInfo } from "@/lib/domain/invoice-status";
import type {
  BankAccount,
  CatalogItem,
  InvoiceTemplate,
  NumberSequence,
  RecurringInvoice,
} from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "./StatusBadge";
import { RecurringInvoicesPanel } from "./RecurringInvoicesPanel";

export interface InvoiceListRow {
  id: string;
  docType: SalesDocType;
  number: string;
  description: string;
  status: string;
  quoteStatus: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  totalMinor: number;
  paidMinor: number;
  exportedAt: string | null;
  customerName: string;
  customerIco: string;
  customerEmail: string;
  derived: InvoiceStatusInfo;
}

type SectionTab =
  | "invoice"
  | "proforma"
  | "tax_document"
  | "credit_note"
  | "quote"
  | "sales_receipt"
  | "recurring"
  | "templates";

type StatusFilter = "all" | DerivedInvoiceStatus;

const SECTION_TABS: Array<{ key: SectionTab; label: string }> = [
  { key: "invoice", label: "Faktury" },
  { key: "proforma", label: "Zálohy" },
  { key: "tax_document", label: "Daňové doklady" },
  { key: "credit_note", label: "Dobropisy" },
  { key: "quote", label: "Nabídky" },
  { key: "sales_receipt", label: "Prodejky" },
  { key: "recurring", label: "Pravidelné" },
  { key: "templates", label: "Šablony" },
];

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "Vše" },
  { key: "draft", label: "Koncepty" },
  { key: "sent", label: "Čeká na úhradu" },
  { key: "partial", label: "Částečně" },
  { key: "overdue", label: "Po splatnosti" },
  { key: "paid", label: "Zaplacené" },
  { key: "cancelled", label: "Stornované" },
];

export function InvoicesClient({
  initialRows,
  initialRecurring,
  initialTemplates,
  contacts,
  sequences = [],
  bankAccounts = [],
  catalogItems = [],
  company = {
    email: "",
    accountantEmail: "",
    vatPayer: true,
    defaultDueDays: 14,
    defaultRounding: false,
    defaultNoteAfter: "Děkujeme za spolupráci.",
  },
}: {
  initialRows: InvoiceListRow[];
  initialRecurring: RecurringInvoice[];
  initialTemplates: InvoiceTemplate[];
  contacts: Array<{
    id: string;
    name: string;
    ico: string;
    dic?: string;
    street?: string;
    city?: string;
    zip?: string;
    email: string;
  }>;
  sequences?: NumberSequence[];
  bankAccounts?: BankAccount[];
  catalogItems?: CatalogItem[];
  company?: {
    email: string;
    accountantEmail: string;
    vatPayer: boolean;
    defaultDueDays: number;
    defaultRounding: boolean;
    defaultNoteAfter: string;
  };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialStav = (searchParams.get("stav") as StatusFilter) || "all";
  const initialTyp = (searchParams.get("typ") as SectionTab) || "invoice";

  const [section, setSection] = useState<SectionTab>(
    SECTION_TABS.some((t) => t.key === initialTyp) ? initialTyp : "invoice",
  );
  const [filter, setFilter] = useState<StatusFilter>(
    STATUS_FILTERS.some((f) => f.key === initialStav) ? initialStav : "all",
  );
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"issueDate" | "dueDate" | "totalMinor">("issueDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3200);
  }

  const sectionCounts = useMemo(() => {
    const map: Record<SectionTab, number> = {
      invoice: 0,
      proforma: 0,
      tax_document: 0,
      credit_note: 0,
      quote: 0,
      sales_receipt: 0,
      recurring: initialRecurring.length,
      templates: initialTemplates.length,
    };
    for (const r of initialRows) {
      const k = (r.docType in map ? r.docType : "invoice") as SectionTab;
      map[k] += 1;
    }
    return map;
  }, [initialRows, initialRecurring.length, initialTemplates.length]);

  const docsInSection = useMemo(
    () => initialRows.filter((r) => r.docType === section),
    [initialRows, section],
  );

  const statusCounts = useMemo(() => {
    const map: Record<StatusFilter, number> = {
      all: docsInSection.length,
      draft: 0,
      sent: 0,
      partial: 0,
      overdue: 0,
      paid: 0,
      cancelled: 0,
    };
    for (const r of docsInSection) map[r.derived.derived] += 1;
    return map;
  }, [docsInSection]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = docsInSection.filter((r) => {
      if (filter !== "all" && r.derived.derived !== filter) return false;
      if (!q) return true;
      return (
        r.number.toLowerCase().includes(q) ||
        r.customerName.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.customerIco.includes(q)
      );
    });
    return [...list].sort((a, b) => {
      const mul = sortDir === "asc" ? 1 : -1;
      if (sortBy === "totalMinor") return (a.totalMinor - b.totalMinor) * mul;
      return a[sortBy].localeCompare(b[sortBy]) * mul;
    });
  }, [docsInSection, filter, query, sortBy, sortDir]);

  const summary = useMemo(() => {
    let total = 0;
    let unpaid = 0;
    let overdue = 0;
    for (const r of filtered) {
      if (r.status === "cancelled") continue;
      total += r.totalMinor;
      if (r.status === "issued") {
        unpaid += r.derived.remainingMinor;
        if (r.derived.derived === "overdue") overdue += r.derived.remainingMinor;
      }
    }
    return { total, unpaid, overdue };
  }, [filtered]);

  function toggleSort(col: "issueDate" | "dueDate" | "totalMinor") {
    if (sortBy === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(col);
      setSortDir("desc");
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runBulk(action: "mark_paid" | "clear_export_flag") {
    if (selectedIds.size === 0) return;
    setBusyId("bulk");
    try {
      const res = await fetch("/api/invoices/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids: [...selectedIds] }),
      });
      const json = await res.json();
      if (res.ok) {
        setSelectedIds(new Set());
        showToast(
          action === "mark_paid"
            ? `Označeno jako zaplacené: ${json.count} dokladů.`
            : `Příznak exportu smazán u ${json.count} dokladů.`,
        );
        router.refresh();
      }
    } finally {
      setBusyId(null);
    }
  }

  async function markFullyPaid(row: InvoiceListRow) {
    if (row.derived.remainingMinor <= 0) return;
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/invoices/${row.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountMinor: row.derived.remainingMinor,
          method: "bank_transfer",
          note: "Ručně označeno jako zaplacené",
        }),
      });
      if (res.ok) {
        showToast(`Doklad ${row.number} byl označen jako zaplacený.`);
        router.refresh();
      }
    } finally {
      setBusyId(null);
    }
  }

  async function sendQuickReminder(row: InvoiceListRow) {
    const email = row.customerEmail || "fakturace@odberatel.cz";
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/invoices/${row.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send_email",
          kind: "reminder",
          recipientEmail: email,
        }),
      });
      if (res.ok) {
        showToast(`Upomínka k ${row.number} byla zařazena k odeslání na ${email}.`);
        router.refresh();
      }
    } finally {
      setBusyId(null);
    }
  }

  const isDocumentSection = section !== "recurring" && section !== "templates";

  return (
    <div className="container pb-16">
      <div className="page-head">
        <div>
          <p className="eyebrow">Prodej a fakturace</p>
          <h1 className="display h-page">
            {SECTION_TABS.find((t) => t.key === section)?.label ?? "Prodej"}
          </h1>
        </div>
        <div className="actions">
          {isDocumentSection && (
            <>
              <Button asChild variant="ghost" size="sm">
                <a href="/api/exports?format=csv">
                  <Download className="size-3.5" />
                  Export CSV
                </a>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <a href="/api/exports?format=pohoda">
                  <Download className="size-3.5" />
                  Pohoda XML
                </a>
              </Button>
              {section !== "invoice" && (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/faktury/nova?docType=${section}`}>
                    <Plus className="size-3.5" />
                    Nový doklad ({DOC_TYPE_LABELS[section].short})
                  </Link>
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Primary module tabs (all iDoklad sales submodules) */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <Tabs
          value={section}
          onValueChange={(v) => {
            setSection(v as SectionTab);
            setFilter("all");
            setSelectedIds(new Set());
          }}
        >
          <TabsList>
            {SECTION_TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key}>
                {t.label}
                <span className="text-xs text-muted-foreground num">{sectionCounts[t.key]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {isDocumentSection && (
          <div className="relative w-full sm:w-72">
            <Input
              ref={searchRef}
              type="search"
              placeholder="Hledat číslo, odběratele, IČO…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Hledat doklady"
            />
            {!query && (
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-[2px] border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                /
              </span>
            )}
          </div>
        )}
      </div>

      {/* RECURRING INVOICES VIEW — full iDoklad parity */}
      {section === "recurring" && (
        <RecurringInvoicesPanel
          initialRecurring={initialRecurring}
          contacts={contacts}
          sequences={sequences}
          bankAccounts={bankAccounts}
          catalogItems={catalogItems}
          company={company}
          onToast={showToast}
        />
      )}

      {/* TEMPLATES VIEW */}
      {section === "templates" && (
        <div>
          {initialTemplates.length === 0 ? (
            <Card className="p-9">
              <p className="text-sm text-muted-foreground">
                Zatím nemáte žádnou šablonu. Šablonu vytvoříte z detailu libovolné faktury akcí
                „Uložit jako šablonu“.
              </p>
            </Card>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Název šablony</TableHead>
                  <TableHead>Typ</TableHead>
                  <TableHead>Odběratel</TableHead>
                  <TableHead>Měna</TableHead>
                  <TableHead className="text-right">Akce</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {initialTemplates.map((t) => {
                  const cust = JSON.parse(t.customerSnapshotJson) as { name?: string };
                  return (
                    <TableRow key={t.id}>
                      <TableCell>
                        <span className="block font-semibold">{t.name}</span>
                        {t.description && (
                          <span className="block text-xs text-muted-foreground">
                            {t.description}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {DOC_TYPE_LABELS[(t.docType as SalesDocType) ?? "invoice"].short}
                      </TableCell>
                      <TableCell>{cust.name || "—"}</TableCell>
                      <TableCell className="num">{t.currency}</TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-3 text-xs">
                          <Link
                            href={`/faktury/nova?templateId=${t.id}`}
                            className="font-semibold underline underline-offset-4"
                          >
                            Použít šablonu
                          </Link>
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-destructive cursor-pointer"
                            onClick={async () => {
                              await fetch(`/api/templates?id=${t.id}`, { method: "DELETE" });
                              showToast("Šablona odstraněna.");
                              router.refresh();
                            }}
                          >
                            Smazat
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {/* SALES DOCUMENTS LIST VIEW */}
      {isDocumentSection && (
        <>
          <div className="mb-3.5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap gap-4">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`text-xs transition-colors cursor-pointer ${
                    filter === f.key
                      ? "font-semibold text-foreground underline underline-offset-4"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label} <span className="text-muted-foreground num">({statusCounts[f.key]})</span>
                </button>
              ))}
            </div>

            {selectedIds.size > 0 && (
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold num">Vybráno: {selectedIds.size}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busyId === "bulk"}
                  onClick={() => runBulk("mark_paid")}
                >
                  Označit zaplacené
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => runBulk("clear_export_flag")}
                >
                  Smazat příznak exportu
                </Button>
              </div>
            )}
          </div>

          <div className="summary-strip num">
            <span>
              Zobrazeno <strong>{filtered.length}</strong> dokladů
            </span>
            <span>
              Celkem <strong>{formatCzk(summary.total)}</strong>
            </span>
            <span>
              Neuhrazeno <strong>{formatCzk(summary.unpaid)}</strong>
            </span>
            {summary.overdue > 0 && (
              <span className="text-destructive">
                Po splatnosti <strong>{formatCzk(summary.overdue)}</strong>
              </span>
            )}
          </div>

          {filtered.length === 0 ? (
            <Card className="p-10">
              <p className="mb-1.5 font-semibold">Žádné doklady v této sekci.</p>
              <p className="mb-4 text-sm text-muted-foreground">
                Vystavte nový doklad typu {DOC_TYPE_LABELS[section].short.toLowerCase()}.
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href={`/faktury/nova?docType=${section}`}>
                  <Plus className="size-3.5" />
                  Nový doklad ({DOC_TYPE_LABELS[section].short})
                </Link>
              </Button>
            </Card>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-9 pr-0">
                    <input
                      type="checkbox"
                      aria-label="Vybrat vše"
                      checked={filtered.length > 0 && selectedIds.size === filtered.length}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedIds(new Set(filtered.map((f) => f.id)));
                        else setSelectedIds(new Set());
                      }}
                    />
                  </TableHead>
                  <TableHead>Číslo</TableHead>
                  <TableHead>Odběratel</TableHead>
                  <TableHead>
                    <button
                      type="button"
                      onClick={() => toggleSort("issueDate")}
                      className="cursor-pointer font-semibold uppercase tracking-[0.06em]"
                    >
                      Vystaveno {sortBy === "issueDate" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      type="button"
                      onClick={() => toggleSort("dueDate")}
                      className="cursor-pointer font-semibold uppercase tracking-[0.06em]"
                    >
                      {section === "quote" ? "Platnost do" : "Splatnost"}{" "}
                      {sortBy === "dueDate" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button
                      type="button"
                      onClick={() => toggleSort("totalMinor")}
                      className="cursor-pointer font-semibold uppercase tracking-[0.06em]"
                    >
                      Částka {sortBy === "totalMinor" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                    </button>
                  </TableHead>
                  <TableHead>Stav</TableHead>
                  <TableHead className="text-right">Akce</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="pr-0">
                      <input
                        type="checkbox"
                        aria-label={`Vybrat ${row.number}`}
                        checked={selectedIds.has(row.id)}
                        onChange={() => toggleSelect(row.id)}
                      />
                    </TableCell>
                    <TableCell className="num whitespace-nowrap">
                      <Link href={`/faktury/${row.id}`} className="font-semibold hover:underline">
                        {row.number}
                      </Link>
                      {row.exportedAt && (
                        <span className="block text-xs text-muted-foreground">exportováno</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/faktury/${row.id}`}
                        className="block font-semibold hover:underline"
                      >
                        {row.customerName}
                      </Link>
                      <span className="block text-xs text-muted-foreground num">
                        {[row.customerIco ? `IČO ${row.customerIco}` : null, row.description]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </TableCell>
                    <TableCell className="num whitespace-nowrap">
                      {formatDateCz(row.issueDate)}
                    </TableCell>
                    <TableCell className="num whitespace-nowrap">
                      {row.status === "draft" ? "—" : formatDateCz(row.dueDate)}
                      <span
                        className={`block text-xs ${
                          row.derived.isDangerSubtext
                            ? "font-medium text-destructive"
                            : "text-muted-foreground"
                        }`}
                      >
                        {row.derived.dueSubtext}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-bold num whitespace-nowrap">
                      {formatCzk(row.totalMinor, { currency: row.currency })}
                    </TableCell>
                    <TableCell>
                      {row.docType === "quote" ? (
                        <Badge variant="outline">
                          {row.quoteStatus === "converted"
                            ? "Převedeno"
                            : row.quoteStatus === "accepted"
                              ? "Přijato"
                              : row.quoteStatus === "rejected"
                                ? "Zamítnuto"
                                : "Otevřená"}
                        </Badge>
                      ) : (
                        <StatusBadge status={row.derived.derived} />
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-3 text-xs">
                        {row.status === "draft" ? (
                          <Link
                            href={`/faktury/${row.id}`}
                            className="font-semibold underline underline-offset-4"
                          >
                            Dokončit
                          </Link>
                        ) : row.derived.derived === "overdue" ? (
                          <button
                            type="button"
                            className="font-semibold underline underline-offset-4 cursor-pointer"
                            disabled={busyId === row.id}
                            onClick={() => sendQuickReminder(row)}
                          >
                            Upomenout
                          </button>
                        ) : row.status === "issued" &&
                          row.docType !== "quote" &&
                          row.derived.remainingMinor > 0 ? (
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground cursor-pointer"
                            disabled={busyId === row.id}
                            onClick={() => markFullyPaid(row)}
                          >
                            Označit zaplacené
                          </button>
                        ) : null}

                        {row.status === "issued" && (
                          <a
                            href={`/api/invoices/${row.id}/pdf`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-muted-foreground hover:text-foreground"
                          >
                            PDF
                          </a>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}
