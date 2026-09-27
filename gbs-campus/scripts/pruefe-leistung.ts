/**
 * Gegenprobe für die Leistungs-Kernlogik (DB-frei): erlaubte Ergebnisse und die
 * Prüfung/Normalisierung einer Bewertungseingabe (Ergebnis + optionale Punkte +
 * optionale Note), das Zod-Schema der Noten-Routen und — im Quelltext —, dass
 * die Oberfläche diese Regeln nutzt statt eigener Kopien.
 *
 * ACHTUNG beim Erweitern: Eine Prüfung beweist erst dann etwas, wenn sie ROT
 * wird, sobald man die geprüfte Regel entfernt. Auf den konkreten Wert prüfen,
 * nie auf die Anzahl.
 */

import { readFileSync } from "fs";
import {
  BESTANDEN_ERGEBNISSE,
  ERGEBNIS_OPTIONEN,
  ergebnisName,
  giltAlsBestanden,
  istErgebnisErlaubt,
  LEISTUNG_ERGEBNISSE,
  noteNormalisiert,
  NOTE_MAX_LAENGE,
  pruefeLeistung,
  pruefeNotenZiele,
  punkteGueltig,
  PUNKTE_MAX,
  wirdBenotet,
  type NotenZiel,
} from "../src/lib/leistung";
import { leistungEintragSchema } from "../src/lib/leistung-schema";

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
pruefe(
  "BESTANDEN_ERGEBNISSE ist eine Teilmenge der erlaubten Ergebnisse",
  BESTANDEN_ERGEBNISSE.every((e) => istErgebnisErlaubt(e)),
  BESTANDEN_ERGEBNISSE,
);
pruefe(
  "jedes erlaubte Ergebnis: giltAlsBestanden stimmt mit BESTANDEN_ERGEBNISSE überein",
  LEISTUNG_ERGEBNISSE.every((e) => giltAlsBestanden(e) === (BESTANDEN_ERGEBNISSE as readonly string[]).includes(e)),
  LEISTUNG_ERGEBNISSE.map((e) => [e, giltAlsBestanden(e)]),
);

console.log("\n7. Wer benotet wird — Hörer und Abgemeldete nicht");
pruefe("Schüler werden benotet", wirdBenotet("SCHUELER") === true);
pruefe("Hörer werden nicht benotet (Bauregel: fallen aus jeder Prüfungsautomatik)", wirdBenotet("HOERER") === false);
{
  const ziele: NotenZiel[] = [
    { id: "schueler", teilnahmeform: "SCHUELER", abgemeldetAm: null },
    { id: "hoerer", teilnahmeform: "HOERER", abgemeldetAm: null },
    { id: "raus", teilnahmeform: "SCHUELER", abgemeldetAm: new Date() },
  ];
  const nurSchueler = pruefeNotenZiele(["schueler"], ziele);
  pruefe("ein zählender Schüler ist gültig", "gueltig" in nurSchueler && nurSchueler.gueltig.has("schueler"), nurSchueler);
  const mitFremd = pruefeNotenZiele(["schueler", "fremd"], ziele);
  pruefe(
    "eine semesterfremde Teilnahme wird still übersprungen (Whitelist)",
    "gueltig" in mitFremd && mitFremd.gueltig.size === 1 && !mitFremd.gueltig.has("fremd"),
    mitFremd,
  );
  const hoerer = pruefeNotenZiele(["schueler", "hoerer"], ziele);
  pruefe("ein Hörer im Batch lehnt die ganze Erfassung ab (fehler hoerer)", "fehler" in hoerer && hoerer.fehler === "hoerer", hoerer);
  const raus = pruefeNotenZiele(["raus"], ziele);
  pruefe("eine abgemeldete Teilnahme lehnt die Erfassung ab (fehler abgemeldet)", "fehler" in raus && raus.fehler === "abgemeldet", raus);
}
{
  // Die Schreib- und Lesewege müssen die Regel auch benutzen — sonst hilft die
  // reine Funktion nichts.
  let io = "";
  let routeSl = "";
  let routeDoz = "";
  try {
    io = readFileSync("src/lib/leistung-io.ts", "utf8");
    routeSl = readFileSync("src/app/api/noten/route.ts", "utf8");
    routeDoz = readFileSync("src/app/api/dozent/note/route.ts", "utf8");
  } catch {
    // leer lassen — die Prüfungen unten werden dann rot
  }
  pruefe("die Notenmatrix lädt nur Schüler", io.includes('teilnahmeform: "SCHUELER"'));
  pruefe("der Schreibweg prüft mit pruefeNotenZiele", io.includes("pruefeNotenZiele("));
  pruefe("der Noten-Editor der Detailakte prüft wirdBenotet", /ladePersonNoten[\s\S]*?wirdBenotet\(/.test(io));
  pruefe(
    "Schulleitungs-Route: Hörer → 400, abgemeldet → 409",
    /case "hoerer":[\s\S]{0,300}?, 400\)/.test(routeSl) && /case "abgemeldet":[\s\S]{0,200}?, 409\)/.test(routeSl),
  );
  pruefe(
    "Dozenten-Route: Hörer → 400, abgemeldet → 409",
    /case "hoerer":[\s\S]{0,300}?, 400\)/.test(routeDoz) && /case "abgemeldet":[\s\S]{0,200}?, 409\)/.test(routeDoz),
  );
}

console.log("\n8. Zod-Schema der Noten-Routen (leistung-schema.ts)");
{
  const basis = { teilnahmeId: "11111111-1111-4111-8111-111111111111", ergebnis: "BESTANDEN" };
  pruefe("gültiger Eintrag wird angenommen", leistungEintragSchema.safeParse({ ...basis, punkte: 87, note: "1,7" }).success);
  pruefe("unbekanntes Ergebnis wird abgelehnt", !leistungEintragSchema.safeParse({ ...basis, ergebnis: "TANZEN" }).success);
  pruefe(
    "Punkte über PUNKTE_MAX werden abgelehnt",
    !leistungEintragSchema.safeParse({ ...basis, punkte: PUNKTE_MAX + 1 }).success,
  );
  pruefe(
    "Note über NOTE_MAX_LAENGE wird abgelehnt",
    !leistungEintragSchema.safeParse({ ...basis, note: "x".repeat(NOTE_MAX_LAENGE + 1) }).success,
  );
}

console.log("\n9. Eine Quelle für die Oberfläche (keine Kopien der Regeln)");
pruefe(
  "ERGEBNIS_OPTIONEN: alle erlaubten Ergebnisse in Modell-Reihenfolge",
  JSON.stringify(ERGEBNIS_OPTIONEN.map((o) => o.wert)) === JSON.stringify(LEISTUNG_ERGEBNISSE),
  ERGEBNIS_OPTIONEN,
);
pruefe(
  "ERGEBNIS_OPTIONEN: Klartext aus ergebnisName",
  ERGEBNIS_OPTIONEN.every((o) => o.label === ergebnisName(o.wert)),
  ERGEBNIS_OPTIONEN,
);
{
  let leistungQuelle = "";
  let schemaQuelle = "";
  let io = "";
  let inline = "";
  let matrix = "";
  let semesterwahl = "";
  let routeSl = "";
  let routeDoz = "";
  try {
    leistungQuelle = readFileSync("src/lib/leistung.ts", "utf8");
    schemaQuelle = readFileSync("src/lib/leistung-schema.ts", "utf8");
    io = readFileSync("src/lib/leistung-io.ts", "utf8");
    inline = readFileSync("src/components/personen/noten-inline.tsx", "utf8");
    matrix = readFileSync("src/components/noten/noten-matrix.tsx", "utf8");
    semesterwahl = readFileSync("src/app/verwaltung/noten/semesterwahl.tsx", "utf8");
    routeSl = readFileSync("src/app/api/noten/route.ts", "utf8");
    routeDoz = readFileSync("src/app/api/dozent/note/route.ts", "utf8");
  } catch {
    // leer lassen — die Prüfungen unten werden dann rot
  }
  // leistung.ts landet über Matrix, Detailakte und Badge im Browser-Bundle.
  pruefe("leistung.ts importiert kein zod (Client-Bundle)", leistungQuelle !== "" && !/from "zod"/.test(leistungQuelle));
  pruefe(
    "das Zod-Schema liegt in leistung-schema.ts, beide Routen nehmen es von dort",
    /export const leistungEintragSchema = z\.object/.test(schemaQuelle) &&
      [routeSl, routeDoz].every((r) => r.includes('import { leistungEintragSchema } from "@/lib/leistung-schema"')),
  );
  pruefe(
    "giltAlsBestanden entscheidet über BESTANDEN_ERGEBNISSE (keine Literale)",
    /export function giltAlsBestanden\([^)]*\)[^{]*\{[^}]*BESTANDEN_ERGEBNISSE/.test(leistungQuelle) &&
      !/export function giltAlsBestanden\([^)]*\)[^{]*\{[^}]*"BESTANDEN"/.test(leistungQuelle),
  );
  pruefe(
    "LeistungWert ist nur in leistung.ts definiert (keine Kopie in IO-Teil, Matrix, Detailakte)",
    /export type LeistungWert = /.test(leistungQuelle) && [io, inline, matrix].every((q) => q !== "" && !/type LeistungWert = /.test(q)),
  );
  pruefe(
    "Detailakte: Punkte über punkteGueltig, Grenzen und Notenlänge aus leistung.ts (keine Literale)",
    /punkteGueltig\(/.test(inline) &&
      /min=\{PUNKTE_MIN\}/.test(inline) &&
      /max=\{PUNKTE_MAX\}/.test(inline) &&
      /maxLength=\{NOTE_MAX_LAENGE\}/.test(inline) &&
      !/< 0\b|> 100\b|=\{0\}|=\{100\}|=\{40\}|0 bis 100/.test(inline),
  );
  pruefe(
    "Detailakte und Matrix nehmen die Auswahl aus ERGEBNIS_OPTIONEN (keine eigene Liste)",
    [inline, matrix].every((q) => /ERGEBNIS_OPTIONEN\b/.test(q) && !/const ERGEBNIS_OPTIONEN\s*=/.test(q)),
  );
  pruefe("Matrix prüft Punkte über punkteGueltig", /punkteGueltig\(/.test(matrix) && !/zahl < PUNKTE_MIN/.test(matrix));
  pruefe(
    "Matrix warnt vor dem Verlassen mit ungespeicherten Noten (beforeunload)",
    /addEventListener\("beforeunload"/.test(matrix) && /removeEventListener\("beforeunload"/.test(matrix),
  );
  pruefe(
    "Semesterwahl der Notenseite: Menü aus Links (wirkt sofort, ohne „Anzeigen“), kein Wechsel beim Auswählen",
    /<Menue\b/.test(semesterwahl) && /href: href\(s\.id\)/.test(semesterwahl) && !/onChange|router\.push/.test(semesterwahl),
  );
  const badges = (() => {
    try {
      return readFileSync("src/components/ui/badges.tsx", "utf8");
    } catch {
      return "";
    }
  })();
  pruefe(
    "ErgebnisBadge färbt über giltAlsBestanden (keine eigene Grün-Tabelle ERGEBNIS_TON)",
    /giltAlsBestanden\(/.test(badges) && !/ERGEBNIS_TON/.test(badges),
  );
  pruefe(
    "beide Noten-Routen: unerwartete Fehler über mitFehlerbehandlung, kein toter default mit 500",
    [routeSl, routeDoz].every(
      (r) =>
        /return mitFehlerbehandlung\("NOTEN", "Die Noten konnten nicht gespeichert werden\.", async \(\) => \{/.test(r) &&
        /default:\s*return nieErreicht\(ergebnis\.fehler\);/.test(r) &&
        !/default:\s*return fehler\(/.test(r),
    ),
  );
}

// Soll-Anzahl: fängt lautlos entfallene Prüfungen ab. Beim Ergänzen anheben.
const ERWARTET = 67;
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);
