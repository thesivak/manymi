"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRightLeft,
  Bell,
  BookmarkPlus,
  Copy,
  Download,
  FileCode2,
  FileMinus,
  FileText,
  Mail,
  Printer,
} from "lucide-react";
import {
  DOC_TYPE_LABELS,
  formatCzk,
  formatDateCz,
  parseCzechAmountToMinor,
  type PriceType,
  type SalesDocType,
  type VatMode,
} from "@/lib/domain/money";
import type { InvoiceStatusInfo } from "@/lib/domain/invoice-status";
import { todayIso } from "@/lib/domain/czech";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "./StatusBadge";
import { InvoicePreviewA4 } from "./InvoicePreviewA4";
import type { BankSnapshot, InvoicePdfItem, PartySnapshot } from "@/lib/pdf/invoice-pdf";

interface RecordedPayment {
  paymentId: string;
  amountMinor: number;
  paidAt: string;
  method: string;
  note: string;
}

interface AttachmentRow {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

interface EmailRow {
  id: string;
  kind: string;
  recipientEmail: string;
  subject: string;
  sentAt: string;
}

interface InvoiceDetailProps {
  invoice: {
    id: string;
    docType: SalesDocType;
    number: string;
    status: string;
    quoteStatus: string;
    printLanguage: "cs" | "en";
    priceType: PriceType;
    proformaDeductionMinor: number;
    issueDate: string;
    duzp: string;
    dueDate: string;
    paymentMethod: string;
    variableSymbol: string;
    constantSymbol: string;
    discountPercent: number;
    currency: string;
    vatMode: VatMode;
    roundToWhole: boolean;
    showQr: boolean;
    spaydString: string;
    noteBefore: string;
    noteAfter: string;
    totalMinor: number;
    paidMinor: number;
    supplier: PartySnapshot;
    customer: PartySnapshot;
    bank: BankSnapshot;
    items: InvoicePdfItem[];
    payments: RecordedPayment[];
    attachments: AttachmentRow[];
    emails: EmailRow[];
    derived: InvoiceStatusInfo;
  };
}

export function InvoiceDetailClient({ invoice }: InvoiceDetailProps) {
  const router = useRouter();
  const [amountStr, setAmountStr] = useState(
    invoice.derived.remainingMinor > 0
      ? String((invoice.derived.remainingMinor / 100).toFixed(2)).replace(".", ",")
      : "",
  );

  useEffect(() => {
    setAmountStr(
      invoice.derived.remainingMinor > 0
        ? String((invoice.derived.remainingMinor / 100).toFixed(2)).replace(".", ",")
        : "",
    );
  }, [invoice.derived.remainingMinor]);

  const [paidAt, setPaidAt] = useState(todayIso());
  const [method, setMethod] = useState<"bank_transfer" | "cash" | "card">("bank_transfer");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [emailModal, setEmailModal] = useState<"invoice" | "reminder" | null>(null);
  const [emailTo, setEmailTo] = useState(invoice.customer.email || "");
  const [tplName, setTplName] = useState("");
  const [showTplForm, setShowTplForm] = useState(false);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  async function recordPayment(e: React.FormEvent) {
    e.preventDefault();
    const minor = parseCzechAmountToMinor(amountStr);
    if (minor <= 0) {
      showToast("Zadejte kladnou částku úhrady.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountMinor: minor, paidAt, method, note }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error ?? "Nepodařilo se zapsat úhradu.");
      } else {
        setNote("");
        showToast(`Úhrada ${formatCzk(minor, { currency: invoice.currency })} byla zapsána.`);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function deletePayment(paymentId: string) {
    setBusy(true);
    try {
      await fetch(`/api/invoices/${invoice.id}/payments?paymentId=${paymentId}`, {
        method: "DELETE",
      });
      showToast("Úhrada byla odebrána.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function toggleCancel() {
    const action = invoice.status === "cancelled" ? "restore" : "cancel";
    setBusy(true);
    try {
      await fetch(`/api/invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      showToast(
        action === "cancel"
          ? `Doklad ${invoice.number} byl stornován.`
          : `Doklad ${invoice.number} byl obnoven.`,
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function runDocAction(
    action: "duplicate" | "credit_note" | "convert_to_invoice" | "tax_document",
  ) {
    setBusy(true);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error ?? "Akci se nepodařilo dokončit.");
      } else {
        showToast(`Vytvořen doklad ${json.number}.`);
        router.push(`/faktury/${json.id}`);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function sendEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!emailTo.trim() || !emailModal) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send_email",
          kind: emailModal,
          recipientEmail: emailTo.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) showToast(json.error ?? "Odeslání selhalo.");
      else {
        setEmailModal(null);
        showToast(json.detail ?? `E-mail k dokladu ${invoice.number} byl zpracován.`);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveAsTemplate(e: React.FormEvent) {
    e.preventDefault();
    if (!tplName.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_template", name: tplName.trim() }),
      });
      if (res.ok) {
        setShowTplForm(false);
        setTplName("");
        showToast("Šablona byla uložena do sekce Prodej → Šablony.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function uploadAttachment(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/invoices/${invoice.id}/attachments`, {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) showToast(json.error ?? "Přílohu se nepodařilo nahrát.");
      else {
        showToast(`Příloha ${file.name} byla přiložena.`);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  const paidPct =
    invoice.totalMinor > 0
      ? Math.min(100, Math.round((invoice.paidMinor / invoice.totalMinor) * 100))
      : 0;

  return (
    <div className="container">
      <div className="page-head no-print">
        <div>
          <p className="eyebrow">
            <Link href="/faktury" className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline">
              Prodej
            </Link>{" "}
            / {DOC_TYPE_LABELS[invoice.docType].short} {invoice.number}
          </p>
          <div className="flex flex-wrap items-baseline gap-4">
            <h1 className="display h-page num">
              {DOC_TYPE_LABELS[invoice.docType].short} {invoice.number}
            </h1>
            <StatusBadge status={invoice.derived.derived} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={invoice.status === "cancelled" ? "" : "text-muted-foreground hover:text-destructive"}
            disabled={busy}
            onClick={toggleCancel}
          >
            {invoice.status === "cancelled" ? "Obnovit" : "Stornovat"}
          </Button>
          <Button asChild variant="ghost" size="sm">
            <a href={`/api/invoices/${invoice.id}/isdoc`}>
              <FileCode2 className="size-3.5" />
              ISDOC XML
            </a>
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => window.print()}>
            <Printer className="size-3.5" />
            Tisk
          </Button>
          <Button asChild>
            <a href={`/api/invoices/${invoice.id}/pdf?download=1`}>
              <Download className="size-4" />
              Stáhnout PDF
            </a>
          </Button>
        </div>
      </div>

      {/* Workflow actions bar matching iDoklad */}
      <div className="mb-7 flex flex-wrap gap-2.5 border-y border-border py-3.5 no-print">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => setEmailModal("invoice")}
        >
          <Mail className="size-3.5" />
          Odeslat e-mailem
        </Button>
        {invoice.derived.remainingMinor > 0 && invoice.docType !== "quote" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setEmailModal("reminder")}
          >
            <Bell className="size-3.5" />
            Poslat upomínku
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => runDocAction("duplicate")}
        >
          <Copy className="size-3.5" />
          Kopírovat doklad
        </Button>
        {invoice.docType === "invoice" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => runDocAction("credit_note")}
          >
            <FileMinus className="size-3.5" />
            Vystavit dobropis
          </Button>
        )}
        {(invoice.docType === "quote" || invoice.docType === "proforma") && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => runDocAction("convert_to_invoice")}
          >
            <ArrowRightLeft className="size-3.5" />
            {invoice.docType === "proforma"
              ? "Vyúčtovat (konečná faktura)"
              : "Převést na fakturu"}
          </Button>
        )}
        {invoice.docType === "proforma" && invoice.paidMinor > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => runDocAction("tax_document")}
          >
            <FileText className="size-3.5" />
            Daňový doklad k platbě
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowTplForm((v) => !v)}
        >
          <BookmarkPlus className="size-3.5" />
          Uložit jako šablonu
        </Button>
      </div>

      {emailModal && (
        <Card className="mb-6 max-w-xl border-foreground no-print">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {emailModal === "reminder"
                ? `Poslat upomínku k ${invoice.number}`
                : `Odeslat doklad ${invoice.number} e-mailem`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={sendEmail} className="flex flex-wrap gap-2.5">
              <Input
                type="email"
                className="flex-1 min-w-56"
                required
                placeholder="fakturace@odberatel.cz"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
              />
              <Button type="submit" disabled={busy}>
                Odeslat
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEmailModal(null)}>
                Zrušit
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {showTplForm && (
        <Card className="mb-6 max-w-xl border-foreground no-print">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Uložit doklad jako šablonu</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveAsTemplate} className="flex flex-wrap gap-2.5">
              <Input
                className="flex-1 min-w-56"
                required
                placeholder="Název šablony (např. Měsíční vývoj)"
                value={tplName}
                onChange={(e) => setTplName(e.target.value)}
              />
              <Button type="submit" disabled={busy}>
                Uložit
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShowTplForm(false)}>
                Zrušit
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="editor-layout">
        {/* LEFT: PAYMENTS, ATTACHMENTS & EMAIL HISTORY */}
        <div className="no-print">
          {invoice.docType !== "quote" && (
            <section className="editor-section">
              <div className="editor-section__head">
                <span className="editor-section__num">01</span>
                <h2 className="h3">Stav úhrady</h2>
              </div>

              <div className="mb-5">
                <div className="mb-2 flex justify-between">
                  <span className="text-xs text-muted-foreground">Uhrazeno / Celkem</span>
                  <span className="num font-bold text-sm">
                    {formatCzk(invoice.paidMinor, { currency: invoice.currency })} /{" "}
                    {formatCzk(invoice.totalMinor, { currency: invoice.currency })}
                  </span>
                </div>
                <div className="meter">
                  <div className="meter__fill" style={{ width: `${paidPct}%` }} />
                </div>
                <p
                  className={`text-xs num ${
                    invoice.derived.isDangerSubtext ? "text-destructive font-medium" : "text-muted-foreground"
                  }`}
                >
                  Splatnost {formatDateCz(invoice.dueDate)} · {invoice.derived.dueSubtext}
                  {invoice.derived.remainingMinor > 0
                    ? ` · zbývá uhradit ${formatCzk(invoice.derived.remainingMinor, { currency: invoice.currency })}`
                    : ""}
                </p>
              </div>

              {invoice.status === "issued" && invoice.derived.remainingMinor > 0 && (
                <Card className="mb-6 border-foreground">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Zapsat úhradu (plnou či částečnou)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={recordPayment} className="space-y-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="pay-amt">Částka ({invoice.currency})</Label>
                          <Input
                            id="pay-amt"
                            className="num text-right"
                            inputMode="decimal"
                            value={amountStr}
                            onChange={(e) => setAmountStr(e.target.value)}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="pay-date">Datum úhrady</Label>
                          <Input
                            id="pay-date"
                            type="date"
                            className="num"
                            value={paidAt}
                            onChange={(e) => setPaidAt(e.target.value)}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="pay-m">Způsob</Label>
                          <Select
                            id="pay-m"
                            value={method}
                            onChange={(e) =>
                              setMethod(e.target.value as "bank_transfer" | "cash" | "card")
                            }
                          >
                            <option value="bank_transfer">Bankovní převod</option>
                            <option value="card">Kartou</option>
                            <option value="cash">Hotově</option>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="pay-note">Poznámka (volitelné)</Label>
                          <Input
                            id="pay-note"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="Výpis z účtu"
                          />
                        </div>
                      </div>
                      <Button type="submit" variant="outline" disabled={busy}>
                        {busy ? "Ukládám…" : "Zapsat úhradu"}
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              )}

              <h3 className="mb-2.5 text-sm font-bold">
                Historie plateb ({invoice.payments.length})
              </h3>
              {invoice.payments.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  K tomuto dokladu zatím není zapsána žádná úhrada.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Datum</TableHead>
                      <TableHead>Poznámka</TableHead>
                      <TableHead className="text-right">Částka</TableHead>
                      <TableHead className="text-right">Akce</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoice.payments.map((p) => (
                      <TableRow key={p.paymentId}>
                        <TableCell className="num whitespace-nowrap">{formatDateCz(p.paidAt)}</TableCell>
                        <TableCell className="text-muted-foreground">{p.note || "Úhrada"}</TableCell>
                        <TableCell className="text-right font-bold num whitespace-nowrap">
                          {formatCzk(p.amountMinor, { currency: invoice.currency })}
                        </TableCell>
                        <TableCell className="text-right">
                          <button
                            type="button"
                            className="text-xs text-muted-foreground hover:text-destructive cursor-pointer"
                            disabled={busy}
                            onClick={() => deletePayment(p.paymentId)}
                          >
                            Odebrat
                          </button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>
          )}

          {/* 02 Přílohy (max 5 × 2 MB) */}
          <section className="editor-section">
            <div className="editor-section__head">
              <span className="editor-section__num">02</span>
              <h2 className="h3">Přílohy ({invoice.attachments.length} / 5)</h2>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              K dokladu lze přiložit až 5 souborů po nejvýše 2 MB (objednávka, výkaz práce, smlouva).
            </p>
            {invoice.attachments.length < 5 && (
              <Input
                type="file"
                aria-label="Přiložit soubor"
                disabled={busy}
                className="mb-3.5 cursor-pointer"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadAttachment(file);
                  e.target.value = "";
                }}
              />
            )}
            {invoice.attachments.length > 0 && (
              <Table>
                <TableBody>
                  {invoice.attachments.map((att) => (
                    <TableRow key={att.id}>
                      <TableCell className="font-semibold">{att.filename}</TableCell>
                      <TableCell className="num text-xs text-muted-foreground">
                        {(att.sizeBytes / 1024).toFixed(1)} KB
                      </TableCell>
                      <TableCell className="text-right">
                        <button
                          type="button"
                          className="text-xs text-muted-foreground hover:text-destructive cursor-pointer"
                          onClick={async () => {
                            await fetch(
                              `/api/invoices/${invoice.id}/attachments?attachmentId=${att.id}`,
                              { method: "DELETE" },
                            );
                            router.refresh();
                          }}
                        >
                          Odebrat
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>

          {/* 03 Komunikace */}
          <section className="editor-section">
            <div className="editor-section__head">
              <span className="editor-section__num">03</span>
              <h2 className="h3">Odeslané e-maily ({invoice.emails.length})</h2>
            </div>
            {invoice.emails.length === 0 ? (
              <p className="text-xs text-muted-foreground">Doklad zatím nebyl odeslán e-mailem.</p>
            ) : (
              <Table>
                <TableBody>
                  {invoice.emails.map((em) => (
                    <TableRow key={em.id}>
                      <TableCell className="num text-xs whitespace-nowrap">
                        {formatDateCz(em.sentAt)}
                      </TableCell>
                      <TableCell>
                        <span className="block font-semibold">{em.recipientEmail}</span>
                        <span className="block text-xs text-muted-foreground">{em.subject}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </div>

        {/* RIGHT: A4 DOCUMENT */}
        <div>
          <InvoicePreviewA4
            number={invoice.number}
            docType={invoice.docType}
            printLanguage={invoice.printLanguage}
            priceType={invoice.priceType}
            proformaDeductionMinor={invoice.proformaDeductionMinor}
            issueDate={invoice.issueDate}
            duzp={invoice.duzp}
            dueDate={invoice.dueDate}
            paymentMethod={invoice.paymentMethod}
            variableSymbol={invoice.variableSymbol}
            constantSymbol={invoice.constantSymbol}
            currency={invoice.currency}
            vatMode={invoice.vatMode}
            roundToWhole={invoice.roundToWhole}
            discountPercent={invoice.discountPercent}
            showQr={invoice.showQr}
            spaydString={invoice.spaydString}
            noteBefore={invoice.noteBefore}
            noteAfter={invoice.noteAfter}
            supplier={invoice.supplier}
            customer={invoice.customer}
            bank={invoice.bank}
            items={invoice.items}
          />
        </div>
      </div>

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}
