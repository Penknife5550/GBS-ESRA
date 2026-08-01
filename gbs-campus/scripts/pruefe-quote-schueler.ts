/**
 * Gegenprobe für die Schüler-Quote (Modell A, DB-frei): die eigene
 * Anwesenheitsquote über ALLE Abende des Semesters mit den drei Zuständen
 * ERFUELLT / OFFEN / NICHT_ERREICHBAR und dem Fehl-Budget `darfNochFehlen`.
 *
 * ACHTUNG beim Erweitern: Eine Prüfung beweist erst dann etwas, wenn sie ROT
 * wird, sobald man die geprüfte Regel entfernt. Auf den konkreten Wert prüfen,
 * nie auf die Anzahl.
 */

import {
  abendWort,
  istQuoteDringend,
  quoteAusVergangenen,
  quoteErfuellt,
  quoteHinweis,
  quoteModellA,
  zaehltAlsVersaeumt,
} from "../src/lib/stundenplan";

let geprueft = 0;
let fehlgeschlagen = 0;

function pruefe(bezeichnung: string, bedingung: boolean, zusatz?: unknown) {
  geprueft++;
  if (bedingung) {
    console.log(`  ok    ${bezeichnung}`);
  } else {
    fehlgeschlagen++;
    console.log(`  FEHLT ${bezeichnung}`);
    if (zusatz !== undefined) console.log("        ", JSON.stringify(zusatz));
  }
}

console.log("\n1. Ohne Abende");
{
  const q = quoteModellA(0, 0, 0, 80);
  pruefe("gesamt 0 gilt als erfüllt", q.zustand === "ERFUELLT", q);
  pruefe("gesamt 0 zeigt 100 %", q.prozent === 100, q);
  pruefe("gesamt 0 verlangt nichts", q.benoetigt === 0, q);
}

console.log("\n2. Nötige Teilnahmen (ganzzahlige Schwelle)");
pruefe("20 Abende, 80 % → nötig 16", quoteModellA(20, 0, 0, 80).benoetigt === 16, quoteModellA(20, 0, 0, 80));
pruefe("5 Abende, 80 % → nötig 4", quoteModellA(5, 0, 0, 80).benoetigt === 4);
pruefe("4 Abende, 80 % → nötig 4 (3,2 aufgerundet)", quoteModellA(4, 0, 0, 80).benoetigt === 4);
pruefe("Schwelle wird zur Anzeige durchgereicht", quoteModellA(20, 0, 0, 80).schwelleProzent === 80);

console.log("\n3. Sicher erfüllt (nicht mehr verlierbar)");
{
  // 16 von 20 bereits teilgenommen — Schwelle steht, egal was mit den 4 offenen passiert.
  const q = quoteModellA(20, 16, 0, 80);
  pruefe("teilgenommen == nötig → ERFUELLT", q.zustand === "ERFUELLT", q);
  pruefe("erfüllt trotz 4 offener Abende", q.offen === 4 && q.zustand === "ERFUELLT", q);
}
pruefe("4 von 5 (genau 80 %) → ERFUELLT", quoteModellA(5, 4, 0, 80).zustand === "ERFUELLT");
pruefe("3 von 5 mit 2 versäumt → NICHT_ERREICHBAR", quoteModellA(5, 3, 2, 80).zustand === "NICHT_ERREICHBAR");

console.log("\n4. Noch offen (erreichbar, nicht gesichert)");
{
  const q = quoteModellA(20, 9, 0, 80);
  pruefe("9 von 20, nichts versäumt → OFFEN", q.zustand === "OFFEN", q);
  pruefe("darf noch 4 fehlen", q.darfNochFehlen === 4, q);
  pruefe("11 Abende offen", q.offen === 11, q);
  pruefe("Prozent 45 (9/20)", q.prozent === 45, q);
}
{
  // Fehl-Budget schrumpft mit jedem versäumten Abend.
  const q = quoteModellA(20, 8, 2, 80);
  pruefe("2 versäumt → darf noch 2 fehlen", q.darfNochFehlen === 2, q);
  pruefe("noch OFFEN", q.zustand === "OFFEN", q);
}

console.log("\n5. Unerfasste vergangene Abende bleiben offen");
{
  // 10 Abende, 2 als anwesend erfasst, 0 versäumt — die anderen 8 sind
  // künftig ODER vergangen-aber-noch-nicht-erfasst: dürfen die Quote NICHT senken.
  const q = quoteModellA(10, 2, 0, 80);
  pruefe("unerfasst zählt weder als versäumt …", q.versaeumt === 0, q);
  pruefe("… noch drückt es unter erreichbar", q.zustand === "OFFEN", q);
  pruefe("darf noch 2 fehlen (nicht 0)", q.darfNochFehlen === 2, q);
}

console.log("\n6. Nicht mehr erreichbar");
{
  // 20 Abende, Schwelle 80 % → nur 4 Fehltage erlaubt. 5 versäumt = vorbei.
  const q = quoteModellA(20, 3, 5, 80);
  pruefe("5 versäumt bei 4 erlaubten → NICHT_ERREICHBAR", q.zustand === "NICHT_ERREICHBAR", q);
  pruefe("Fehl-Budget ist negativ", q.darfNochFehlen === -1, q);
}
pruefe("genau erlaubte Fehlzahl (4 versäumt) ist noch OFFEN", quoteModellA(20, 3, 4, 80).zustand === "OFFEN", quoteModellA(20, 3, 4, 80));
pruefe("bei ausgeschöpftem Budget ist darfNochFehlen 0", quoteModellA(20, 3, 4, 80).darfNochFehlen === 0);
pruefe("einer zu viel (5 versäumt) kippt auf NICHT_ERREICHBAR", quoteModellA(20, 3, 5, 80).zustand === "NICHT_ERREICHBAR");

console.log("\n7. Konfigurierbare Schwelle — Extreme");
pruefe("Schwelle 0 % → immer ERFUELLT (benötigt 0)", quoteModellA(10, 0, 5, 0).zustand === "ERFUELLT", quoteModellA(10, 0, 5, 0));
pruefe("Schwelle 100 % → nötig = alle Abende", quoteModellA(10, 0, 0, 100).benoetigt === 10);
pruefe("Schwelle 100 %: ein Fehltag macht es unerreichbar", quoteModellA(10, 0, 1, 100).zustand === "NICHT_ERREICHBAR");

console.log("\n8. Prozent wird gerundet");
pruefe("5 von 6 → 83 % (gerundet, nicht abgeschnitten)", quoteModellA(6, 5, 0, 80).prozent === 83, quoteModellA(6, 5, 0, 80));

console.log("\n9. Ableitung Status → Zahl (quoteAusVergangenen)");
pruefe("GEFEHLT zählt als versäumt", zaehltAlsVersaeumt("GEFEHLT") === true);
pruefe("ENTSCHULDIGT zählt als versäumt", zaehltAlsVersaeumt("ENTSCHULDIGT") === true);
pruefe("ANWESEND zählt NICHT als versäumt", zaehltAlsVersaeumt("ANWESEND") === false);
pruefe("fehlender Status zählt NICHT als versäumt", zaehltAlsVersaeumt(null) === false);
{
  // Fünf vergangene Abende (anwesend, nachgearbeitet, gefehlt, entschuldigt, unerfasst)
  // bei 10 Abenden gesamt → teilgenommen 2, versäumt 2, offen 6 (inkl. der 5 künftigen).
  const q = quoteAusVergangenen(["ANWESEND", "NACHGEARBEITET", "GEFEHLT", "ENTSCHULDIGT", null], 10, 80);
  pruefe("anwesend + nachgearbeitet → teilgenommen 2", q.teilgenommen === 2, q);
  pruefe("gefehlt + entschuldigt → versäumt 2", q.versaeumt === 2, q);
  pruefe("unerfasster Abend zählt NICHT als versäumt (bleibt offen)", q.versaeumt === 2 && q.offen === 6, q);
}

console.log("\n10. Quote-Klartext: Wortlaut & Dringlichkeit (die Aussage an den Schüler)");
pruefe("abendWort(1) → Abend (Singular)", abendWort(1) === "Abend");
pruefe("abendWort(2) → Abende (Plural)", abendWort(2) === "Abende");
pruefe("Hinweis ERFUELLT nennt „gesichert“", quoteHinweis(quoteModellA(5, 4, 0, 80)).includes("gesichert"));
pruefe("Hinweis NICHT_ERREICHBAR nennt „nicht mehr erreichbar“", quoteHinweis(quoteModellA(20, 3, 5, 80)).includes("nicht mehr erreichbar"));
pruefe(
  "Hinweis ohne Puffer: kein Abend mehr",
  quoteHinweis(quoteModellA(20, 3, 4, 80)) === "Achtung: Es darf kein Abend mehr fehlen, sonst reißt die Grenze.",
  quoteHinweis(quoteModellA(20, 3, 4, 80)),
);
pruefe(
  "Hinweis bei 1 Puffer: Singular „1 Abend“",
  quoteHinweis(quoteModellA(20, 8, 3, 80)) === "Es dürfen noch 1 Abend fehlen.",
  quoteHinweis(quoteModellA(20, 8, 3, 80)),
);
pruefe(
  "Hinweis bei 2 Puffer: Plural „2 Abende“",
  quoteHinweis(quoteModellA(20, 8, 2, 80)) === "Es dürfen noch 2 Abende fehlen.",
  quoteHinweis(quoteModellA(20, 8, 2, 80)),
);
pruefe("dringend: NICHT_ERREICHBAR", istQuoteDringend(quoteModellA(20, 3, 5, 80)) === true);
pruefe("dringend: OFFEN ohne Puffer (0)", istQuoteDringend(quoteModellA(20, 3, 4, 80)) === true);
pruefe("nicht dringend: OFFEN mit Puffer", istQuoteDringend(quoteModellA(20, 8, 2, 80)) === false);
pruefe("nicht dringend: ERFUELLT", istQuoteDringend(quoteModellA(5, 4, 0, 80)) === false);
pruefe("quoteErfuellt: 4 von 5 bei 80 %", quoteErfuellt(4, 5, 80) === true);
pruefe("quoteErfuellt: 3 von 4 bei 80 % (75 %)", quoteErfuellt(3, 4, 80) === false);
pruefe("quoteErfuellt: ohne Abende gilt als erfüllt", quoteErfuellt(0, 0, 80) === true);

// Soll-Anzahl: fängt lautlos entfallene Prüfungen ab. Beim Ergänzen anheben.
const ERWARTET = 51;
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);
