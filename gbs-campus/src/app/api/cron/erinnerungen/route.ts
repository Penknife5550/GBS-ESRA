import { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { cronKonfiguriert } from "@/lib/konfiguration";
import {
  fuehreErinnerungslauf,
  schliesseRueckmeldungen,
  type AbmeldeBericht,
  type ErinnerungBericht,
} from "@/lib/ueberleitung";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler } from "@/lib/api";

/** Vergleicht das mitgeschickte Geheimnis zeitkonstant mit `CRON_SECRET`. */
function secretStimmt(mitgegeben: string | null): boolean {
  const erwartet = process.env.CRON_SECRET;
  if (!erwartet || !mitgegeben) return false;
  const a = Buffer.from(mitgegeben);
  const b = Buffer.from(erwartet);
  // Längengleichheit zuerst: timingSafeEqual wirft bei ungleicher Länge.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Erinnerungslauf der Semesterüberleitung (T-14/-7/-3) samt Abmeldung der
 * Eingeladenen ohne Antwort ab Semesterstart — dasselbe, was der Worker
 * stündlich tut.
 *
 * Gedacht für einen externen Zeitgeber (systemd-Timer, Cron, Uptime-Ping), der
 * einmal täglich aufruft:
 *
 *   curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://…/api/cron/erinnerungen
 *
 * Geschützt NICHT über eine Sitzung, sondern über das gemeinsame Geheimnis
 * `CRON_SECRET` (Header `x-cron-secret`). Der Lauf selbst ist idempotent — ein
 * doppelter Aufruf am selben Tag verschickt niemandem zweimal und meldet
 * niemanden zweimal ab.
 *
 * Scheitert ein Teillauf, läuft der andere trotzdem (wie im Worker). Die Antwort
 * ist dann 500 mit den Namen der gescheiterten Teilläufe, und ein Audit-Eintrag
 * `WORKER_LAUF_FEHLGESCHLAGEN` (objektId CRON) macht den Ausfall in der
 * Betriebsansicht sichtbar — nicht nur im Container-Log.
 */
export async function POST(request: NextRequest) {
  if (!cronKonfiguriert()) {
    return fehler("Der Erinnerungslauf ist nicht konfiguriert (CRON_SECRET fehlt).", 503);
  }
  if (!secretStimmt(request.headers.get("x-cron-secret"))) {
    return fehler("Keine Berechtigung.", 401);
  }

  const jetzt = new Date();
  const fehlgeschlagen: string[] = [];
  let abgemeldet: AbmeldeBericht[] = [];
  let laeufe: ErinnerungBericht[] = [];

  // Erst abmelden, dann erinnern: Am Starttag geht an niemanden mehr eine
  // Erinnerung, dessen Rückmeldung schon geschlossen ist.
  try {
    abgemeldet = await schliesseRueckmeldungen(jetzt);
  } catch (ausnahme) {
    console.error("[CRON] Abmeldung ohne Rückmeldung fehlgeschlagen:", ausnahme);
    fehlgeschlagen.push("Abmeldung ohne Rückmeldung");
  }
  try {
    laeufe = await fuehreErinnerungslauf(jetzt);
  } catch (ausnahme) {
    console.error("[CRON] Erinnerungslauf fehlgeschlagen:", ausnahme);
    fehlgeschlagen.push("Erinnerungslauf");
  }

  if (fehlgeschlagen.length > 0) {
    // Nur die Namen der Teilläufe — die Fehlermeldung kann Werte aus der
    // Datenbank enthalten und steht im Server-Log.
    await protokolliere({
      aktion: "WORKER_LAUF_FEHLGESCHLAGEN",
      objektTyp: "System",
      objektId: "CRON",
      quelle: "SYSTEM",
      nachher: { teillaeufe: fehlgeschlagen },
    });
    return fehler(`Fehlgeschlagen: ${fehlgeschlagen.join(", ")}. Einzelheiten stehen im Server-Log.`, 500);
  }

  return erfolg({ laeufe, abgemeldet });
}
