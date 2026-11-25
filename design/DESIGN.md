# Manymy — grafický návrh a design systém

> Verze 0.1 · listopad 2026 · interaktivní ukázka: [`mockup.html`](./mockup.html)

Manymy je česká online aplikace pro vystavování faktur pro OSVČ a malé firmy (obdoba iDoklad / Fakturoid). Vizuálně vychází ze **švýcarského editoriálního minimalismu** webu `sivak.ai`: inkoust na papíře, sebevědomá typografie, ostré linky, žádná dekorace navíc.

---

## 1. Principy vizuální identity

1. **Inkoust na papíře.** Hierarchii nese kontrast téměř černého inkoustu (`#0B1220`) na světlém plátně, ne barva. Rozhraní má působit jako dobře vysázený dokument, ne jako barevný dashboard.
2. **Typografie je layout.** Velké, těsně vysázené nadpisy (Archivo, zúžený řez, 800, `-0.03em`) samy strukturují stránku. Přehled začíná větou s čísly („Listopad: 465 910 Kč vyfakturováno.“), ne mřížkou dlaždic.
3. **Linky místo stínů.** Sekce oddělují předěly `1.5px` v barvě inkoustu, klíčové tabulky mají rám `1px`, řádky vlasové linky `#E5E7EB`. Stíny (`box-shadow`) se pro hloubku nepoužívají.
4. **Barva je jen značka.** Karmínová a zelená smějí pokrýt značku 6–8 px, text chyby nebo údaj „18 dní po splatnosti“. Nikdy pozadí karty, celý štítek ani graf.
5. **Čísla sedí v řádu.** Každá částka, datum, IČO, DIČ, VS a IBAN se sází s `font-variant-numeric: tabular-nums`, aby čísla ve sloupcích lícovala. Částky jsou v tabulkách vždy zarovnané vpravo.
6. **Jedna hlavní akce.** Na obrazovce je nejvýš jedno plné inkoustové tlačítko. Druhá akce v pořadí je podtržený odkaz nebo obrysové tlačítko.
7. **Lehká architektura.** Horní lišta místo tmavého bočního panelu, hodně vzduchu a obsah v max. šířce 1 280 px.

---

## 2. Tokeny

### 2.1 Barvy

| Token | Hex | Použití | Kontrast na #FFF |
|---|---|---|---|
| `--ink` | `#0B1220` | Nadpisy, text, primární CTA, rámy tabulek, předěly, datové lišty a sloupce grafů | 18,7 : 1 |
| `--ink-2` | `#1E293B` | Hover primárního CTA, položky navigace | 14,6 : 1 |
| `--text-2` | `#4B5563` | Perex, odstavce, sekundární text | 7,6 : 1 |
| `--muted` | `#6B7280` | Metadata, nápovědy, osy grafů, IČO pod názvem | 4,8 : 1 |
| `--subtle` | `#9CA3AF` | Placeholdery, čárkovaný okraj konceptu (ne pro text, který nese informaci) | 2,5 : 1 |
| `--line-strong` | `#D1D5DB` | Okraje polí, rám A4 náhledu | — |
| `--line` | `#E5E7EB` | Linky řádků, stopa měřidel, mřížka grafu | — |
| `--fill` | `#F3F4F6` | Podklad štítku „Zaplaceno“, hover, předvyplněná pole | — |
| `--canvas` | `#F8F9FA` | Pozadí aplikace | — |
| `--surface` | `#FFFFFF` | Tabulky, formulářová pole, horní lišta, papír A4 | — |

**Sémantické akcenty** (jen drobně):

| Token | Hex | Kde smí být |
|---|---|---|
| `--danger` | `#B91C1C` | Značka u KPI „Po splatnosti“, text „N dní po splatnosti“, chybová hláška a rám chybného pole (6,5 : 1) |
| `--danger-on-ink` | `#F87171` | Jen 6 × 6 px značka uvnitř tmavého štítku „Po splatnosti“ |
| `--success` | `#15803D` | Jen 6–7 px značka: „Zaplaceno“, „Ověřeno v ARES“ (5,0 : 1) |

Pravidlo: když z obrazovky odstraníte barvy, musí zůstat srozumitelná, protože stav vždy nese i text a váha inkoustu.

### 2.2 Typografie

- **Display:** `Archivo` (proměnný, `font-stretch: 86%`), váha 700–800, tracking `-0.03em` až `-0.035em`, řádkování `1.04–1.15`.
- **UI:** `Inter` 400 / 500 / 600 / 700; záložní `-apple-system, Segoe UI, Roboto, Arial`.
- **Mono:** `ui-monospace, SF Mono, Menlo`, jen pro tokeny a řetězec SPAYD.

| Styl | Písmo | Velikost / řádkování | Váha | Tracking | Použití |
|---|---|---|---|---|---|
| Display XL | Archivo 86 % | `clamp(40, 5.4vw, 82)` / 1.06 | 800 | −0.035em | Úvod Přehledu |
| Display L | Archivo 86 % | `clamp(36, 4.2vw, 60)` / 1.08 | 800 | −0.03em | Nadpis stránky |
| Nadpis 2 | Archivo 86 % | `clamp(30, 3.2vw, 46)` / 1.1 | 800 | −0.03em | Sekce |
| Nadpis 3 | Archivo 86 % | 22–24 / 1.2 | 700 | −0.02em | Podsekce, sekce formuláře |
| KPI hodnota | Archivo 86 % | `clamp(30, 3vw, 44)` / 1.1 | 700 | −0.03em | Metriky, „Celkem k úhradě“ |
| Perex | Inter | 17–20 / 1.62 | 400 | 0 | Úvodní odstavec, `--text-2` |
| Text | Inter | 15 / 1.55 | 400 | 0 | Výchozí text |
| Popisek | Inter | 13.5 / 1.4 | 600 | 0 | Popisky polí, hlavičky tabulek (14) |
| Malý | Inter | 13 / 1.5 | 400 | 0 | Nápovědy, metadata |

Čísla: `tabular-nums` globálně třídou `.num` i na všech `input.num`. Měna se odděluje nezlomitelnou mezerou (`465 910 Kč`). Tisíce odděluje mezera, desetinná čárka (`Intl.NumberFormat('cs-CZ')`). Datum se zapisuje `24. 11. 2026` s nezlomitelnými mezerami.

### 2.3 Mřížka a layout

- 12 sloupců, obsah **max. 1 280 px**, okraje (gutter) **48 px** (≥ 900 px), **24 px** (tablet), **16 px** (mobil).
- Editoriální dělení **5 : 7** (text vlevo, data vpravo), jako sekce „Co agent udělá“ v referenci.
- Editor faktury **1 : 1,1** (formulář : náhled A4). Náhled je `sticky` pod horní lištou.
- Hlavní zlomy: **1180 px** (navigace se zalomí pod logo a lze ji posouvat), **1100 px** (editor do jednoho sloupce), **980 px** (KPI 2 × 2, split do jednoho sloupce), **560 px** (formulářové dvojice pod sebe).
- Na `html` ani `body` se nenastavuje `height: 100%` ani jednotky `vh`. Výška plyne s obsahem.

### 2.4 Rozestupy (základ 4 px)

`--s-1 4` · `--s-2 8` · `--s-3 12` · `--s-4 16` · `--s-5 24` · `--s-6 32` · `--s-7 48` · `--s-8 64` · `--s-9 96`

Rytmus stránky: úvod 88 / 72 px, sekce 64 px, sekce formuláře 20 / 30 px, buňka tabulky 16–18 × 24 px.

### 2.5 Ohraničení a geometrie

| Prvek | Hodnota |
|---|---|
| Zaoblení | `0` tabulky, A4, měřidla, sloupce grafu · `2px` štítky · `3px` tlačítka a pole · `4px` maximum (menu, toast). **Nikdy 12–16 px.** |
| Předěl sekce | `1.5px solid #0B1220` |
| Rám tabulky | `1px solid #0B1220`; hlavička podtržená `1.5px` |
| Linka řádku | `1px solid #E5E7EB` |
| Callout | `border-left: 2px solid #0B1220`, odsazení 26 px |
| Fokus | `outline: 2px solid #0B1220; outline-offset: 2px`; pole: rám inkoust + `box-shadow: 0 0 0 1px` |
| Stíny | žádné |
| Pohyb | 120–200 ms, `cubic-bezier(.2,0,0,1)`, žádné odskakování; respektuje `prefers-reduced-motion` |

---

## 3. Informační architektura

```
Manymy
├── Přehled                 souhrn měsíce, KPI, graf, odhad DPH, poslední faktury
├── Faktury                 seznam · filtr stavů · hledání · detail · editor
│   ├── Nová faktura        editor + živý A4 náhled
│   ├── Zálohové faktury    (řada Z-RRRR-NNN)
│   ├── Opravné doklady     (dobropis, storno)
│   └── Opakované faktury   šablony s intervalem
├── Náklady                 přijaté faktury, účtenky (upload / e-mail), DPH na vstupu
├── Kontakty                odběratelé a dodavatelé · ARES · registr plátců DPH
├── DPH & Reporty           přiznání, kontrolní hlášení, souhrnné hlášení, cash-flow, export pro účetní
└── Nastavení               firma, bankovní účty, číselné řady, šablona PDF, e-maily, uživatelé, API
```

**Navigace:** bílá horní lišta 72 px se spodní linkou `#E5E7EB`. Vlevo logo (geometrický list s ohnutým rohem) a slovní značka `manymy`, malými písmeny jako `sivak.ai`. V běžném textu se píše „Manymy“. Uprostřed položky v jedné řádce (aktivní má podtržení 2 px u spodní hrany lišty). Vpravo tichý odkaz „Nastavení“ a jediné plné CTA **„+ Nová faktura“**.
**Kontextová lišta** (44 px, na plátně): aktivní firma, IČO, DIČ, režim DPH a vpravo dnešní datum. Při více firmách se z ní stane přepínač firem.
**Drobečková navigace** jen v hloubce (např. „Faktury / Nová faktura“) jako tichý odkaz nad nadpisem.

### Obsah sekcí

- **Přehled.** Typografický úvod (věta s částkou za měsíc a po splatnosti), perex s konkrétními fakty, CTA „Vystavit fakturu“ a odkaz „Poslat upomínky (3)“. Následuje předěl, 4 KPI, graf po měsících s editorial poznámkou (odhad DPH, termín přiznání) a tabulka posledních 6 faktur.
- **Faktury.** Filtry stavů s počty (Vše · Koncepty · Čeká na úhradu · Po splatnosti · Zaplacené · Stornované), hledání (`/` pro fokus), souhrnný řádek (počet · vystaveno · neuhrazeno · po splatnosti), řaditelná tabulka a řádkové akce podle stavu (Upomenout / Označit zaplacené / Dokončit / PDF). Hromadné akce se objeví v liště nad tabulkou po výběru řádků.
- **Náklady.** Stejná tabulka jako u faktur (dodavatel, číslo dokladu dodavatele, DUZP, částka, DPH na vstupu, stav úhrady). Nahrání PDF nebo fotky: vytěžení údajů (IČO, VS, částky), kontrola proti ARES a registru plátců DPH. Upozornění na nespolehlivého plátce nebo nezveřejněný účet se zobrazí jako callout s karmínovou značkou.
- **Kontakty / ARES.** Seznam odběratelů s obratem a průměrnou dobou úhrady. Nový kontakt začíná polem IČO a tlačítkem „Načíst z ARES“. Detail ukazuje historii faktur, saldo a údaje z ARES s datem posledního ověření.
- **DPH & Reporty.** Přehled zdaňovacích období (měsíc / čtvrtletí), u každého DPH na výstupu, na vstupu a k odvodu. Následuje stav podání přiznání a kontrolního hlášení (XML pro EPO / datovou schránku) a souhrnné hlášení pro plnění do EU. Reporty: fakturace po měsících, top odběratelé, stárnutí pohledávek (0–30 / 31–60 / 60+ dní) a export pro účetní (ISDOC, CSV, Pohoda XML).
- **Nastavení.** Firma (logo, IČO, DIČ, režim DPH, zápis v OR), bankovní účty (výchozí účet podle měny), číselné řady, šablona PDF (logo, patička, jazyk CZ / EN), e-mailové šablony a upomínky (automaticky 3 / 7 / 14 dní po splatnosti), uživatelé a role (vlastník, účetní jen pro čtení), API a webhooky.

---

## 4. Komponenty

### 4.1 Tlačítka a odkazy
| Varianta | Vzhled | Kdy |
|---|---|---|
| Primary | `#0B1220`, bílý text 600, výška 44 (lg 58, sm 34), radius 3 px, hover `#1E293B` | Jediná hlavní akce: „Vystavit fakturu“, „+ Nová faktura“ |
| Outline | bílé pozadí, `1px solid #0B1220`, hover `#F3F4F6` | „Načíst z ARES“, „Uložit koncept“ |
| Link | text 600, `underline`, tloušťka 1,5 px, `text-underline-offset: 4px`, hover 2,5 px | Sekundární akce: „Poslat upomínky“, „Stáhnout PDF“ |
| Link quiet | `#4B5563`, linka `#D1D5DB` 1 px | Pomocné akce v řádcích, „Export pro účetní“ |
| Link danger | `#B91C1C` | Storno, smazání, vždy s potvrzovacím dialogem |
| Disabled | `#F3F4F6` / `#9CA3AF` | — |
| Loading | text zmizí, uvnitř běží ostrá 2px inkoustová linka | ARES, odesílání |

### 4.2 Štítky stavu
Naléhavost vyjadřuje **váha inkoustu**: plný štítek znamená akci, obrys znamená, že stav běží, a šedý podklad znamená vyřízeno.

| Stav | Vzhled |
|---|---|
| **Po splatnosti** | plný inkoust, bílý text a značka `#F87171` 6 × 6 px |
| **Čeká na úhradu** | bílý, rám `1px #0B1220` (jako „Agent“ v referenci) |
| **Zaplaceno** | `#F3F4F6`, rám `#D1D5DB`, zelená značka 6 × 6 px |
| **Koncept** | průhledný, čárkovaný rám `#9CA3AF`, text `#4B5563` |
| **Stornováno** | rám `#E5E7EB`, přeškrtnutý text `#6B7280` |

Výška 26 px, radius 2 px, text 13 px / 600. Značky jsou čtvercové (s radiusem 1 px), aby odpovídaly ostré geometrii.

### 4.3 Formulářová pole
- Výška 42 px (v řádcích položek 38), rám `#D1D5DB`, radius 3 px, pozadí bílé.
- Popisek nad polem (13,5 / 600). Volitelnost se píše za popisek tlumeně: „— volitelné“.
- Fokus: rám inkoust a vnější linka 1 px, takže výsledný rám je ostrý a 2 px silný.
- Chyba: karmínový rám a konkrétní česká hláška pod polem („IČO nemá platný kontrolní součet. Zkontrolujte poslední číslici.“).
- Pole předvyplněná z ARES krátce bliknou podkladem `#F3F4F6` (900 ms), aby bylo vidět, co se změnilo.
- Číselná pole (`IČO`, `VS`, `KS`, ceny) mají `inputmode="numeric"`/`decimal`, `tabular-nums` a ceny se zarovnávají vpravo.
- Segmentový přepínač (splatnost 7 / 14 / 30 / 60 dní): rám inkoust, vybraná volba plná. Vedle se ukazuje vypočtené datum („→ 8. 12. 2026“).

### 4.4 Pole IČO + ARES
1. Uživatel zadá 8 číslic. Pole po zadání 8. číslice ověří kontrolní součet modulo 11 (váhy 8…2; zbytek 0 → 1, 1 → 0, jinak 11 − zbytek).
2. „Načíst z ARES“ (nebo Enter) zobrazí stav načítání s ostrou linkou a textem „Načítám údaje z ARES…“.
3. Úspěch: vyplní se název, DIČ, ulice, obec a PSČ. Pod polem se zobrazí zelená značka a text „Ověřeno v ARES 24. 11. 2026 · plátce DPH · Brno“.
4. Nenalezeno: „Subjekt s IČO … jsme v ARES nenašli. Vyplňte údaje ručně.“ Pole zůstanou editovatelná.
5. Produkce: REST `GET https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/{ico}`, cache 24 h. Plátcovství DPH, nespolehlivý plátce a zveřejněné účty se ověřují v registru plátců DPH (CRPDPH).

### 4.5 Tabulka
Bílý povrch v rámu `1px #0B1220`. Hlavička 14 / 600 podtržená předělem `1.5px`, řádky s linkou `#E5E7EB` a buňkou 16 × 24 px. Číslo dokladu je tučné, pod názvem odběratele je tlumeně IČO a pod splatností relativní údaj („za 4 dny“, „uhrazeno 20. 11.“, karmínově „18 dní po splatnosti“). Částky jsou zarovnané vpravo a tučné. Řazení se zobrazuje šipkou ↑ ↓ v hlavičce. Na úzkém displeji tabulka vodorovně scrolluje uvnitř rámu (min. 760 px), stránka nikdy.

### 4.6 KPI metrika
Popisek 14,5 / 600 (volitelně s karmínovou značkou 8 px), hodnota Archivo 44 / 700 s menším „Kč“, ostré měřidlo 8 px (stopa `#E5E7EB`, výplň inkoust, bez zaoblení) a metadata 13,5 tlumeně. Měřidlo vždy něco poměřuje a v metadatech je uvedeno co: měsíc proti minulému, podíl pohledávek nebo plnění ročního plánu. Metriky dělí svislé vlasové linky, nejsou to karty.

### 4.7 Graf
SVG s pevnou výškou 260 px a šířkou podle kontejneru (překresluje se při resize). Sloupce jsou ostré a inkoustové, bez zaoblení a přechodů. Mřížka `#E5E7EB` po 200 tis., základní linka 1,5 px inkoust a průměr jako čárkovaná inkoustová linka. Budoucí měsíc se kreslí jako čárkovaný obrys. Hover zvýrazní jeden sloupec (ostatní `#D1D5DB`) a velký údaj nad grafem ukáže měsíc, částku a počet faktur. Popisky os jsou 12 px `#6B7280` s `tabular-nums`.

### 4.8 Editorial poznámka (callout)
Svislá linka `2px #0B1220` vlevo, tučná hlavní věta (18 / 600) a pod ní vysvětlení (14 / 400, `#4B5563`). Hodí se pro odhad DPH, upozornění na splatnost nebo nespolehlivého plátce. Na jedné obrazovce je nejvýš jedna nebo dvě.

### 4.9 Filtry, hledání, toast
- **Filtry:** textové záložky s počtem, aktivní je tučná s podtržením 3 px, které dosedá na předěl `1.5px` lišty.
- **Hledání:** pole 320 px s lupou a nápovědou klávesy `/`. Hledá v čísle, odběrateli, IČO a částce. Prázdný stav: „Nic jsme nenašli“ a odkaz „Zrušit hledání“.
- **Toast:** inkoustový obdélník vlevo dole, radius 3 px, zmizí po 3 s, `role="status"`.

### 4.10 A4 doklad (náhled i PDF)
Poměr 210 : 297. Typografie se škáluje přes container query (`font-size: 1.58cqw`), takže náhled odpovídá tisku. Pořadí bloků:
1. Logo a název dodavatele vlevo, vpravo „Faktura — daňový doklad“ a velké číslo dokladu.
2. Předěl 1,5 px.
3. Dodavatel | Odběratel (název, adresa, IČO, DIČ; u neplátce „není plátce DPH“).
4. Pruh dat: datum vystavení · DUZP · datum splatnosti · forma úhrady.
5. Pruh platby: číslo účtu · IBAN · variabilní symbol · konstantní symbol.
6. Položky: označení, množství a MJ, cena / MJ, sazba DPH, cena bez DPH.
7. Dole vlevo QR Platba (SPAYD) se SWIFT, vpravo rekapitulace DPH podle sazeb, případné zaokrouhlení a **Celkem k úhradě** (Archivo 800).
8. Úvodní text s levou linkou.
9. Patička: zápis v obchodním rejstříku a kontakt.

Tisk (`@media print`) vytiskne pouze list A4 bez okrajů stránky.

---

## 5. Obrazovky

### 5.1 Přehled
```
eyebrow  Přehled · listopad 2026 · stav k 24. 11.
H1       Listopad: 465 910 Kč vyfakturováno.
         97 860 Kč je po splatnosti.
perex    Za 24 dní jste vystavili 12 faktur pro 8 odběratelů. Tři faktury …
CTA      [Vystavit fakturu]   Poslat upomínky (3)
──────────────────────────────────────────────────── 1.5px
KPI      Fakturováno tento měsíc │ Čeká na úhradu │ ■ Po splatnosti │ Letos celkem
         465 910 Kč ▬▬▬▬▬▬▬░    │ 214 380 Kč ▬▬▬░ │ 97 860 Kč ▬░░░  │ 4 049 260 Kč ▬▬▬▬▬░
5 : 7    Fakturace po měsících + callout DPH  │  SVG graf 260 px
         Poslední faktury ─ tabulka v rámu 1px
```

### 5.2 Faktury
Nadpis „Faktury“, vpravo „Export pro účetní (ISDOC)“ a CTA. Pod ním lišta filtrů a hledání na předělu 1,5 px, souhrnný řádek a tabulka. Akce v řádku podle stavu:

| Stav | Akce |
|---|---|
| Po splatnosti | **Upomenout** · PDF |
| Čeká na úhradu | Označit zaplacené · PDF |
| Koncept | **Dokončit** |
| Zaplaceno | PDF |
| Stornováno | — |

### 5.3 Nová faktura (editor a živý A4 náhled)
Hlavička: drobečky, H1 „Nová faktura 2026-0149“ a akce „Stáhnout PDF“ (odkaz), „Uložit koncept“ (outline) a **„Vystavit fakturu“** (primary).
Formulář má číslované sekce oddělené předělem 1,5 px (`01` tlumeně + Archivo 24):

1. **Odběratel:** IČO + „Načíst z ARES“, název, DIČ, ulice, obec, PSČ, e-mail.
2. **Doklad:** číslo, číselná řada, datum vystavení, DUZP, splatnost (segment a vypočtené datum).
3. **Platba:** forma úhrady, bankovní účet, VS (automaticky z čísla dokladu, dokud jej uživatel nepřepíše), KS, přepínač QR Platby, IBAN a ukázka řetězce SPAYD.
4. **Položky:** dvouřádková položka (popis, pod ním množství, MJ, cena / MJ bez DPH, sazba a součet), odebrání ×, „+ Přidat položku“. Rekapitulace podle sazeb, zaokrouhlení a „Celkem k úhradě“.
5. **Text na faktuře.**

Validace při vystavení: bez odběratele se faktura nevystaví. Pole IČO zčervená a hláška vysvětlí, co doplnit. Úspěšné vystavení přidá doklad do seznamu se stavem „Čeká na úhradu“ a připraví další číslo v řadě.

### 5.4 Design systém
Interní stránka v aplikaci se sekcemi 01–07 (barvy, typografie, mřížka a geometrie, tlačítka, štítky, pole, tabulka / KPI / callout). Každá sekce má rozvržení 4 : 8 s předělem 1,5 px.

---

## 6. Česká specifika

| Téma | Pravidlo v Manymy |
|---|---|
| **Náležitosti daňového dokladu** (§ 29 ZDPH) | označení a DIČ dodavatele i odběratele, evidenční číslo, rozsah plnění, datum vystavení, DUZP, jednotková cena bez DPH, základ, sazba a výše DPH. Editor nepustí vystavení, pokud něco chybí. |
| **DUZP** | Výchozí hodnota je datum vystavení. Doklad je nutné vystavit do 15 dnů od DUZP, jinak editor upozorní. |
| **Sazby DPH** | 21 % (základní), 12 % (snížená, od 2024), 0 % / osvobozeno. Rekapitulace se počítá po sazbách a DPH se zaokrouhluje na haléře. |
| **Přenesená daňová povinnost** | Přepínač v sekci Doklad. Na dokladu se zobrazí text „Daň odvede zákazník“ a DPH se nevyčísluje. |
| **Neplátce DPH** | U dodavatele se skryjí sloupce DPH a doklad se jmenuje „Faktura“ (ne „daňový doklad“). U odběratele se zobrazí „není plátce DPH“. |
| **Zaokrouhlení** | Celkovou částku lze volitelně zaokrouhlit na celé koruny (zvlášť řádek „Zaokrouhlení“); u hotovosti povinně. |
| **IČO** | 8 číslic, kontrolní součet modulo 11, načtení z ARES. |
| **DIČ** | `CZ` + 8–10 číslic. Plátcovství se ověřuje v registru plátců DPH a upozorní na nespolehlivého plátce. |
| **Číselné řady** | Maska `RRRR-NNNN` (např. 2026-0149). Samostatné řady pro zálohy (`Z-`) a opravné doklady (`D-`). |
| **Variabilní symbol** | Max. 10 číslic, výchozí hodnota jsou číslice čísla dokladu (2026-0149 → `20260149`). KS je volitelný (např. 0308). |
| **IBAN** | Počítá se z čísla účtu (předčíslí-číslo/kód banky) podle ISO 13616 (mod 97). |
| **QR Platba (SPAYD)** | Formát ČBA: `SPD*1.0*ACC:{IBAN}*AM:{částka}*CC:CZK*DT:{RRRRMMDD}*X-VS:{VS}*X-KS:{KS}*MSG:{zpráva}`. Zpráva je bez diakritiky a velkými písmeny. Kód ECC M, min. 2,5 × 2,5 cm, popisek „QR Platba“. V mockupu je QR stylizovaný (deterministický podle obsahu), v produkci se použije skutečný enkodér. |
| **Termíny DPH** | Přiznání i kontrolní hlášení do 25. dne následujícího měsíce. Připadne-li na víkend nebo svátek, termín se posouvá na další pracovní den (za listopad 2026: 28. 12. 2026). |
| **Formát** | `cs-CZ`: `1 234 567,89 Kč`, datum `24. 11. 2026`, nezlomitelné mezery mezi číslem a měnou a uvnitř data. |
| **Export** | ISDOC 6 (standard českých e-faktur), CSV, Pohoda XML. PDF/A-3 s přiloženým ISDOC. |

---

## 7. Přístupnost

- Kontrast textu min. 4,5 : 1 (`--muted` 4,8 : 1). `--subtle` se nepoužívá pro informační text.
- Stav nikdy nenese jen barva: štítky mají text, po splatnosti je i plný inkoust a údaj „N dní po splatnosti“.
- Viditelný fokus 2 px inkoust, celé ovládání klávesnicí (`/` hledání, Enter v poli IČO spustí ARES).
- Filtry a segmenty používají `aria-pressed`, řazení `aria-sort`, toast `role="status"`, graf `role="img"` s popisem.
- `prefers-reduced-motion` vypne animace.
- Cílová velikost interaktivních prvků je min. 34 px, v primárních akcích 44 px a víc.

---

## 8. Tón a mikrocopy

Věcně, česky, s čísly. Uživateli se vyká a mluví se k němu v činné větě.

| Místo | Ano | Ne |
|---|---|---|
| Úvod | „Tři faktury čekají déle, než by měly.“ | „Upozornění: Máte 3 položky ve stavu OVERDUE!“ |
| Chyba | „IČO nemá platný kontrolní součet. Zkontrolujte poslední číslici.“ | „Neplatný vstup.“ |
| Úspěch | „Faktura 2026-0149 na 68 512 Kč vystavena a odeslána na …“ | „Úspěšně uloženo!“ |
| Prázdný stav | „Nic jsme nenašli. Zrušit hledání“ | „Žádná data“ |

---

## 9. Soubory

- `design/DESIGN.md`: tento dokument.
- `design/mockup.html`: samostatný interaktivní návrh (HTML/CSS/JS bez knihoven; písma Archivo a Inter z Google Fonts se záložními systémovými písmy). Pohledy se přepínají přes hash (`#prehled`, `#faktury`, `#nova`, `#design`). Funkční je filtrování, hledání a řazení faktur, označení faktury jako zaplacené, simulace ARES s validací IČO, živý přepočet položek a DPH, výpočet IBAN a SPAYD, tisk A4 a vystavení faktury do seznamu. Všechna data jsou smyšlená.
