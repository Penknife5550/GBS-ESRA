import { NextRequest } from "next/server";
import { z } from "zod";
import { beantworteEinladung } from "@/lib/ueberleitung";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler } from "@/lib/api";
import { ABMELDEGRUND } from "@/lib/constants";

// Ohne `antwort` gilt „dabei" — so bleiben ältere Aufrufer (und der Durchstich)
// gültig, die nur den Token schicken.
const schema = z.object({
  token: z.string().uuid(),
  antwort: z.enum(["dabei", "raus"]).default("dabei"),
});

/**
 * Löst einen Überleitungs-Link ein: „Ich bin dabei" setzt
 * `Teilnahme.bestaetigtAm`, „Ich bin raus" meldet die Teilnahme ab
 * (`abgemeldetAm` + BIN_RAUS). Bis zum Tag vor Semesterbeginn (einschließlich,
 * `rueckmeldeFrist`) darf eine spätere Antwort die frühere ändern.
 *
 * Bewusst OHNE Login und OHNE Sitzung: Der Besitz des Fragment-Links ist der
 * Nachweis; ein Klick meldet niemanden an. POST von einer Bestätigungsseite aus
 * — wie beim Anmelde- und Auskunftslink —, damit Link-Scanner den Token nicht
 * vorab einlösen. Die Entscheidung liegt in `beantworteEinladung` (ohne HTTP
 * testbar), race-sicher und idempotent.
 */
export async function POST(request: NextRequest) {
  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) {
    return fehler("Dieser Link ist ungültig.", 400);
  }

  const ergebnis = await beantworteEinladung(geprueft.data.token, geprueft.data.antwort);

  if (ergebnis.status === "ungueltig") {
    return fehler(
      "Dieser Link ist abgelaufen oder ungültig. Bitte verwenden Sie den Link aus der neuesten E-Mail oder wenden Sie sich an die Schulverwaltung.",
      401,
    );
  }
  if (ergebnis.status === "geschlossen") {
    return fehler(
      "Das Semester hat bereits begonnen — die Rückmeldung über diesen Link ist geschlossen. Bitte wenden Sie sich an die Schulverwaltung.",
      409,
    );
  }

  // Nur die tatsächlich geänderte Antwort wird protokolliert; ein wiederholter
  // Klick (schon_…) erzeugt keinen zweiten Eintrag.
  if (ergebnis.status === "ok") {
    await protokolliere({
      aktion: "TEILNAHME_BESTAETIGT",
      objektTyp: "Teilnahme",
      objektId: ergebnis.teilnahmeId,
      akteurId: ergebnis.personId,
      quelle: "WEB",
      nachher: { semester: ergebnis.semester, vorher: ergebnis.vorher },
      headers: request.headers,
    });
  }
  if (ergebnis.status === "abgemeldet") {
    await protokolliere({
      aktion: "TEILNAHME_ABGEMELDET",
      objektTyp: "Teilnahme",
      objektId: ergebnis.teilnahmeId,
      akteurId: ergebnis.personId,
      quelle: "WEB",
      nachher: { semester: ergebnis.semester, grund: ABMELDEGRUND.BIN_RAUS, vorher: ergebnis.vorher },
      headers: request.headers,
    });
  }

  return erfolg({
    status: ergebnis.status,
    semester: ergebnis.semester,
    vorname: ergebnis.vorname,
    faecher: ergebnis.faecher,
    // Bis zu diesem Tag (einschließlich) lässt sich die Antwort ändern — die
    // Seite nennt das Datum statt eines ungenauen „bis zum Semesterstart".
    frist: ergebnis.frist,
  });
}
