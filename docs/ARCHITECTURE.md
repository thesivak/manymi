# Manymi — Clean-Room architektura

Technický přehled současné implementace české fakturace. Design systém je v [`design/DESIGN.md`](../design/DESIGN.md); historický průzkum a funkční specifikace v ostatních souborech `docs/` nejsou inventářem implementovaných funkcí.

## 1. Stack a autentizace

- **Next.js 15 (App Router), React 19, TypeScript**, Tailwind CSS 4 a komponenty Radix UI.
- **Clerk (`@clerk/nextjs` v7)** spravuje identity a sessions. Přihlášení je na `/sign-in/[[...sign-in]]`; `/sign-up/[[...sign-up]]` přesměruje na `/sign-in` v middleware i v samotné stránce. Vlastní login/register endpointy ani ukládání hesel aplikace nemá.
- `src/middleware.ts` používá `clerkMiddleware` a `auth.protect()`. Veřejné vůči Clerk jsou `/sign-in(.*)`, `/api/health` a `/api/mcp`; MCP má vlastní Bearer autentizaci. Bez konfigurace Clerk middleware propouští požadavky, ale aplikační layout přesměruje na přihlášení a `getAuthContext()` vrací `null`.
- `src/lib/auth.ts` propojuje `clerkUserId` s členstvím ve firmách (`owner` / `accountant`), přijímá pozvánky, vytváří výchozí firmu a načítá aktivní firmu z preferencí. `src/lib/access.ts` kontroluje e-mailový allowlist `ALLOWED_EMAILS` (s výchozím povoleným účtem); `clerk-config.ts` ověřuje konfiguraci klíčů. API handlery kontrolují firemní kontext přes `getAuthContext()`.
- **PostgreSQL (Supabase), Drizzle ORM a `postgres`**. Klient v `src/db/index.ts` vzniká líně; `ensureDatabaseReady()` inicializuje schéma pomocí SQL pod advisory lockem. Pro serverless se používá transaction pooler s `prepare: false`.
- **PDFKit + lokální fonty** generují vektorové A4 PDF; `qrcode` kóduje skutečný SPAYD QR. ČNB poskytuje měnové kurzy, ARES údaje firem, `mailer.ts` odesílání e-mailů. Vitest pokrývá doménu, PDF a MCP.

## 2. Moduly a routy

| Modul | Stránky a funkce |
| --- | --- |
| Přehled | `/`: měsíční a roční KPI, graf fakturace, pohledávky a závazky, poslední doklady a onboarding firmy. |
| Prodej | `/faktury`: záložky Faktury, Zálohy, Daňové doklady, Dobropisy, Nabídky, Prodejky, Pravidelné, Šablony. Parametry `typ` a `stav` nastavují počáteční záložku a filtr. `/faktury/nova` podporuje `docType`, `contactId`, `templateId`; `/faktury/[id]` zobrazuje detail nebo editor konceptu. |
| Nákup | `/nakup`: Přijaté faktury, Účtenky, Inbox s nahráváním a převodem na náklad. |
| Ceník | `/cenik`: položky ceníku, skladové pohyby a prodej po položkách. |
| Finance | `/finance`: banka (CSV import, automatické i ruční párování), pokladna a úhrady. |
| Kontakty | `/kontakty`: adresář, obrat, historie e-mailů; `/api/ares/[ico]` ověřuje IČO a načítá ARES. |
| Nastavení | `/nastaveni`: firma, účty, číselné řady, export/import, firmy a pozvánky, MCP & API. `?tab=` přijímá `company`, `bank`, `sequences`, `export`, `companies`, `mcp`. |
| MCP | `/api/mcp`: firemní JSON-RPC rozhraní se sedmi nástroji (viz níže). |

### API inventář

- `/api/invoices`, `/api/invoices/bulk`, `/api/invoices/[id]` a podcesty `actions`, `payments`, `attachments`, `pdf`, `isdoc`: doklady, převody, hromadné akce, úhrady a exporty.
- `/api/recurring`, `/api/templates`: pravidelné předpisy a šablony.
- `/api/purchases`, `/api/inbox`: náklady a zpracování příchozích souborů.
- `/api/catalog`, `/api/bank`, `/api/cash`: ceník/sklad, bankovní pohyby a pokladna.
- `/api/contacts`, `/api/contacts/[id]`, `/api/ares/[ico]`, `/api/cnb`: kontakty a veřejné registry/kurzy přes server.
- `/api/settings`, `/api/settings/invitations`, `/api/settings/api-keys`, `/api/companies`, `/api/companies/switch`: firemní nastavení, členství a klíče.
- `/api/exports`, `/api/emails`, `/api/health`, `/api/mcp`: účetní exporty, e-mailová historie, diagnostika a MCP.

## 3. Datový model

`src/db/schema.ts` aktuálně definuje **23 tabulek**. Finanční částky jsou celočíselné haléře (`*Minor`), množství tisíciny (`quantityMilli`, 1 ks = 1000).

| Tabulky | Účel |
| --- | --- |
| `user_preferences` | Aktivní firma podle `clerkUserId`. |
| `companies` | Právní údaje a výchozí fakturační/e-mailové nastavení firmy. |
| `company_memberships` | Členství identity Clerk ve firmě a role. |
| `company_invitations` | Pozvánky podle e-mailu, role a přijetí. |
| `bank_accounts` | Firemní účty, IBAN, SWIFT a měna. |
| `number_sequences` | Číselné řady podle firmy, typu dokladu, prefixu a roku. |
| `contacts` | Adresář s údaji ARES a fakturačními preferencemi. |
| `invoices` | Prodejní doklady, stavy, měny, součty a snapshoty dodavatele/odběratele/účtu. |
| `invoice_items` | Řádky dokladu, množství, ceny a DPH. |
| `document_attachments` | Přílohy faktur/nákupů s obsahem v Base64. |
| `invoice_templates` | Šablony dokladů a položek. |
| `recurring_invoices` | Opakované předpisy, intervaly, ukončení a volby odeslání. |
| `email_logs` | Historie odesílání a obsah e-mailů. |
| `purchases` | Přijaté faktury/účtenky, dodavatelský snapshot, položky JSON a úhrada. |
| `inbox_items` | Nahrané soubory, vytěžené údaje a stav zpracování. |
| `catalog_items` | Ceník, SKU/EAN, cena a skladové nastavení. |
| `stock_movements` | Příjmy/výdeje množství a vazba na zdrojový doklad. |
| `payments` | Samostatné platby. |
| `payment_allocations` | Alokace částek plateb na faktury. |
| `bank_transactions` | Bankovní pohyby, stav párování a vazby na doklady/platby. |
| `cash_registers` | Pokladny s měnou a počátečním zůstatkem. |
| `cash_vouchers` | Příjmové/výdajové pokladní doklady. |
| `api_keys` | Firemní klíče: prefix, SHA-256 hash, poslední použití a revokace. |

Doklady mají životní stav `draft` / `issued` / `cancelled`; stav úhrady (`sent`, `partial`, `overdue`, `paid`) se odvozuje z částek a splatnosti v `domain/invoice-status.ts`. Snapshoty chrání obsah vystaveného dokladu před pozdější změnou kontaktu nebo firmy.

## 4. Struktura `src/`

```text
src/
├── app/
│   ├── layout.tsx, globals.css
│   ├── sign-in/[[...sign-in]]/page.tsx
│   ├── sign-up/[[...sign-up]]/page.tsx
│   ├── (app)/                         # chráněný layout a loading skeleton
│   │   ├── page.tsx                   # Přehled
│   │   ├── faktury/                   # seznam, nova, [id]
│   │   ├── nakup/, cenik/, finance/
│   │   └── kontakty/, nastaveni/
│   └── api/                          # handlery uvedené v inventáři
├── assets/fonts/                     # Archivo a Inter pro PDF
├── components/                       # AppShell, klientské moduly, A4 náhled, graf
│   └── ui/                           # sdílené UI komponenty
├── db/
│   ├── index.ts                      # lazy klient a SQL bootstrap
│   └── schema.ts                     # Drizzle tabulky a typy
├── lib/
│   ├── auth.ts, access.ts, clerk-config.ts
│   ├── domain/                       # money, czech, ares, cnb, exports,
│   │                                 # invoice-status, recurring, bank-and-inbox
│   │   └── __tests__/
│   ├── mcp/server.ts, mcp/__tests__/
│   ├── pdf/invoice-pdf.ts
│   └── mailer.ts, demo-seed.ts, utils.ts
└── middleware.ts
```

## 5. MCP

`src/lib/mcp/server.ts` implementuje Streamable HTTP JSON-RPC 2.0 (verze protokolu `2025-03-26`), obsluhované přes `/api/mcp`. GET vrací veřejný popis endpointu a seznam nástrojů; POST vyžaduje klíč. Klíč `mnm_live_…` se předává jako `Authorization: Bearer …`; ověřuje se hash a revokace v `api_keys`, kontextem je firma klíče.

| Nástroj | Funkce |
| --- | --- |
| `get_dashboard_summary` | Měsíční/roční fakturace, neuhrazené a po splatnosti, informativní DPH na výstupu. |
| `list_invoices` | Seznam s filtrem stavu, hledáním a limitem. |
| `get_invoice` | Detail podle ID/čísla, položky, úhrady a cesta k PDF. |
| `create_invoice` | Koncept nebo vystavení, volitelně ARES, výpočet DPH a QR. |
| `record_payment` | Plná nebo částečná úhrada vystavené faktury. |
| `list_contacts` | Firemní kontakty s hledáním a obratem. |
| `lookup_ares` | Validace IČO a načtení veřejných údajů ARES. |

## 6. Doménová pravidla a ověřování

IČO se validuje modulo 11; český IBAN modulo 97. Doména podporuje DPH 21/12/0 %, neplátce i přenesenou povinnost, ceny bez/s DPH, slevu a zaokrouhlení. PDF a náhled používají SPAYD QR; účetní výstupy zahrnují ISDOC, CSV a Pohoda XML.

Aplikace záměrně **negeneruje daňová přiznání, kontrolní ani souhrnná hlášení**. DPH na dokladech a účetní podklady jsou součástí fakturace.

`pnpm lint`, `pnpm typecheck` a `pnpm test` běží v GitHub Actions bez secrets. Dva PostgreSQL integrační testy a jeden MCP integrační test se bez `DATABASE_URL` přeskočí; ostatní testy běží. Build není součástí CI. Nasazování produkce a preview popisuje [`README.md`](../README.md#nasazování-a-ci).
