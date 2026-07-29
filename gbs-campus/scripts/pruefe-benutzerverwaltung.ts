/**
 * Gegenprobe für die Rollenverwaltung (DB-frei): der Diff zwischen Ist- und
 * Soll-Rollen, die Prüfung auf bekannte Rollen und die Erkennung eines
 * Administrator-Entzugs.
 *
 * ACHTUNG beim Erweitern: Eine Prüfung beweist erst dann etwas, wenn sie ROT
 * wird, sobald man die geprüfte Regel entfernt. Auf den konkreten Wert prüfen.
 */

import { ADMIN_ROLLE, entziehtAdmin, rollenDiff, sindRollenBekannt } from "../src/lib/benutzerverwaltung";

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

const sortiert = (a: string[]) => [...a].sort().join(",");

console.log("\n1. Diff zwischen Ist und Soll");
{
  const d = rollenDiff(["TEILNEHMER", "DOZENT"], ["TEILNEHMER"]);
  pruefe("eine neue Rolle wird als hinzu erkannt", sortiert(d.hinzu) === "DOZENT" && d.weg.length === 0, d);
}
{
  const d = rollenDiff(["TEILNEHMER"], ["TEILNEHMER", "DOZENT"]);
  pruefe("eine entfernte Rolle wird als weg erkannt", sortiert(d.weg) === "DOZENT" && d.hinzu.length === 0, d);
}
{
  const d = rollenDiff(["TEILNEHMER", "DOZENT"], ["TEILNEHMER", "DOZENT"]);
  pruefe("unveränderte Rollen ergeben keinen Diff", d.hinzu.length === 0 && d.weg.length === 0, d);
}
{
  const d = rollenDiff(["ADMIN", "DOZENT"], ["TEILNEHMER"]);
  pruefe("gleichzeitig hinzu und weg", sortiert(d.hinzu) === "ADMIN,DOZENT" && sortiert(d.weg) === "TEILNEHMER", d);
}
{
  // Doppelte im Wunsch dürfen keinen Unterschied machen (Mengen).
  const d = rollenDiff(["DOZENT", "DOZENT"], ["DOZENT"]);
  pruefe("doppelte Wunsch-Rollen ergeben keinen Diff", d.hinzu.length === 0 && d.weg.length === 0, d);
}

console.log("\n2. Nur bekannte Rollen");
pruefe("bekannte Rollen sind zulässig", sindRollenBekannt(["TEILNEHMER", "DOZENT"], ["TEILNEHMER", "DOZENT", "ADMIN"]) === true);
pruefe("eine unbekannte Rolle wird abgelehnt", sindRollenBekannt(["TEILNEHMER", "HACKER"], ["TEILNEHMER", "DOZENT"]) === false);
pruefe("die leere Wunschmenge ist zulässig", sindRollenBekannt([], ["TEILNEHMER"]) === true);

console.log("\n3. Administrator-Entzug erkennen");
pruefe("ADMIN_ROLLE ist ADMIN (passend zum Seed)", ADMIN_ROLLE === "ADMIN");
pruefe("Entzug von ADMIN wird erkannt", entziehtAdmin(rollenDiff(["TEILNEHMER"], ["ADMIN", "TEILNEHMER"])) === true);
pruefe("ohne ADMIN-Entzug meldet es false", entziehtAdmin(rollenDiff(["ADMIN"], ["ADMIN", "DOZENT"])) === false);
pruefe("das Hinzufügen von ADMIN ist kein Entzug", entziehtAdmin(rollenDiff(["ADMIN"], [])) === false);

// Soll-Anzahl: fängt lautlos entfallene Prüfungen ab. Beim Ergänzen anheben.
const ERWARTET = 13;
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);
