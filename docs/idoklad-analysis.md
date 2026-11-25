# iDoklad · Analýza aplikace pro Manymi

Analýza vychází z průzkumu přihlášeného iDokladu dne 24. listopadu 2026. Popisuje obrazovky a dostupné ovládací prvky. Operace nad živými doklady, účtem a integracemi zůstaly bez provedení. Cesty jsou relativní vůči `https://app.idoklad.cz`.

## 1. Informační architektura

| Oblast | Podsekce a cesty |
| --- | --- |
| Přehledy | `/` |
| Adresář | Kontakty `/Contact`, Historie e-mailů `/MailHistory` |
| Prodej | Faktury vydané `/IssuedInvoice`, Zálohové faktury `/ProformaInvoice`, Daňové doklady k platbě `/IssuedTaxDocument`, Dobropisy a vrubopisy `/CreditNote`, Cenové nabídky `/SalesOrder`, Prodejky `/SalesReceipt`, Zaúčtování prodejek `/SalesReceiptAccounting`, Šablony `/IssuedDocumentTemplate`, Pravidelné faktury `/RecurringInvoice`, Úhrady `/IssuedInvoicePayment`, Přehled prodeje `/PriceListOverview` |
| Nákup | Faktury přijaté `/ReceivedInvoice`, Účtenky `/ReceivedReceipt`, Úhrady `/ReceivedInvoicePayment`, Inbox `/Inbox` |
| Ceník | Seznam položek ceníku `/PriceList`, Skladové pohyby `/StockMovement` |
| Finance a daně | Banka `/BankStatement`, Pokladna `/CashVoucher`, DPH `/VatDeclaration`, Daň z příjmů FO `/TaxDeclaration` |
| Nastavení | Předplatné `/Billing/MySubscription`, Firma `/Settings/Company`, Prodej `/Settings/Sales/Default`, Nákup `/Settings/Purchases/Default`, E-maily a komunikace `/Settings/Emails/Templates`, Banka `/Settings/Bank/Accounts`, Pokladna `/Settings/CashRegister/CashRegisters`, Aplikace `/Settings/System/Default`, Uživatelský účet `/Settings/User/Login` |

### Rychlé vytvoření

| Položka | Cesta |
| --- | --- |
| Faktura vydaná | `/IssuedInvoice/Create` |
| Zálohová faktura | `/ProformaInvoice/Create` |
| Cenová nabídka | `/SalesOrder/Create` |
| Prodejka | `/SalesReceipt/Create` |
| Šablona | `/IssuedDocumentTemplate/Create/0` |
| Pravidelná faktura | `/RecurringInvoice/Create` |
| Přijatá faktura | `/ReceivedInvoice/Create` |
| Účtenka | `/ReceivedReceipt/Create` |
| Kontakt v adresáři | `/Contact/Create` |
| Položka ceníku | `/PriceList/Create` |

V liště je zkratka na Přehledy, nabídka rychlého vytvoření, vstupy do oblastí, Nápověda, notifikace a odhlášení. Patička odkazuje na kontakt s podporou, ochranu soukromí, API a mobilní aplikace.

## 2. Prodej a fakturace

### Vydané faktury

Seznam má vyhledávání, filtr, nastavení seznamu, výběr záznamů a akce v řádku. Viditelné sloupce byly číslo dokladu, stav, popis, odběratel, datum vystavení, splatnost, cena bez DPH, cena s DPH a akce. Stav je samostatnou osou vedle splatnosti a částky. Rychlé pohledy jsou Všechny, Uhrazené, Neuhrazené a Po splatnosti. V rozšířeném filtru byly vidět také Uhrazené po splatnosti, Přeplacené a zahrnutí do přiznání k dani z příjmů. Řádek má přímé ikony pro úpravu, PDF, úhradu a další akce. Rozšířený filtr zahrnuje vystavení, splatnost, datum platby, DUZP a cenu. Rozbalené akce zahrnovaly Upravit, Odeslat, Exportovat do PDF, Tisk, Smazat, Upomínky, Kopírovat, Vystavit opravný doklad, Pravidelná faktura, Vazby a Smazat příznak exportu. Vystavení, odeslání, úhrada a případná oprava představují samostatné události. Samostatná akce Storno nebyla v otevřené nabídce vidět. Seznam obsahuje také ovládání exportu PDF, exportu a příznaku exportu. Úplný rozsah hromadných akcí po výběru záznamů zůstal neověřený.

### Editor vydané faktury

| Blok | Pole a ovládání |
| --- | --- |
| Hlavička | Předvyplněné číslo dokladu, výběr šablony (Bez šablony), řady (Výchozí), štítky, přepínač zahrnutí do přiznání k dani z příjmů FO. Záložky Doklad a Přílohy. Přílohy mají akci Načíst soubor a sloupce název, velikost, datum nahrání a akce. Limit zobrazený v editoru je pět příloh po nejvýše 2 MB. |
| Odběratel a popis | Povinný odběratel s vyhledáním podle názvu firmy nebo IČ a tlačítkem přidání kontaktu, číslo objednávky, povinný popis. |
| Datumy | Vystaveno, DUZP, splatnost. Datum vystavení a DUZP byly předvyplněné aktuálním dnem. Splatnost byla předvyplněná. |
| Moje platební údaje | Způsob úhrady (Převodem, Kartou, Hotově, Dobírka, Zápočtem, Zálohou, PayPal), výběr bankovního účtu, číslo a kód banky, IBAN, SWIFT, odkaz na úpravu účtu a přepínač Uhrazeno. |
| Rozšířené volby | Variabilní symbol předvyplněný dle čísla, konstantní symbol, měna (výchozí Kč, nabídka zahrnuje například EUR, USD, GBP a PLN), kód plnění pro přenesení daňové povinnosti, poznámka pro mě. Detaily se rozbalují samostatným tlačítkem. |
| Tisk a texty | Jazyk tiskové sestavy (v účtu předvyplněna angličtina), Vzhled tiskové sestavy, Text před položkami a Text za položkami. |
| Položka | Název, cena, množství, jednotka, typ ceny, celkem a akce. Výchozí řádek měl množství 1 a nulovou cenu. Typy ceny jsou S DPH, Bez DPH a Přenesená daňová povinnost. Pozorovaný typ ceny Bez DPH, sazba 21 % a členění DPH 01–02 vycházejí z otevřené konfigurace. |
| Přidávání | Nový řádek, Přidat položku z ceníku, Přidat odpočet zálohy. |
| Součty | Sleva na fakturu v procentech s výchozí nulou, cena bez DPH, DPH, zaokrouhlení, cena celkem. Výchozí pravidlo zaokrouhlení je samostatně v nastavení prodeje. |
| Konec formuláře | Zrušit, Uložit, Další akce s volbami Uložit jako šablonu, Odeslat a uložit, Vytisknout a uložit a Exportovat do PDF a uložit. |

Předvyplněné položky jsou pozorování konkrétního účtu. Export z editoru výslovně zahrnuje uložení. Žádný doklad ani tisk sestavy nebyl vytvořen.

### Ostatní prodejní moduly

- **Zálohové faktury** mají stejný základ seznamu jako vydané faktury. Konečná faktura má samostatnou akci přidání odpočtu zálohy.
- **Daňové doklady k přijaté platbě** mají vlastní seznam s vyhledáváním, filtrem a akcemi. V informační architektuře jsou oddělené od zálohových i konečných faktur.
- **Dobropisy a vrubopisy** jsou samostatná skupina s filtrem a nastavením seznamu pro opravné doklady.
- **Cenové nabídky** mají vlastní seznam a editor. Výchozí platnost nabídky se nastavuje odděleně od splatnosti faktur.
- **Prodejky** mají vlastní seznam a editor. **Zaúčtování prodejek** má samostatnou obrazovku s hledáním a filtrem.
- **Šablony** uvádějí název, typ dokladu, popis, odběratele a ceny bez DPH a s DPH. Editor faktury má volitelný výběr šablony přímo v hlavičce.
- **Pravidelné faktury** mají název vzoru, stav, popis, odběratele, periodicitu, poslední vystavení a ceny. Předpis a vystavené instance mají v navigaci samostatné seznamy.
- **Úhrady** mají seznam se samostatným vyhledáváním a filtrem. Prodejní a nákupní úhrady mají odlišné vstupní cesty.
- **Přehled prodeje** shrnuje název položky, prodané množství, jednotku a ceny bez DPH a s DPH. Obsahuje vyhledávání a filtr.

## 3. Nákup, ceník a finance

- **Přijaté faktury** mají stav, variabilní symbol, popis, dodavatele, datum přijetí a splatnosti a ceny bez DPH a s DPH. Seznam má hledání, filtr a nastavení seznamu.
- **Účtenky** mají samostatný editor a seznam. **Inbox** je vstup pro vytěžování. Nabízí načtení souboru, zobrazení e-mailového vstupu a nákup dalších vyčtení. Kvůli režimu čtení jsem soubor nenahrával ani nezobrazoval e-mailovou adresu.
- **Ceník** zobrazuje název položky, stav skladu, jednotku, cenu bez DPH a s DPH, typ ceny a sazbu DPH. Faktura dovoluje výběr ze seznamu položek. **Skladové pohyby** mají vlastní filtrovatelný seznam.
- **Banka** zobrazuje číslo pohybu, směr pohybu, variabilní symbol, partnera, datum, částku, název účtu, stav párování a akce. Způsob párování má vlastní konfiguraci v nastavení Banky.
- **Pokladna** má seznam s filtrem, nastavením zobrazení a oddělenými vstupy pro příjem a výdaj.
- **Daň z příjmů FO** vede seznam vygenerovaných podkladů s datem generování, rokem, způsobem uplatnění nákladů, příjmy, výdaji a daní. Tvorba podkladu je dostupná akcí Generovat nové. Vydaná faktura má vlastní přepínač zahrnutí do přiznání.

### Srovnání editorů dokladů

| Editor | Specifické údaje a volby |
| --- | --- |
| Zálohová faktura | Odběratel, objednávka, popis, vystavení, splatnost, platební údaje, položky, sazba a členění DPH, přílohy. |
| Cenová nabídka | Stav nabídky, číslo objednávky nebo smlouvy, vystavení a platnost do, položky a přílohy. |
| Prodejka | Odběratel, číslo z externí pokladny, popis, vystavení, prodejní terminál, způsob a částka úhrady. Lze přidat další řádek úhrady. |
| Šablona | Typ dokladu, řada, název, odběratel, objednávka, popis, splatnost ve dnech, platební údaje, položky a sleva. |
| Přijatá faktura | Dodavatel, variabilní symbol, číslo objednávky a externí číslo, popis, přijetí, vystavení, DUZP, splatnost, platební údaje dodavatele, položky a přílohy. |
| Účtenka | Dodavatel, externí číslo, popis, datum vystavení, způsob úhrady, položky a přílohy. |
| Ceníková položka | Název, katalogové číslo, EAN, prodejní množství a jednotka, cena, měna, sazba a typ ceny, ceny s daní a bez daně, členění DPH a sekce Evidence položky. |

### Pravidelné vystavování

Editor samostatně řeší typ faktury, řadu, název vzoru, odběratele, objednávku a popis. V části Opakování vystavení se volí periodicita, první vystavení, interval a způsob ukončení opakování. Tlačítko Přehled budoucích vystavení slouží ke kontrole plánu. V části Odesílání faktury jsou samostatné volby pro odběratele, kopii na vlastní e-mail, účetní a další příjemce kontaktu. Splatnost se udává ve dnech a DUZP má vlastní pravidlo. Platební údaje, položky a sleva jsou součástí vzoru.

### Adresář a komunikace

Kontakty mají seznam s vyhledáváním a akcemi. Úprava existujícího záznamu vede na `/Contact/Edit/{id}/Info`. Nový kontakt má záložky Základní údaje a Dodací adresy. V základním formuláři je stát, firma nebo jméno, IČ a DIČ, ulice, PSČ, město, hlavní a další e-maily, telefon, web a kontaktní osoba s titulem, jménem, příjmením a mobilem. Vyhledání české firmy nebo IČ je dostupné už při zakládání. Samostatné tlačítko rozbalí obchodní parametry (splatnost ve dnech a sleva), poznámku a bankovní údaje (číslo, kód banky, IBAN a SWIFT). Historie e-mailů je zvláštní obrazovka s filtrem a nastavením seznamu.

### Přehledy a daňové podklady

- **Fakturace za období** nabízí přepínání Měsíce, Kvartály a Roky. Další widgety jsou Bilance, Evidence DPH, Neuhrazené, Hledáte účetního? a Daňový kalendář. Evidence DPH zobrazuje tento a minulý měsíc. Neuhrazené srovnává faktury a závazky a nabízí Zobrazit podrobnosti. Hodnoty za období lze prohlížet po kartách. Nastavení úvodní stránky otevírá samostatný dialog s volbou Zrušit nebo Aplikovat a uložit.
- **DPH** má formulář Podklady pro DPH s typem výkazu, měsícem, rokem, hlavní činností a finančním úřadem. Typy výkazů jsou Přiznání k DPH, Kontrolní hlášení a Souhrnné hlášení. Umožňuje zobrazit seznam dokladů. Generování je spojené s uložením.
- **Daň z příjmů FO** zahrnuje také Historii podání.

## 4. Nastavení a předplatné

| Oblast | Záložky a pozorovaný obsah |
| --- | --- |
| Firma | Základní nastavení firmy, Účetní údaje, Logo a podpis, Správa firem, Správa uživatelů. Základ obsahuje legislativu, identitu a sídlo, kontakty a samostatné akce pro změnu údajů a e-mailu firmy. |
| Prodej | Výchozí nastavení, Vzhled a tisk dokladů, Číslování. Výchozí nastavení obsahuje typ ceny, DPH, zaokrouhlení, způsob úhrady, splatnost, platnost cenové nabídky a konstantní symbol. |
| Nákup | Výchozí nastavení, Číslování a Inbox. Základ obsahuje typ ceny, DPH a způsob úhrady pro přijaté faktury. |
| Banka | Bankovní účty, Párování bankovních pohybů a Číslování. Eviduje výchozí účet, název, měnu, číslo, banku, IBAN, SWIFT a počáteční stav. |
| Pokladna | Pokladny, Prodejní terminály, Vzhled a tisk dokladů a Číslování. Pokladna má název, měnu, počáteční stav a volbu výchozí pokladny. |
| Aplikace | Obecné nastavení, Export, Import, Štítky, API, GDPR a Koš. Základ obsahuje tmavý mód, podbarvení lišty, notifikace, počet desetinných míst pro množství a jednotkovou cenu a jazyk. Patička obsahuje odkaz `/developer`. |
| Uživatelský účet | Přihlašovací údaje a Osobní údaje. Přihlašovací údaje mají samostatné akce pro změnu e-mailu, změnu hesla a zapnutí dvoufázového ověření. |
| Předplatné | Moje předplatné, historie předplatného a objednávek, výběr předplatných, doplňky, časté otázky a detailní porovnání. V nabídce jsou Základní, Oblíbený a Prémiový s roční, kvartální nebo měsíční periodou. Porovnání ukazuje také Tarif Zdarma. Doplňkem jsou další vyčtení. |

### Cesty podzáložek

| Oblast | Ověřené podcesty |
| --- | --- |
| Firma | `/Settings/Company/Accounting`, `/Settings/Company/Logo`, `/Settings/Company/Administration`, `/Settings/Company/UserList` |
| Prodej | `/Settings/Sales/Report`, `/Settings/Sales/NumericSequence` |
| Nákup | `/Settings/Purchases/NumericSequence`, `/Settings/Purchases/Inbox` |
| E-maily a komunikace | `/Settings/Emails/Templates`, `/Settings/Emails/EmailServer` |
| Banka | `/Settings/Bank/Pairing`, `/Settings/Bank/NumericSequence` |
| Pokladna | `/Settings/CashRegister/SalesPosEquipments`, `/Settings/CashRegister/Report`, `/Settings/CashRegister/NumericSequence` |
| Aplikace | `/Settings/System/Export`, `/Settings/System/Import`, `/Settings/System/Tags`, `/Settings/System/Api`, `/Settings/System/GDPR` |
| Uživatelský účet | `/Settings/User/Detail` |

- **Účetní údaje** mají typ plátce, zdaňovací období, DIČ, kód plnění, členění DPH, typ subjektu a spisovou značku. Logo a podpis se načítají samostatně. Správa firem nabízí založení a vstup do smazání. Správa uživatelů zobrazuje stav, kontaktní údaje, dvoufázové ověření a typ přístupu.
- **Vzhled a tisk** pro prodej má obecné a typové nastavení, text před a za položkami, jazyk a formát názvu PDF. Pokladní doklad má vlastní vzhled a jazyk. Prodejní terminály mají vazbu na pokladnu a údaj o spárování přes PIN.
- **E-maily** mají šablony pro vydanou fakturu, zálohu, daňový doklad, dobropis, nabídku a prodejku. Vedle nich je komunikace s účetní, šablona upomínky a šablona poděkování za úhradu. Upomínky a poděkování mohou mít samostatně zapnuté automatické zasílání. Jednotlivá faktura nabízí ruční vstup do upomínek. Poštovní server nabízí interní server iDokladu, Exchange, Gmail nebo vlastní SMTP.
- **Bankovní párování** má vyhrazenou kartu a pole Bankovní e-mail. Samotný bankovní seznam ukazuje, které pohyby jsou spárované. Nabídka řádku obsahovala Párovat vedle úpravy, PDF, tisku a kopie. Pravidla automatického přiřazení a chování při více shodách zůstaly neověřené.
- **Export** má výběr programu, období a skupin dokladů. Na obrazovce byla Pohoda a mimo jiné skupiny vydaných, zálohových a přijatých faktur, opravných dokladů, prodejek, pokladních a daňových dokladů. **Import** nabízí Pohodu a SuperFakturu.
- **Předání účetní** má dvě místa v produktu. Komunikační nastavení uchovává účetní kontakt, pravidelná faktura umožňuje zahrnout účetní mezi adresáty. Účetní export se připravuje výběrem programu, období a skupin dokladů.
- **API** ukazuje kvótu volání, správu klientských klíčů a přehled připojených aplikací s vytvořením a expirací. Hodnoty klíčů v dokumentaci nejsou. **GDPR** popisuje uložení a zabezpečení údajů. E-shopový konektor nebyl v těchto kartách samostatně zobrazen.

## Datový model pro Manymi

| Entita | Obsah a relace |
| --- | --- |
| Firma a členství | Firma vlastní doklady, kontakty, číselné řady, katalog, peněžní účty a konfiguraci. Členství spojuje uživatele s firmou a oprávněním. |
| Kontakt a otisk protistrany | Kontakt eviduje identitu, adresy, komunikační a obchodní výchozí údaje. Vystavený doklad má vlastní otisk dodavatele a odběratele, aby pozdější změna kontaktu neměnila jeho obsah. |
| Doklad | Společná hlavička typu dokladu obsahuje číslo a řadu, protistrany, data, měnu, kurz, způsob úhrady, daňový režim, texty a součty. Druh dokladu určuje přípustné akce a vazby. |
| Položka dokladu | Název, popis, množství, jednotka, jednotková cena, sleva, sazba, základ, daň a součet. Vazba na katalog je volitelná. Cenové a daňové údaje položky zůstávají v dokladu historicky zachované. |
| Vazba dokladů | Typované relace pro převod nabídky na fakturu, vyúčtování zálohy, daňový doklad k platbě a opravu původního dokladu. Pravidelná faktura uchovává předpis generování a vazbu na vystavené instance. |
| Úhrada a alokace | Úhrada obsahuje částku, datum, měnu a zdroj. Alokace přiřazuje část úhrady k dokladu a dovoluje částečné úhrady i rozdělení jedné platby. Stav splatnosti lze odvodit ze zůstatku a data splatnosti. |
| Bankovní pohyb a pokladní doklad | Bankovní pohyb má peněžní účet, identitu dle zdroje, částku, datum a párovací symboly. Pokladní doklad má směr a pokladnu. Vazba na úhradu umožňuje dohledat původ přiřazení. |
| Katalog a skladový pohyb | Katalogová položka nese prodejní údaje. Skladový pohyb je příjem či výdej s množstvím a případným zdrojovým dokladem. Skladový stav lze odvodit z pohybů. |
| Komunikace a přílohy | Příloha má typ, bezpečně uložený soubor a vazbu k dokladu. Událost komunikace zaznamená typ, čas, příslušný doklad, adresáta a výsledek doručení. |
| Export a audit | Export eviduje typ, období nebo vybrané doklady a výsledek. Auditní události zachytí vystavení, změny, odeslání, úhrady a opravy. |

Pro Manymi je vhodné udržovat oddělený stav vystavení, doručení a vypořádání dokladu. Číslo rezervovat transakčně, částky počítat v desetinné aritmetice a opakované importy nebo generování chránit klíčem idempotence.

| Fáze | Rozsah |
| --- | --- |
| MVP (v1) | Firma, kontakty, základní katalog, vydané faktury, číselná řada, položky, základní DPH v podporovaných režimech, PDF a QR pro podporované platby. Seznam s vyhledáváním, stavem a splatností, ruční částečná či plná úhrada, historie vystavení a jednoduché předání účetní. |
| v2 | Nabídky, zálohy a jejich vyúčtování, opravy, pravidelná fakturace a upomínky, nákupní doklady a přílohy, cizí měny, role, účetní export, bankovní import a asistované párování. |
| Pokročilé / později | Živá bankovní napojení a automatické párování s kontrolou výjimek, OCR a Inbox, pokladny a skladové pohyby, zaúčtování prodejek, pokročilé daňové sestavy, API a ekosystém integrací. |

## Rozsah ověření

Průzkum pokryl hlavní navigaci, dostupné seznamy, nové formuláře z rychlé nabídky, kartu příloh, filtr a nabídku vydaných faktur, účetní podklady a podzáložky nastavení. Pro Manymi jsou nejdůležitější vztahy mezi doklady, oddělené evidence úhrad a opakovaných předpisů a možnost nastavit výchozí hodnoty na úrovni firmy a kontaktu.

Některé seznamy byly prázdné, včetně prodejek, účtenek a pokladních dokladů. U nich bylo možné ověřit vstupy a prázdný stav. Přesný tarifní nárok jednotlivých funkcí, samostatný e-shopový konektor, ISDOC, podmínky zobrazení QR platby a některé větve měnových a daňových režimů zůstaly neověřené. Stejně tak zůstává otevřený úplný katalog stavů, pravidla automatického párování, intervaly upomínek a výsledek skutečných exportů či odeslání. V produkčním účtu nebyly provedeny žádné zápisové akce.
