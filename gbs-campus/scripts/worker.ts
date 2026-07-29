/**
 * GBS Campus — Worker
 *
 * Läuft als eigener Container (docker-compose-Dienst `worker`) und übernimmt die
 * zeitgesteuerten Aufgaben, die kein Nutzer auslöst:
 *  - die Überleitungs-Erinnerungen T−14/−7/−3 (`fuehreErinnerungslauf`)
 *  - den DSGVO-Aufräumlauf (`raeumeAuf`)
 *
 * Beide sind idempotent, deshalb genügt ein stündlicher Takt — kein präzises
 * Tages-Timing nötig, und trotzdem kein Doppelversand (die Erinnerungen tragen je
 * Stufe eine DB-Marke). Da die Erinnerungen tagesgenau feuern, ist eine
 * Verzögerung von bis zu einer Stunde beim ersten Start ohne Bedeutung.
 *
 * `WORKER_EINMAL=1` lässt genau einen Lauf durchlaufen und beendet den Prozess —
 * für Tests und zum manuellen Auslösen (`docker exec … node worker.js`).
 *
 * Damit ist der externe Zeitgeber (systemd-Timer/Uptime-Ping auf
 * `/api/cron/erinnerungen`) nicht mehr nötig. Der HTTP-Endpunkt bleibt für das
 * manuelle Auslösen bestehen.
 */

import { fuehreErinnerungslauf } from "@/lib/ueberleitung";
import { raeumeAuf } from "@/lib/aufraeumen";
import { prisma } from "@/lib/db";

const TAKT_MS = 60 * 60 * 1000; // stündlich

async function laufeEinmal(): Promise<void> {
  try {
    const berichte = await fuehreErinnerungslauf(new Date());
    if (berichte.length > 0) console.log("[WORKER] Erinnerungen verschickt:", JSON.stringify(berichte));
  } catch (fehler) {
    console.error("[WORKER] Erinnerungslauf fehlgeschlagen:", fehler);
  }
  try {
    const ergebnis = await raeumeAuf();
    console.log("[WORKER] Aufgeräumt:", JSON.stringify(ergebnis));
  } catch (fehler) {
    console.error("[WORKER] Aufräumlauf fehlgeschlagen:", fehler);
  }
}

/**
 * Wartet, bis die Datenbank erreichbar ist und die Migrationen angewendet sind
 * (die App wendet sie in ihrem Entrypoint an). `einstellung.count()` wirft,
 * solange die Tabelle fehlt — dann kurz warten und erneut versuchen.
 */
async function warteAufSchema(): Promise<void> {
  for (let versuch = 0; versuch < 60; versuch++) {
    try {
      await prisma.einstellung.count();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  console.error("[WORKER] Schema nach 2 Minuten nicht bereit — starte trotzdem.");
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
  await warteAufSchema();

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
