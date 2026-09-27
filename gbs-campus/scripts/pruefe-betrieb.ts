/**
 * Gegenprobe für den Betrieb (DB-frei): Passwort des Anwendungsnutzers, der
 * Umschalter auf gbs_app im Entrypoint, das Traefik-Netz in docker-compose.yml,
 * der Seed (Einwilligungstexte und Semester nur anlegen, Mail-Betreffs ohne
 * Personendaten), die Trigger, die Einwilligungstexte einfrieren, und die
 * Bereinigung alter Betreffs im Versandprotokoll (Code-Review 4, M1, M2, M3,
 * M6b, M8). Ab Abschnitt 9 die MINOR/INFO-Punkte des Betriebs: Eigentümer-
 * Passwort, Rechtematrix im Seed, eingefrorene Belege, Leistung -> Kurseinheit,
 * PDF-Zeichensatz, Log ohne Adressen, Traefik-Default-Router, Prüf-Gate im
 * Build und die Betriebsansicht; Abschnitt 18 der Worker (Healthcheck,
 * Lebenszeichen, Antwortfrist in den Mails), Abschnitt 19 die gemeinsamen
 * Bausteine der Oberfläche (Meldungsbox, Seitentitel, Zurück-Leiste, Badges,
 * Datumshelfer, Name der Einrichtung).
 *
 * Das meiste davon steht nicht in src/lib, sondern in Compose, Shell, Seed und
 * SQL — geprüft wird deshalb am Quelltext, wie in pruefe-honorar.ts. Aufruf aus
 * dem Anwendungsordner (relative Pfade).
 *
 * ACHTUNG beim Erweitern: Eine Prüfung beweist erst dann etwas, wenn sie ROT
 * wird, sobald man die geprüfte Regel entfernt.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { scrubbeZeugnisSnapshot } from "../src/lib/anonymisierung";
import { pruefeAppDbPasswort } from "../src/lib/konfiguration";
import { erzeugePdf, pdfText } from "../src/lib/pdf";

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

function lies(pfad: string): string {
  try {
    return readFileSync(pfad, "utf8");
  } catch {
    return "";
  }
}

console.log("\n1. Passwort des Anwendungsnutzers gbs_app (M2)");
pruefe("ein Hex-Passwort aus openssl rand -hex 24 taugt", pruefeAppDbPasswort("0123456789abcdef".repeat(3)) === null);
pruefe("Buchstaben und Ziffern gemischt taugen", pruefeAppDbPasswort("GbsCampus2026Minden") === null);
pruefe("15 Zeichen sind zu kurz", pruefeAppDbPasswort("abcdefghij12345") !== null);
pruefe(
  "ein Base64-Passwort mit / und + wird abgelehnt (zerlegt die unkodierte URL)",
  pruefeAppDbPasswort("q9Zx/4kLm+Pw2RtY8vBn3sHd") !== null,
);
pruefe("ein @ wird abgelehnt", pruefeAppDbPasswort("abcdefgh@ijklmnop123") !== null);
pruefe("ein : wird abgelehnt", pruefeAppDbPasswort("abcdefgh:ijklmnop123") !== null);
pruefe("ein % wird abgelehnt", pruefeAppDbPasswort("abcdefgh%ijklmnop123") !== null);
const setup = lies("prisma/setup-app-nutzer.ts");
pruefe("setup-app-nutzer.ts ist lesbar", setup.length > 0);
pruefe(
  "das Setup prüft das Passwort und bricht mit einem Fehler ab, bevor es die Rolle anlegt",
  /const problem = pruefeAppDbPasswort\(passwort\);\s*if \(problem\) \{\s*throw new Error\(/.test(setup) &&
    setup.indexOf("pruefeAppDbPasswort(passwort)") < setup.indexOf("CREATE ROLE gbs_app"),
);
pruefe(
  "das Setup entzieht gbs_app UPDATE/DELETE/TRUNCATE auf einwilligungs_texte",
  /REVOKE UPDATE, DELETE, TRUNCATE ON einwilligungs_texte FROM gbs_app/.test(setup),
);

console.log("\n2. Umschalter auf gbs_app im Entrypoint (M2)");
const entrypoint = lies("docker/entrypoint.sh");
pruefe("entrypoint.sh ist lesbar", entrypoint.length > 0);
pruefe("set -e: ein scheiterndes Setup bricht den Start ab", /^set -e$/m.test(entrypoint));
pruefe(
  "umgeschaltet wird nur bei gesetztem APP_DB_PASSWORD (nicht schon, weil APP_DATABASE_URL da ist)",
  /if \[ -n "\$\{APP_DB_PASSWORD:-\}" \][^\n]*; then\n\s*export DATABASE_URL="\$APP_DATABASE_URL"/.test(entrypoint),
);
pruefe(
  "DATABASE_URL wird genau an dieser einen Stelle umgeschaltet",
  (entrypoint.match(/export DATABASE_URL=/g) ?? []).length === 1,
);
const posMigration = entrypoint.indexOf("prisma migrate deploy");
const posSetup = entrypoint.indexOf("node prisma/setup-app-nutzer.js");
const posServer = entrypoint.indexOf("exec node server.js");
pruefe(
  "das Setup läuft nach der Migration und vor dem Serverstart",
  posMigration >= 0 && posSetup > posMigration && posServer > posSetup,
  { posMigration, posSetup, posServer },
);

console.log("\n3. docker-compose.yml: Traefik-Netz (M1) und Worker (M2)");
const compose = lies("docker-compose.yml");
pruefe("docker-compose.yml ist lesbar", compose.length > 0);
function dienstBloecke(yml: string): Map<string, string> {
  const bloecke = new Map<string, string>();
  const start = yml.indexOf("\nservices:\n");
  if (start < 0) return bloecke;
  const ende = yml.slice(start + 1).search(/\n(volumes|networks):\n/);
  const teil = ende >= 0 ? yml.slice(start, start + 1 + ende) : yml.slice(start);
  for (const block of teil.split(/\n {2}(?=[a-z][a-z0-9_-]*:[ \t]*\n)/).slice(1)) {
    bloecke.set(block.slice(0, block.indexOf(":")), block);
  }
  return bloecke;
}
const dienste = dienstBloecke(compose);
pruefe("die Dienste app und traefik werden gefunden", dienste.has("app") && dienste.has("traefik"), [...dienste.keys()]);
pruefe(
  "Traefik ist global auf das Netz gbs_edge festgelegt",
  (dienste.get("traefik") ?? "").includes('"--providers.docker.network=gbs_edge"'),
);
const geroutet = [...dienste].filter(([, block]) => block.includes('"traefik.enable=true"') && /\n\s+- data\n/.test(block + "\n"));
const ohneNetz = geroutet.filter(([, block]) => !block.includes('"traefik.docker.network=gbs_edge"')).map(([name]) => name);
pruefe(
  "jeder Traefik-Dienst, der auch im data-Netz hängt, trägt traefik.docker.network=gbs_edge",
  geroutet.length >= 1 && ohneNetz.length === 0,
  { geroutet: geroutet.map(([name]) => name), ohneNetz },
);
pruefe(
  "das Netz edge heißt fest gbs_edge (nicht <projekt>_edge)",
  /\nnetworks:\n\s+edge:\n(?:\s*#[^\n]*\n)*\s+name: gbs_edge\n/.test(compose),
);
const worker = dienste.get("worker") ?? "";
pruefe(
  "der Worker verbindet sich als Eigentümer, nie über APP_DATABASE_URL",
  worker.includes("DATABASE_URL=postgresql://gbs:${DB_PASSWORD}@db") && !worker.includes("APP_DATABASE_URL"),
);

console.log("\n4. Seed: Einwilligungstexte und Semester nur anlegen (M3, M8)");
const seed = lies("prisma/seed.ts");
pruefe("seed.ts ist lesbar", seed.length > 0);
// Einzige erlaubte Schreibaktion an einer bestehenden Fassung: `aktivBis` einer
// abgelösten setzen (das Einzige, was der Trigger zulässt) — als updateMany
// mit NUR aktivBis im data-Teil und nur, solange es noch leer ist.
const textSchreibend = [...seed.matchAll(/einwilligungsText\.(upsert|update|updateMany|delete|deleteMany)\(/g)].map((m) => m[1]);
const textUpdateMany = [...seed.matchAll(/einwilligungsText\.updateMany\(\{[\s\S]*?\}\);/g)].map((m) => m[0]);
pruefe(
  "Einwilligungstexte werden nie per upsert/update/delete geschrieben — nur aktivBis einer abgelösten Fassung",
  textSchreibend.every((art) => art === "updateMany") &&
    textUpdateMany.length === textSchreibend.length &&
    textUpdateMany.every((aufruf) => /data: \{ aktivBis: [\w.]+ \}/.test(aufruf) && /aktivBis: null/.test(aufruf)),
  textSchreibend,
);
pruefe("Einwilligungstexte werden angelegt, wenn sie fehlen", /if \(!vorhanden\) \{\s*await prisma\.einwilligungsText\.create\(/.test(seed));
pruefe("Semester werden nie per upsert/update geschrieben", !/semester\.(upsert|update|updateMany)\(/.test(seed));
pruefe(
  "Semester werden nur bei leerer Tabelle angelegt",
  /const (\w+) = await prisma\.semester\.count\(\);\s*if \(\1 === 0\) \{\s*await prisma\.semester\.createMany\(/.test(seed),
);

console.log("\n5. Seed: Mail-Betreffs ohne Personendaten (M6b)");
const vorlagenStart = seed.indexOf("const MAIL_VORLAGEN = [");
const vorlagenEnde = vorlagenStart >= 0 ? seed.indexOf("\n];", vorlagenStart) : -1;
const vorlagen = vorlagenStart >= 0 && vorlagenEnde > vorlagenStart ? seed.slice(vorlagenStart, vorlagenEnde) : "";
const betreffs = [...vorlagen.matchAll(/betreff:\s*"([^"]*)",/g)].map((m) => m[1]);
pruefe(
  "jeder Betreff ist ein einfacher String (keine Verkettung, die die Prüfung umgeht)",
  betreffs.length >= 10 && betreffs.length === (vorlagen.match(/betreff:/g) ?? []).length,
  { gefunden: betreffs.length, gesamt: (vorlagen.match(/betreff:/g) ?? []).length },
);
const PERSONENBEZUG = /name|mail|adresse|erreichbar|telefon|mitteilung|link|iban|geburt/i;
const mitPerson = betreffs.filter((b) =>
  [...b.matchAll(/\{\{\s*([A-Za-z_]+)\s*\}\}/g)].some((m) => PERSONENBEZUG.test(m[1])),
);
pruefe(
  "kein Betreff trägt einen Personen-Platzhalter ({{name}}, {{vorname}}, {{email}}, …)",
  betreffs.length > 0 && mitPerson.length === 0,
  mitPerson,
);

console.log("\n6. Migration: Einwilligungstexte eingefroren (M8)");
const ORDNER = "prisma/migrations/20260927100000_einwilligungstexte_unveraenderlich";
const migration = lies(`${ORDNER}/migration.sql`);
pruefe("die Migration ist lesbar", migration.length > 0);
pruefe(
  "UPDATE-Trigger einwilligungs_text_nur_aktiv_bis (BEFORE UPDATE, je Zeile)",
  /CREATE TRIGGER einwilligungs_text_nur_aktiv_bis\s+BEFORE UPDATE ON einwilligungs_texte\s+FOR EACH ROW/.test(migration),
);
pruefe(
  "DELETE-Trigger einwilligungs_text_kein_delete (BEFORE DELETE, je Zeile)",
  /CREATE TRIGGER einwilligungs_text_kein_delete\s+BEFORE DELETE ON einwilligungs_texte\s+FOR EACH ROW/.test(migration),
);
pruefe(
  "TRUNCATE-Trigger einwilligungs_text_kein_truncate (BEFORE TRUNCATE, je Anweisung)",
  /CREATE TRIGGER einwilligungs_text_kein_truncate\s+BEFORE TRUNCATE ON einwilligungs_texte\s+FOR EACH STATEMENT/.test(migration),
);
pruefe(
  "verglichen wird die Zeile ohne aktivBis, No-op-Updates gehen durch (IS NOT DISTINCT FROM)",
  /\(to_jsonb\(NEW\) - 'aktivBis'\) IS NOT DISTINCT FROM \(to_jsonb\(OLD\) - 'aktivBis'\)/.test(migration),
);
function migrationsDateien(): string[] {
  try {
    return readdirSync("prisma/migrations")
      .map((ordner) => join("prisma/migrations", ordner))
      .filter((pfad) => pfad !== ORDNER && statSync(pfad).isDirectory())
      .map((pfad) => join(pfad, "migration.sql"));
  } catch {
    return [];
  }
}
const andere = migrationsDateien();
const droppt = andere.filter((pfad) =>
  /DROP TRIGGER\s+(IF EXISTS\s+)?einwilligungs_text_|DROP FUNCTION\s+(IF EXISTS\s+)?einwilligungs_text_ist_unveraenderlich/i.test(lies(pfad)),
);
pruefe("keine andere Migration entfernt diese Trigger", andere.length > 0 && droppt.length === 0, droppt);

console.log("\n7. Quelltext: Ersatz-Betreffs ohne Personendaten (M6b)");
// Greift, wenn die Vorlage fehlt (frische Datenbank, gelöschte Vorlage). Der
// Betreff landet im Versandprotokoll an der personId der EMPFÄNGER — dort
// erreicht ihn keine Anonymisierung über die Person.
function quelltextDateien(ordner: string): string[] {
  try {
    return readdirSync(ordner).flatMap((eintrag) => {
      const pfad = join(ordner, eintrag);
      if (statSync(pfad).isDirectory()) return quelltextDateien(pfad);
      return /\.(ts|tsx)$/.test(pfad) ? [pfad] : [];
    });
  } catch {
    return [];
  }
}
// ersatzBetreff: "…" / betreff: `…` / vorlage?.betreff ?? "…" — jeweils mit
// einem String- oder Template-Literal (Aufrufe wie fuelleVorlage(…) zählen nicht).
const BETREFF_LITERAL = /(?:ersatzBetreff|betreff)\s*(?::|\?\?)\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
const codeBetreffs = quelltextDateien("src").flatMap((pfad) =>
  [...lies(pfad).matchAll(BETREFF_LITERAL)].map((m) => ({ pfad, betreff: m[2] })),
);
pruefe(
  "die Ersatz- und Rückfall-Betreffs unter src/ werden gefunden",
  codeBetreffs.filter((b) => b.pfad.endsWith("selbstpflege.ts")).length >= 3 && codeBetreffs.length >= 10,
  codeBetreffs.length,
);
const PLATZHALTER_PERSON = /\{\{\s*(name|vorname|nachname|email)\s*\}\}/i;
const mitPlatzhalter = codeBetreffs.filter((b) => PLATZHALTER_PERSON.test(b.betreff));
pruefe(
  "kein Betreff im Code trägt {{name}}, {{vorname}}, {{nachname}} oder {{email}}",
  mitPlatzhalter.length === 0,
  mitPlatzhalter,
);
// `${EINRICHTUNG.name}` ist der Name der Schule, keine Personenangabe.
const mitEinsetzung = codeBetreffs.filter((b) => /\$\{(?!EINRICHTUNG\.)[^}]*(name|mail)[^}]*\}/i.test(b.betreff));
pruefe("kein Betreff im Code setzt Name oder Adresse per ${…} ein", mitEinsetzung.length === 0, mitEinsetzung);
const ERSATZ_WIE_SEED: [string, string][] = [
  ["src/lib/anmeldung.ts", "Neue Anmeldung eingegangen"],
  ["src/lib/selbstpflege.ts", "Stammdaten geändert"],
  ["src/app/api/zugang-hilfe/route.ts", "Meldung zum Portalzugang"],
];
const abweichend = ERSATZ_WIE_SEED.filter(
  ([pfad, betreff]) => !lies(pfad).includes(`ersatzBetreff: "${betreff}"`) || !betreffs.includes(betreff),
);
pruefe("die drei Verwaltungs-Ersatzbetreffs lauten wie ihre Seed-Vorlage", abweichend.length === 0, abweichend);

console.log("\n8. Migration: alte Betreffs mit Namen im Versandprotokoll bereinigt (M6b)");
// Die neuen Vorlagen wirken nur für künftige Mails. Die alten Zeilen („Neue
// Anmeldung: Max Muster") erreicht die Anonymisierung nur über den aktuellen
// Namen — nach einer Namensänderung und für Namen aus dem Hilfeformular nie.
const BESTAND = lies("prisma/migrations/20260927130000_versandprotokoll_betreff_ohne_namen/migration.sql");
pruefe("die Migration ist lesbar", BESTAND.length > 0);
const BESTAND_REGELN: [string, string, string][] = [
  ["Neue Anmeldung:%", "Neue Anmeldung eingegangen", "ANMELDUNG_VERWALTUNG"],
  ["Stammdaten geändert:%", "Stammdaten geändert", "DATENAENDERUNG_VERWALTUNG"],
  ["Kommt nicht ins Portal:%", "Meldung zum Portalzugang", "ZUGANG_HILFE_MELDUNG"],
];
const nichtBereinigt = BESTAND_REGELN.filter(([alt, neu, code]) => {
  const muster = new RegExp(
    `UPDATE "email_versand"\\s+SET "betreff" = '${neu}'\\s+WHERE "betreff" LIKE '${alt}'\\s+` +
      `AND \\("vorlageCode" = '${code}' OR "vorlageCode" IS NULL\\);`,
  );
  return !muster.test(BESTAND) || !betreffs.includes(neu);
});
pruefe(
  "jeder alte Namens-Betreff wird zum Betreff seiner Seed-Vorlage (auch Zeilen ohne Vorlage, etwa Ausfallzeilen)",
  nichtBereinigt.length === 0,
  nichtBereinigt,
);
const ohneKommentare = BESTAND.replace(/--.*$/gm, "");
pruefe(
  "die Migration ändert nur Betreffs in email_versand (kein DROP, ALTER, DELETE oder TRUNCATE)",
  !/\b(DROP|ALTER|DELETE|TRUNCATE|INSERT)\b/i.test(ohneKommentare) &&
    (ohneKommentare.match(/UPDATE "email_versand"/g) ?? []).length === 3 &&
    (ohneKommentare.match(/\bUPDATE\b/g) ?? []).length === 3,
);

console.log("\n9. Entrypoint: Eigentümer-Passwort nicht in der Umgebung des Servers");
// Über env_file (.env) kommt DB_PASSWORD mit in den Container. Nach dem
// Umschalten auf gbs_app braucht der Server es nicht — bliebe es stehen, könnte
// Code im Serverprozess sich als Eigentümer verbinden und die Trigger entfernen.
const umschaltzweig = entrypoint.match(
  /export DATABASE_URL="\$APP_DATABASE_URL"\n(?:[ \t]*#[^\n]*\n)*[ \t]*unset DB_PASSWORD\n/,
);
pruefe(
  "im Umschaltzweig wird DB_PASSWORD direkt nach dem Umschalten entfernt",
  umschaltzweig !== null && entrypoint.indexOf("unset DB_PASSWORD") < entrypoint.indexOf("exec node server.js"),
);
const liestDbPasswort = quelltextDateien("src").filter((pfad) => /(?<!APP_)DB_PASSWORD/.test(lies(pfad)));
pruefe("kein Quelltext unter src/ liest DB_PASSWORD (das Entfernen bricht nichts)", liestDbPasswort.length === 0, liestDbPasswort);

console.log("\n10. Seed: Rechtematrix je Rolle atomar");
const matrixStart = seed.indexOf('console.log("[Seed] Rollen und Rechtematrix...");');
const matrixEnde = matrixStart >= 0 ? seed.indexOf('console.log("[Seed]', matrixStart + 10) : -1;
const matrix = matrixStart >= 0 && matrixEnde > matrixStart ? seed.slice(matrixStart, matrixEnde) : "";
pruefe(
  "Rolle, Löschen und Neuanlegen der Rechte laufen je Rolle in einer Transaktion",
  /await prisma\.\$transaction\(async \(tx\) => \{\s*await tx\.rolle\.upsert\([\s\S]*?await tx\.rolleRecht\.deleteMany\([\s\S]*?await tx\.rolleRecht\.createMany\(/.test(
    matrix,
  ),
);
pruefe(
  "die Rechtematrix wird nirgends außerhalb der Transaktion geschrieben",
  !/prisma\.(rolleRecht|rolle)\.(upsert|update|updateMany|create|createMany|delete|deleteMany)\(/.test(seed),
);

console.log("\n11. Migration: eingefrorene Belege (Sätze, Abrechnungen, Posten, Zeugnisse)");
const BELEGE_ORDNER = "prisma/migrations/20260927160000_belege_unveraenderlich";
const belege = lies(`${BELEGE_ORDNER}/migration.sql`);
pruefe("die Migration ist lesbar", belege.length > 0);
function funktion(name: string): string {
  const start = belege.indexOf(`CREATE OR REPLACE FUNCTION ${name}()`);
  const ende = start >= 0 ? belege.indexOf("$$ LANGUAGE plpgsql;", start) : -1;
  return start >= 0 && ende > start ? belege.slice(start, ende) : "";
}
const fSatz = funktion("honorar_satz_ist_eingefroren");
const fAbrechnung = funktion("honorar_abrechnung_ist_eingefroren");
const fPosten = funktion("honorar_posten_ist_eingefroren");
const fZeugnis = funktion("zeugnis_ist_eingefroren");
pruefe(
  "alle vier Trigger-Funktionen weisen mit insufficient_privilege ab",
  [fSatz, fAbrechnung, fPosten, fZeugnis].every((f) => f.includes("USING ERRCODE = 'insufficient_privilege'")),
);
const TRIGGER: [string, string, string, string, string][] = [
  ["honorar_satz_nur_dms_nachtrag", "UPDATE", "honorar_saetze", "ROW", "honorar_satz_ist_eingefroren"],
  ["honorar_satz_kein_delete", "DELETE", "honorar_saetze", "ROW", "honorar_satz_ist_eingefroren"],
  ["honorar_satz_kein_truncate", "TRUNCATE", "honorar_saetze", "STATEMENT", "honorar_satz_ist_eingefroren"],
  ["honorar_abrechnung_nur_statuskette", "UPDATE", "honorar_abrechnungen", "ROW", "honorar_abrechnung_ist_eingefroren"],
  ["honorar_abrechnung_delete_nur_offen", "DELETE", "honorar_abrechnungen", "ROW", "honorar_abrechnung_ist_eingefroren"],
  ["honorar_abrechnung_kein_truncate", "TRUNCATE", "honorar_abrechnungen", "STATEMENT", "honorar_abrechnung_ist_eingefroren"],
  ["honorar_posten_insert_nur_offen", "INSERT", "honorar_abrechnung_posten", "ROW", "honorar_posten_ist_eingefroren"],
  ["honorar_posten_kein_update", "UPDATE", "honorar_abrechnung_posten", "ROW", "honorar_posten_ist_eingefroren"],
  ["honorar_posten_delete_nur_storno", "DELETE", "honorar_abrechnung_posten", "ROW", "honorar_posten_ist_eingefroren"],
  ["honorar_posten_kein_truncate", "TRUNCATE", "honorar_abrechnung_posten", "STATEMENT", "honorar_posten_ist_eingefroren"],
  ["zeugnis_nur_status_dms_scrub", "UPDATE", "zeugnisse", "ROW", "zeugnis_ist_eingefroren"],
  ["zeugnis_kein_truncate", "TRUNCATE", "zeugnisse", "STATEMENT", "zeugnis_ist_eingefroren"],
];
const ohneTrigger = TRIGGER.filter(
  ([name, art, tabelle, ebene, fn]) =>
    !new RegExp(
      `CREATE TRIGGER ${name}\\s+BEFORE ${art} ON ${tabelle}\\s+FOR EACH ${ebene} EXECUTE FUNCTION ${fn}\\(\\);`,
    ).test(belege),
).map(([name]) => name);
pruefe("alle zwölf Trigger (INSERT/UPDATE/DELETE/TRUNCATE) sind angelegt", ohneTrigger.length === 0, ohneTrigger);
pruefe(
  "Posten: INSERT nur zu einer OFFENEN Abrechnung (nichts an Freigegebene anhängen)",
  /IF TG_OP = 'INSERT' THEN\n(?:\s*--[^\n]*\n)*\s*IF EXISTS \(SELECT 1 FROM honorar_abrechnungen WHERE id = NEW\."abrechnungId" AND status = 'OFFEN'\) THEN\s*RETURN NEW;/.test(
    fPosten,
  ),
);
// Summe = Summe der Posten, geprüft beim Commit — auf beiden Tabellen, damit
// weder ein Kopf ohne passende Posten noch ein nachgeschobener Posten durchgeht.
const fSumme = funktion("honorar_abrechnung_summe_pruefen");
const summenTrigger = [
  ["honorar_abrechnung_summe_passt", "honorar_abrechnungen"],
  ["honorar_posten_summe_passt", "honorar_abrechnung_posten"],
].filter(
  ([name, tabelle]) =>
    !new RegExp(
      `CREATE CONSTRAINT TRIGGER ${name}\\s+AFTER INSERT ON ${tabelle}\\s+DEFERRABLE INITIALLY DEFERRED\\s+FOR EACH ROW EXECUTE FUNCTION honorar_abrechnung_summe_pruefen\\(\\);`,
    ).test(belege),
);
pruefe(
  "Abrechnung: beim Commit gilt summe = Summe der Posten (verzögerter Constraint-Trigger auf Kopf und Posten)",
  summenTrigger.length === 0 &&
    /SELECT COALESCE\(SUM\(betrag\), 0\) INTO posten_summe FROM honorar_abrechnung_posten WHERE "abrechnungId" = kopf_id;/.test(fSumme) &&
    /IF posten_summe <> kopf_summe THEN\s*RAISE EXCEPTION/.test(fSumme) &&
    /IF NOT FOUND THEN\s*RETURN NULL;/.test(fSumme),
  summenTrigger.map(([name]) => name),
);

// Welche Spalten die jsonb-Zeile ohne Vergleich lassen darf — jede weitere
// wäre still änderbar (etwa 'summe' oder 'betrag').
function ausnahmen(f: string, seite: "NEW" | "OLD"): string[] | null {
  const m = f.match(new RegExp(`to_jsonb\\(${seite}\\) - ARRAY\\[([^\\]]*)\\]`));
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((t) => t[1]).sort() : null;
}
const AUSNAHMEN: [string, string, string[]][] = [
  ["Honorarsatz", fSatz, ["dmsBelegNr", "dmsGesendetAm"]],
  [
    "Abrechnung",
    fAbrechnung,
    ["status", "belegNr", "dmsGesendetAm", "freigegebenVonId", "freigegebenAm", "ausgezahltVonId", "ausgezahltAm"],
  ],
  ["Zeugnis", fZeugnis, ["status", "dmsGesendetAm", "snapshot"]],
];
for (const [name, f, erwartet] of AUSNAHMEN) {
  const neu = ausnahmen(f, "NEW");
  const alt = ausnahmen(f, "OLD");
  pruefe(
    `${name}: nur ${erwartet.join(", ")} sind vom Zeilenvergleich ausgenommen`,
    JSON.stringify(neu) === JSON.stringify([...erwartet].sort()) && JSON.stringify(alt) === JSON.stringify(neu),
    { neu, alt },
  );
}
pruefe(
  "Posten: die ganze Zeile wird verglichen (kein Feld änderbar)",
  /IF to_jsonb\(NEW\) IS NOT DISTINCT FROM to_jsonb\(OLD\) THEN/.test(fPosten),
);
const EINMALIG: [string, string, string[]][] = [
  ["Honorarsatz", fSatz, ["dmsBelegNr", "dmsGesendetAm"]],
  ["Abrechnung", fAbrechnung, ["belegNr", "dmsGesendetAm", "freigegebenVonId", "freigegebenAm", "ausgezahltVonId", "ausgezahltAm"]],
  ["Zeugnis", fZeugnis, ["dmsGesendetAm"]],
];
for (const [name, f, spalten] of EINMALIG) {
  const offen = spalten.filter(
    (s) => !f.includes(`(OLD."${s}" IS NULL OR NEW."${s}" IS NOT DISTINCT FROM OLD."${s}")`),
  );
  pruefe(`${name}: ${spalten.join(", ")} nur leer -> Wert, danach fest`, offen.length === 0, offen);
}
pruefe(
  "Abrechnung: Status nur OFFEN -> FREIGEGEBEN -> AUSGEZAHLT (keine weiteren Übergänge)",
  fAbrechnung.includes("(OLD.status = 'OFFEN' AND NEW.status = 'FREIGEGEBEN')") &&
    fAbrechnung.includes("(OLD.status = 'FREIGEGEBEN' AND NEW.status = 'AUSGEZAHLT')") &&
    (fAbrechnung.match(/NEW\.status = '/g) ?? []).length === 2,
);
pruefe(
  "Zeugnis: Status nur GUELTIG -> ERSETZT",
  fZeugnis.includes("(OLD.status = 'GUELTIG' AND NEW.status = 'ERSETZT')") &&
    (fZeugnis.match(/NEW\.status = '/g) ?? []).length === 1,
);
pruefe(
  "Abrechnung: DELETE (Storno) nur für OFFEN",
  /IF TG_OP = 'DELETE' THEN\n(?:\s*--[^\n]*\n)*\s*IF OLD\.status = 'OFFEN' THEN\s*RETURN OLD;/.test(fAbrechnung) &&
    (fAbrechnung.match(/RETURN OLD;/g) ?? []).length === 1,
);
pruefe(
  "Posten: DELETE nur, wenn die Abrechnung schon weg ist (Storno-Cascade)",
  /IF NOT EXISTS \(SELECT 1 FROM honorar_abrechnungen WHERE id = OLD\."abrechnungId"\) THEN\s*RETURN OLD;/.test(fPosten) &&
    (fPosten.match(/RETURN OLD;/g) ?? []).length === 1,
);
pruefe("Honorarsatz und Zeugnis: kein Weg lässt ein DELETE durch", !fSatz.includes("RETURN OLD") && !fZeugnis.includes("RETURN OLD"));

// Der Trigger lässt am Snapshot genau das durch, was die Anonymisierung
// schreibt. Ändert sich scrubbeZeugnisSnapshot, scheiterte die Anonymisierung
// sonst erst im Betrieb (42501).
const scrubLiteral = fZeugnis.match(/NEW\.snapshot -> 'person' = '(\{[^']*\})'::jsonb/);
let triggerPerson: unknown = undefined;
try {
  triggerPerson = scrubLiteral ? JSON.parse(scrubLiteral[1]) : undefined;
} catch {
  triggerPerson = undefined;
}
const probeSnapshot = {
  titel: "Semesterzeugnis",
  person: { name: "Max Muster", geburtsdatum: "01.01.1990" },
  leistungen: [{ fach: "AT-Bibelkunde", ergebnisText: "bestanden" }],
};
const gescrubbt = scrubbeZeugnisSnapshot(probeSnapshot) as Record<string, unknown>;
function sortiert(wert: unknown): string {
  return JSON.stringify(wert, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}
pruefe(
  "der Trigger erwartet im Snapshot genau die Person, die scrubbeZeugnisSnapshot schreibt",
  triggerPerson !== undefined && sortiert(triggerPerson) === sortiert(gescrubbt.person),
  { trigger: triggerPerson, scrub: gescrubbt.person },
);
const ohnePerson = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== "person"));
pruefe(
  "der Scrub ändert außer `person` nichts am Snapshot (sonst lehnte der Trigger ihn ab)",
  /\(NEW\.snapshot - 'person'\) = \(OLD\.snapshot - 'person'\)/.test(fZeugnis) &&
    sortiert(ohnePerson(gescrubbt)) === sortiert(ohnePerson(probeSnapshot)),
);
const belegeAndere = migrationsDateien().filter((pfad) => !pfad.startsWith(BELEGE_ORDNER));
const droptBelege = belegeAndere.filter((pfad) =>
  new RegExp(
    `DROP TRIGGER\\s+(IF EXISTS\\s+)?(${TRIGGER.map(([name]) => name).join("|")})\\b|DROP FUNCTION\\s+(IF EXISTS\\s+)?(honorar_satz|honorar_abrechnung|honorar_posten|zeugnis)_ist_eingefroren`,
    "i",
  ).test(lies(pfad)),
);
pruefe("keine andere Migration entfernt diese Trigger oder Funktionen", belegeAndere.length > 0 && droptBelege.length === 0, droptBelege);
const REVOKES = [
  "REVOKE UPDATE, DELETE, TRUNCATE ON honorar_abrechnung_posten FROM gbs_app",
  "REVOKE DELETE, TRUNCATE ON honorar_saetze FROM gbs_app",
  "REVOKE DELETE, TRUNCATE ON zeugnisse FROM gbs_app",
];
const posGrant = setup.indexOf("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gbs_app");
const ohneRevoke = REVOKES.filter((r) => setup.indexOf(r) <= posGrant);
pruefe("das Setup entzieht gbs_app DELETE auf Sätzen, Posten und Zeugnissen (nach dem GRANT)", posGrant >= 0 && ohneRevoke.length === 0, ohneRevoke);

console.log("\n12. Leistung -> Kurseinheit: RESTRICT statt CASCADE");
const schema = lies("prisma/schema.prisma");
const leistungModell = schema.slice(schema.indexOf("model Leistung {"), schema.indexOf("@@map(\"leistungen\")"));
pruefe(
  "schema.prisma: Leistung.kurseinheit mit onDelete: Restrict",
  /kurseinheit\s+Kurseinheit @relation\(fields: \[kurseinheitId\], references: \[id\], onDelete: Restrict\)/.test(leistungModell),
);
const letzteFkMigration = migrationsDateien()
  .concat(join(ORDNER, "migration.sql"))
  .sort()
  .filter((pfad) => lies(pfad).includes('ADD CONSTRAINT "leistungen_kurseinheitId_fkey"'))
  .pop();
pruefe(
  "die zuletzt angelegte Fassung des Fremdschlüssels ist ON DELETE RESTRICT",
  letzteFkMigration !== undefined &&
    letzteFkMigration.includes("20260927160500_leistung_kurseinheit_restrict") &&
    /ADD CONSTRAINT "leistungen_kurseinheitId_fkey" FOREIGN KEY \("kurseinheitId"\) REFERENCES "kurseinheiten"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE;/.test(
      lies(letzteFkMigration),
    ),
  letzteFkMigration,
);

console.log("\n13. PDF: Zeichen außerhalb von Latin-1");
const pdfAlsText = (s: string) => pdfText(s).toString("latin1");
pruefe(
  "polnisch/tschechisch: Łukasz Michał Dvořák -> Lukasz Michal Dvorák",
  pdfAlsText("Łukasz Michał Dvořák") === "Lukasz Michal Dvorák",
  pdfAlsText("Łukasz Michał Dvořák"),
);
pruefe("türkisch: Şahin Yıldız, İlkay Güneş -> Sahin Yildiz, Ilkay Günes", pdfAlsText("Şahin Yıldız, İlkay Güneş") === "Sahin Yildiz, Ilkay Günes");
pruefe("kroatisch/rumänisch: Đorđević, Ștefan Țepeș -> Dordevic, Stefan Tepes", pdfAlsText("Đorđević, Ștefan Țepeș") === "Dordevic, Stefan Tepes");
pruefe(
  "WinAnsi-Buchstaben über die Tabelle: Š Ž š ž Œ œ Ÿ -> 0x8A 0x8E 0x9A 0x9E 0x8C 0x9C 0x9F",
  pdfText("ŠŽšžŒœŸ").equals(Buffer.from([0x8a, 0x8e, 0x9a, 0x9e, 0x8c, 0x9c, 0x9f])),
  [...pdfText("ŠŽšžŒœŸ")],
);
pruefe("Šimić -> 0x8A imic", pdfText("Šimić").equals(Buffer.from([0x8a, ...Buffer.from("imic", "latin1")])));
pruefe("zerlegt gespeichertes é (e + Akzent) wird ein Latin-1-Zeichen", pdfText("René").equals(Buffer.from("René", "latin1")));
pruefe(
  "C1-Steuerzeichen und DEL werden Leerzeichen (nicht Š/Œ in WinAnsi)",
  pdfAlsText("A\u0085B\u008aC\u007fD\tE") === "A B C D E",
  pdfAlsText("A\u0085B\u008aC\u007fD\tE"),
);
pruefe("Umlaute bleiben Latin-1: Müller-Groß", pdfText("Müller-Groß").equals(Buffer.from("Müller-Groß", "latin1")));
pruefe("€ bleibt EUR, ( ) \\ werden escaped", pdfAlsText("120 € (bar) \\") === "120 EUR \\(bar\\) \\\\");
pruefe("unsichtbare Zeichen fallen weg, Emoji wird ?", pdfAlsText("Anna​Lena 🎉") === "AnnaLena ?", pdfAlsText("Anna​Lena 🎉"));
pruefe(
  "der Name landet transliteriert im erzeugten PDF",
  erzeugePdf([{ art: "kv", label: "Name", wert: "Łukasz Dvořák" }]).toString("latin1").includes("(Name: Lukasz Dvorák) Tj"),
);

console.log("\n14. Container-Log ohne Empfängeradressen");
const mailer = lies("src/lib/mailer.ts");
const verteiler = lies("src/lib/verteiler.ts");
function konsolenAufrufe(text: string): string[] {
  return [...text.matchAll(/console\.(?:log|info|warn|error)\(/g)].map((m) => {
    const start = m.index ?? 0;
    const ende = text.indexOf(");\n", start);
    return text.slice(start, ende >= 0 ? ende : undefined);
  });
}
const mailerAufrufe = konsolenAufrufe(mailer);
const mitAdresse = mailerAufrufe.filter((a) => /auftrag\.an\b/.test(a));
pruefe(
  "mailer.ts: nur die Entwicklungsausgabe (ohne SMTP, nicht Produktion) nennt die Adresse",
  mailerAufrufe.length >= 4 && mitAdresse.length === 1 && mitAdresse[0].includes("Entwicklungsmodus"),
  mitAdresse,
);
const versandAufrufe = [...mailerAufrufe, ...konsolenAufrufe(verteiler).filter((a) => a.includes("Versand fehlgeschlagen"))];
pruefe(
  "Versandfehler gehen nie als rohes Fehlerobjekt ins Log (nodemailer hängt Adressen an)",
  versandAufrufe.length >= 5 &&
    !versandAufrufe.some((a) => /,\s*(fehler|ausnahme)\s*,?\s*$/.test(a)) &&
    versandAufrufe.filter((a) => a.includes("fehlerFuersLog(fehler)")).length >= 4,
  versandAufrufe.filter((a) => /,\s*(fehler|ausnahme)\s*,?\s*$/.test(a)),
);
pruefe(
  "verteiler.ts: kein Log nennt die Adresse des Empfängers",
  konsolenAufrufe(verteiler).length >= 2 && !konsolenAufrufe(verteiler).some((a) => /\.email\b|\ban:/.test(a)),
);
const maske = mailer.match(/const ADRESSE_IM_TEXT = \/(.+)\/g;/);
const adresseImText = maske ? new RegExp(maske[1], "g") : null;
const maskiert = (s: string) => (adresseImText ? s.replace(adresseImText, "[Adresse]") : s);
pruefe(
  "die Maske ersetzt Adressen in Mailserver-Antworten",
  adresseImText !== null &&
    maskiert("550 5.1.1 <max.muster@example.de>: Recipient address rejected") ===
      "550 5.1.1 <[Adresse]>: Recipient address rejected" &&
    maskiert("all recipients were rejected: 550 anna-lena+gbs@mail.example.org") ===
      "all recipients were rejected: 550 [Adresse]" &&
    maskiert("Connection timeout (ETIMEDOUT)") === "Connection timeout (ETIMEDOUT)",
);
pruefe(
  "fehlerFuersLog maskiert über dieselbe Maske",
  /export function fehlerFuersLog\(fehler: unknown\): string \{[\s\S]*?return ohneAdressen\(/.test(mailer) &&
    /function ohneAdressen\(text: string\): string \{\s*return text\.replace\(ADRESSE_IM_TEXT, "\[Adresse\]"\);/.test(mailer),
);

console.log("\n15. Traefik: kein Default-Router für den eigenen Container");
const traefik = dienste.get("traefik") ?? "";
pruefe(
  "der traefik-Container trägt weder traefik.enable noch Labels",
  traefik.length > 0 && !traefik.includes('"traefik.enable=') && !/\n\s+labels:/.test(traefik),
);
pruefe(
  "die Sicherheits-Header kommen aus dem Datei-Provider (eingebunden und am Entrypoint gesetzt)",
  traefik.includes('"--providers.file.filename=/etc/traefik/dynamisch.yml"') &&
    traefik.includes("./docker/traefik-dynamisch.yml:/etc/traefik/dynamisch.yml:ro") &&
    traefik.includes('"--entrypoints.websecure.http.middlewares=gbs-sicherheit@file"') &&
    !compose.includes("gbs-sicherheit@docker"),
);
const dynamisch = lies("docker/traefik-dynamisch.yml");
const HEADER = [
  "stsSeconds: 31536000",
  "stsIncludeSubdomains: true",
  "frameDeny: true",
  "contentTypeNosniff: true",
  "referrerPolicy: strict-origin-when-cross-origin",
];
pruefe(
  "docker/traefik-dynamisch.yml definiert gbs-sicherheit mit allen fünf Headern",
  /\nhttp:\n\s+middlewares:\n\s+gbs-sicherheit:\n\s+headers:\n/.test(dynamisch) && HEADER.every((h) => dynamisch.includes(h)),
  HEADER.filter((h) => !dynamisch.includes(h)),
);

console.log("\n16. Build: Prüfungen gaten das Image, in Europe/Berlin");
const dockerfile = lies("Dockerfile");
const builder = dockerfile.slice(dockerfile.indexOf("AS builder"), dockerfile.indexOf("AS runner"));
pruefe(
  "Builder-Stufe: TZ=Europe/Berlin, dann npm run pruefen, dann npm run build",
  builder.length > 0 &&
    builder.indexOf("ENV TZ=Europe/Berlin") >= 0 &&
    builder.indexOf("ENV TZ=Europe/Berlin") < builder.indexOf("RUN npm run pruefen") &&
    builder.indexOf("RUN npm run pruefen") < builder.indexOf("RUN npm run build"),
);
let paket: { scripts?: Record<string, string> } = {};
try {
  paket = JSON.parse(lies("package.json"));
} catch {
  paket = {};
}
const pruefenSkript = paket.scripts?.pruefen ?? "";
const alleSkript = lies("scripts/pruefe-alle.ts");
const alleListe = [...(alleSkript.match(/const SKRIPTE = \[([\s\S]*?)\];/)?.[1] ?? "").matchAll(/"(pruefe-[^"]+\.ts)"/g)].map(
  (m) => m[1],
);
const imLauf = pruefenSkript.includes("scripts/pruefe-alle.ts")
  ? alleListe
  : [...pruefenSkript.matchAll(/scripts\/(pruefe-[^\s&]+\.ts)/g)].map((m) => m[1]);
const mitDb = [...(paket.scripts?.["pruefen:db"] ?? "").matchAll(/scripts\/(pruefe-[^\s&]+\.ts)/g)].map((m) => m[1]);
let aufPlatte: string[] = [];
try {
  aufPlatte = readdirSync("scripts").filter((d) => /^pruefe-.+\.ts$/.test(d) && d !== "pruefe-alle.ts");
} catch {
  aufPlatte = [];
}
const nichtImLauf = aufPlatte.filter((d) => !imLauf.includes(d) && !mitDb.includes(d));
pruefe(
  "jedes DB-freie Prüfskript läuft in npm run pruefen (direkt oder über pruefe-alle.ts)",
  aufPlatte.length >= 19 && mitDb.length >= 1 && nichtImLauf.length === 0,
  nichtImLauf,
);
pruefe(
  "pruefe-alle.ts: startet jedes Skript in Europe/Berlin und kennt alle Prüfskripte",
  /const ZEITZONE = "Europe\/Berlin";/.test(alleSkript) &&
    /env: \{ \.\.\.process\.env, TZ: ZEITZONE \}/.test(alleSkript) &&
    aufPlatte.every((d) => alleListe.includes(d) || alleSkript.includes(`"${d}"`)),
);

console.log("\n17. Betriebsansicht: Portalzugang und offene DMS-Belege");
const betrieb = lies("src/app/verwaltung/betrieb/page.tsx");
pruefe(
  "der Hinweis zum Anmeldelink berücksichtigt den Passwort-Login",
  betrieb.includes("Für alle ohne Passwort ist der Anmeldelink") &&
    !betrieb.includes("Der Anmeldelink per E-Mail ist der einzige Weg ins Portal"),
);
pruefe(
  "offene DMS-Belege werden gezählt (Zahlungsbelege, Honorarsätze, Zeugnisse)",
  /prisma\.honorarAbrechnung\.count\(\{\s*where: \{ status: \{ not: "OFFEN" \}, belegNr: \{ not: null \}, dmsGesendetAm: null \}/.test(betrieb) &&
    /prisma\.honorarSatz\.count\(\{ where: \{ dmsBelegNr: \{ not: null \}, dmsGesendetAm: null \} \}\)/.test(betrieb) &&
    betrieb.includes("zaehleOffeneDmsArchivierungen()"),
);
pruefe(
  "eine fehlende DMS_EMAIL wird gemeldet",
  /const dmsEingerichtet = dmsAdresse\(\) !== null;/.test(betrieb) && /\{!dmsEingerichtet && \(/.test(betrieb),
);
const dashboard = lies("src/app/verwaltung/page.tsx");
pruefe(
  "die Dashboard-Kachel „Betrieb“ berücksichtigt den Passwort-Login",
  dashboard.includes("Ohne Mail kommt, wer kein Passwort hat, nicht ins Portal.") &&
    !dashboard.includes("Ohne Mail kommt niemand ins Portal"),
);
const fehlerseite = lies("src/app/error.tsx");
pruefe(
  "Fehlerseite: „Erneut versuchen“ lädt beim Server neu, zeigt und loggt den Fehlercode",
  /router\.refresh\(\);\s*reset\(\);/.test(fehlerseite) &&
    fehlerseite.includes("{error.digest}") &&
    fehlerseite.includes("console.error(error)"),
);
const ladeGrenzen = quelltextDateien("src/app").filter((p) => /(^|[\\/])loading\.tsx$/.test(p));
pruefe(
  "keine loading.tsx im App-Router (Seiten-Weiterleitungen blieben sonst nicht 307/404, sondern 200 + Meta-Refresh)",
  ladeGrenzen.length === 0,
  ladeGrenzen,
);
{
  // Auch die Links in die schweren Seiten (Detailakte aus der Personenliste,
  // Abrechnung, Teilnehmer, Formular, /dozent → /meine-daten) melden sich.
  const mitHinweis = [
    "src/components/ui/kachel.tsx",
    "src/components/ui/zurueck-leiste.tsx",
    "src/app/verwaltung/personen/page.tsx",
    "src/app/verwaltung/honorar/abrechnungen/page.tsx",
    "src/app/verwaltung/teilnehmer/page.tsx",
    "src/app/verwaltung/formulare/page.tsx",
    "src/app/dozent/page.tsx",
  ].filter((pfad) => !lies(pfad).includes("<LadeHinweis"));
  pruefe(
    "Rückmeldung beim Seitenwechsel: Kachel, Zurück-Leiste und die Listen-Links tragen den Lade-Hinweis (useLinkStatus)",
    lies("src/components/ui/lade-hinweis.tsx").includes("useLinkStatus()") && mitHinweis.length === 0,
    mitHinweis,
  );
  const ladeHinweis = lies("src/components/ui/lade-hinweis.tsx");
  pruefe(
    "der Lade-Hinweis pulsiert nicht als Text (Kontrast unter 4,5:1), nur ein dekorativer Punkt während des Ladens",
    /<span role="status" className=\{`inline-block text-xs font-normal text-muted-foreground \$\{className\}`\}>/.test(ladeHinweis) &&
      /\{pending && \(\s*<>\s*<span aria-hidden="true" className="motion-safe:animate-pulse">/.test(ladeHinweis),
  );
}

console.log("\n18. Worker: Healthcheck, Lebenszeichen in der Betriebsansicht, Antwortfrist in den Mails");
pruefe(
  "der Dienst worker hat einen Healthcheck auf das Lebenszeichen — und kein depends_on auf app",
  /healthcheck:/.test(worker) &&
    worker.includes("/tmp/gbs-worker-lebenszeichen") &&
    worker.includes("-mmin") &&
    !/depends_on:[\s\S]*?\n\s+app:/.test(worker),
);
pruefe(
  "die Betriebsseite liest das Lebenszeichen des Workers und gescheiterte Läufe",
  betrieb.includes('objektId: "WORKER"') && betrieb.includes('"WORKER_LAUF_FEHLGESCHLAGEN"'),
);
{
  const vorlage = (code: string) => {
    const start = vorlagen.indexOf(`code: "${code}"`);
    return start < 0 ? "" : vorlagen.slice(start, vorlagen.indexOf("\n  },", start));
  };
  pruefe(
    "Einladung und Erinnerung der Überleitung nennen die Antwortfrist ({{frist}})",
    /textMd:[\s\S]*\{\{frist\}\}/.test(vorlage("UEBERLEITUNG_EINLADUNG")) &&
      /textMd:[\s\S]*\{\{frist\}\}/.test(vorlage("UEBERLEITUNG_ERINNERUNG")),
  );
}

console.log("\n19. Oberfläche: gemeinsame Bausteine statt Kopien (Code-Review 4, Querschnitt)");
{
  const oberflaeche = [...quelltextDateien("src/app"), ...quelltextDateien("src/components")];
  const text = (pfad: string) => lies(pfad);
  // (a) Live-Regionen: vorher entstand die Region erst mit ihrem Text und
  // wurde von Screenreadern oft nicht angesagt.
  const meldung = lies("src/components/ui/meldung.tsx");
  pruefe(
    "MeldungsBox: status- und alert-Region stehen immer im DOM (leer sr-only)",
    /<div role="status" className=\{hoeflich \? box\(meldung\.art\) : "sr-only"\}>/.test(meldung) &&
      /<div role="alert" className=\{dringend \? box\("fehler"\) : "sr-only"\}>/.test(meldung),
  );
  const nachtraeglich = oberflaeche.filter((pfad) =>
    /\{meldung && \(\s*<(?:p|div)\s+role=\{meldung\.art/.test(text(pfad)),
  );
  pruefe("keine Meldung fügt ihre Live-Region erst mit dem Text ein", nachtraeglich.length === 0, nachtraeglich);
  // (b) Seitentitel (WCAG 2.4.2).
  const seiten = quelltextDateien("src/app").filter((pfad) => /(^|[\\/])page\.tsx$/.test(pfad));
  const ohneTitel = seiten.filter((pfad) => !/export const metadata\b[\s\S]{0,120}title:|export async function generateMetadata/.test(text(pfad)));
  pruefe(
    "jede Seite setzt einen eigenen Titel; die Vorlage hängt „· GBS Campus“ an",
    seiten.length >= 30 &&
      ohneTitel.length === 0 &&
      /title: \{ default: "GBS Campus", template: "%s · GBS Campus" \}/.test(lies("src/app/layout.tsx")),
    ohneTitel,
  );
  // (c) Rückwege nur über die Zurück-Leiste.
  const handRueckweg = oberflaeche.filter((pfad) => !pfad.endsWith("zurueck-leiste.tsx") && /←/.test(text(pfad)));
  pruefe("kein handgeschriebener „←“-Rückweg außerhalb der Zurück-Leiste", handRueckweg.length === 0, handRueckweg);
  // (d) Status-Badges aus components/ui/badges.tsx, keine lokalen Tint-Tabellen —
  // auch nicht in src/components außerhalb von components/ui und auch nicht als
  // *_TON-Tabelle (die Detailakte färbte Abende sonst anders als die Schüler-Akte).
  const lokaleTabellen = oberflaeche
    .filter((pfad) => !/components[\\/]ui[\\/]/.test(pfad))
    .filter((pfad) => /const (BADGE|STATUS_STIL|STATUS_NAME|[A-Z_]*_TON)\b/.test(text(pfad)));
  pruefe(
    "keine lokale Tint-/Klartext-Tabelle für Status in src/app und src/components (außer components/ui)",
    lokaleTabellen.length === 0 && /<AnwesenheitBadge status=\{termin\.status\} \/>/.test(lies("src/components/personen/anwesenheit-liste.tsx")),
    lokaleTabellen,
  );
  const querImporte = oberflaeche.filter(
    (pfad) => !pfad.includes(`app${"/"}verwaltung`) && /from "@\/app\/verwaltung\//.test(text(pfad)),
  );
  pruefe(
    "geteilte Komponenten liegen unter src/components — niemand importiert aus app/verwaltung",
    querImporte.length === 0 && /ANMELDUNG_TON|AnmeldungStatusBadge/.test(lies("src/components/ui/badges.tsx")),
    querImporte,
  );
  // (e) Datumsausgabe über lib/datum.ts (immer Europe/Berlin).
  const inlineDatum = oberflaeche.filter((pfad) => /toLocaleDateString\(|toLocaleString\("de-DE", \{/.test(text(pfad)));
  pruefe("keine Datumsformatierung am Helfer vorbei (toLocale…String)", inlineDatum.length === 0, inlineDatum);
  // (f) Name und Träger der Einrichtung nur in constants.ts (Kommentare zählen nicht).
  const ohneKommentare = (quelle: string) =>
    quelle
      .split("\n")
      .filter((zeile) => !/^\s*(\*|\/\/|\/\*)/.test(zeile))
      .join("\n");
  const festerName = quelltextDateien("src").filter(
    (pfad) =>
      !pfad.endsWith("constants.ts") && /Gemeindebibelschule Minden|Christliches Werk Esra/.test(ohneKommentare(text(pfad))),
  );
  pruefe(
    "Name und Träger der Einrichtung stehen nur in EINRICHTUNG (constants.ts)",
    festerName.length === 0 && /name: "Gemeindebibelschule Minden",/.test(lies("src/lib/constants.ts")),
    festerName,
  );
}

// Soll-Anzahl: fängt lautlos entfallene Prüfungen ab. Beim Ergänzen anheben.
const ERWARTET = 110;
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);
