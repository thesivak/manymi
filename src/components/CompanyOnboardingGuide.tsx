"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, CheckCircle2, CreditCard, Layers, Loader2, Search } from "lucide-react";
import { czechAccountToIban, formatIban, validateIco } from "@/lib/domain/czech";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { Company } from "@/db/schema";

interface CompanyOnboardingGuideProps {
  company: Company;
}

type VatMode = "monthly" | "quarterly" | "none";

export function CompanyOnboardingGuide({ company }: CompanyOnboardingGuideProps) {
  const router = useRouter();
  const [ico, setIco] = useState(company.ico || "");
  const [name, setName] = useState("");
  const [dic, setDic] = useState(company.dic || "");
  const [vatMode, setVatMode] = useState<VatMode>("none");
  const [street, setStreet] = useState(company.street || "");
  const [city, setCity] = useState(company.city || "");
  const [zip, setZip] = useState(company.zip || "");
  const [registryNote, setRegistryNote] = useState(company.registryNote || "");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankSwift, setBankSwift] = useState("");

  const [aresStatus, setAresStatus] = useState<"idle" | "loading" | "found" | "error">("idle");
  const [aresMessage, setAresMessage] = useState("");
  const [showManualFields, setShowManualFields] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const lastFetchedIcoRef = useRef<string>("");

  async function lookupAres(rawIco: string, force = false) {
    const check = validateIco(rawIco);
    if (!check.valid) {
      setAresStatus("error");
      setAresMessage(check.error ?? "Neplatné IČO.");
      return;
    }
    if (!force && lastFetchedIcoRef.current === check.normalized) {
      return;
    }
    lastFetchedIcoRef.current = check.normalized;
    setAresStatus("loading");
    setAresMessage("Vyhledávám subjekt v registru ARES…");
    setError("");

    try {
      const res = await fetch(`/api/ares/${check.normalized}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.data) {
        setAresStatus("error");
        setAresMessage(json.error ?? "Subjekt nebyl v ARES nalezen. Údaje můžete vyplnit ručně.");
        setShowManualFields(true);
        return;
      }
      const d = json.data as {
        ico: string;
        name: string;
        dic: string;
        vatPayer: boolean;
        street: string;
        city: string;
        zip: string;
      };
      setIco(d.ico);
      setName(d.name || "");
      setDic(d.dic || "");
      setVatMode(d.vatPayer ? "monthly" : "none");
      setStreet(d.street || "");
      setCity(d.city || "");
      setZip(d.zip || "");
      setShowManualFields(true);
      setAresStatus("found");
      setAresMessage(
        `Načteno z ARES: ${d.name}${d.vatPayer ? " (plátce DPH)" : " (neplátce DPH)"}`,
      );
    } catch {
      setAresStatus("error");
      setAresMessage("Nepodařilo se spojit s ARES. Údaje můžete vyplnit ručně.");
      setShowManualFields(true);
    }
  }

  useEffect(() => {
    const digits = ico.replace(/\D/g, "");
    if (digits.length < 8) {
      if (aresStatus !== "idle") {
        setAresStatus("idle");
        setAresMessage("");
      }
      lastFetchedIcoRef.current = "";
      return;
    }
    if (digits.length === 8) {
      const check = validateIco(digits);
      if (!check.valid) {
        setAresStatus("error");
        setAresMessage(check.error ?? "Neplatné IČO (kontrolní součet).");
        return;
      }
      const timer = setTimeout(() => {
        void lookupAres(digits);
      }, 220);
      return () => clearTimeout(timer);
    }
  }, [ico]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveCompany(addAnotherAfter: boolean) {
    const trimmedName = name.trim();
    const cleanIco = ico.replace(/\D/g, "");
    if (!cleanIco) {
      setError("Zadejte prosím 8místné IČO vaší firmy nebo OSVČ.");
      return;
    }
    const icoCheck = validateIco(cleanIco);
    if (!icoCheck.valid) {
      setError(icoCheck.error ?? "Zadejte platné 8místné IČO.");
      return;
    }
    if (!trimmedName) {
      setError("Doplňte prosím název firmy nebo jméno OSVČ.");
      setShowManualFields(true);
      return;
    }

    setSaving(true);
    setError("");
    const vatPayer = vatMode !== "none";

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          ico: icoCheck.normalized,
          dic: vatPayer ? dic.trim() : "",
          vatPayer,
          vatPeriod: vatPayer ? vatMode : "none",
          street: street.trim(),
          city: city.trim(),
          zip: zip.trim(),
          country: company.country || "Česká republika",
          email: company.email,
          phone: company.phone,
          web: company.web,
          registryNote: registryNote.trim(),
          defaultDueDays: company.defaultDueDays || 14,
          defaultVatRate: vatPayer ? 21 : 0,
          defaultRounding: company.defaultRounding,
          defaultNoteAfter: company.defaultNoteAfter || "Děkujeme za spolupráci.",
          annualPlanMinor: company.annualPlanMinor || 250000000,
          bankAccountNumber: bankAccountNumber.trim() || undefined,
          bankSwift: bankSwift.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Nepodařilo se uložit údaje firmy.");
        return;
      }
      if (addAnotherAfter) {
        router.push("/nastaveni?tab=companies");
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const previewIban = czechAccountToIban(bankAccountNumber);

  return (
    <div className="container pb-20">
      <section className="hero pb-9">
        <p className="eyebrow">První nastavení · Krok 1 z 2</p>
        <h1 className="display h-hero hero__title">
          Nejdříve přidejte svou
          <br />
          firmu nebo OSVČ.
        </h1>
        <p className="lead hero__lead">
          Zadejte 8místné IČO — název, sídlo, DIČ i režim DPH načteme automaticky z registru ARES.
          Pod svým účtem pak můžete kdykoliv přidat i další subjekt (např. OSVČ i s.r.o.) a snadno
          mezi nimi přepínat.
        </p>
      </section>

      <Separator className="h-[1.5px] bg-foreground" />

      <section className="grid grid-cols-1 gap-10 pt-8 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] items-start">
        <div className="space-y-5">
          <h2 className="h3">Jak nastavení funguje</h2>
          <ol className="space-y-5 list-none p-0 m-0">
            <li className="border-l-2 border-foreground pl-4 space-y-1">
              <div className="flex items-center gap-2 font-semibold text-sm text-foreground">
                <Building2 className="size-4" />
                1. Vyhledání podle IČO v ARES
              </div>
              <p className="text-sm text-muted-foreground">
                Po napsání 8 číslic se údaje subjektu doplní automaticky. Nemusíte nic opisovat.
              </p>
            </li>
            <li className="border-l-2 border-border pl-4 space-y-1">
              <div className="flex items-center gap-2 font-semibold text-sm text-foreground">
                <CreditCard className="size-4" />
                2. Bankovní účet pro QR platby
              </div>
              <p className="text-sm text-muted-foreground">
                Z účtu hned spočítáme IBAN a každá vaše faktura bude obsahovat platnou QR Platbu
                (SPAYD).
              </p>
            </li>
            <li className="border-l-2 border-border pl-4 space-y-1">
              <div className="flex items-center gap-2 font-semibold text-sm text-foreground">
                <Layers className="size-4" />
                3. Více firem pod jedním účtem
              </div>
              <p className="text-sm text-muted-foreground">
                Fakturujete za OSVČ i za s.r.o.? Po uložení první firmy rovnou přidejte druhou —
                číselné řady, kontakty i faktury zůstanou čistě oddělené.
              </p>
            </li>
          </ol>
        </div>

        <Card className="border-foreground">
          <CardHeader>
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              Krok 1 · Identifikace subjektu
            </p>
            <CardTitle className="text-xl">Vyhledat firmu nebo OSVČ podle IČO</CardTitle>
            <CardDescription>
              Stačí napsat 8 číslic IČO — údaje načteme z MFČR ARES automaticky.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void saveCompany(false);
              }}
              className="space-y-5"
            >
              <div className="space-y-2">
                <Label htmlFor="onb-ico">IČO (8 číslic)</Label>
                <div className="flex gap-2.5">
                  <Input
                    id="onb-ico"
                    className="num"
                    inputMode="numeric"
                    maxLength={8}
                    autoFocus
                    placeholder="např. 27082440"
                    value={ico}
                    onChange={(e) => setIco(e.target.value.replace(/[^\d\s]/g, "").slice(0, 8))}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={aresStatus === "loading"}
                    onClick={() => void lookupAres(ico, true)}
                  >
                    {aresStatus === "loading" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Search className="size-4" />
                    )}
                    {aresStatus === "loading" ? "Hledám…" : "Načíst z ARES"}
                  </Button>
                </div>

                {aresMessage && (
                  <p
                    className={`flex items-center gap-1.5 text-xs ${
                      aresStatus === "error"
                        ? "text-destructive"
                        : aresStatus === "found"
                          ? "font-semibold text-foreground"
                          : "text-muted-foreground"
                    }`}
                  >
                    {aresStatus === "found" && <CheckCircle2 className="size-3.5 text-emerald-700" />}
                    {aresMessage}
                  </p>
                )}

                {!showManualFields && (
                  <div>
                    <Button
                      type="button"
                      variant="link"
                      className="text-xs text-muted-foreground font-normal"
                      onClick={() => setShowManualFields(true)}
                    >
                      Zadat údaje ručně bez ARES
                    </Button>
                  </div>
                )}
              </div>

              {showManualFields && (
                <>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="onb-name">Název firmy / jméno OSVČ</Label>
                      <Input
                        id="onb-name"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="onb-vat">Režim DPH</Label>
                      <Select
                        id="onb-vat"
                        value={vatMode}
                        onChange={(e) => setVatMode(e.target.value as VatMode)}
                      >
                        <option value="none">Neplátce DPH</option>
                        <option value="monthly">Plátce DPH (měsíční)</option>
                        <option value="quarterly">Plátce DPH (čtvrtletní)</option>
                      </Select>
                    </div>
                  </div>

                  {vatMode !== "none" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="onb-dic">DIČ</Label>
                      <Input
                        id="onb-dic"
                        className="num"
                        placeholder="CZ12345678"
                        value={dic}
                        onChange={(e) => setDic(e.target.value)}
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="onb-street">Ulice a číslo</Label>
                      <Input
                        id="onb-street"
                        value={street}
                        onChange={(e) => setStreet(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="onb-city">Obec</Label>
                      <Input
                        id="onb-city"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="onb-zip">PSČ</Label>
                      <Input
                        id="onb-zip"
                        className="num"
                        value={zip}
                        onChange={(e) => setZip(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="onb-reg">Zápis v rejstříku (patička faktury, volitelné)</Label>
                    <Input
                      id="onb-reg"
                      placeholder="Podnikatel zapsán v živnostenském rejstříku / Zapsána v OR u MS v Praze…"
                      value={registryNote}
                      onChange={(e) => setRegistryNote(e.target.value)}
                    />
                  </div>

                  <Separator />

                  <div className="space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      Krok 2 · Bankovní účet (pro QR platby)
                    </p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="onb-acc">Číslo účtu (volitelné teď)</Label>
                        <Input
                          id="onb-acc"
                          className="num"
                          placeholder="2104891234/2010"
                          value={bankAccountNumber}
                          onChange={(e) => setBankAccountNumber(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="onb-swift">SWIFT / BIC (volitelné)</Label>
                        <Input
                          id="onb-swift"
                          className="mono"
                          placeholder="FIOBCZPPXXX"
                          value={bankSwift}
                          onChange={(e) => setBankSwift(e.target.value)}
                        />
                      </div>
                    </div>
                    {previewIban && (
                      <p className="text-xs text-muted-foreground mono">
                        Automatický IBAN: {formatIban(previewIban)}
                      </p>
                    )}
                  </div>

                  {error && (
                    <Alert variant="destructive">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <Button type="submit" disabled={saving}>
                      {saving ? "Ukládám…" : "Uložit firmu a pokračovat"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={saving}
                      onClick={() => void saveCompany(true)}
                    >
                      Uložit a přidat druhou firmu
                    </Button>
                  </div>
                </>
              )}
            </form>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
