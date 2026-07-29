/**
 * Gegenprobe für die Selbstbestätigung (DB-frei): die drei Regeln, nach denen
 * ein Teilnehmer seine Anwesenheit selbst setzen darf.
 *
 * ACHTUNG beim Erweitern: Eine Prüfung beweist erst dann etwas, wenn sie ROT
 * wird, sobald man die geprüfte Regel entfernt. Auf den konkreten Wert prüfen,
 * nie auf die Anzahl.
 */

import {
  SELBST_STATUS,
  darfSelbstSetzen,
  istSelbstStatusErlaubt,
  terminVergangen,
} from "../src/lib/selbstbestaetigung";

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

console.log("\n1. Erlaubte Zustände");
pruefe("ANWESEND ist erlaubt", istSelbstStatusErlaubt("ANWESEND") === true);
pruefe("NACHGEARBEITET ist erlaubt", istSelbstStatusErlaubt("NACHGEARBEITET") === true);
pruefe("ENTSCHULDIGT ist NICHT erlaubt (entscheidet die Schule)", istSelbstStatusErlaubt("ENTSCHULDIGT") === false);
pruefe("GEFEHLT ist NICHT erlaubt (meldet niemand über sich)", istSelbstStatusErlaubt("GEFEHLT") === false);
pruefe("leerer Wert ist nicht erlaubt", istSelbstStatusErlaubt("") === false);
pruefe("genau zwei erlaubte Zustände", SELBST_STATUS.length === 2);

console.log("\n2. Nur vergangene Abende");
{
  const abend = new Date("2026-09-15T19:00:00.000Z");
  pruefe("ein Abend vor jetzt ist bestätigbar", terminVergangen(abend, new Date("2026-09-16T08:00:00.000Z")) === true);
  pruefe("ein Abend nach jetzt ist nicht bestätigbar", terminVergangen(abend, new Date("2026-09-14T08:00:00.000Z")) === false);
  pruefe("ein Abend genau jetzt gilt als vergangen", terminVergangen(abend, new Date("2026-09-15T19:00:00.000Z")) === true);
  pruefe(
    "eine Sekunde vor Beginn ist noch nicht bestätigbar",
    terminVergangen(abend, new Date("2026-09-15T18:59:59.000Z")) === false,
  );
}

console.log("\n3. Nur den eigenen Eintrag überschreiben");
const ICH = "person-1";
pruefe("ohne vorhandenen Eintrag darf gesetzt werden", darfSelbstSetzen(null, ICH) === true);
pruefe("ein selbst gesetzter Eintrag darf geändert werden", darfSelbstSetzen({ erfasstVonId: ICH }, ICH) === true);
pruefe(
  "ein von der Verwaltung erfasster Eintrag ist gesperrt",
  darfSelbstSetzen({ erfasstVonId: "verwaltung-9" }, ICH) === false,
);
pruefe(
  "ein Eintrag ohne Erfasser (System) ist ebenfalls gesperrt",
  darfSelbstSetzen({ erfasstVonId: null }, ICH) === false,
);

// Soll-Anzahl: fängt lautlos entfallene Prüfungen ab. Beim Ergänzen anheben.
const ERWARTET = 15;
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);
