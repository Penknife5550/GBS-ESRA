/**
 * Gegenprobe für das Kursraster (Fächer & Kurseinheiten) und die
 * Darstellungshelfer.
 *
 * Kein Test-Framework, keine Datenbank — geprüft werden die reinen Helfer aus
 * `src/lib/faecher.ts` und die Datenintegrität der EINEN Quelle
 * `prisma/kursraster-definition.ts` (die Seed und dieses Skript teilen).
 *
 * ACHTUNG beim Erweitern: Eine Prüfung beweist erst dann etwas, wenn sie ROT
 * wird, sobald man die geprüfte Regel entfernt. Immer auf den konkreten Wert
 * prüfen, nie auf die Anzahl.
 */

import { FAECHER, KURSEINHEITEN } from "../prisma/kursraster-definition";
import { gruppiereRaster, halbjahrName, lehrjahrName, sortiereKurse } from "../src/lib/faecher";

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

console.log("\n1. Darstellungshelfer");
pruefe("Halbjahr 1 heißt Herbst", halbjahrName(1) === "Herbst");
pruefe("Halbjahr 2 heißt Frühling", halbjahrName(2) === "Frühling");
pruefe("ein ungültiges Halbjahr bleibt leer", halbjahrName(3) === "");
pruefe("Lehrjahr 1 heißt „1. Lehrjahr“", lehrjahrName(1) === "1. Lehrjahr");
pruefe("ein fehlendes Lehrjahr bleibt leer", lehrjahrName(null) === "");

const unsortiert = [
  { jahrgangsjahr: 2, halbjahr: 1, sortierung: 20, titel: "B" },
  { jahrgangsjahr: 1, halbjahr: 2, sortierung: 10, titel: "C" },
  { jahrgangsjahr: 1, halbjahr: 1, sortierung: 10, titel: "A" },
];
pruefe(
  "sortiereKurse ordnet nach Lehrjahr, dann Halbjahr",
  sortiereKurse(unsortiert)
    .map((k) => k.titel)
    .join("") === "ACB",
);

const fachName = new Map(FAECHER.map((f) => [f.code, f.bezeichnung]));
const kurse = KURSEINHEITEN.map((k) => ({
  fachCode: k.fachCode,
  fachBezeichnung: fachName.get(k.fachCode) ?? k.fachCode,
  titel: k.titel,
  jahrgangsjahr: k.jahrgangsjahr,
  halbjahr: k.halbjahr,
  stunden: k.stunden,
  sortierung: k.sortierung,
}));
const raster = gruppiereRaster(kurse);
const imRaster = raster.reduce((s, j) => s + j.halbjahre.reduce((t, h) => t + h.kurse.length, 0), 0);
pruefe("gruppiereRaster verliert keinen Kurs", imRaster === KURSEINHEITEN.length, [imRaster, KURSEINHEITEN.length]);
pruefe("gruppiereRaster bildet drei Lehrjahre", raster.length === 3, raster.length);

console.log("\n2. Datenintegrität des Kursrasters");
const fachCodes = new Set(FAECHER.map((f) => f.code));
pruefe("jede Kurseinheit verweist auf ein existierendes Fach", KURSEINHEITEN.every((k) => fachCodes.has(k.fachCode)));
pruefe("jedes Halbjahr ist 1 (Herbst) oder 2 (Frühling)", KURSEINHEITEN.every((k) => k.halbjahr === 1 || k.halbjahr === 2));
pruefe("jedes Lehrjahr liegt zwischen 1 und 3", KURSEINHEITEN.every((k) => k.jahrgangsjahr >= 1 && k.jahrgangsjahr <= 3));

const plaetze = KURSEINHEITEN.map((k) => `${k.fachCode}-${k.jahrgangsjahr}-${k.halbjahr}`);
pruefe("jeder Rasterplatz (Fach × Lehrjahr × Halbjahr) ist eindeutig", new Set(plaetze).size === plaetze.length);

// Die Stunden der Kurseinheiten eines Fachs müssen seine Gesamtstunden ergeben
// (Bibelkunde 80 = 4×20, Kirchengeschichte 20 = 2×10, Dogmatik 30 = 3×10, …).
const summenStimmen = FAECHER.every((f) => {
  const summe = KURSEINHEITEN.filter((k) => k.fachCode === f.code).reduce((s, k) => s + k.stunden, 0);
  return summe === f.gesamtstunden;
});
pruefe("die Kurseinheit-Stunden je Fach ergeben die Gesamtstunden des Fachs", summenStimmen);

pruefe("jedes Fach hat mindestens eine Kurseinheit", FAECHER.every((f) => KURSEINHEITEN.some((k) => k.fachCode === f.code)));
pruefe("es sind sieben Fächer", FAECHER.length === 7, FAECHER.length);
pruefe("es sind dreizehn Kurseinheiten", KURSEINHEITEN.length === 13, KURSEINHEITEN.length);

// Soll-Anzahl: fängt lautlos entfallene Prüfungen ab. Beim Ergänzen anheben.
const ERWARTET = 17;
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);
