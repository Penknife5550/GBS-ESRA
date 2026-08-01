/**
 * Gegenprobe für die Leistungs-Kernlogik (DB-frei): erlaubte Ergebnisse und die
 * Prüfung/Normalisierung einer Bewertungseingabe (Ergebnis + optionale Punkte +
 * optionale Note).
 *
 * ACHTUNG beim Erweitern: Eine Prüfung beweist erst dann etwas, wenn sie ROT
 * wird, sobald man die geprüfte Regel entfernt. Auf den konkreten Wert prüfen,
 * nie auf die Anzahl.
 */

import {
  ergebnisName,
  giltAlsBestanden,
  istErgebnisErlaubt,
  noteNormalisiert,
  NOTE_MAX_LAENGE,
  pruefeLeistung,
  punkteGueltig,
  PUNKTE_MAX,
} from "../src/lib/leistung";

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

console.log("\n1. Erlaubte Ergebnisse");
pruefe("TEILGENOMMEN ist erlaubt", istErgebnisErlaubt("TEILGENOMMEN") === true);
pruefe("ERFOLGREICH_TEILGENOMMEN ist erlaubt", istErgebnisErlaubt("ERFOLGREICH_TEILGENOMMEN") === true);
pruefe("BESTANDEN ist erlaubt", istErgebnisErlaubt("BESTANDEN") === true);
pruefe("NICHT_BESTANDEN ist erlaubt", istErgebnisErlaubt("NICHT_BESTANDEN") === true);
pruefe("ANWESEND ist KEIN Leistungsergebnis", istErgebnisErlaubt("ANWESEND") === false);
pruefe("Leerstring ist nicht erlaubt", istErgebnisErlaubt("") === false);

console.log("\n2. Klartext");
pruefe("Klartext: TEILGENOMMEN → teilgenommen", ergebnisName("TEILGENOMMEN") === "teilgenommen");
pruefe("Klartext: BESTANDEN → bestanden", ergebnisName("BESTANDEN") === "bestanden");
pruefe("Klartext: NICHT_BESTANDEN → nicht bestanden", ergebnisName("NICHT_BESTANDEN") === "nicht bestanden");
pruefe("Klartext: fehlendes Ergebnis → —", ergebnisName(null) === "—");
pruefe("Klartext: unbekannter Wert → — (Default)", ergebnisName("TANZEN") === "—");

console.log("\n3. Punkte-Gültigkeit");
pruefe("0 Punkte sind gültig (untere Grenze)", punkteGueltig(0) === true);
pruefe("100 Punkte sind gültig (obere Grenze)", punkteGueltig(PUNKTE_MAX) === true);
pruefe("-1 Punkt ist ungültig", punkteGueltig(-1) === false);
pruefe("101 Punkte sind ungültig", punkteGueltig(101) === false);
pruefe("Kommazahl ist ungültig (nur ganzzahlig)", punkteGueltig(12.5) === false);

console.log("\n4. Notenangabe normalisieren");
pruefe("Leerstring wird zu null", noteNormalisiert("") === null);
pruefe("nur Leerzeichen werden zu null", noteNormalisiert("   ") === null);
pruefe("undefined bleibt null", noteNormalisiert(undefined) === null);
pruefe("umschließende Leerzeichen werden getrimmt", noteNormalisiert("  gut  ") === "gut");

console.log("\n5. Bewertungseingabe prüfen und normalisieren");
{
  const r = pruefeLeistung({ ergebnis: "BESTANDEN", punkte: 87, note: " 1,7 " });
  pruefe("gültige Eingabe: ergebnis übernommen", "wert" in r && r.wert.ergebnis === "BESTANDEN", r);
  pruefe("gültige Eingabe: Punkte übernommen", "wert" in r && r.wert.punkte === 87, r);
  pruefe("gültige Eingabe: Note getrimmt", "wert" in r && r.wert.note === "1,7", r);
}
{
  const r = pruefeLeistung({ ergebnis: "TEILGENOMMEN" });
  pruefe("ohne Punkte/Note: Punkte null", "wert" in r && r.wert.punkte === null, r);
  pruefe("ohne Punkte/Note: Note null", "wert" in r && r.wert.note === null, r);
}
{
  // Falsy-Zero: 0 ist ein gültiger Punktwert und darf NICHT zu null werden.
  const r = pruefeLeistung({ ergebnis: "BESTANDEN", punkte: 0 });
  pruefe("0 Punkte bleiben erhalten (nicht null)", "wert" in r && r.wert.punkte === 0, r);
}
{
  // Obere Notengrenze: genau NOTE_MAX_LAENGE Zeichen werden akzeptiert (Off-by-one).
  const r = pruefeLeistung({ ergebnis: "BESTANDEN", note: "x".repeat(NOTE_MAX_LAENGE) });
  pruefe("Note mit genau der Maximallänge ist gültig", "wert" in r && r.wert.note?.length === NOTE_MAX_LAENGE, r);
}
{
  const r = pruefeLeistung({ ergebnis: "TANZEN" });
  pruefe("ungültiges Ergebnis → fehler ergebnis", "fehler" in r && r.fehler === "ergebnis", r);
}
{
  const r = pruefeLeistung({ ergebnis: "BESTANDEN", punkte: 200 });
  pruefe("Punkte außerhalb der Grenze → fehler punkte", "fehler" in r && r.fehler === "punkte", r);
}
{
  const r = pruefeLeistung({ ergebnis: "BESTANDEN", note: "x".repeat(NOTE_MAX_LAENGE + 1) });
  pruefe("zu lange Note → fehler note", "fehler" in r && r.fehler === "note", r);
}
{
  const r = pruefeLeistung({ ergebnis: "BESTANDEN", punkte: null, note: null });
  pruefe("explizit null bei Punkte/Note ist gültig", "wert" in r && r.wert.punkte === null && r.wert.note === null, r);
}

console.log("\n6. Was als bestanden zählt (Personen-Liste: X/Y bestanden)");
pruefe("BESTANDEN gilt als bestanden", giltAlsBestanden("BESTANDEN") === true);
pruefe("ERFOLGREICH_TEILGENOMMEN gilt als bestanden", giltAlsBestanden("ERFOLGREICH_TEILGENOMMEN") === true);
pruefe("TEILGENOMMEN gilt NICHT als bestanden", giltAlsBestanden("TEILGENOMMEN") === false);
pruefe("NICHT_BESTANDEN gilt NICHT als bestanden", giltAlsBestanden("NICHT_BESTANDEN") === false);
pruefe("fehlendes Ergebnis gilt NICHT als bestanden", giltAlsBestanden(null) === false);

// Soll-Anzahl: fängt lautlos entfallene Prüfungen ab. Beim Ergänzen anheben.
const ERWARTET = 37;
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);
