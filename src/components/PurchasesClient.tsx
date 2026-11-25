"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { addDaysIso, todayIso, validateIco } from "@/lib/domain/czech";
import { formatCzk, formatDateCz, parseCzechAmountToMinor } from "@/lib/domain/money";
import type { InboxExtractedData } from "@/lib/domain/bank-and-inbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface PurchaseRow {
  id: string;
  docType: string;
  number: string;
  externalNumber: string;
  supplierName: string;
  supplierIco: string;
  description: string;
  issueDate: string;
  dueDate: string;
  variableSymbol: string;
  currency: string;
  subtotalMinor: number;
  vatTotalMinor: number;
  totalMinor: number;
  paidMinor: number;
}

interface InboxRow {
  id: string;
  filename: string;
  sizeBytes: number;
  status: string;
  createdAt: string;
  extracted: InboxExtractedData;
}

export function PurchasesClient({
  initialPurchases,
  initialInbox,
}: {
  initialPurchases: PurchaseRow[];
  initialInbox: InboxRow[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"received_invoice" | "receipt" | "inbox">("received_invoice");
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const today = todayIso();

  const [form, setForm] = useState({
    supplierIco: "",
    supplierName: "",
    supplierDic: "",
    externalNumber: "",
    variableSymbol: "",
    description: "",
    issueDate: today,
    dueDate: addDaysIso(today, 14),
    baseCzk: "",
    vatRate: 21,
    paid: false,
  });

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3200);
  }

  const received = initialPurchases.filter((p) => p.docType === "received_invoice");
  const receipts = initialPurchases.filter((p) => p.docType === "receipt");
  const activeList = tab === "receipt" ? receipts : received;

  async function lookupSupplierAres() {
    const check = validateIco(form.supplierIco);
    if (!check.valid) {
      showToast(check.error ?? "Neplatné IČO.");
      return;
    }
    const res = await fetch(`/api/ares/${check.normalized}`);
    const json = await res.json();
    if (!res.ok) {
      showToast(json.error ?? "Dodavatel nebyl v ARES nalezen.");
      return;
    }
    setForm((p) => ({
      ...p,
      supplierIco: json.data.ico,
      supplierName: json.data.name,
      supplierDic: json.data.dic || "",
    }));
    showToast(`Dodavatel ${json.data.name} načten z ARES.`);
  }

  async function savePurchase(e: React.FormEvent) {
    e.preventDefault();
    const baseMinor = parseCzechAmountToMinor(form.baseCzk);
    if (!form.supplierName.trim() || baseMinor <= 0) {
      showToast("Vyplňte dodavatele a kladnou částku bez DPH.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docType: tab === "receipt" ? "receipt" : "received_invoice",
          supplier: {
            name: form.supplierName,
            ico: form.supplierIco,
            dic: form.supplierDic,
          },
          externalNumber: form.externalNumber,
          variableSymbol: form.variableSymbol,
          description: form.description || "Nákup služeb / zboží",
          issueDate: form.issueDate,
          dueDate: form.dueDate,
          unitPriceMinor: baseMinor,
          vatRate: form.vatRate,
          paid: tab === "receipt" ? true : form.paid,
        }),
      });
      const json = await res.json();
      if (!res.ok) showToast(json.error ?? "Nepodařilo se uložit doklad.");
      else {
        setShowForm(false);
        setForm((p) => ({
          ...p,
          supplierName: "",
          supplierIco: "",
          description: "",
          baseCzk: "",
          externalNumber: "",
          variableSymbol: "",
        }));
        showToast(`Doklad ${json.number} byl uložen.`);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleInboxUpload(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/inbox", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) showToast(json.error ?? "Nahrání selhalo.");
      else {
        showToast(`Soubor ${file.name} byl nahrán a vytěžen.`);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container pb-16">
      <div className="page-head">
        <div>
          <p className="eyebrow">Náklady, přijaté doklady a vytěžování</p>
          <h1 className="display h-page">Nákup</h1>
        </div>
        <div className="actions">
          {tab !== "inbox" && (
            <Button type="button" onClick={() => setShowForm((v) => !v)}>
              <Plus className="size-4" />
              {tab === "receipt" ? "Nová účtenka" : "Přijatá faktura"}
            </Button>
          )}
        </div>
      </div>

      <div className="mb-6">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="received_invoice">
              Přijaté faktury{" "}
              <span className="text-xs text-muted-foreground num">{received.length}</span>
            </TabsTrigger>
            <TabsTrigger value="receipt">
              Účtenky <span className="text-xs text-muted-foreground num">{receipts.length}</span>
            </TabsTrigger>
            <TabsTrigger value="inbox">
              Inbox (vytěžování){" "}
              <span className="text-xs text-muted-foreground num">{initialInbox.length}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {showForm && tab !== "inbox" && (
        <Card className="mb-7 border-foreground">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">
              {tab === "receipt" ? "Nová účtenka" : "Nová přijatá faktura"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={savePurchase} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="p-ico">IČO dodavatele (ARES)</Label>
                  <div className="flex gap-2">
                    <Input
                      id="p-ico"
                      className="num"
                      value={form.supplierIco}
                      onChange={(e) => setForm((p) => ({ ...p, supplierIco: e.target.value }))}
                      placeholder="27082440"
                    />
                    <Button type="button" variant="outline" onClick={lookupSupplierAres}>
                      <Search className="size-4" />
                      ARES
                    </Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-name">Dodavatel</Label>
                  <Input
                    id="p-name"
                    required
                    value={form.supplierName}
                    onChange={(e) => setForm((p) => ({ ...p, supplierName: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="p-desc">Popis nákladu</Label>
                  <Input
                    id="p-desc"
                    required
                    placeholder="Cloud hosting / kancelářské potřeby"
                    value={form.description}
                    onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-ext">Číslo dokladu dodavatele</Label>
                  <Input
                    id="p-ext"
                    className="num"
                    value={form.externalNumber}
                    onChange={(e) => setForm((p) => ({ ...p, externalNumber: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-vs">Variabilní symbol</Label>
                  <Input
                    id="p-vs"
                    className="num"
                    value={form.variableSymbol}
                    onChange={(e) => setForm((p) => ({ ...p, variableSymbol: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="p-base">Částka bez DPH (Kč)</Label>
                  <Input
                    id="p-base"
                    className="num text-right"
                    required
                    value={form.baseCzk}
                    onChange={(e) => setForm((p) => ({ ...p, baseCzk: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-vat">Sazba DPH</Label>
                  <Select
                    id="p-vat"
                    className="num"
                    value={form.vatRate}
                    onChange={(e) => setForm((p) => ({ ...p, vatRate: Number(e.target.value) }))}
                  >
                    <option value={21}>21 %</option>
                    <option value={12}>12 %</option>
                    <option value={0}>0 %</option>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-due">Splatnost</Label>
                  <Input
                    id="p-due"
                    type="date"
                    className="num"
                    value={form.dueDate}
                    onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value }))}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 pt-1">
                <Button type="submit" disabled={busy}>
                  Uložit doklad
                </Button>
                {tab === "received_invoice" && (
                  <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.paid}
                      onChange={(e) => setForm((p) => ({ ...p, paid: e.target.checked }))}
                    />
                    Již uhrazeno
                  </label>
                )}
                <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
                  Zrušit
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {tab === "inbox" ? (
        <div className="space-y-6">
          <Card className="border-foreground">
            <CardHeader>
              <CardTitle className="text-lg">Nahrát doklad k vytěžení</CardTitle>
              <CardDescription>
                Nahrajte ISDOC XML, textovou fakturu nebo PDF. Manymi automaticky vytěží IČO (s
                doplněním přes ARES), variabilní symbol, částku a datum a jedním klikem jej převede
                na přijatou fakturu nebo účtenku.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Input
                type="file"
                aria-label="Nahrát soubor do Inboxu"
                disabled={busy}
                className="max-w-md cursor-pointer"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleInboxUpload(file);
                  e.target.value = "";
                }}
              />
            </CardContent>
          </Card>

          {initialInbox.length === 0 ? (
            <Card className="p-8">
              <p className="text-sm text-muted-foreground">
                Inbox je prázdný. Nahrajte první přijatý doklad výše.
              </p>
            </Card>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Soubor</TableHead>
                  <TableHead>Vytěžený dodavatel</TableHead>
                  <TableHead>VS</TableHead>
                  <TableHead className="text-right">Částka</TableHead>
                  <TableHead>Stav</TableHead>
                  <TableHead className="text-right">Akce</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {initialInbox.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <span className="block font-semibold">{item.filename}</span>
                      <span className="block text-xs text-muted-foreground num">
                        {formatDateCz(item.createdAt)}
                      </span>
                    </TableCell>
                    <TableCell>
                      {item.extracted.supplierName || "—"}
                      {item.extracted.supplierIco && (
                        <span className="block text-xs text-muted-foreground num">
                          IČO {item.extracted.supplierIco}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="num">{item.extracted.variableSymbol || "—"}</TableCell>
                    <TableCell className="text-right font-bold num">
                      {item.extracted.totalMinor > 0 ? formatCzk(item.extracted.totalMinor) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.status === "processed" ? "default" : "outline"}>
                        {item.status === "processed" ? "Zpracováno" : "Čeká"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {item.status !== "processed" && (
                        <div className="inline-flex items-center gap-3 text-xs">
                          <button
                            type="button"
                            className="font-semibold underline underline-offset-4 cursor-pointer"
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              const res = await fetch("/api/inbox", {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  id: item.id,
                                  docType: "received_invoice",
                                }),
                              });
                              const json = await res.json();
                              setBusy(false);
                              if (res.ok) {
                                showToast(`Vytvořena přijatá faktura ${json.number}.`);
                                router.refresh();
                              }
                            }}
                          >
                            Na přijatou fakturu
                          </button>
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground cursor-pointer"
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              await fetch("/api/inbox", {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ id: item.id, docType: "receipt" }),
                              });
                              setBusy(false);
                              router.refresh();
                            }}
                          >
                            Na účtenku
                          </button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      ) : activeList.length === 0 ? (
        <Card className="p-9">
          <p className="text-sm text-muted-foreground">
            Zatím zde nejsou žádné nákupní doklady.
          </p>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Číslo / VS</TableHead>
              <TableHead>Dodavatel</TableHead>
              <TableHead>Vystaveno</TableHead>
              <TableHead>Splatnost</TableHead>
              <TableHead className="text-right">Bez DPH</TableHead>
              <TableHead className="text-right">Celkem s DPH</TableHead>
              <TableHead>Stav</TableHead>
              <TableHead className="text-right">Akce</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activeList.map((p) => {
              const isPaid = p.paidMinor >= p.totalMinor && p.totalMinor > 0;
              const isOverdue = !isPaid && p.dueDate < today;
              return (
                <TableRow key={p.id}>
                  <TableCell className="num whitespace-nowrap">
                    <span className="block font-semibold">{p.number}</span>
                    {p.variableSymbol && (
                      <span className="block text-xs text-muted-foreground">
                        VS {p.variableSymbol}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="block font-semibold">{p.supplierName}</span>
                    <span className="block text-xs text-muted-foreground">{p.description}</span>
                  </TableCell>
                  <TableCell className="num whitespace-nowrap">{formatDateCz(p.issueDate)}</TableCell>
                  <TableCell className="num whitespace-nowrap">{formatDateCz(p.dueDate)}</TableCell>
                  <TableCell className="text-right num whitespace-nowrap">
                    {formatCzk(p.subtotalMinor, { currency: p.currency })}
                  </TableCell>
                  <TableCell className="text-right font-bold num whitespace-nowrap">
                    {formatCzk(p.totalMinor, { currency: p.currency })}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={isPaid ? "default" : isOverdue ? "destructive" : "outline"}
                    >
                      {isPaid ? "Uhrazeno" : isOverdue ? "Po splatnosti" : "Neuhrazeno"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-3 text-xs">
                      {!isPaid && (
                        <button
                          type="button"
                          className="font-semibold underline underline-offset-4 cursor-pointer"
                          onClick={async () => {
                            await fetch("/api/purchases", {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ id: p.id, action: "mark_paid" }),
                            });
                            showToast(`Doklad ${p.number} označen jako uhrazený.`);
                            router.refresh();
                          }}
                        >
                          Uhradit
                        </button>
                      )}
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-destructive cursor-pointer"
                        onClick={async () => {
                          await fetch(`/api/purchases?id=${p.id}`, { method: "DELETE" });
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

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}
