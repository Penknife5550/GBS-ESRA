import { NextRequest } from "next/server";
import { z } from "zod";
import { bestaetigeTeilnahme } from "@/lib/ueberleitung";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler } from "@/lib/api";

const schema = z.object({ token: z.string().uuid() });

/**
 * Löst einen „Ich bin dabei"-Link ein und setzt `Teilnahme.bestaetigtAm`.
 *
 * Bewusst OHNE Login und OHNE Sitzung: Der Besitz des Fragment-Links ist der
 * Nachweis; ein Klick meldet niemanden an. POST von einer Bestätigungsseite aus
 * — wie beim Anmelde- und Auskunftslink —, damit Link-Scanner den Token nicht
 * vorab einlösen. Die Entscheidung liegt in `bestaetigeTeilnahme` (ohne HTTP
 * testbar), race-sicher und idempotent.
 */
export async function POST(request: NextRequest) {
  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) {
    return fehler("Dieser Link ist ungültig.", 400);
  }

  const ergebnis = await bestaetigeTeilnahme(geprueft.data.token);

  if (ergebnis.status === "ungueltig") {
    return fehler("Dieser Link ist abgelaufen oder ungültig. Bitte wende dich an die Schulverwaltung.", 401);
  }

  // Nur die tatsächlich neu gesetzte Bestätigung wird protokolliert; ein
  // wiederholter Klick (schon_bestaetigt) erzeugt keinen zweiten Eintrag.
  if (ergebnis.status === "ok") {
    await protokolliere({
      aktion: "TEILNAHME_BESTAETIGT",
      objektTyp: "Teilnahme",
      objektId: ergebnis.teilnahmeId,
      akteurId: ergebnis.personId,
      quelle: "WEB",
      nachher: { semester: ergebnis.semester },
      headers: request.headers,
    });
  }

  return erfolg({
    status: ergebnis.status,
    semester: ergebnis.semester,
    vorname: ergebnis.vorname,
    faecher: ergebnis.faecher,
  });
}
