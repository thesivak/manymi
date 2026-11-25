# Manymi — minimalistická česká online fakturace (Clean-Room)

Plnohodnotná clean-room online fakturační aplikace pro české OSVČ a malé firmy postavená ve stylu švýcarského editoriálního minimalismu ([`design/DESIGN.md`](./design/DESIGN.md)) s paritou klíčových modulů iDokladu (vyjma generování daňového přiznání).

## Moduly a funkce

- **Přehled (`/`)** — typografický souhrn měsíce, 4 KPI s proporčními měřidly, SVG graf měsíční fakturace, bilance příjmů vs. nákladů, neuhrazené pohledávky a závazky, poslední doklady.
- **Prodej (`/faktury`)** — Vydané faktury, Zálohové faktury, Daňové doklady k platbě, Dobropisy, Cenové nabídky, Prodejky, Pravidelné faktury (automatické vzory + jednorázové spuštění) a Šablony.
  - Editor se zadáváním cen **Bez DPH i S DPH** (§ 37 ZDPH), **cizími měnami + živým kurzem ČNB**, jazykem tisku **CZ / EN**, výběrem z ceníku, slevou %, zaokrouhlením, přílohami (5 × 2 MB), **reálným SPAYD QR kódem**, **vektorovým A4 PDF**, **ISDOC 6.0.2 XML**, **Pohoda XML**, **CSV**, odesíláním e-mailem & upomínkami, hromadnými akcemi a převody dokladů (`Nabídka → Faktura`, `Záloha → Vyúčtovací faktura / Daňový doklad`, `Faktura → Dobropis`, `Kopie`).
- **Nákup (`/nakup`)** — Přijaté faktury (s ARES dodavatele a evidencí úhrad), Účtenky a **Inbox** (nahrání ISDOC XML / souboru s vytěžením IČO, VS, částky, dat a převodem na náklad).
- **Ceník (`/cenik`)** — Položky ceníku (SKU, EAN, cena, DPH), Skladové pohyby (ruční i automatický výdej při vystavení faktury) a Přehled prodeje po položkách.
- **Finance (`/finance`)** — Bankovní pohyby s **importem CSV výpisu**, **automatickým párováním** podle VS a částky i ručním párováním, **Pokladna** (PPD / VPD se zůstatkem) a centrální přehled všech úhrad.
- **Kontakty (`/kontakty`)** — Adresář odběratelů s živým MFČR ARES (validace IČO mod 11), přehled obratu a **Historie e-mailů**.
- **Nastavení (`/nastaveni`)** — Firma a fakturace, Bankovní účty (automatický ISO 13616 IBAN), Číselné řady, Export & import (Pohoda XML, CSV, import kontaktů), Uživatelé & pozvánky pro účetní + multi-company přepínač, **MCP & API**.
- **Vestavěný MCP server (`/api/mcp`)** — Streamable HTTP JSON-RPC 2.0 endpoint chráněný firemními Bearer API klíči (SHA-256 hash) se 7 nástroji pro AI agenty.

> Poznámka: Aplikace záměrně **negeneruje daňová přiznání** (ani daň z příjmů FO ani přiznání k DPH).

## Stack & spuštění

- **Next.js 15 (App Router) + React 19 + TypeScript**
- **Clerk (`@clerk/nextjs` v7)** pro autentizaci
- **Supabase PostgreSQL + Drizzle ORM (`postgres`)**
- **`pdfkit` + `qrcode` + Vitest**

```bash
cp .env.example .env.local   # doplňte Clerk a Supabase klíče
pnpm install
pnpm dev                     # vývoj na http://localhost:3000
pnpm test                    # unit, integrační, ARES, Supabase, PDF a MCP testy
pnpm build && pnpm start     # produkční build a spuštění
```

## Nasazování a CI

Produkce na **manymi.cz** se nasazuje pouze po sloučení Pull Requestu do `main`. Do `main` se neposílají přímé pushe; změny procházejí PR. Feature a fix větve dostávají Vercel preview deploymenty pro kontrolu před sloučením.

GitHub Actions pro PR do `main` a pushe do `main` spouští `pnpm lint`, `pnpm typecheck` a `pnpm test`. Kontroly nepotřebují GitHub secrets; tři databázové integrační testy se bez `DATABASE_URL` přeskočí. Lokálně lze stejné příkazy spustit po `pnpm install --frozen-lockfile`.
