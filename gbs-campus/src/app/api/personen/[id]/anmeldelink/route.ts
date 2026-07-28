import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler, keineBerechtigung } from "@/lib/api";
import { RECHT } from "@/lib/constants";
import { pruefeNeueEmail } from "@/lib/eigene-daten";
import { fordereMagicLinkAn } from "@/lib/magic-link";
import { ermittleRequestKontext } from "@/lib/request-kontext";

/**
 * Schickt einer Person ihren Anmeldelink — auf Zuruf am Telefon.
 *
 * Der Link geht ausschließlich an die hinterlegte Adresse, nie an den
 * Auslösenden. Wer damit ein fremdes Konto übernehmen wollte, müsste vorher die
 * Adresse ändern, und genau das steht als eigener Vorgang im Audit-Log.
 */
export async function POST(request: NextRequest, kontext: { params: Promise<{ id: string }> }) {
  const benutzer = await ladeMitRecht(RECHT.PERSON_BEARBEITEN_ALLE);
  if (!benutzer) return keineBerechtigung();

  const { id } = await kontext.params;
  const person = await prisma.person.findUnique({ where: { id }, include: { status: true } });
  if (!person) return fehler("Diese Person gibt es nicht.", 404);

  // `fordereMagicLinkAn` steigt bei Endzuständen still aus — was am Telefon
  // aussähe, als sei die Mail unterwegs. Deshalb hier ausdrücklich.
  if (person.status.istTerminal) {
    return fehler(
      `Dieses Konto steht auf „${person.status.bezeichnung}". Für Endzustände wird kein Anmeldelink verschickt.`,
      409,
    );
  }

  // Ohne brauchbare Adresse geht der Link ins Leere: `fordereMagicLinkAn`
  // steigt bei einer unbekannten Adresse still aus, und am Telefon sähe es aus,
  // als sei die Mail unterwegs. Dieselbe Prüfung wie beim Eintragen — der
  // Vergleichswert ist leer, weil es hier keine „bisherige" Adresse gibt.
  const adresse = pruefeNeueEmail(person.email, "");
  if (!adresse.ok) {
    return fehler(
      "Für dieses Konto ist keine brauchbare E-Mail-Adresse hinterlegt. Bitte zuerst die Anmeldeadresse ändern.",
      409,
    );
  }

  const { ipAdresse, userAgent } = ermittleRequestKontext(request.headers);
  const { gedrosselt } = await fordereMagicLinkAn(person.email, ipAdresse, userAgent);

  await protokolliere({
    aktion: "ANMELDELINK_DURCH_VERWALTUNG",
    objektTyp: "Person",
    objektId: id,
    akteurId: benutzer.id,
    nachher: { empfaenger: person.email, gedrosselt },
    headers: request.headers,
  });

  if (gedrosselt) {
    return fehler(
      "Für diese Adresse wurden zuletzt zu viele Links angefordert. Bitte etwas warten und noch einmal versuchen.",
      429,
    );
  }

  return erfolg({ gesendet: true, empfaenger: person.email });
}
