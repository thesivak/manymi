"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Copy, Download, KeyRound, Loader2, Search } from "lucide-react";
import {
  czechAccountToIban,
  formatIban,
  formatInvoiceNumber,
  validateIco,
} from "@/lib/domain/czech";
import { formatDateCz } from "@/lib/domain/money";
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
import type { BankAccount, Company, NumberSequence } from "@/db/schema";

interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

interface McpToolSummary {
  name: string;
  description: string;
}

interface InvitationRow {
  id: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
}

type SettingsTab = "company" | "bank" | "sequences" | "export" | "companies" | "mcp";

interface SettingsClientProps {
  initialTab?: SettingsTab;
  company: Company;
  companies: Company[];
  bankAccounts: BankAccount[];
  sequences: NumberSequence[];
  apiKeys: ApiKeySummary[];
  invitations?: InvitationRow[];
  mcpTools: McpToolSummary[];
}

export function SettingsClient({
  initialTab = "company",
  company,
  companies,
  bankAccounts,
  sequences,
  apiKeys,
  invitations = [],
  mcpTools,
}: SettingsClientProps) {
  const router = useRouter();
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [toast, setToast] = useState("");
  const [saving, setSaving] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdRawKey, setCreatedRawKey] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"accountant" | "owner">("accountant");
  const [importCsvText, setImportCsvText] = useState(
    "Název;IČO;DIČ;Ulice;Město;PSČ;Email\n",
  );

  // Company form
  const [comp, setComp] = useState({
    name: company.name,
    ico: company.ico,
    dic: company.dic,
    vatPayer: company.vatPayer,
    vatPeriod: company.vatPeriod,
    street: company.street,
    city: company.city,
    zip: company.zip,
    country: company.country,
    email: company.email,
    phone: company.phone,
    web: company.web,
    registryNote: company.registryNote,
    accountantEmail: company.accountantEmail || "",
    defaultDueDays: company.defaultDueDays,
    defaultVatRate: company.defaultVatRate,
    defaultRounding: company.defaultRounding,
    defaultNoteAfter: company.defaultNoteAfter,
    annualPlanCzk: Math.round(company.annualPlanMinor / 100),
  });

  // New bank account
  const [newBank, setNewBank] = useState({
    label: "",
    accountNumber: "",
    swift: "",
    isDefault: bankAccounts.length === 0,
  });

  // New company (OSVČ / s.r.o.)
  const [newComp, setNewComp] = useState({
    name: "",
    ico: "",
    dic: "",
    vatMode: "none" as "monthly" | "quarterly" | "none",
    street: "",
    city: "",
    zip: "",
    registryNote: "",
    accountNumber: "",
    swift: "",
  });
  const [newCompAresStatus, setNewCompAresStatus] = useState<
    "idle" | "loading" | "found" | "error"
  >("idle");
  const [newCompAresMessage, setNewCompAresMessage] = useState("");
  const lastNewCompIcoRef = useRef("");

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3200);
  }

  async function autofillNewCompanyAres(rawIco: string, force = false) {
    const check = validateIco(rawIco);
    if (!check.valid) {
      setNewCompAresStatus("error");
      setNewCompAresMessage(check.error ?? "Neplatné IČO.");
      return;
    }
    if (!force && lastNewCompIcoRef.current === check.normalized) return;
    lastNewCompIcoRef.current = check.normalized;
    setNewCompAresStatus("loading");
    setNewCompAresMessage("Vyhledávám v ARES…");
    try {
      const res = await fetch(`/api/ares/${check.normalized}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.data) {
        setNewCompAresStatus("error");
        setNewCompAresMessage(json.error ?? "Subjekt nebyl v ARES nalezen.");
        return;
      }
      const d = json.data;
      setNewComp((p) => ({
        ...p,
        ico: d.ico,
        name: d.name || p.name,
        dic: d.dic || "",
        vatMode: d.vatPayer ? "monthly" : "none",
        street: d.street || "",
        city: d.city || "",
        zip: d.zip || "",
      }));
      setNewCompAresStatus("found");
      setNewCompAresMessage(
        `Načteno z ARES: ${d.name}${d.vatPayer ? " (plátce DPH)" : " (neplátce DPH)"}`,
      );
    } catch {
      setNewCompAresStatus("error");
      setNewCompAresMessage("Nepodařilo se spojit s ARES.");
    }
  }

  useEffect(() => {
    const digits = newComp.ico.replace(/\D/g, "");
    if (digits.length < 8) {
      lastNewCompIcoRef.current = "";
      if (newCompAresStatus !== "idle") {
        setNewCompAresStatus("idle");
        setNewCompAresMessage("");
      }
      return;
    }
    if (digits.length === 8) {
      const check = validateIco(digits);
      if (!check.valid) {
        setNewCompAresStatus("error");
        setNewCompAresMessage(check.error ?? "Neplatné IČO.");
        return;
      }
      const timer = setTimeout(() => {
        void autofillNewCompanyAres(digits);
      }, 220);
      return () => clearTimeout(timer);
    }
  }, [newComp.ico]); // eslint-disable-line react-hooks/exhaustive-deps

  async function autofillCompanyAres() {
    const check = validateIco(comp.ico);
    if (!check.valid) {
      showToast(check.error ?? "Neplatné IČO.");
      return;
    }
    const res = await fetch(`/api/ares/${check.normalized}`);
    const json = await res.json();
    if (!res.ok) {
      showToast(json.error ?? "Subjekt nebyl v ARES nalezen.");
      return;
    }
    const d = json.data;
    setComp((p) => ({
      ...p,
      ico: d.ico,
      name: d.name || p.name,
      dic: d.dic || p.dic,
      vatPayer: Boolean(d.vatPayer),
      street: d.street || p.street,
      city: d.city || p.city,
      zip: d.zip || p.zip,
    }));
    showToast("Údaje firmy byly doplněny z ARES.");
  }

  async function saveCompany(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: comp.name,
          ico: comp.ico,
          dic: comp.dic,
          vatPayer: comp.vatPayer,
          vatPeriod: comp.vatPayer ? comp.vatPeriod : "none",
          street: comp.street,
          city: comp.city,
          zip: comp.zip,
          country: comp.country,
          email: comp.email,
          phone: comp.phone,
          web: comp.web,
          registryNote: comp.registryNote,
          accountantEmail: comp.accountantEmail,
          defaultDueDays: Number(comp.defaultDueDays) || 14,
          defaultVatRate: Number(comp.defaultVatRate),
          defaultRounding: comp.defaultRounding,
          defaultNoteAfter: comp.defaultNoteAfter,
          annualPlanMinor: Math.max(0, Math.round(Number(comp.annualPlanCzk) || 0) * 100),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        showToast(d.error ?? "Nepodařilo se uložit nastavení.");
      } else {
        showToast("Nastavení firmy bylo uloženo.");
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  async function addBankAccount(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "add_bank",
          label: newBank.label || "Bankovní účet",
          accountNumber: newBank.accountNumber,
          swift: newBank.swift,
          currency: "CZK",
          isDefault: newBank.isDefault,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        showToast(d.error ?? "Nepodařilo se přidat účet.");
      } else {
        setNewBank({ label: "", accountNumber: "", swift: "", isDefault: false });
        showToast("Bankovní účet byl přidán.");
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  async function bankAction(kind: "set_default_bank" | "delete_bank", id: string) {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, id }),
    });
    showToast(kind === "set_default_bank" ? "Výchozí účet změněn." : "Účet odstraněn.");
    router.refresh();
  }

  async function saveSequence(seq: NumberSequence, nextNumber: number, prefix: string) {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "upsert_sequence",
        id: seq.id,
        name: seq.name,
        prefix,
        year: seq.year,
        nextNumber,
        padding: seq.padding,
      }),
    });
    showToast("Číselná řada byla uložena.");
    router.refresh();
  }

  async function createNewCompany(e: React.FormEvent) {
    e.preventDefault();
    if (!newComp.name.trim()) return;
    setSaving(true);
    try {
      const vatPayer = newComp.vatMode !== "none";
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newComp.name,
          ico: newComp.ico,
          dic: vatPayer ? newComp.dic : "",
          vatPayer,
          vatPeriod: newComp.vatMode,
          street: newComp.street,
          city: newComp.city,
          zip: newComp.zip,
          registryNote: newComp.registryNote,
          accountNumber: newComp.accountNumber,
          swift: newComp.swift,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(json.error ?? "Nepodařilo se vytvořit firmu.");
      } else {
        setNewComp({
          name: "",
          ico: "",
          dic: "",
          vatMode: "none",
          street: "",
          city: "",
          zip: "",
          registryNote: "",
          accountNumber: "",
          swift: "",
        });
        setNewCompAresStatus("idle");
        setNewCompAresMessage("");
        lastNewCompIcoRef.current = "";
        showToast("Nová firma byla vytvořena a nastavena jako aktivní.");
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  const previewIban = czechAccountToIban(newBank.accountNumber);
  const previewNewCompIban = czechAccountToIban(newComp.accountNumber);

  return (
    <div className="container pb-16">
      <div className="page-head">
        <div>
          <p className="eyebrow">Konfigurace fakturace</p>
          <h1 className="display h-page">Nastavení</h1>
        </div>
      </div>

      <div className="mb-6">
        <Tabs value={tab} onValueChange={(v) => setTab(v as SettingsTab)}>
          <TabsList>
            {(
              [
                ["company", "Firma a fakturace", null],
                ["bank", "Bankovní účty", bankAccounts.length],
                ["sequences", "Číselné řady", sequences.length],
                ["export", "Export & import", null],
                ["companies", "Moje firmy", companies.length],
                ["mcp", "MCP & API", apiKeys.length],
              ] as const
            ).map(([key, label, count]) => (
              <TabsTrigger key={key} value={key}>
                {label}
                {count !== null && (
                  <span className="text-xs text-muted-foreground num">{count}</span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {tab === "company" && (
        <form onSubmit={saveCompany} className="max-w-2xl space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="s-ico">IČO</Label>
            <div className="flex gap-2.5">
              <Input
                id="s-ico"
                className="num"
                value={comp.ico}
                onChange={(e) => setComp((p) => ({ ...p, ico: e.target.value }))}
              />
              <Button type="button" variant="outline" onClick={autofillCompanyAres}>
                <Search className="size-4" />
                Načíst z ARES
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="s-name">Název firmy</Label>
              <Input
                id="s-name"
                required
                value={comp.name}
                onChange={(e) => setComp((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-dic">DIČ</Label>
              <Input
                id="s-dic"
                className="num"
                value={comp.dic}
                onChange={(e) => setComp((p) => ({ ...p, dic: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="s-street">Ulice</Label>
              <Input
                id="s-street"
                value={comp.street}
                onChange={(e) => setComp((p) => ({ ...p, street: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-city">Obec</Label>
              <Input
                id="s-city"
                value={comp.city}
                onChange={(e) => setComp((p) => ({ ...p, city: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-zip">PSČ</Label>
              <Input
                id="s-zip"
                className="num"
                value={comp.zip}
                onChange={(e) => setComp((p) => ({ ...p, zip: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="s-email">Kontaktní e-mail</Label>
              <Input
                id="s-email"
                type="email"
                value={comp.email}
                onChange={(e) => setComp((p) => ({ ...p, email: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-acc-email">E-mail účetního</Label>
              <Input
                id="s-acc-email"
                type="email"
                placeholder="ucetni@kancelar.cz"
                value={comp.accountantEmail}
                onChange={(e) => setComp((p) => ({ ...p, accountantEmail: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-phone">Telefon</Label>
              <Input
                id="s-phone"
                className="num"
                value={comp.phone}
                onChange={(e) => setComp((p) => ({ ...p, phone: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="s-reg">Zápis v obchodním rejstříku (patička PDF)</Label>
            <Input
              id="s-reg"
              value={comp.registryNote}
              onChange={(e) => setComp((p) => ({ ...p, registryNote: e.target.value }))}
              placeholder="Zapsána v OR u MS v Praze, oddíl C, vložka …"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="s-due">Výchozí splatnost (dny)</Label>
              <Input
                id="s-due"
                type="number"
                className="num"
                value={comp.defaultDueDays}
                onChange={(e) => setComp((p) => ({ ...p, defaultDueDays: Number(e.target.value) }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-vatrate">Výchozí sazba DPH</Label>
              <Select
                id="s-vatrate"
                className="num"
                value={comp.defaultVatRate}
                onChange={(e) => setComp((p) => ({ ...p, defaultVatRate: Number(e.target.value) }))}
              >
                <option value={21}>21 %</option>
                <option value={12}>12 %</option>
                <option value={0}>0 %</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-plan">Roční plán fakturace (Kč)</Label>
              <Input
                id="s-plan"
                type="number"
                className="num"
                value={comp.annualPlanCzk}
                onChange={(e) => setComp((p) => ({ ...p, annualPlanCzk: Number(e.target.value) }))}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6 pt-1 pb-2">
            <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={comp.vatPayer}
                onChange={(e) => setComp((p) => ({ ...p, vatPayer: e.target.checked }))}
              />
              Plátce DPH
            </label>
            {comp.vatPayer && (
              <Select
                aria-label="Období DPH"
                className="h-8 w-36 text-xs"
                value={comp.vatPeriod === "quarterly" ? "quarterly" : "monthly"}
                onChange={(e) => setComp((p) => ({ ...p, vatPeriod: e.target.value }))}
              >
                <option value="monthly">Měsíční plátce</option>
                <option value="quarterly">Čtvrtletní plátce</option>
              </Select>
            )}
            <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={comp.defaultRounding}
                onChange={(e) => setComp((p) => ({ ...p, defaultRounding: e.target.checked }))}
              />
              Výchozí zaokrouhlování na celé Kč
            </label>
          </div>

          <Button type="submit" disabled={saving}>
            {saving ? "Ukládám…" : "Uložit nastavení firmy"}
          </Button>
        </form>
      )}

      {tab === "bank" && (
        <div className="space-y-7 pt-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Název</TableHead>
                <TableHead>Číslo účtu</TableHead>
                <TableHead>IBAN</TableHead>
                <TableHead>SWIFT</TableHead>
                <TableHead className="text-right">Akce</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bankAccounts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    Zatím nemáte zadaný žádný bankovní účet. Přidejte jej níže pro generování QR
                    plateb.
                  </TableCell>
                </TableRow>
              ) : (
                bankAccounts.map((acc) => (
                  <TableRow key={acc.id}>
                    <TableCell>
                      <span className="block font-semibold">{acc.label}</span>
                      {acc.isDefault && (
                        <span className="block text-xs text-muted-foreground">Výchozí účet</span>
                      )}
                    </TableCell>
                    <TableCell className="num whitespace-nowrap">{acc.accountNumber}</TableCell>
                    <TableCell className="num whitespace-nowrap">
                      {acc.iban ? formatIban(acc.iban) : "—"}
                    </TableCell>
                    <TableCell className="mono">{acc.swift || "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-3 text-xs">
                        {!acc.isDefault && (
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground cursor-pointer"
                            onClick={() => bankAction("set_default_bank", acc.id)}
                          >
                            Nastavit výchozí
                          </button>
                        )}
                        <button
                          type="button"
                          className="text-destructive hover:underline cursor-pointer"
                          onClick={() => bankAction("delete_bank", acc.id)}
                        >
                          Smazat
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          <Card className="max-w-2xl border-foreground">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Přidat bankovní účet</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={addBankAccount} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="b-label">Název</Label>
                    <Input
                      id="b-label"
                      required
                      placeholder="Fio podnikatelský"
                      value={newBank.label}
                      onChange={(e) => setNewBank((p) => ({ ...p, label: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="b-num">Číslo účtu</Label>
                    <Input
                      id="b-num"
                      className="num"
                      required
                      placeholder="2104891234/2010"
                      value={newBank.accountNumber}
                      onChange={(e) => setNewBank((p) => ({ ...p, accountNumber: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="b-swift">SWIFT</Label>
                    <Input
                      id="b-swift"
                      className="mono"
                      placeholder="FIOBCZPPXXX"
                      value={newBank.swift}
                      onChange={(e) => setNewBank((p) => ({ ...p, swift: e.target.value }))}
                    />
                  </div>
                </div>
                {previewIban && (
                  <p className="text-xs text-muted-foreground mono">
                    Automatický IBAN: {formatIban(previewIban)}
                  </p>
                )}
                <Button type="submit" disabled={saving}>
                  Přidat účet
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "sequences" && (
        <div className="pt-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Název řady</TableHead>
                <TableHead>Rok</TableHead>
                <TableHead>Prefix</TableHead>
                <TableHead>Další pořadí</TableHead>
                <TableHead>Náhled dalšího čísla</TableHead>
                <TableHead className="text-right">Akce</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sequences.map((seq) => (
                <SequenceRow key={seq.id} seq={seq} onSave={saveSequence} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {tab === "export" && (
        <div className="grid grid-cols-1 gap-8 pt-2 lg:grid-cols-2">
          <div className="space-y-4">
            <h2 className="h3">Účetní exporty</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Exportujte vystavené doklady pro vaši účetní nebo účetní software (Stormware Pohoda
              XML, CSV pro Excel nebo jednotlivé faktury v ISDOC 6.0.2 XML).
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <a href="/api/exports?format=pohoda">
                  <Download className="size-4" />
                  Stáhnout Pohoda XML
                </a>
              </Button>
              <Button asChild variant="outline">
                <a href="/api/exports?format=csv">
                  <Download className="size-4" />
                  Stáhnout CSV (Excel)
                </a>
              </Button>
            </div>
          </div>

          <Card className="border-foreground">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Import kontaktů z CSV</CardTitle>
              <CardDescription>
                Přenos adresáře z jiného systému (např. iDoklad / Pohoda / Excel):
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setSaving(true);
                  try {
                    const res = await fetch("/api/exports", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ csvText: importCsvText }),
                    });
                    const json = await res.json();
                    if (!res.ok) showToast(json.error ?? "Import se nezdařil.");
                    else {
                      showToast(`Naimportováno ${json.imported} kontaktů.`);
                      router.refresh();
                    }
                  } finally {
                    setSaving(false);
                  }
                }}
                className="space-y-3"
              >
                <Textarea
                  className="mono text-xs"
                  rows={5}
                  value={importCsvText}
                  onChange={(e) => setImportCsvText(e.target.value)}
                />
                <Button type="submit" variant="outline" disabled={saving}>
                  Importovat kontakty
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "companies" && (
        <div className="space-y-8 pt-2">
          <div>
            <h2 className="h3 mb-2">Moje firmy a OSVČ</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Pod jedním přihlášením můžete spravovat více subjektů (např. vlastní OSVČ i s.r.o.).
              Každý subjekt má oddělené faktury, číselné řady, bankovní účty i kontakty.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Firma / OSVČ</TableHead>
                  <TableHead>IČO</TableHead>
                  <TableHead>Režim DPH</TableHead>
                  <TableHead className="text-right">Stav</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companies.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <span className="block font-semibold">{c.name}</span>
                      {c.city && <span className="block text-xs text-muted-foreground">{c.city}</span>}
                    </TableCell>
                    <TableCell className="num">{c.ico || "—"}</TableCell>
                    <TableCell>
                      {!c.vatPayer
                        ? "Neplátce DPH"
                        : c.vatPeriod === "quarterly"
                          ? "Plátce DPH (čtvrtletní)"
                          : "Plátce DPH (měsíční)"}
                    </TableCell>
                    <TableCell className="text-right">
                      {c.id === company.id ? (
                        <Badge>Aktivní</Badge>
                      ) : (
                        <Button
                          type="button"
                          variant="link"
                          className="text-xs"
                          onClick={async () => {
                            await fetch("/api/companies/switch", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ companyId: c.id }),
                            });
                            router.refresh();
                          }}
                        >
                          Přepnout
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <Card className="max-w-2xl border-foreground">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Přidat další firmu nebo OSVČ</CardTitle>
              <CardDescription>
                Zadejte 8místné IČO — název, sídlo, DIČ i režim DPH načteme automaticky z ARES.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={createNewCompany} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="nc-ico">IČO (8 číslic)</Label>
                  <div className="flex gap-2.5">
                    <Input
                      id="nc-ico"
                      className="num"
                      inputMode="numeric"
                      maxLength={8}
                      placeholder="např. 27082440"
                      value={newComp.ico}
                      onChange={(e) =>
                        setNewComp((p) => ({
                          ...p,
                          ico: e.target.value.replace(/[^\d\s]/g, "").slice(0, 8),
                        }))
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={newCompAresStatus === "loading"}
                      onClick={() => void autofillNewCompanyAres(newComp.ico, true)}
                    >
                      {newCompAresStatus === "loading" ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Search className="size-4" />
                      )}
                      {newCompAresStatus === "loading" ? "Hledám…" : "Načíst z ARES"}
                    </Button>
                  </div>
                  {newCompAresMessage && (
                    <p
                      className={`flex items-center gap-1.5 text-xs ${
                        newCompAresStatus === "error"
                          ? "text-destructive"
                          : newCompAresStatus === "found"
                            ? "font-semibold text-foreground"
                            : "text-muted-foreground"
                      }`}
                    >
                      {newCompAresStatus === "found" && (
                        <CheckCircle2 className="size-3.5 text-emerald-700" />
                      )}
                      {newCompAresMessage}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="nc-name">Název firmy / jméno OSVČ</Label>
                    <Input
                      id="nc-name"
                      required
                      value={newComp.name}
                      onChange={(e) => setNewComp((p) => ({ ...p, name: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="nc-vat">Režim DPH</Label>
                    <Select
                      id="nc-vat"
                      value={newComp.vatMode}
                      onChange={(e) =>
                        setNewComp((p) => ({
                          ...p,
                          vatMode: e.target.value as "monthly" | "quarterly" | "none",
                        }))
                      }
                    >
                      <option value="none">Neplátce DPH</option>
                      <option value="monthly">Plátce DPH (měsíční)</option>
                      <option value="quarterly">Plátce DPH (čtvrtletní)</option>
                    </Select>
                  </div>
                </div>

                {newComp.vatMode !== "none" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="nc-dic">DIČ</Label>
                    <Input
                      id="nc-dic"
                      className="num"
                      placeholder="CZ12345678"
                      value={newComp.dic}
                      onChange={(e) => setNewComp((p) => ({ ...p, dic: e.target.value }))}
                    />
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="nc-street">Ulice</Label>
                    <Input
                      id="nc-street"
                      value={newComp.street}
                      onChange={(e) => setNewComp((p) => ({ ...p, street: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="nc-city">Obec</Label>
                    <Input
                      id="nc-city"
                      value={newComp.city}
                      onChange={(e) => setNewComp((p) => ({ ...p, city: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="nc-zip">PSČ</Label>
                    <Input
                      id="nc-zip"
                      className="num"
                      value={newComp.zip}
                      onChange={(e) => setNewComp((p) => ({ ...p, zip: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="nc-reg">Zápis v rejstříku (volitelné)</Label>
                  <Input
                    id="nc-reg"
                    placeholder="Zapsána v OR u MS v Praze, oddíl C, vložka …"
                    value={newComp.registryNote}
                    onChange={(e) => setNewComp((p) => ({ ...p, registryNote: e.target.value }))}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="nc-acc">Bankovní účet</Label>
                    <Input
                      id="nc-acc"
                      className="num"
                      placeholder="2104891234/2010"
                      value={newComp.accountNumber}
                      onChange={(e) =>
                        setNewComp((p) => ({ ...p, accountNumber: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="nc-swift">SWIFT (volitelné)</Label>
                    <Input
                      id="nc-swift"
                      className="mono"
                      placeholder="FIOBCZPPXXX"
                      value={newComp.swift}
                      onChange={(e) => setNewComp((p) => ({ ...p, swift: e.target.value }))}
                    />
                  </div>
                </div>
                {previewNewCompIban && (
                  <p className="text-xs text-muted-foreground mono">
                    Automatický IBAN: {formatIban(previewNewCompIban)}
                  </p>
                )}

                <Button type="submit" disabled={saving}>
                  {saving ? "Vytvářím…" : "Přidat firmu a přepnout na ni"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Separator className="h-[1.5px] bg-foreground" />

          <div className="space-y-4">
            <h2 className="h3">Uživatelé a přístup pro účetní</h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!inviteEmail.trim()) return;
                setSaving(true);
                try {
                  const res = await fetch("/api/settings/invitations", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
                  });
                  const json = await res.json();
                  if (!res.ok) showToast(json.error ?? "Pozvánku se nepodařilo odeslat.");
                  else {
                    setInviteEmail("");
                    showToast("Pozvánka byla vytvořena.");
                    router.refresh();
                  }
                } finally {
                  setSaving(false);
                }
              }}
              className="flex max-w-2xl flex-wrap gap-2.5"
            >
              <Input
                type="email"
                className="flex-1 min-w-56"
                required
                placeholder="ucetni@kancelar.cz"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
              <Select
                className="w-56"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as "accountant" | "owner")}
              >
                <option value="accountant">Účetní (čtení + export)</option>
                <option value="owner">Vlastník (plný přístup)</option>
              </Select>
              <Button type="submit" variant="outline" disabled={saving}>
                Pozvat
              </Button>
            </form>

            {invitations.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Stav</TableHead>
                    <TableHead className="text-right">Akce</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invitations.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-semibold">{inv.email}</TableCell>
                      <TableCell>{inv.role === "owner" ? "Vlastník" : "Účetní"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">Pozváno</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <button
                          type="button"
                          className="text-xs text-muted-foreground hover:text-destructive cursor-pointer"
                          onClick={async () => {
                            await fetch(`/api/settings/invitations?id=${inv.id}`, {
                              method: "DELETE",
                            });
                            router.refresh();
                          }}
                        >
                          Zrušit
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      )}

      {tab === "mcp" && (
        <div className="space-y-8 pt-2">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div className="space-y-4">
              <h2 className="h3">MCP server pro AI agenty</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Manymi vystavuje vlastní Streamable HTTP MCP endpoint na{" "}
                <code className="mono">/api/mcp</code>. AI agenti (Claude, Codex, Cursor, T3 Code)
                mohou číst přehled, vyhledávat v ARES, vystavovat faktury a zapisovat úhrady pod
                přístupovým klíčem této firmy.
              </p>

              <Card className="border-foreground">
                <CardContent className="pt-6">
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!newKeyName.trim()) return;
                      setSaving(true);
                      try {
                        const res = await fetch("/api/settings/api-keys", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ name: newKeyName.trim() }),
                        });
                        const json = await res.json();
                        if (!res.ok) {
                          showToast(json.error ?? "Nepodařilo se vytvořit klíč.");
                        } else {
                          setCreatedRawKey(json.rawKey);
                          setNewKeyName("");
                          showToast("MCP API klíč byl vygenerován.");
                          router.refresh();
                        }
                      } finally {
                        setSaving(false);
                      }
                    }}
                    className="space-y-3"
                  >
                    <div className="space-y-1.5">
                      <Label htmlFor="mcp-key-name">Nový API klíč</Label>
                      <Input
                        id="mcp-key-name"
                        required
                        placeholder="např. Claude Desktop nebo T3 Code"
                        value={newKeyName}
                        onChange={(e) => setNewKeyName(e.target.value)}
                      />
                    </div>
                    <Button type="submit" disabled={saving}>
                      <KeyRound className="size-4" />
                      {saving ? "Generuji…" : "Vygenerovat MCP klíč"}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              {createdRawKey && (
                <Alert>
                  <AlertTitle>Uložte si klíč — zobrazí se pouze jednou</AlertTitle>
                  <AlertDescription>
                    <p className="mono text-xs break-all my-2 text-foreground">{createdRawKey}</p>
                    <Button
                      type="button"
                      variant="link"
                      onClick={() => {
                        navigator.clipboard?.writeText(createdRawKey);
                        showToast("Klíč zkopírován do schránky.");
                      }}
                    >
                      <Copy className="size-3.5" />
                      Kopírovat klíč
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
            </div>

            <div className="space-y-5">
              <div>
                <h3 className="mb-2.5 text-sm font-bold">Ukázka konfigurace MCP klienta</h3>
                <pre className="mono text-xs rounded-[3px] border border-border bg-card p-4 overflow-x-auto leading-relaxed">{`{
  "mcpServers": {
    "manymi": {
      "url": "https://www.manymi.cz/api/mcp",
      "headers": {
        "Authorization": "Bearer ${createdRawKey ?? "mnm_live_..."}"
      }
    }
  }
}`}</pre>
              </div>

              <div>
                <h3 className="mb-2.5 text-sm font-bold">
                  Dostupné MCP nástroje ({mcpTools.length})
                </h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nástroj</TableHead>
                      <TableHead>Popis</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mcpTools.map((t) => (
                      <TableRow key={t.name}>
                        <TableCell className="mono whitespace-nowrap font-semibold text-xs">
                          {t.name}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {t.description}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-bold">Aktivní klíče ({apiKeys.length})</h3>
            {apiKeys.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Zatím nemáte vygenerovaný žádný MCP API klíč.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Název</TableHead>
                    <TableHead>Prefix</TableHead>
                    <TableHead>Vytvořeno</TableHead>
                    <TableHead>Poslední použití</TableHead>
                    <TableHead className="text-right">Akce</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apiKeys.map((k) => (
                    <TableRow key={k.id}>
                      <TableCell className="font-semibold">{k.name}</TableCell>
                      <TableCell className="mono text-xs">{k.keyPrefix}…</TableCell>
                      <TableCell className="num text-xs">{formatDateCz(k.createdAt)}</TableCell>
                      <TableCell className="num text-xs text-muted-foreground">
                        {k.lastUsedAt ? formatDateCz(k.lastUsedAt) : "Zatím nepoužit"}
                      </TableCell>
                      <TableCell className="text-right">
                        <button
                          type="button"
                          className="text-xs text-muted-foreground hover:text-destructive cursor-pointer"
                          onClick={async () => {
                            await fetch(`/api/settings/api-keys?id=${k.id}`, {
                              method: "DELETE",
                            });
                            showToast(`Klíč „${k.name}“ byl zneplatněn.`);
                            router.refresh();
                          }}
                        >
                          Zneplatnit
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}

function SequenceRow({
  seq,
  onSave,
}: {
  seq: NumberSequence;
  onSave: (seq: NumberSequence, nextNumber: number, prefix: string) => Promise<void>;
}) {
  const [prefix, setPrefix] = useState(seq.prefix);
  const [nextNumber, setNextNumber] = useState(seq.nextNumber);

  return (
    <TableRow>
      <TableCell className="font-semibold">{seq.name}</TableCell>
      <TableCell className="num">{seq.year}</TableCell>
      <TableCell>
        <Input
          className="h-8 w-24"
          value={prefix}
          onChange={(e) => setPrefix(e.target.value)}
        />
      </TableCell>
      <TableCell>
        <Input
          type="number"
          min={1}
          className="h-8 w-24 num text-right"
          value={nextNumber}
          onChange={(e) => setNextNumber(Math.max(1, Number(e.target.value) || 1))}
        />
      </TableCell>
      <TableCell className="num font-bold">
        {formatInvoiceNumber(prefix, seq.year, nextNumber, seq.padding)}
      </TableCell>
      <TableCell className="text-right">
        <Button
          type="button"
          variant="link"
          className="text-xs"
          onClick={() => onSave(seq, nextNumber, prefix)}
        >
          Uložit
        </Button>
      </TableCell>
    </TableRow>
  );
}
