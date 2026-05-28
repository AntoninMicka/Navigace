# Plán implementace MIL-STD symbolů

## Fáze 1: Jádro značky (Základní geometrie a ikony)

- [ ] 1.1. Rámeček a výplň (Frame & Fill): Vykreslení základního tvaru podle afiliace (obdélník/přítel, kosočtverec/nepřítel, čtverec/neutrál, čtyřlístek/neznámý) a příslušné barevné výplně.

- [ ] 1.2. Hlavní ikona (A/AA): Vycentrování a vykreslení primárního symbolu jednotky/vybavení uvnitř rámečku.

- [ ] 1.3. Vnitřní modifikátory (B/C/D, AC): Přidání stavových indikátorů přímo do základního rámečku (např. grafika horního výřezu, indikátor zničené jednotky).

## Fáze 2: Systém kotevních bodů a layout

- [ ] 2.1. Definice mřížky: Nastavení relativních kotevních bodů (anchor points) kolem centrálního rámečku pro správné pozicování všech externích polí bez jejich vzájemného překryvu.

- [ ] 2.2. Ošetření textového rendereru: Příprava funkce pro vykreslování textu s "halo" efektem (kontrastní obrys), aby byly labely čitelné nad libovolným mapovým podkladem.

- [ ] 2.3. Level of Detail (LOD): Definování pravidel pro skrývání doplňkových textových polí na základě aktuálního přiblížení mapy, aby se mapa nezahltila.

## Fáze 3: Horní a spodní indikátory

- [ ] 3.1. Echelon a mobilita (AB): Vykreslení grafických značek velikosti jednotky (tečky, čárky, křížky) nad rámečkem, nebo znázornění způsobu pohybu pod rámečkem.

- [ ] 3.2. Speciální horní pole (AO): Textové nebo grafické označení nad echelonem (např. indikátor Task Force).

- [ ] 3.3. Spodní datová pole (R/AW, AL): Pozicování textových polí přímo pod značkou.

## Fáze 4: Levé a pravé textové bloky

- [ ] 4.1. Levý sloupec (AR/W, X/Y, V/AD/AE, C/T, Z): Nasazení textových hodnot zarovnaných doprava (těsně k rámečku). Sem patří např. datum/čas, množství, typ vybavení.

- [ ] 4.2. Pravý sloupec (F/AS, G, H/AF, M, J/K/P): Nasazení textových hodnot zarovnaných doleva (od rámečku). Typicky volací znaky, označení jednotky.

## Fáze 5: Dynamické prostorové prvky

- [x] 5.1. Vektor směru (Q): Vykreslení šipky směřující od značky s rotací podle směru pohybu a délkou indikující rychlost.

- [x] 5.2. Vodící čára k pozici (S, S2): Vykreslení čáry spojující značku s její skutečnou polohou v případě, že je značka kvůli přehlednosti nebo dekonflikci mapy posunuta.