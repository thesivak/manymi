# Manymy — Clean-Room Architektura (MVP v1)

> Dokumentace technického návrhu pro čistou implementaci fakturační aplikace **Manymy** nad českými standardy (ARES MFČR, SPAYD QR, zákon o DPH) a design systémem [`design/DESIGN.md`](../design/DESIGN.md).

## 1. Technologický stack

| Vrstva | Volba | Důvod |
| --- | --- | --- |
| Aplikační framework | **Next.js (App Router) + React + TypeScript** | Jedno full-stack repo, serverové komponenty, route handlery pro PDF/ARES/API, přímý tok formulářů. |
| Databáze & ORM | **Drizzle ORM + PostgreSQL (Supabase)** | Typově bezpečné schéma, transakční advisory lock při inicializaci, Session/Transaction Pooler přes `postgres`. |
| MCP rozhraní | **Streamable HTTP JSON-RPC 2.0 (`/api/mcp`)** | 7 nástrojů pro AI agenty chráněných firemními Bearer API klíči (`api_keys`, SHA-256 hash). |
| Autentizace | **Clerk (`@clerk/nextjs`)** | Správa účtů, přihlášení/registrace, 2FA a session middleware přes Clerk; v DB mapujeme `clerkUserId` na firmy a role. |
| QR platba | **`qrcode` (ECC M) + vlastní SPAYD 1.0 generátor** | Skutečný čitelný QR kód podle specifikace ČBA v A4 náhledu (SVG) i v PDF (PNG). |
| Export PDF | **`pdfkit` + vektorové písmo s českou diakritikou** | Deterministický, rychlý vektorový A4 PDF výstup přesně podle sekce 4.10 `DESIGN.md` bez závislosti na headless prohlížeči. |
| Veřejné integrace | **ARES REST API (MFČR)** | Přímé serverové volání `ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/{ico}` s validací IČO a 24h cache. |
| Testy | **Vitest** | Rychlé unit testy pro haléřovou aritmetiku, DPH, zaokrouhlení, IČO, IBAN, SPAYD a transakční číslování. |

## 2. Doménový a databázový model

Všechny finanční částky jsou uložené jako **celočíselné haléře (`*Minor`)** a množství jako **tisíciny (`quantityMilli`, 1 ks = `1000`)**, aby nikdy nedocházelo ke ztrátě přesnosti ve `float`.

### Hlavní entity (`src/db/schema.ts`)

1. **`user_preferences` (napojené na `clerkUserId`)**
   - Identitu uživatele spravuje Clerk (`clerkUserId`).
   - Tabulka `user_preferences` uchovává `activeCompanyId` pro okamžité přepínání firem v kontextové liště.
2. **`companies` a `company_memberships`**
   - Multi-company model od prvního dne; členství spojuje `clerkUserId` s firmou a rolí (`owner` | `accountant`).
   - Firma nese právní údaje (název, IČO, DIČ, plátce DPH, zdaňovací období, sídlo, zápis v OR) a výchozí parametry fakturace (splatnost, sazba DPH, zaokrouhlení, roční plán).
3. **`bank_accounts`**
   - Bankovní účty firmy (číslo účtu, kód banky, IBAN, SWIFT, měna, výchozí příznak).
4. **`number_sequences`**
   - Číselné řady podle typu dokladu (`invoice`), prefixu a roku (např. `2026-0001`).
   - Unikátní klíč `(companyId, docType, prefix, year)` + transakční rezervace dalšího čísla při vystavení.
5. **`contacts`**
   - Adresář odběratelů s IČO, DIČ, plátcovstvím DPH, adresou, kontakty, výchozí splatností a datem posledního ověření v ARES.
6. **`invoices` a `invoice_items`**
   - `invoices` mají vlastní životní stav dokladu (`draft` | `issued` | `cancelled`).
   - Při uložení/vystavení ukládají **neměnný JSON otisk** (`supplierSnapshotJson`, `customerSnapshotJson`, `bankSnapshotJson`), takže pozdější úprava firmy nebo kontaktu nikdy nezmění již vystavenou fakturu.
   - Uchovávají předpočítané haléřové součty (`subtotalMinor`, `vatTotalMinor`, `roundingMinor`, `totalMinor`, `paidMinor`) a řetězec `spaydString`.
   - Zobrazený stav úhrady (`draft` / `cancelled` / `paid` / `partial` / `overdue` / `sent`) se vždy čistě odvozuje ze stavu dokladu, `paidMinor`, `totalMinor` a `dueDate`.
7. **`payments` a `payment_allocations`**
   - Oddělená evidence plateb a jejich alokace na faktury. Podporuje plné i částečné úhrady a je připravená na budoucí bankovní párování.

## 3. Struktura aplikace (`src/`)

```text
src/
├── app/
│   ├── (auth)/login, register          # Přihlášení a registrace
│   ├── (app)/
│   │   ├── page.tsx                    # Přehled (KPI, graf, odhad DPH, poslední faktury)
│   │   ├── faktury/page.tsx            # Seznam faktur s filtry, hledáním a akcemi
│   │   ├── faktury/nova/page.tsx       # Split-view editor + živý A4 náhled
│   │   ├── faktury/[id]/page.tsx       # Detail / editace faktury + evidence úhrad
│   │   ├── kontakty/page.tsx           # Adresář odběratelů + živý ARES
│   │   └── nastaveni/page.tsx          # Firma, bankovní účty, číselné řady, nová firma
│   └── api/
│       ├── auth/*                      # login, register, logout, switch-company
│       ├── ares/[ico]/route.ts         # Proxy + validace + cache pro MFČR ARES
│       ├── invoices/*                  # CRUD, vystavení, storno, úhrady, PDF export
│       ├── contacts/*                  # CRUD kontaktů
│       └── settings/*                  # Firma, bankovní účty, číselné řady, firmy
├── components/                         # UI kit přesně podle design/DESIGN.md
├── db/                                 # Drizzle klient, schéma, migrace, seed
└── lib/
    ├── auth.ts                         # Hesla (scrypt), sessions, ochrana endpointů
    ├── domain/                         # Čistá doménová logika (money, czech, ares, status)
    └── pdf/                            # Vektorový A4 PDF generátor (pdfkit + qrcode)
```

## 4. Česká legislativní pravidla (MVP v1)

- **IČO**: kontrolní součet modulo 11 před dotazem do ARES.
- **DPH na fakturách**: sazby 21 %, 12 %, 0 %; rekapitulace po sazbách; režim plátce, neplátce („Faktura“ místo „Faktura — daňový doklad“) i přenesená daňová povinnost („Daň odvede zákazník“).
- **DUZP & upozornění**: výchozí shoda s datem vystavení; vizuální upozornění při prodlevě > 15 dnů.
- **IBAN**: výpočet dle ISO 13616 (mod 97) z českého formátu `[předčíslí-]číslo/kód`.
- **SPAYD QR**: formát `SPD*1.0*ACC:...*AM:...*CC:CZK*DT:...*X-VS:...*MSG:...` s reálným QR kódem (ECC M).

### Mimo rozsah (Non-goals)
- **Žádné generování daňového přiznání** (ani přiznání k DPH, kontrolního hlášení či daňového přiznání k dani z příjmů FO). Aplikace se soustředí na fakturaci, přehled tržeb/pohledávek a podklady pro účetní.
