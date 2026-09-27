/**
 * GBS Campus — Worker
 *
 * Läuft als eigener Container (docker-compose-Dienst `worker`) und übernimmt die
 * zeitgesteuerten Aufgaben, die kein Nutzer auslöst:
 *  - ab Semesterstart die Abmeldung der Eingeladenen ohne Antwort
 *    (`schliesseRueckmeldungen`, Grund KEINE_RUECKMELDUNG)
 *  - die Überleitungs-Erinnerungen T−14/−7/−3 (`fuehreErinnerungslauf`)
 *  - den DSGVO-Aufräumlauf (`raeumeAuf`)
 *
 * Alle drei sind idempotent, deshalb genügt ein stündlicher Takt — kein präzises
 * Tages-Timing nötig, und trotzdem kein Doppelversand (die Erinnerungen tragen je
 * Stufe eine DB-Marke) und keine doppelte Abmeldung (bedingtes Update). Da beide
 * Überleitungs-Läufe tagesgenau greifen, ist eine Verzögerung von bis zu einer
 * Stunde beim ersten Start ohne Bedeutung.
 *
 * Lebenszeichen, damit ein stehender Worker auffällt (Projektregel „Was der
 * Betrieb nicht sehen kann, ist kaputt"):
 *  - Nach jedem Lauf, in dem mindestens ein Teillauf gelungen ist, schreibt er
 *    den Zeitpunkt in `LEBENSZEICHEN_DATEI`; der Docker-Healthcheck des Dienstes
 *    prüft, dass die Datei jünger als gut zwei Takte ist. Scheitern alle drei
 *    (etwa weil der Worker die Datenbank nicht erreicht), bleibt es aus — sonst
 *    stünde der Healthcheck dauerhaft auf grün, obwohl nichts passiert, und
 *    auch das Fehler-Audit ließe sich dann nicht schreiben.
 *  - Der Aufräumlauf schreibt mit Herkunft WORKER spätestens alle zwölf Stunden
 *    `AUFRAEUMEN_GELAUFEN` — daran liest die Betriebsansicht „Worker zuletzt
 *    gelaufen" ab, getrennt von den gelegentlichen Läufen der App.
 *  - Scheitert ein Teillauf, steht zusätzlich zum Log ein Audit-Eintrag
 *    `WORKER_LAUF_FEHLGESCHLAGEN` (nur die Namen der Teilläufe, keine
 *    Fehlermeldung — die kann Werte aus der Datenbank enthalten).
 *
 * `WORKER_EINMAL=1` lässt genau einen Lauf durchlaufen und beendet den Prozess —
 * für Tests und zum manuellen Auslösen (`docker exec … node worker.js`).
 *
 * Damit ist der externe Zeitgeber (systemd-Timer/Uptime-Ping auf
 * `/api/cron/erinnerungen`) nicht mehr nötig. Der HTTP-Endpunkt bleibt für das
 * manuelle Auslösen bestehen.
 */

import { readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { fuehreErinnerungslauf, schliesseRueckmeldungen } from "@/lib/ueberleitung";
import { raeumeAuf } from "@/lib/aufraeumen";
import { protokolliere } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { STUNDE_MS } from "@/lib/constants";

const TAKT_MS = STUNDE_MS; // stündlich

/** Vom Docker-Healthcheck des `worker`-Dienstes gelesen — Pfad nur gemeinsam ändern. */
const LEBENSZEICHEN_DATEI = "/tmp/gbs-worker-lebenszeichen";

/** So lange wartet der Start auf ein vollständig migriertes Schema (je 2 s). */
const SCHEMA_VERSUCHE = 300; // 10 Minuten

function schreibeLebenszeichen(): void {
  try {
    writeFileSync(LEBENSZEICHEN_DATEI, new Date().toISOString());
  } catch (fehler) {
    console.error("[WORKER] Lebenszeichen konnte nicht geschrieben werden:", fehler);
  }
}

async function laufeEinmal(): Promise<void> {
  // Welche Teilläufe gescheitert sind — für den Audit-Eintrag nur die Namen.
  const fehlgeschlagen: string[] = [];
  // Wie viele gelungen sind — nur dann gibt es ein Lebenszeichen (siehe unten).
  let gelungen = 0;

  // Erst abmelden, dann erinnern: Am Starttag geht an niemanden mehr eine
  // Erinnerung, dessen Rückmeldung schon geschlossen ist.
  try {
    const abgemeldet = await schliesseRueckmeldungen(new Date());
    if (abgemeldet.length > 0) console.log("[WORKER] Ohne Rückmeldung abgemeldet:", JSON.stringify(abgemeldet));
    gelungen += 1;
  } catch (fehler) {
    console.error("[WORKER] Abmeldung ohne Rückmeldung fehlgeschlagen:", fehler);
    fehlgeschlagen.push("Abmeldung ohne Rückmeldung");
  }
  try {
    const berichte = await fuehreErinnerungslauf(new Date());
    if (berichte.length > 0) console.log("[WORKER] Erinnerungen verschickt:", JSON.stringify(berichte));
    gelungen += 1;
  } catch (fehler) {
    console.error("[WORKER] Erinnerungslauf fehlgeschlagen:", fehler);
    fehlgeschlagen.push("Erinnerungslauf");
  }
  try {
    const ergebnis = await raeumeAuf("WORKER");
    console.log("[WORKER] Aufgeräumt:", JSON.stringify(ergebnis));
    gelungen += 1;
  } catch (fehler) {
    console.error("[WORKER] Aufräumlauf fehlgeschlagen:", fehler);
    fehlgeschlagen.push("Aufräumlauf");
  }

  // Nur im Fehlerfall ins Audit — ein Eintrag je Lauf wäre bei stündlichem Takt
  // zu viel Volumen für das append-only Protokoll. `protokolliere` wirft nie.
  if (fehlgeschlagen.length > 0) {
    await protokolliere({
      aktion: "WORKER_LAUF_FEHLGESCHLAGEN",
      objektTyp: "System",
      objektId: "WORKER",
      quelle: "SYSTEM",
      nachher: { teillaeufe: fehlgeschlagen },
    });
  }

  // Der Prozess lebt und taktet — auch wenn ein Teillauf gescheitert ist (das
  // steht dann im Audit). Ein hängender oder toter Worker schreibt nichts mehr,
  // ebenso einer, bei dem ALLES scheitert (keine Datenbank): Dann soll der
  // Healthcheck rot werden, statt einen Worker zu melden, der nichts tut.
  if (gelungen > 0) {
    schreibeLebenszeichen();
  } else {
    console.error("[WORKER] Kein Teillauf gelungen — kein Lebenszeichen, der Healthcheck wird rot.");
  }
}

/**
 * Die Migrationen, die dieses Image mitbringt (Ordnernamen unter
 * `prisma/migrations`, im Image unter /app). Null, wenn der Ordner fehlt — etwa
 * beim Start aus einem anderen Arbeitsverzeichnis; dann bleibt es bei der
 * einfachen Probe, ob die Datenbank antwortet.
 */
function mitgelieferteMigrationen(): string[] | null {
  try {
    return readdirSync(join(process.cwd(), "prisma", "migrations"), { withFileTypes: true })
      .filter((eintrag) => eintrag.isDirectory())
      .map((eintrag) => eintrag.name);
  } catch {
    return null;
  }
}

/** Welche der erwarteten Migrationen sind noch nicht abgeschlossen eingespielt? */
async function fehlendeMigrationen(erwartet: string[]): Promise<string[]> {
  const fertig = await prisma.$queryRaw<{ migration_name: string }[]>`
    SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  const eingespielt = new Set(fertig.map((m) => m.migration_name));
  return erwartet.filter((name) => !eingespielt.has(name));
}

/**
 * Wartet, bis die Datenbank erreichbar ist UND jede Migration dieses Images
 * abgeschlossen eingespielt ist. Die App wendet sie in ihrem Entrypoint an
 * (`prisma migrate deploy`, danach der Seed). Bei einem Upgrade existieren die
 * Tabellen schon — die frühere Probe auf `einstellungen` ließ den neuen Worker
 * deshalb sofort gegen das alte Schema laufen, während die App noch migrierte.
 *
 * Auf den Seed wartet der Worker nicht eigens: Er liest nur Einstellungen (mit
 * Standardwert als Rückfall) und Mail-Vorlagen (mit Ersatztext).
 *
 * Liefert false, wenn das Schema nach `SCHEMA_VERSUCHE` Versuchen nicht bereit
 * ist.
 */
async function warteAufSchema(): Promise<boolean> {
  const erwartet = mitgelieferteMigrationen();
  if (!erwartet) {
    console.error("[WORKER] prisma/migrations nicht gefunden — geprüft wird nur, ob die Datenbank antwortet.");
  }
  for (let versuch = 0; versuch < SCHEMA_VERSUCHE; versuch++) {
    try {
      await prisma.einstellung.count();
      const fehlen = erwartet ? await fehlendeMigrationen(erwartet) : [];
      if (fehlen.length === 0) return true;
      if (versuch % 30 === 0) {
        console.log(`[WORKER] Warte auf ${fehlen.length} Migration(en), zuerst ${fehlen[0]}.`);
      }
    } catch {
      // Datenbank noch nicht erreichbar oder Tabellen fehlen — kurz warten.
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

/** Schläft in kleinen Schritten, damit ein SIGTERM schnell greift. */
function schlafe(ms: number, abbruch: () => boolean): Promise<void> {
  return new Promise((aufloesen) => {
    const ende = Date.now() + ms;
    const tick = () => {
      if (abbruch() || Date.now() >= ende) return aufloesen();
      setTimeout(tick, 1000);
    };
    tick();
  });
}

async function main(): Promise<void> {
  if (!(await warteAufSchema())) {
    // Nicht gegen ein halb migriertes Schema laufen (dieselbe Haltung wie der
    // Entrypoint der App). Der Exit-Code lässt Docker den Worker neu starten,
    // der dann erneut wartet — und der Healthcheck bleibt rot, weil kein
    // Lebenszeichen entsteht.
    console.error(
      `[WORKER] Schema nach ${(SCHEMA_VERSUCHE * 2) / 60} Minuten nicht vollständig migriert — Worker beendet sich.`,
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  if (process.env.WORKER_EINMAL === "1") {
    console.log("[WORKER] Einzellauf.");
    await laufeEinmal();
    await prisma.$disconnect();
    return;
  }

  console.log(`[WORKER] Start. Takt: ${TAKT_MS / 60000} Minuten.`);
  let beendet = false;
  const stop = () => {
    beendet = true;
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  while (!beendet) {
    await laufeEinmal();
    await schlafe(TAKT_MS, () => beendet);
  }

  await prisma.$disconnect();
  console.log("[WORKER] Beendet.");
}

main().catch((fehler) => {
  console.error("[WORKER] Unerwarteter Abbruch:", fehler);
  process.exit(1);
});
