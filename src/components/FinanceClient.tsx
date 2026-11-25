"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { formatCzk, formatDateCz, parseCzechAmountToMinor } from "@/lib/domain/money";
import { todayIso } from "@/lib/domain/czech";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { Textarea } from "@/components/ui/textarea";
import type { BankTransaction, CashVoucher, Payment } from "@/db/schema";

interface RegisterWithBalance {
  id: string;
  name: string;
  currency: string;
  currentBalanceMinor: number;
}

interface UnpaidInv {
  id: string;
  number: string;
  variableSymbol: string;
  remainingMinor: number;
  customerName: string;
}

export function FinanceClient({
  transactions,
  unpaidInvoices,
  registers,
  vouchers,
  payments,
}: {
  transactions: BankTransaction[];
  unpaidInvoices: UnpaidInv[];
  registers: RegisterWithBalance[];
  vouchers: CashVoucher[];
  payments: Payment[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"bank" | "cash" | "payments">("bank");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [showCsv, setShowCsv] = useState(false);
  const [csvText, setCsvText] = useState(
    "Datum;Částka;Měna;VS;Protiúčet;Název protiúčtu;Poznámka\n",
  );
  const [txForm, setTxForm] = useState({
    direction: "credit" as "credit" | "debit",
    amountCzk: "",
    variableSymbol: "",
    counterpartyName: "",
    bookedAt: todayIso(),
    note: "",
  });
  const [voucherForm, setVoucherForm] = useState({
    cashRegisterId: registers[0]?.id ?? "",
    direction: "in" as "in" | "out",
    amountCzk: "",
    counterpartyName: "",
    description: "",
    issuedAt: todayIso(),
  });

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  async function addManualTx(e: React.FormEvent) {
    e.preventDefault();
    const amountMinor = parseCzechAmountToMinor(txForm.amountCzk);
    if (amountMinor <= 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/bank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "add_manual",
          direction: txForm.direction,
          amountMinor,
          variableSymbol: txForm.variableSymbol,
          counterpartyName: txForm.counterpartyName,
          bookedAt: txForm.bookedAt,
          note: txForm.note,
        }),
      });
      if (res.ok) {
        setTxForm((p) => ({
          ...p,
          amountCzk: "",
          variableSymbol: "",
          counterpartyName: "",
          note: "",
        }));
        showToast("Bankovní pohyb byl přidán.");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function importCsv(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/bank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "import_csv", csvText }),
      });
      const json = await res.json();
      if (!res.ok) showToast(json.error ?? "Import CSV selhal.");
      else {
        setShowCsv(false);
        showToast(`Naimportováno ${json.imported} bankovních pohybů.`);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function runAutoPair() {
    setBusy(true);
    try {
      const res = await fetch("/api/bank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "auto_pair" }),
      });
      const json = await res.json();
      if (res.ok) {
        showToast(`Automaticky spárováno ${json.matchedCount} pohybů podle VS a částky.`);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function createVoucher(e: React.FormEvent) {
    e.preventDefault();
    const amountMinor = parseCzechAmountToMinor(voucherForm.amountCzk);
    if (amountMinor <= 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cashRegisterId: voucherForm.cashRegisterId,
          direction: voucherForm.direction,
          amountMinor,
          counterpartyName: voucherForm.counterpartyName,
          description: voucherForm.description,
          issuedAt: voucherForm.issuedAt,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setVoucherForm((p) => ({ ...p, amountCzk: "", counterpartyName: "", description: "" }));
        showToast(`Pokladní doklad ${json.number} byl vystaven.`);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  const unmatchedCount = transactions.filter((t) => t.matchStatus === "unmatched").length;

  return (
    <div className="container pb-16">
      <div className="page-head">
        <div>
          <p className="eyebrow">Banka, pokladna a přehled úhrad</p>
          <h1 className="display h-page">Finance</h1>
        </div>
        <div className="actions">
          {tab === "bank" && (
            <>
              <Button type="button" variant="outline" onClick={() => setShowCsv((v) => !v)}>
                <Upload className="size-4" />
                Import CSV výpisu
              </Button>
              <Button type="button" disabled={busy} onClick={runAutoPair}>
                Automaticky spárovat ({unmatchedCount})
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="mb-6">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="bank">
              Banka a párování{" "}
              <span className="text-xs text-muted-foreground num">{transactions.length}</span>
            </TabsTrigger>
            <TabsTrigger value="cash">
              Pokladna <span className="text-xs text-muted-foreground num">{vouchers.length}</span>
            </TabsTrigger>
            <TabsTrigger value="payments">
              Všechny úhrady{" "}
              <span className="text-xs text-muted-foreground num">{payments.length}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {tab === "bank" && (
        <div className="space-y-6">
          {showCsv && (
            <Card className="border-foreground">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Import bankovního CSV výpisu</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={importCsv} className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Vložte řádky z CSV (kladná částka = příjem, záporná = výdej):
                  </p>
                  <Textarea
                    className="mono text-xs"
                    rows={5}
                    value={csvText}
                    onChange={(e) => setCsvText(e.target.value)}
                  />
                  <div className="flex items-center gap-3">
                    <Button type="submit" size="sm" disabled={busy}>
                      Importovat pohyby
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setShowCsv(false)}>
                      Zavřít
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Zapsat bankovní pohyb</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={addManualTx}
                className="grid grid-cols-1 gap-2.5 sm:grid-cols-[130px_140px_130px_1fr_145px_auto] items-center"
              >
                <Select
                  className="h-9"
                  value={txForm.direction}
                  onChange={(e) =>
                    setTxForm((p) => ({ ...p, direction: e.target.value as "credit" | "debit" }))
                  }
                >
                  <option value="credit">Příjem (+)</option>
                  <option value="debit">Výdej (−)</option>
                </Select>
                <Input
                  className="h-9 num text-right"
                  placeholder="Částka Kč"
                  required
                  value={txForm.amountCzk}
                  onChange={(e) => setTxForm((p) => ({ ...p, amountCzk: e.target.value }))}
                />
                <Input
                  className="h-9 num"
                  placeholder="VS"
                  value={txForm.variableSymbol}
                  onChange={(e) => setTxForm((p) => ({ ...p, variableSymbol: e.target.value }))}
                />
                <Input
                  className="h-9"
                  placeholder="Název protistrany"
                  value={txForm.counterpartyName}
                  onChange={(e) => setTxForm((p) => ({ ...p, counterpartyName: e.target.value }))}
                />
                <Input
                  type="date"
                  className="h-9 num"
                  value={txForm.bookedAt}
                  onChange={(e) => setTxForm((p) => ({ ...p, bookedAt: e.target.value }))}
                />
                <Button type="submit" variant="outline" size="sm" className="h-9" disabled={busy}>
                  Přidat
                </Button>
              </form>
            </CardContent>
          </Card>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Datum</TableHead>
                <TableHead>Protistrana</TableHead>
                <TableHead>VS</TableHead>
                <TableHead className="text-right">Částka</TableHead>
                <TableHead>Párování</TableHead>
                <TableHead className="text-right">Akce</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    Zatím nejsou zapsány žádné bankovní pohyby.
                  </TableCell>
                </TableRow>
              ) : (
                transactions.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell className="num whitespace-nowrap">{formatDateCz(tx.bookedAt)}</TableCell>
                    <TableCell>
                      <span className="block font-semibold">
                        {tx.counterpartyName || "Bankovní pohyb"}
                      </span>
                      {tx.note && <span className="block text-xs text-muted-foreground">{tx.note}</span>}
                    </TableCell>
                    <TableCell className="num">{tx.variableSymbol || "—"}</TableCell>
                    <TableCell className="text-right font-bold num whitespace-nowrap">
                      {tx.direction === "credit" ? "+" : "−"}
                      {formatCzk(tx.amountMinor, { currency: tx.currency })}
                    </TableCell>
                    <TableCell>
                      <Badge variant={tx.matchStatus === "matched" ? "default" : "outline"}>
                        {tx.matchStatus === "matched" ? "Spárováno" : "Nespárováno"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {tx.matchStatus === "unmatched" &&
                      tx.direction === "credit" &&
                      unpaidInvoices.length > 0 ? (
                        <Select
                          aria-label="Ručně spárovat s fakturou"
                          className="h-8 w-52 ml-auto text-xs"
                          value=""
                          onChange={async (e) => {
                            if (!e.target.value) return;
                            await fetch("/api/bank", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                kind: "pair_manual",
                                transactionId: tx.id,
                                invoiceId: e.target.value,
                              }),
                            });
                            showToast("Pohyb byl spárován s fakturou.");
                            router.refresh();
                          }}
                        >
                          <option value="">Spárovat s fakturou…</option>
                          {unpaidInvoices.map((inv) => (
                            <option key={inv.id} value={inv.id}>
                              {inv.number} · {inv.customerName} ({formatCzk(inv.remainingMinor)})
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {tab === "cash" && (
        <div className="space-y-6">
          <div className="kpi-grid pt-2 pb-4">
            {registers.map((r) => (
              <div className="kpi" key={r.id}>
                <div className="kpi__label">{r.name}</div>
                <div className="kpi__value num">
                  {formatCzk(r.currentBalanceMinor, { currency: r.currency })}
                </div>
                <div className="kpi__meta">Aktuální stav pokladny</div>
              </div>
            ))}
          </div>

          <Card className="border-foreground">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Nový pokladní doklad (PPD / VPD)</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={createVoucher} className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Select
                    value={voucherForm.direction}
                    onChange={(e) =>
                      setVoucherForm((p) => ({ ...p, direction: e.target.value as "in" | "out" }))
                    }
                  >
                    <option value="in">Příjmový pokladní doklad (PPD)</option>
                    <option value="out">Výdajový pokladní doklad (VPD)</option>
                  </Select>
                  <Input
                    className="num text-right"
                    required
                    placeholder="Částka Kč"
                    value={voucherForm.amountCzk}
                    onChange={(e) => setVoucherForm((p) => ({ ...p, amountCzk: e.target.value }))}
                  />
                  <Input
                    type="date"
                    className="num"
                    value={voucherForm.issuedAt}
                    onChange={(e) => setVoucherForm((p) => ({ ...p, issuedAt: e.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input
                    placeholder="Protistrana (firma / osoba)"
                    value={voucherForm.counterpartyName}
                    onChange={(e) =>
                      setVoucherForm((p) => ({ ...p, counterpartyName: e.target.value }))
                    }
                  />
                  <Input
                    placeholder="Účel platby"
                    required
                    value={voucherForm.description}
                    onChange={(e) => setVoucherForm((p) => ({ ...p, description: e.target.value }))}
                  />
                </div>
                <Button type="submit" disabled={busy}>
                  Vystavit pokladní doklad
                </Button>
              </form>
            </CardContent>
          </Card>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Číslo</TableHead>
                <TableHead>Datum</TableHead>
                <TableHead>Směr</TableHead>
                <TableHead>Popis / Protistrana</TableHead>
                <TableHead className="text-right">Částka</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vouchers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    Zatím nejsou vystaveny žádné pokladní doklady.
                  </TableCell>
                </TableRow>
              ) : (
                vouchers.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="num font-semibold">{v.number}</TableCell>
                    <TableCell className="num">{formatDateCz(v.issuedAt)}</TableCell>
                    <TableCell>
                      <Badge variant={v.direction === "in" ? "default" : "outline"}>
                        {v.direction === "in" ? "Příjem" : "Výdej"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="block font-semibold">{v.description}</span>
                      {v.counterpartyName && (
                        <span className="block text-xs text-muted-foreground">
                          {v.counterpartyName}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-bold num">
                      {v.direction === "in" ? "+" : "−"}
                      {formatCzk(v.amountMinor, { currency: v.currency })}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {tab === "payments" && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Datum</TableHead>
              <TableHead>Směr</TableHead>
              <TableHead>VS</TableHead>
              <TableHead>Poznámka</TableHead>
              <TableHead className="text-right">Částka</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  Zatím nebyly zaznamenány žádné úhrady.
                </TableCell>
              </TableRow>
            ) : (
              payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="num whitespace-nowrap">{formatDateCz(p.paidAt)}</TableCell>
                  <TableCell>
                    <Badge variant={p.direction === "in" ? "default" : "outline"}>
                      {p.direction === "in" ? "Příjem (prodej)" : "Výdej (nákup)"}
                    </Badge>
                  </TableCell>
                  <TableCell className="num">{p.variableSymbol || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{p.note || "Úhrada"}</TableCell>
                  <TableCell className="text-right font-bold num">
                    {p.direction === "in" ? "+" : "−"}
                    {formatCzk(p.amountMinor, { currency: p.currency })}
                  </TableCell>
                </TableRow>
              ))
            )}
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
