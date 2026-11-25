"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Search, X } from "lucide-react";
import { validateIco } from "@/lib/domain/czech";
import { formatCzk, formatDateCz } from "@/lib/domain/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { EmailLog } from "@/db/schema";

export interface ContactListItem {
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
  phone: string;
  defaultDueDays: number | null;
  note: string;
  aresVerifiedAt: string | null;
  stats: {
    invoiceCount: number;
    turnoverMinor: number;
    unpaidMinor: number;
  };
}

const EMPTY_FORM = {
  id: "",
  name: "",
  ico: "",
  dic: "",
  vatPayer: false,
  street: "",
  city: "",
  zip: "",
  country: "Česká republika",
  email: "",
  phone: "",
  defaultDueDays: "",
  note: "",
  aresVerifiedAt: null as string | null,
};

export function ContactsClient({
  initialContacts,
  emailLogs = [],
}: {
  initialContacts: ContactListItem[];
  emailLogs?: EmailLog[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [vatFilter, setVatFilter] = useState<"all" | "vat" | "non_vat" | "emails">("all");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [aresLoading, setAresLoading] = useState(false);
  const [aresMsg, setAresMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3200);
  }

  const vatCount = initialContacts.filter((c) => c.vatPayer).length;
  const nonVatCount = initialContacts.length - vatCount;

  const filtered = initialContacts.filter((c) => {
    if (vatFilter === "vat" && !c.vatPayer) return false;
    if (vatFilter === "non_vat" && c.vatPayer) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.ico.includes(q) ||
      c.city.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q)
    );
  });

  function openNew() {
    setForm(EMPTY_FORM);
    setAresMsg(null);
    setShowForm(true);
  }

  function openEdit(c: ContactListItem) {
    setForm({
      id: c.id,
      name: c.name,
      ico: c.ico,
      dic: c.dic,
      vatPayer: c.vatPayer,
      street: c.street,
      city: c.city,
      zip: c.zip,
      country: c.country,
      email: c.email,
      phone: c.phone,
      defaultDueDays: c.defaultDueDays != null ? String(c.defaultDueDays) : "",
      note: c.note,
      aresVerifiedAt: c.aresVerifiedAt,
    });
    setAresMsg(null);
    setShowForm(true);
  }

  async function lookupAres() {
    const check = validateIco(form.ico);
    if (!check.valid) {
      setAresMsg({ ok: false, text: check.error ?? "Neplatné IČO." });
      return;
    }
    setAresLoading(true);
    setAresMsg(null);
    try {
      const res = await fetch(`/api/ares/${check.normalized}`);
      const json = await res.json();
      if (!res.ok) {
        setAresMsg({ ok: false, text: json.error ?? "Subjekt nebyl v ARES nalezen." });
        return;
      }
      const d = json.data;
      setForm((prev) => ({
        ...prev,
        ico: d.ico,
        name: d.name || prev.name,
        dic: d.dic || "",
        vatPayer: Boolean(d.vatPayer),
        street: d.street || prev.street,
        city: d.city || prev.city,
        zip: d.zip || prev.zip,
        country: d.country || "Česká republika",
        aresVerifiedAt: d.verifiedAt,
      }));
      setAresMsg({
        ok: true,
        text: `Ověřeno v ARES · ${d.vatPayer ? "plátce DPH" : "neplátce DPH"}${
          d.city ? ` · ${d.city}` : ""
        }`,
      });
    } catch {
      setAresMsg({ ok: false, text: "Chyba spojení s ARES." });
    } finally {
      setAresLoading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setAresMsg({ ok: false, text: "Vyplňte název odběratele." });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        ico: form.ico,
        dic: form.dic,
        vatPayer: form.vatPayer,
        street: form.street,
        city: form.city,
        zip: form.zip,
        country: form.country,
        email: form.email,
        phone: form.phone,
        defaultDueDays: form.defaultDueDays ? Number(form.defaultDueDays) : null,
        note: form.note,
        aresVerifiedAt: form.aresVerifiedAt,
      };
      const isEdit = Boolean(form.id);
      const res = await fetch(isEdit ? `/api/contacts/${form.id}` : "/api/contacts", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setAresMsg({ ok: false, text: json.error ?? "Nepodařilo se uložit kontakt." });
        return;
      }
      setShowForm(false);
      showToast(isEdit ? "Kontakt byl upraven." : `Kontakt ${form.name} byl přidán.`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(c: ContactListItem) {
    await fetch(`/api/contacts/${c.id}`, { method: "DELETE" });
    showToast(`Kontakt ${c.name} byl odstraněn.`);
    router.refresh();
  }

  return (
    <div className="container pb-16">
      <div className="page-head">
        <div>
          <p className="eyebrow">Adresář odběratelů · ověřováno v ARES</p>
          <h1 className="display h-page">Kontakty</h1>
        </div>
        <div className="actions">
          <Button type="button" onClick={openNew}>
            <Plus className="size-4" />
            Nový kontakt
          </Button>
        </div>
      </div>

      {showForm && (
        <Card className="mb-8 border-foreground">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="text-lg">
              {form.id ? "Upravit kontakt" : "Nový kontakt"}
            </CardTitle>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)}>
              <X className="size-4" />
              Zavřít
            </Button>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="max-w-md space-y-1.5">
                <Label htmlFor="c-ico">IČO — ověření v ARES</Label>
                <div className="flex gap-2.5">
                  <Input
                    id="c-ico"
                    className="num"
                    inputMode="numeric"
                    placeholder="27082440"
                    value={form.ico}
                    onChange={(e) => setForm((p) => ({ ...p, ico: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void lookupAres();
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={aresLoading}
                    onClick={() => void lookupAres()}
                  >
                    {aresLoading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Search className="size-4" />
                    )}
                    {aresLoading ? "Načítám…" : "Načíst z ARES"}
                  </Button>
                </div>
                {aresMsg && (
                  <p
                    className={`text-xs ${
                      aresMsg.ok ? "text-muted-foreground" : "text-destructive"
                    }`}
                  >
                    {aresMsg.text}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="c-name">Název firmy / jméno</Label>
                  <Input
                    id="c-name"
                    required
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="c-dic">DIČ</Label>
                  <Input
                    id="c-dic"
                    className="num"
                    value={form.dic}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        dic: e.target.value,
                        vatPayer: Boolean(e.target.value.trim()),
                      }))
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="c-street">Ulice</Label>
                  <Input
                    id="c-street"
                    value={form.street}
                    onChange={(e) => setForm((p) => ({ ...p, street: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="c-city">Obec</Label>
                  <Input
                    id="c-city"
                    value={form.city}
                    onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="c-zip">PSČ</Label>
                  <Input
                    id="c-zip"
                    className="num"
                    value={form.zip}
                    onChange={(e) => setForm((p) => ({ ...p, zip: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="c-email">E-mail</Label>
                  <Input
                    id="c-email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="c-phone">Telefon</Label>
                  <Input
                    id="c-phone"
                    className="num"
                    value={form.phone}
                    onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="c-due">Výchozí splatnost (dny)</Label>
                  <Input
                    id="c-due"
                    type="number"
                    className="num"
                    placeholder="14"
                    value={form.defaultDueDays}
                    onChange={(e) => setForm((p) => ({ ...p, defaultDueDays: e.target.value }))}
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Button type="submit" disabled={saving}>
                  {saving ? "Ukládám…" : form.id ? "Uložit změny" : "Přidat kontakt"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
                  Zrušit
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <Tabs value={vatFilter} onValueChange={(v) => setVatFilter(v as typeof vatFilter)}>
          <TabsList>
            <TabsTrigger value="all">
              Všechny <span className="text-xs text-muted-foreground num">{initialContacts.length}</span>
            </TabsTrigger>
            <TabsTrigger value="vat">
              Plátci DPH <span className="text-xs text-muted-foreground num">{vatCount}</span>
            </TabsTrigger>
            <TabsTrigger value="non_vat">
              Neplátci <span className="text-xs text-muted-foreground num">{nonVatCount}</span>
            </TabsTrigger>
            <TabsTrigger value="emails">
              Historie e-mailů <span className="text-xs text-muted-foreground num">{emailLogs.length}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="w-full sm:w-72">
          <Input
            type="search"
            placeholder="Hledat firmu, IČO, město…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {vatFilter === "emails" ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Odesláno</TableHead>
              <TableHead>Příjemce</TableHead>
              <TableHead>Doklad</TableHead>
              <TableHead>Typ</TableHead>
              <TableHead>Předmět</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {emailLogs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  Zatím nebyly odeslány žádné e-maily ani upomínky.
                </TableCell>
              </TableRow>
            ) : (
              emailLogs.map((em) => (
                <TableRow key={em.id}>
                  <TableCell className="num whitespace-nowrap">{formatDateCz(em.sentAt)}</TableCell>
                  <TableCell className="font-semibold">{em.recipientEmail}</TableCell>
                  <TableCell className="num">{em.documentNumber || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={em.kind === "reminder" ? "destructive" : "default"}>
                      {em.kind === "reminder"
                        ? "Upomínka"
                        : em.kind === "thank_you"
                          ? "Poděkování"
                          : "Doklad"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{em.subject}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      ) : filtered.length === 0 ? (
        <Card className="p-9">
          <p className="mb-3 text-sm text-muted-foreground">
            Zatím nemáte žádné uložené odběratele.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={openNew}>
            <Plus className="size-3.5" />
            Přidat kontakt přes ARES
          </Button>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Odběratel</TableHead>
              <TableHead>IČO / DIČ</TableHead>
              <TableHead>Sídlo</TableHead>
              <TableHead className="text-right">Faktur</TableHead>
              <TableHead className="text-right">Obrat</TableHead>
              <TableHead className="text-right">Akce</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <span className="block font-semibold">{c.name}</span>
                  {c.email && <span className="block text-xs text-muted-foreground">{c.email}</span>}
                </TableCell>
                <TableCell className="num whitespace-nowrap">
                  {c.ico || "—"}
                  <span className="block text-xs text-muted-foreground">
                    {c.vatPayer && c.dic ? c.dic : "neplátce DPH"}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {[c.street, [c.zip, c.city].filter(Boolean).join(" ")]
                    .filter(Boolean)
                    .join(", ") || "—"}
                </TableCell>
                <TableCell className="text-right num">{c.stats.invoiceCount}</TableCell>
                <TableCell className="text-right font-bold num whitespace-nowrap">
                  {formatCzk(c.stats.turnoverMinor)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex items-center gap-3 text-xs">
                    <Link
                      href={`/faktury/nova?contactId=${c.id}`}
                      className="font-semibold underline underline-offset-4 hover:opacity-75"
                    >
                      Fakturovat
                    </Link>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground cursor-pointer"
                      onClick={() => openEdit(c)}
                    >
                      Upravit
                    </button>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive cursor-pointer"
                      onClick={() => handleDelete(c)}
                    >
                      Smazat
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
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
