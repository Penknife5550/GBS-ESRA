/**
 * Führt alle DB-freien Prüfskripte aus und fasst am Ende zusammen — gedacht als
 * `npm run pruefen` (bzw. `npm test`), im Dockerfile vor `next build` und in der
 * CI (.github/workflows/pruefen.yml).
 *
 * Anders als eine &&-Kette bricht ein rotes Skript den Lauf nicht ab: Alle
 * laufen, die Zusammenfassung nennt jedes rote Skript und die Gesamtzahl der
 * Prüfungen, der Exit-Code ist 1, sobald eines rot ist.
 *
 * Jedes Skript läuft in einem eigenen Prozess in der Zeitzone Europe/Berlin —
 * wie Server und Worker. In UTC blieben die Prüfungen zu Sommerzeit,
 * Mitternacht und Abendterminen grün, ohne etwas zu beweisen.
 *
 * Neue Prüfskripte hier eintragen. Ein scripts/pruefe-*.ts, das weder in
 * SKRIPTE noch in MIT_DATENBANK steht, macht den Lauf rot — so bleibt keins
 * still liegen.
 *
 * Aufruf aus dem Anwendungsordner: npx tsx scripts/pruefe-alle.ts
 */

import { spawnSync } from "child_process";
import { existsSync, readdirSync } from "fs";
import { join } from "path";

/** Die DB-freien Prüfskripte, in dieser Reihenfolge. */
const SKRIPTE = [
  "pruefe-formularlogik.ts",
  "pruefe-semesterlogik.ts",
  "pruefe-eigene-daten.ts",
  "pruefe-passwort.ts",
  "pruefe-auskunft.ts",
  "pruefe-beitrag.ts",
  "pruefe-faecher.ts",
  "pruefe-stundenplan.ts",
  "pruefe-quote-schueler.ts",
  "pruefe-leistung.ts",
  "pruefe-zeugnis.ts",
  "pruefe-selbstbestaetigung.ts",
  "pruefe-honorar.ts",
  "pruefe-honorar-abrechnung.ts",
  "pruefe-benutzerverwaltung.ts",
  "pruefe-anonymisierung.ts",
  "pruefe-herkunft.ts",
  "pruefe-anmeldung-antworten.ts",
  "pruefe-betrieb.ts",
  "pruefe-anmelde-schutz.ts",
  "pruefe-navigation.ts",
  "pruefe-heute.ts",
];

/** Brauchen eine Datenbank — laufen über `npm run pruefen:db`, nicht hier. */
const MIT_DATENBANK = ["pruefe-einstellungen.ts", "pruefe-auskunft-db.ts"];

const ZEITZONE = "Europe/Berlin";
const ORDNER = "scripts";

type Ergebnis = { skript: string; exit: number | null; geprueft: number | null; fehlgeschlagen: number | null };

// tsx aus node_modules/.bin (npm run und npx setzen es ohnehin in den PATH).
const lokal = join("node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
const tsx = existsSync(lokal) ? lokal : "tsx";

// Vollständigkeit: Jedes Prüfskript auf der Platte ist hier eingeordnet.
let vorhanden: string[] = [];
try {
  vorhanden = readdirSync(ORDNER).filter((datei) => /^pruefe-.+\.ts$/.test(datei) && datei !== "pruefe-alle.ts");
} catch {
  vorhanden = [];
}
const nichtEingetragen = vorhanden.filter((datei) => !SKRIPTE.includes(datei) && !MIT_DATENBANK.includes(datei));
const fehlend = SKRIPTE.filter((datei) => !vorhanden.includes(datei));

const ergebnisse: Ergebnis[] = [];
for (const skript of SKRIPTE) {
  if (fehlend.includes(skript)) continue;
  console.log(`\n=== ${skript} ===`);
  const lauf = spawnSync(tsx, [join(ORDNER, skript)], {
    encoding: "utf8",
    env: { ...process.env, TZ: ZEITZONE },
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 64 * 1024 * 1024,
  });
  const ausgabe = lauf.stdout ?? "";
  process.stdout.write(ausgabe);
  if (lauf.error) console.log(`  Start fehlgeschlagen: ${lauf.error.message}`);
  const treffer = [...ausgabe.matchAll(/(\d+) Prüfungen, (\d+) fehlgeschlagen\./g)].pop();
  ergebnisse.push({
    skript,
    exit: lauf.status,
    geprueft: treffer ? Number(treffer[1]) : null,
    fehlgeschlagen: treffer ? Number(treffer[2]) : null,
  });
}

const rot = ergebnisse.filter((e) => e.exit !== 0 || e.geprueft === null || (e.fehlgeschlagen ?? 0) > 0);
const summeGeprueft = ergebnisse.reduce((s, e) => s + (e.geprueft ?? 0), 0);
const summeFehlgeschlagen = ergebnisse.reduce((s, e) => s + (e.fehlgeschlagen ?? 0), 0);
const breite = Math.max(...SKRIPTE.map((s) => s.length));

console.log(`\n=== Zusammenfassung (TZ=${ZEITZONE}) ===`);
for (const e of ergebnisse) {
  const zahlen =
    e.geprueft === null ? "keine Zusammenfassung ausgegeben" : `${e.geprueft} Prüfungen, ${e.fehlgeschlagen} fehlgeschlagen`;
  const markierung = rot.includes(e) ? "ROT " : "ok  ";
  console.log(`  ${markierung} ${e.skript.padEnd(breite)}  ${zahlen}${e.exit !== 0 ? ` (Exit ${e.exit ?? "abgebrochen"})` : ""}`);
}
for (const datei of fehlend) console.log(`  ROT  ${datei.padEnd(breite)}  Datei fehlt`);
for (const datei of nichtEingetragen) {
  console.log(`  ROT  ${datei.padEnd(breite)}  nicht in scripts/pruefe-alle.ts eingetragen (SKRIPTE oder MIT_DATENBANK)`);
}

const allesGruen = rot.length === 0 && fehlend.length === 0 && nichtEingetragen.length === 0;
console.log(
  `\nGesamt: ${summeGeprueft} Prüfungen in ${ergebnisse.length} Skripten, ${summeFehlgeschlagen} fehlgeschlagen` +
    (allesGruen ? " — alles grün.\n" : ` — ${rot.length + fehlend.length + nichtEingetragen.length} Skript(e) rot.\n`),
);
process.exit(allesGruen ? 0 : 1);
