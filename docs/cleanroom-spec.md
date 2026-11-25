# Manymi — Clean-Room funkční specifikace

> Zpracováno na základě pasivní analýzy (REA `inspect-web-network-capture` nad dočasným HAR záznamem, který byl po extrakci abstraktních schémat odstraněn) a funkčního průzkumu [`idoklad-analysis.md`](./idoklad-analysis.md). Obsahuje pouze doménová pravidla pro čistou implementaci **Manymi** bez kopírování cizího kódu či API kontraktů.

## 1. Zásadní doménové principy z analýzy

1. **Oddělení životního cyklu dokladu a stavu úhrady**
   - Doklad má vlastní stav: `draft` (koncept), `issued` (vystaveno), `cancelled` (stornováno).
   - Stav úhrady (`sent`, `partial`, `overdue`, `paid`) se dynamicky odvozuje z `paidMinor`, `totalMinor`, `dueDate` a aktuálního data.
2. **Neměnné otisky protistran a banky na dokladu**
   - Každá faktura si při uložení/vystavení uloží snapshot dodavatele, odběratele a bankovního účtu. Pozdější změna v Nastavení nebo Adresáři historický doklad nezmění.
3. **Položky, slevy a daňové režimy**
   - Položka nese popis, množství (tisíciny MJ), jednotku, jednotkovou cenu bez DPH (haléře) a sazbu DPH (`21 %`, `12 %`, `0 %`).
   - Celková sleva na fakturu (`discountPercent`, 0–100 %) se aplikuje rovnoměrně na základ před výpočtem DPH po sazbách.
   - Daňové režimy: `standard` (plátce DPH), `reverse_charge` (přenesená daňová povinnost — „Daň odvede zákazník“), `non_vat` (neplátce DPH — „Faktura“ bez vyčíslení DPH).
   - Volitelné zaokrouhlení celkové částky na celé koruny (samostatný řádek `Zaokrouhlení`).
4. **Číselné řady a platební údaje**
   - Číselná řada `(companyId, docType, prefix, year)` transakčně inkrementuje pořadové číslo při vystavení dokladu.
   - Variabilní symbol se automaticky odvozuje z číslic čísla faktury (max. 10 znaků), uživatel jej může přepsat.
   - Z českého čísla účtu (`[předčíslí-]číslo/kód`) se deterministicky počítá IBAN (ISO 13616) a validní řetězec SPAYD 1.0 pro QR Platbu (ECC M).
5. **Úhrady a alokace**
   - Evidence plateb je oddělená od dokladů přes `payments` + `payment_allocations`, což nativně podporuje částečné i plné úhrady.
6. **Multi-company a autentizace**
   - Autentizaci zajišťuje **Clerk** (`@clerk/nextjs`), jeden uživatel může spravovat více firem s okamžitým přepínáním v kontextové liště.
7. **Explicitně vyřazeno**
   - Aplikace **negeneruje daňová přiznání** (ani přiznání k DPH, kontrolní hlášení či daň z příjmů FO). Zaměřuje se na vystavování faktur, přehled tržeb/pohledávek, úhrady a PDF/QR doklady.
