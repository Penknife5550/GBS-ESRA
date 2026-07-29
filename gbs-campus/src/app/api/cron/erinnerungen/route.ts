import { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { cronKonfiguriert } from "@/lib/konfiguration";
import { fuehreErinnerungslauf } from "@/lib/ueberleitung";
import { erfolg, fehler } from "@/lib/api";

/**
 * Erinnerungslauf der Semesterüberleitung (T-14/-7/-3).
 *
 * Gedacht für einen externen Zeitgeber (systemd-Timer, Cron, Uptime-Ping), der
 * einmal täglich aufruft:
 *
 *   curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://…/api/cron/erinnerungen
 *
 * Geschützt NICHT über eine Sitzung, sondern über das gemeinsame Geheimnis
 * `CRON_SECRET` (Header `x-cron-secret`). Der Lauf selbst ist idempotent — ein
 * doppelter Aufruf am selben Tag verschickt niemandem zweimal.
 */
function secretStimmt(mitgegeben: string | null): boolean {
  const erwartet = process.env.CRON_SECRET;
  if (!erwartet || !mitgegeben) return false;
  const a = Buffer.from(mitgegeben);
  const b = Buffer.from(erwartet);
  // Längengleichheit zuerst: timingSafeEqual wirft bei ungleicher Länge.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!cronKonfiguriert()) {
    return fehler("Der Erinnerungslauf ist nicht konfiguriert (CRON_SECRET fehlt).", 503);
  }
  if (!secretStimmt(request.headers.get("x-cron-secret"))) {
    return fehler("Keine Berechtigung.", 401);
  }

  const laeufe = await fuehreErinnerungslauf(new Date());
  return erfolg({ laeufe });
}
