/**
 * Gegenprobe für die Herkunftsprüfung schreibender API-Anfragen (CSRF-Schutz),
 * DB-frei. Die Regel steht in src/lib/herkunft.ts, angewendet wird sie in
 * src/middleware.ts auf /api/*.
 *
 * ACHTUNG beim Erweitern: Eine Prüfung beweist erst dann etwas, wenn sie ROT
 * wird, sobald man die geprüfte Regel entfernt. Deshalb schicken die Fälle zur
 * Origin-Regel KEIN Sec-Fetch-Site mit (wie ältere Browser) — sonst würde die
 * zweite Regel den Fall mit abweisen, und ein Entfernen der Origin-Regel bliebe
 * unbemerkt. Geprüft wird außerdem der Grund, nicht nur „abgewiesen".
 *
 * Dazu die Startprüfung von APP_URL (src/lib/konfiguration.ts), an der die
 * erwartete Herkunft hängt, und die Laufzeit-Weiche in src/instrumentation.ts,
 * die wegen der Edge-Middleware nötig ist.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { erwarteterOrigin, pruefeHerkunft, type HerkunftsAnfrage } from "../src/lib/herkunft";
import { pruefeAppUrl, pruefeKonfiguration } from "../src/lib/konfiguration";
import { drosselSchluesselFuerIp } from "../src/lib/request-kontext";

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

const APP_URL = "https://gbs.fes-credo.de";
const EIGEN = "https://gbs.fes-credo.de";

function anfrage(teil: Partial<HerkunftsAnfrage>): HerkunftsAnfrage {
  return { methode: "POST", origin: null, secFetchSite: null, appUrl: APP_URL, ...teil };
}

function erlaubt(teil: Partial<HerkunftsAnfrage>): boolean {
  return pruefeHerkunft(anfrage(teil)).erlaubt;
}

function grund(teil: Partial<HerkunftsAnfrage>): string {
  const e = pruefeHerkunft(anfrage(teil));
  return e.erlaubt ? "erlaubt" : e.grund;
}

console.log("\n1. Erwartete Herkunft aus APP_URL");
pruefe("einfache Adresse bleibt wie sie ist", erwarteterOrigin("https://gbs.fes-credo.de") === EIGEN);
pruefe(
  "Schrägstrich, Pfad und Abfrage fallen weg",
  erwarteterOrigin("https://gbs.fes-credo.de/campus/start?x=1") === EIGEN,
  erwarteterOrigin("https://gbs.fes-credo.de/campus/start?x=1"),
);
pruefe(
  "Großschreibung und Standardport werden wie im Browser geschrieben",
  erwarteterOrigin("HTTPS://GBS.Fes-Credo.de:443") === EIGEN,
  erwarteterOrigin("HTTPS://GBS.Fes-Credo.de:443"),
);
pruefe(
  "ein anderer Port bleibt erhalten",
  erwarteterOrigin("http://127.0.0.1:3000/") === "http://127.0.0.1:3000",
  erwarteterOrigin("http://127.0.0.1:3000/"),
);
pruefe(
  "fehlende, unvollständige oder nicht-http(s) APP_URL ergibt keine Herkunft",
  erwarteterOrigin(undefined) === null &&
    erwarteterOrigin("") === null &&
    erwarteterOrigin("gbs.fes-credo.de") === null &&
    erwarteterOrigin("ftp://gbs.fes-credo.de") === null,
);

console.log("\n2. Lesende Methoden sind immer frei");
pruefe(
  "GET mit fremdem Origin und cross-site geht durch",
  erlaubt({ methode: "GET", origin: "https://angreifer.example", secFetchSite: "cross-site" }),
);
pruefe(
  "HEAD und OPTIONS mit fremdem Origin gehen durch",
  erlaubt({ methode: "HEAD", origin: "https://angreifer.example", secFetchSite: "cross-site" }) &&
    erlaubt({ methode: "OPTIONS", origin: "https://angreifer.example", secFetchSite: "cross-site" }),
);

console.log("\n3. Origin vorhanden — muss exakt passen");
pruefe("gleicher Origin geht durch", erlaubt({ origin: EIGEN }));
pruefe(
  "gleicher Origin mit Sec-Fetch-Site same-origin geht durch (der Normalfall im Browser)",
  erlaubt({ origin: EIGEN, secFetchSite: "same-origin" }),
);
pruefe(
  "fremde Subdomain derselben Site wird abgewiesen",
  grund({ origin: "https://evil.fes-credo.de" }) === "fremder-origin",
  grund({ origin: "https://evil.fes-credo.de" }),
);
pruefe(
  "fremde Site wird abgewiesen",
  grund({ origin: "https://angreifer.example" }) === "fremder-origin",
  grund({ origin: "https://angreifer.example" }),
);
pruefe(
  "anderes Schema (http statt https) wird abgewiesen",
  grund({ origin: "http://gbs.fes-credo.de" }) === "fremder-origin",
  grund({ origin: "http://gbs.fes-credo.de" }),
);
pruefe(
  "anderer Port wird abgewiesen",
  grund({ origin: "https://gbs.fes-credo.de:8443" }) === "fremder-origin",
  grund({ origin: "https://gbs.fes-credo.de:8443" }),
);
pruefe(
  "Großschreibung im Origin wird abgewiesen (so schreibt kein Browser)",
  grund({ origin: "https://GBS.fes-credo.de" }) === "fremder-origin",
  grund({ origin: "https://GBS.fes-credo.de" }),
);
pruefe(
  "Origin „null\" (Sandbox-Frame, Datei, Umleitung) wird abgewiesen",
  grund({ origin: "null" }) === "fremder-origin",
  grund({ origin: "null" }),
);
pruefe("leerer Origin wird abgewiesen", grund({ origin: "" }) === "fremder-origin", grund({ origin: "" }));
pruefe(
  "PUT, PATCH und DELETE mit fremdem Origin werden abgewiesen",
  !erlaubt({ methode: "PUT", origin: "https://evil.fes-credo.de" }) &&
    !erlaubt({ methode: "PATCH", origin: "https://evil.fes-credo.de" }) &&
    !erlaubt({ methode: "DELETE", origin: "https://evil.fes-credo.de" }),
);
pruefe(
  "APP_URL mit Pfad: der eigene Origin geht trotzdem durch",
  erlaubt({ origin: EIGEN, appUrl: "https://gbs.fes-credo.de/campus/" }),
);
pruefe(
  "ohne gültige APP_URL wird ein Origin abgewiesen statt durchgewunken",
  grund({ origin: EIGEN, appUrl: undefined }) === "app-url-ungueltig" &&
    grund({ origin: EIGEN, appUrl: "gbs.fes-credo.de" }) === "app-url-ungueltig",
  [grund({ origin: EIGEN, appUrl: undefined }), grund({ origin: EIGEN, appUrl: "gbs.fes-credo.de" })],
);
pruefe(
  "gleicher Origin, aber Sec-Fetch-Site cross-site wird abgewiesen",
  grund({ origin: EIGEN, secFetchSite: "cross-site" }) === "fremde-fetch-site",
  grund({ origin: EIGEN, secFetchSite: "cross-site" }),
);

console.log("\n4. Origin fehlt — dann entscheidet Sec-Fetch-Site");
pruefe(
  "cross-site wird abgewiesen",
  grund({ secFetchSite: "cross-site" }) === "fremde-fetch-site",
  grund({ secFetchSite: "cross-site" }),
);
pruefe(
  "same-site (Nachbar-Subdomain) wird abgewiesen",
  grund({ secFetchSite: "same-site" }) === "fremde-fetch-site",
  grund({ secFetchSite: "same-site" }),
);
pruefe("same-origin geht durch", erlaubt({ secFetchSite: "same-origin" }));
pruefe("none (vom Menschen selbst ausgelöst) geht durch", erlaubt({ secFetchSite: "none" }));
pruefe(
  "unbekannter oder anders geschriebener Wert wird abgewiesen",
  grund({ secFetchSite: "Same-Origin" }) === "fremde-fetch-site" && grund({ secFetchSite: "" }) === "fremde-fetch-site",
  [grund({ secFetchSite: "Same-Origin" }), grund({ secFetchSite: "" })],
);
pruefe(
  "ohne beide Header (curl, Cron, Durchstich) geht die Anfrage durch",
  erlaubt({ origin: null, secFetchSite: null }),
);

console.log("\n5. Startprüfung von APP_URL — die Herkunft muss sich daraus ergeben");
const PROD = { produktion: true, appDomain: "gbs.fes-credo.de" };
const PROD_OHNE_DOMAIN = { produktion: true, appDomain: undefined };
const ENTWICKLUNG_OHNE_DOMAIN = { produktion: false, appDomain: undefined };
pruefe(
  "passende APP_URL geht durch — auch mit Pfad, Schrägstrich, Großschreibung oder ohne APP_DOMAIN",
  pruefeAppUrl("https://gbs.fes-credo.de", PROD) === null &&
    pruefeAppUrl("https://GBS.fes-credo.de/campus/", PROD) === null &&
    pruefeAppUrl("https://gbs.fes-credo.de", { produktion: true, appDomain: " GBS.fes-credo.de " }) === null &&
    pruefeAppUrl("https://gbs.fes-credo.de", PROD_OHNE_DOMAIN) === null,
  [
    pruefeAppUrl("https://gbs.fes-credo.de", PROD),
    pruefeAppUrl("https://GBS.fes-credo.de/campus/", PROD),
    pruefeAppUrl("https://gbs.fes-credo.de", { produktion: true, appDomain: " GBS.fes-credo.de " }),
    pruefeAppUrl("https://gbs.fes-credo.de", PROD_OHNE_DOMAIN),
  ],
);
pruefe(
  "nur ein Schema ohne Host („https://\") wird abgelehnt — daraus ergibt sich keine Herkunft",
  pruefeAppUrl("https://", PROD_OHNE_DOMAIN) !== null && pruefeAppUrl("http://", ENTWICKLUNG_OHNE_DOMAIN) !== null,
);
pruefe(
  "weicht der Host in Produktion von APP_DOMAIN ab, wird abgelehnt",
  pruefeAppUrl("https://gbs-campus.fes-credo.de", PROD) !== null && pruefeAppUrl("https://fes-credo.de", PROD) !== null,
);
pruefe(
  "in Produktion hinter Traefik (APP_DOMAIN gesetzt) muss APP_URL https sein — sonst wird jede Änderung abgewiesen",
  pruefeAppUrl("http://gbs.fes-credo.de", PROD) !== null &&
    pruefeAppUrl("http://gbs.fes-credo.de", { produktion: false, appDomain: "gbs.fes-credo.de" }) === null,
  [
    pruefeAppUrl("http://gbs.fes-credo.de", PROD),
    pruefeAppUrl("http://gbs.fes-credo.de", { produktion: false, appDomain: "gbs.fes-credo.de" }),
  ],
);
pruefe(
  "außerhalb der Produktion spielt APP_DOMAIN keine Rolle (npm run dev, lokale Tests)",
  pruefeAppUrl("http://localhost:3000", { produktion: false, appDomain: "gbs.fes-credo.de" }) === null,
  pruefeAppUrl("http://localhost:3000", { produktion: false, appDomain: "gbs.fes-credo.de" }),
);
pruefe(
  "die bisherigen Regeln gelten weiter: fehlt, ohne Schema, localhost in Produktion",
  pruefeAppUrl(undefined, PROD) === "fehlt" &&
    pruefeAppUrl("", PROD) === "fehlt" &&
    pruefeAppUrl("gbs.fes-credo.de", PROD_OHNE_DOMAIN) !== null &&
    pruefeAppUrl("http://localhost:3000", PROD_OHNE_DOMAIN) !== null,
);
// Der Startprüfer selbst liest process.env — hier kurz umgestellt und sofort
// zurückgesetzt, damit auffällt, wenn PFLICHT die Regel nicht mehr aufruft.
const appUrlVorher = process.env.APP_URL;
process.env.APP_URL = "https://";
const befundeOhneHost = pruefeKonfiguration();
if (appUrlVorher === undefined) delete process.env.APP_URL;
else process.env.APP_URL = appUrlVorher;
pruefe(
  "der Startprüfer wendet diese Regel beim Start auch an",
  befundeOhneHost.some((b) => b.name === "APP_URL"),
  befundeOhneHost.map((b) => b.name),
);

console.log("\n6. Startprüfung nur in der Node-Laufzeit");
// Seit es die Edge-Middleware gibt, ruft Next register() zusätzlich in der
// Edge-Sandbox auf. Die Weiche muss VOR der Prüfung stehen (Begründung im Kopf
// von src/instrumentation.ts).
let instrumentation = "";
try {
  instrumentation = readFileSync("src/instrumentation.ts", "utf8");
} catch {
  instrumentation = "";
}
const weiche = instrumentation.indexOf('if (process.env.NEXT_RUNTIME === "nodejs") {');
pruefe(
  "register() prüft nur unter NEXT_RUNTIME nodejs — die Weiche steht vor Prüfung und process.exit",
  weiche >= 0 &&
    weiche < instrumentation.indexOf("pruefeKonfiguration()") &&
    weiche < instrumentation.indexOf("process.exit(1)"),
  weiche,
);

console.log("\n7. Drosselschlüssel je Anschluss: IPv6 auf das /64-Netz gekürzt");
pruefe("IPv4 bleibt unverändert", drosselSchluesselFuerIp("203.0.113.7") === "203.0.113.7");
{
  const a = drosselSchluesselFuerIp("2001:db8:1:2:aaaa::1");
  const b = drosselSchluesselFuerIp("2001:db8:1:2:bbbb:cccc:dddd:eeee");
  pruefe("zwei Adressen im selben /64 teilen sich einen Schlüssel", a === b && a === "2001:db8:1:2::/64", { a, b });
  const c = drosselSchluesselFuerIp("2001:db8:1:3::1");
  pruefe("ein anderes /64 bekommt einen anderen Schlüssel", c === "2001:db8:1:3::/64" && c !== a, c);
}
pruefe(
  "führende Nullen und Großschreibung ändern den Schlüssel nicht",
  drosselSchluesselFuerIp("2001:0DB8:0001:0002::5") === "2001:db8:1:2::/64",
  drosselSchluesselFuerIp("2001:0DB8:0001:0002::5"),
);
pruefe("::1 wird zu 0:0:0:0::/64", drosselSchluesselFuerIp("::1") === "0:0:0:0::/64", drosselSchluesselFuerIp("::1"));
pruefe(
  "IPv4-gemappte IPv6-Adresse zählt als IPv4",
  drosselSchluesselFuerIp("::ffff:203.0.113.7") === "203.0.113.7",
  drosselSchluesselFuerIp("::ffff:203.0.113.7"),
);
{
  function quelltext(ordner: string): string[] {
    try {
      return readdirSync(ordner).flatMap((eintrag) => {
        const pfad = join(ordner, eintrag);
        if (statSync(pfad).isDirectory()) return quelltext(pfad);
        return /\.(ts|tsx)$/.test(pfad) ? [pfad] : [];
      });
    } catch {
      return [];
    }
  }
  const dateien = quelltext("src");
  const ungekuerzt = dateien.filter((pfad) => /_IP:\$\{(?!drosselSchluesselFuerIp\()/.test(readFileSync(pfad, "utf8")));
  const gekuerzt = dateien.filter((pfad) => /_IP:\$\{drosselSchluesselFuerIp\(/.test(readFileSync(pfad, "utf8")));
  pruefe(
    "jede Anschlussdrossel (…_IP:) kürzt die Adresse über drosselSchluesselFuerIp",
    ungekuerzt.length === 0 && gekuerzt.length >= 4,
    { ungekuerzt, gekuerzt },
  );
}

// Soll-Anzahl: fängt lautlos entfallene Prüfungen ab. Beim Ergänzen anheben.
const ERWARTET = 42;
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);
