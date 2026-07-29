/**
 * Gegenprobe für das Dozentenhonorar (DB-frei): die Rechnung „Abende × Satz",
 * die Euro-Formatierung und die hinterlegte Grundlage (Einstellung + Recht).
 *
 * ACHTUNG beim Erweitern: Eine Prüfung beweist erst dann etwas, wenn sie ROT
 * wird, sobald man die geprüfte Regel entfernt.
 */

import { readFileSync } from "fs";
import { euro, honorarBetrag } from "../src/lib/honorar";

let geprueft = 0;
let fehlgeschlagen = 0;
function pruefe(bezeichnung: string, bedingung: boolean, zusatz?: unknown) {
  geprueft++;
  if (bedingung) console.log(`  ok    ${bezeichnung}`);
  else {
    fehlgeschlagen++;
    console.log(`  FEHLT ${bezeichnung}`);
    if (zusatz !== undefined) console.log("        ", JSON.stringify(zusatz));
  }
}

console.log("\n1. Honorarbetrag = Abende × Satz");
pruefe("10 Abende × 60 € = 600 €", honorarBetrag(10, 60) === 600);
pruefe("0 Abende ergeben 0 €", honorarBetrag(0, 60) === 0);
pruefe("Satz 0 ergibt 0 €", honorarBetrag(10, 0) === 0);
pruefe("2 Abende × 90 € = 180 €", honorarBetrag(2, 90) === 180);
pruefe("das Ergebnis bleibt ganzzahlig", Number.isInteger(honorarBetrag(21, 60)));

console.log("\n2. Euro-Formatierung");
pruefe("600 wird zu 600 €", euro(600) === "600 €");
pruefe("0 wird zu 0 €", euro(0) === "0 €");
pruefe("Tausender bekommen einen Punkt (1.260 €)", euro(1260) === "1.260 €");

console.log("\n3. Honorarsatz ist als Einstellung im Bereich FINANZEN hinterlegt");
let einstellungen = "";
try {
  einstellungen = readFileSync("src/lib/einstellungen.ts", "utf8");
} catch {
  einstellungen = "";
}
pruefe("einstellungen.ts ist lesbar", einstellungen.length > 0);
pruefe(
  "HONORAR_SATZ_PRO_ABEND liegt im Bereich FINANZEN",
  /HONORAR_SATZ_PRO_ABEND[\s\S]{0,400}bereich: "FINANZEN"/.test(einstellungen),
);
pruefe("der Standardsatz ist 60 €", /HONORAR_SATZ_PRO_ABEND[\s\S]{0,400}standard: 60\b/.test(einstellungen));
pruefe("die Einstellung trägt die Einheit €", /HONORAR_SATZ_PRO_ABEND[\s\S]{0,600}einheit: "€"/.test(einstellungen));

console.log("\n4. Das Recht HONORAR_LESEN ist geseedet und den richtigen Rollen zugeordnet");
let seed = "";
try {
  seed = readFileSync("prisma/seed.ts", "utf8");
} catch {
  seed = "";
}
// Liefert die rechte-Liste einer Rolle als Text (bis zur schließenden Klammer der
// flachen String-Liste). So lässt sich prüfen, WELCHE Rolle das Recht trägt —
// nicht nur, ob der Code irgendwo vorkommt (siehe Datei-Grundsatz oben).
function rechteVon(rolle: string): string {
  const treffer = seed.match(new RegExp(`code: "${rolle}"[\\s\\S]*?rechte: \\[([^\\]]*)\\]`));
  return treffer ? treffer[1] : "";
}
pruefe("seed.ts ist lesbar", seed.length > 0);
pruefe(
  "HONORAR_LESEN ist als Recht im Bereich FINANZEN angelegt",
  /code: "HONORAR_LESEN"[\s\S]{0,120}bereich: "FINANZEN"/.test(seed),
);
pruefe("die Schulleitung hat HONORAR_LESEN", rechteVon("SCHULLEITER").includes("HONORAR_LESEN"));
pruefe("die Verwaltung hat HONORAR_LESEN", rechteVon("VERWALTUNG").includes("HONORAR_LESEN"));
pruefe("der Teilnehmer hat HONORAR_LESEN NICHT", rechteVon("TEILNEHMER").length > 0 && !rechteVon("TEILNEHMER").includes("HONORAR_LESEN"));

// Soll-Anzahl: fängt lautlos entfallene Prüfungen ab. Beim Ergänzen anheben.
const ERWARTET = 18;
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);
