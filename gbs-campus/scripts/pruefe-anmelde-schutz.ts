/**
 * Gegenprobe für den Schutz des öffentlichen Anmeldeformulars vor
 * Massenanmeldungen, DB-frei. Die Regeln stehen in src/lib/anmelde-schutz.ts,
 * angewendet werden sie in src/app/api/anmeldung/route.ts; gezählt wird in
 * src/lib/anmelde-schutz-io.ts.
 *
 * ACHTUNG beim Erweitern: Eine Prüfung beweist erst dann etwas, wenn sie ROT
 * wird, sobald man die geprüfte Regel entfernt. Deshalb stehen an jeder Grenze
 * beide Seiten (knapp darunter, genau darauf), und die Verdrahtung in der Route
 * wird über den Quelltext geprüft — die Reihenfolge der Schichten ist Teil der
 * Zusage (ein Roboter im Fangfeld darf kein Kontingent verbrauchen).
 */

import { createHmac } from "crypto";
import { readFileSync } from "fs";
import {
  ENTWURF_FAKTOR,
  baueFormularStempel,
  entwurfGrenzen,
  gesamtgrenzeErreicht,
  gesamtgrenzeMeldung,
  grenzeAlsText,
  pruefeFormularStempel,
  stempelMeldung,
} from "../src/lib/anmelde-schutz";

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

const GEHEIM = "a".repeat(40);
const ANDERES_GEHEIM = "b".repeat(40);
const T0 = 1_790_000_000_000; // fester Zeitpunkt, damit nichts an der Uhr hängt
const SEK = 1000;

function grund(stempel: string | null | undefined, jetzt: number, mindest = 3, geheim = GEHEIM) {
  const e = pruefeFormularStempel(stempel, jetzt, mindest, geheim);
  return e.ok ? "OK" : e.grund;
}

console.log("\n=== Formularstempel (Mindestdauer) ===");
const stempel = baueFormularStempel(T0, GEHEIM);
pruefe("Format: Zeitpunkt, Punkt, base64url-Signatur", /^\d+\.[A-Za-z0-9_-]{43}$/.test(stempel), stempel);
pruefe("nach genug Zeit gültig", grund(stempel, T0 + 60 * SEK) === "OK");
pruefe("genau auf der Mindestdauer gültig", grund(stempel, T0 + 3 * SEK) === "OK");
pruefe("eine Millisekunde darunter: zu schnell", grund(stempel, T0 + 3 * SEK - 1) === "ZU_SCHNELL");
pruefe("sofort abgeschickt: zu schnell", grund(stempel, T0) === "ZU_SCHNELL");
pruefe("Mindestdauer 0: sofort gültig", grund(stempel, T0, 0) === "OK");
pruefe("ohne Stempel (undefined): fehlt", grund(undefined, T0 + 60 * SEK) === "FEHLT");
pruefe("ohne Stempel (null): fehlt", grund(null, T0 + 60 * SEK) === "FEHLT");
pruefe("leerer Stempel: fehlt", grund("", T0 + 60 * SEK) === "FEHLT");

// Ein Roboter, der einen älteren Zeitpunkt vortäuscht, ändert die Zahl — die
// Signatur passt dann nicht mehr.
const [zeit, signatur] = stempel.split(".");
pruefe(
  "vorgetäuschter älterer Zeitpunkt mit alter Signatur: ungültig",
  grund(`${Number(zeit) - 60 * SEK}.${signatur}`, T0 + SEK) === "UNGUELTIG",
);
const letztes = signatur.slice(-1);
const vertauscht = `${zeit}.${signatur.slice(0, -1)}${letztes === "A" ? "B" : "A"}`;
pruefe("veränderte Signatur: ungültig", grund(vertauscht, T0 + 60 * SEK) === "UNGUELTIG");
pruefe("anderes Geheimnis: ungültig", grund(stempel, T0 + 60 * SEK, 3, ANDERES_GEHEIM) === "UNGUELTIG");
// Zweck-Präfix: dieselbe Zahl, mit demselben Schlüssel, aber ohne Präfix signiert.
const ohneZweck = `${T0}.${createHmac("sha256", GEHEIM).update(String(T0)).digest("base64url")}`;
pruefe("Signatur ohne Zweck-Präfix: ungültig", grund(ohneZweck, T0 + 60 * SEK) === "UNGUELTIG");
for (const kaputt of ["abc", "123", "1.2.3", "-5.abc", ".abc", `${T0}.`, "1e12.abc"]) {
  pruefe(`kaputtes Format „${kaputt}“: ungültig`, grund(kaputt, T0 + 60 * SEK) === "UNGUELTIG");
}
pruefe(
  "Stempel aus der Zukunft (2 Minuten): ungültig",
  grund(baueFormularStempel(T0 + 120 * SEK, GEHEIM), T0, 0) === "UNGUELTIG",
);
pruefe(
  "leichter Uhrenversatz (30 s) mit Mindestdauer 0: gültig",
  grund(baueFormularStempel(T0 + 30 * SEK, GEHEIM), T0, 0) === "OK",
);

console.log("\n=== Gesamtgrenze ===");
const G = { proStunde: 10, proTag: 30 };
pruefe("unter beiden Grenzen: frei", gesamtgrenzeErreicht({ letzteStunde: 9, letzterTag: 29 }, G) === null);
pruefe("Stunde erreicht: STUNDE", gesamtgrenzeErreicht({ letzteStunde: 10, letzterTag: 10 }, G) === "STUNDE");
pruefe("Tag erreicht, Stunde frei: TAG", gesamtgrenzeErreicht({ letzteStunde: 0, letzterTag: 30 }, G) === "TAG");
pruefe("beide erreicht: STUNDE zuerst", gesamtgrenzeErreicht({ letzteStunde: 11, letzterTag: 40 }, G) === "STUNDE");
pruefe("Zwischenstände: Faktor 3", ENTWURF_FAKTOR === 3);
const E = entwurfGrenzen(G);
pruefe("Zwischenstand-Grenzen sind das Dreifache", E.proStunde === 30 && E.proTag === 90, E);

console.log("\n=== Meldungen ===");
const meldungen = [
  gesamtgrenzeMeldung("STUNDE", "ABSENDEN"),
  gesamtgrenzeMeldung("TAG", "ABSENDEN"),
  gesamtgrenzeMeldung("STUNDE", "ZWISCHENSTAND"),
  gesamtgrenzeMeldung("TAG", "ZWISCHENSTAND"),
  stempelMeldung("ZU_SCHNELL"),
  stempelMeldung("FEHLT"),
  stempelMeldung("UNGUELTIG"),
];
pruefe("Stundengrenze nennt „in einer Stunde“", meldungen[0].includes("in einer Stunde"));
pruefe("Tagesgrenze nennt „morgen“", meldungen[1].includes("morgen"));
pruefe("Absenden: Eingaben bleiben stehen", meldungen[0].includes("Eingaben bleiben"));
pruefe("Zwischenstand-Meldung nennt den Zwischenstand", meldungen[2].includes("Zwischenstand"));
pruefe("zu schnell: sagt, dass erneut abgeschickt werden kann", meldungen[4].includes("noch einmal ab"));
pruefe("veraltetes Formular: verweist auf „Später weitermachen“", meldungen[5].includes("Später weitermachen"));
pruefe(
  "alle Meldungen in der Sie-Form, ohne Du-Formen",
  meldungen.every((m) => /\bSie\b/.test(m) && !/\b(du|dich|dir|dein|deine|deinen|deiner)\b/i.test(m)),
  meldungen,
);
pruefe("Warntext Stunde", grenzeAlsText("STUNDE", G) === "10 Anmeldungen in der letzten Stunde");
pruefe("Warntext Tag", grenzeAlsText("TAG", G) === "30 Anmeldungen in den letzten 24 Stunden");

console.log("\n=== Verdrahtung (Quelltext) ===");
const route = readFileSync("src/app/api/anmeldung/route.ts", "utf8");
const io = readFileSync("src/lib/anmelde-schutz-io.ts", "utf8");
const einstellungen = readFileSync("src/lib/einstellungen.ts", "utf8");
const pos = (text: string, muster: string) => text.indexOf(muster);
pruefe(
  "Reihenfolge der Schichten: Fangfeld → Mindestdauer → Gesamtgrenze → Anmeldung anlegen",
  pos(route, "geprueft.data.hp_feld") > 0 &&
    pos(route, "geprueft.data.hp_feld") < pos(route, "pruefeFormularStempel(") &&
    pos(route, "pruefeFormularStempel(") < pos(route, "reserviereKontingent(SCHLUESSEL_EINGANG") &&
    pos(route, "reserviereKontingent(SCHLUESSEL_EINGANG") < pos(route, "nimmAnmeldungEntgegen({"),
);
pruefe(
  "Mindestdauer nur, wenn eingeschaltet (0 = aus)",
  /if \(mindestSekunden > 0\) \{\s*const stempel = pruefeFormularStempel\(/.test(route),
);
pruefe(
  "nicht angenommene Einreichung gibt ihren Platz im finally wieder frei",
  /finally \{[\s\S]{0,300}if \(!angenommen\) await gibKontingentFrei\(reservierung\.platzId\)/.test(route),
);
pruefe("angenommen wird erst nach erfolgreicher Anmeldung gesetzt", /if \(!ergebnis\.ok\) \{[\s\S]{0,300}\}\s*angenommen = true;/.test(route));
pruefe("Warnung an die Verwaltung läuft nach der Antwort (after)", /after\(\(\) => warneBeiGesamtgrenze\(/.test(route));
pruefe(
  "Zwischenstände: jede Anfrage wird gegen die Zeilen-Grenze geprüft",
  /aktion === "speichern"\) \{[\s\S]{0,600}gesamtgrenzeErreicht\(await zaehleNeueAnmeldezeilen\(\), entwurfGrenzen\(/.test(route),
);
pruefe(
  "Warnung höchstens einmal pro Stunde (Drossel 1 je 60 Minuten)",
  /drosselUeberschritten\(SCHLUESSEL_WARNUNG, 1, 60\)/.test(io),
);
pruefe("Reservierung zählt und belegt unter einer Sperre", /pg_advisory_xact_lock[\s\S]{0,600}rateLimit\.create/.test(io));
pruefe(
  "Einstellungen: Mindestdauer abschaltbar (Minimum 0), Standard 3 Sekunden",
  /ANMELDUNG_MINDESTDAUER_SEKUNDEN: \{[\s\S]{0,700}standard: 3,\s*minimum: 0,/.test(einstellungen),
);
pruefe(
  "Einstellungen: Stunden- und Tagesgrenze mit Standard 10 bzw. 30",
  /ANMELDUNG_MAX_GESAMT_STUNDE: \{[\s\S]{0,800}standard: 10,/.test(einstellungen) &&
    /ANMELDUNG_MAX_GESAMT_TAG: \{[\s\S]{0,700}standard: 30,/.test(einstellungen),
);

const seite = readFileSync("src/app/anmeldung/page.tsx", "utf8");
const formular = readFileSync("src/app/anmeldung/oeffentliches-formular.tsx", "utf8");
pruefe("die Formularseite stempelt beim Ausliefern", /baueFormularStempel\(Date\.now\(\), stempelGeheimnis\(\)\)/.test(seite));
pruefe("das Formular schickt den Stempel beim Absenden mit", /aktion: "absenden"[\s\S]{0,400}formularStempel/.test(formular));

const seed = readFileSync("prisma/seed.ts", "utf8");
const vorlage = seed.match(/code: "ANMELDUNG_GEDROSSELT",[\s\S]{0,200}?betreff: "([^"]*)"/);
pruefe("Mail-Vorlage für die Warnung im Seed", vorlage !== null);
pruefe(
  "Betreff der Warnung ohne Personen-Platzhalter",
  vorlage !== null && !/\{\{(name|vorname|nachname|email)\}\}/.test(vorlage[1]),
  vorlage?.[1],
);

// Soll-Anzahl: fängt lautlos entfallene Prüfungen ab. Beim Ergänzen anheben.
const ERWARTET = 52;
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);
