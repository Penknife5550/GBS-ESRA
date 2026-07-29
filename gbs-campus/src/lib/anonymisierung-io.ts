/**
 * GBS Campus — Anonymisierung (DSGVO Art. 17): Datenbank
 *
 * „Anonymisieren statt Löschen": Der Datensatz bleibt (Audit-Log und
 * Einwilligungen sind append-only und dienen als Nachweis), aber jedes
 * personenbezogene Feld wird überschrieben. Die reine Werte-Logik liegt in
 * `anonymisierung.ts` (ohne DB testbar); hier ist die Transaktion.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { protokolliere } from "@/lib/audit";
import { STATUS } from "@/lib/constants";
import { ANONYM_PLATZHALTER, anonymePersonFelder, scrubbeAntworten } from "@/lib/anonymisierung";

export type AnonymErgebnis =
  | { status: "person_fehlt" }
  | { status: "schon_anonym" }
  | { status: "ok"; anmeldungen: number };

/**
 * Anonymisiert eine Person unwiderruflich. Erhalten bleiben (als Nachweis, ohne
 * Personenbezug): Audit-Log und Einwilligungen (beide append-only), Teilnahmen
 * und Anwesenheiten. Idempotent: eine bereits anonymisierte Person wird nicht
 * erneut angefasst.
 */
export async function anonymisierePerson(
  personId: string,
  akteurId: string,
  headers: Headers,
): Promise<AnonymErgebnis> {
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: { id: true, statusCode: true },
  });
  if (!person) return { status: "person_fehlt" };
  if (person.statusCode === STATUS.ANONYMISIERT) return { status: "schon_anonym" };

  const anmeldungen = await prisma.anmeldung.findMany({
    where: { personId },
    select: { id: true, antworten: true },
  });

  await prisma.$transaction(async (tx) => {
    // Ehepartner-Kopplung beidseitig lösen: die Gegenseite zeigt evtl. auf uns.
    await tx.person.updateMany({ where: { ehepartnerId: personId }, data: { ehepartnerId: null } });

    // Alle personenbezogenen Felder der Person überschreiben + Status ANONYMISIERT.
    await tx.person.update({
      where: { id: personId },
      data: anonymePersonFelder(personId) as Prisma.PersonUncheckedUpdateInput,
    });

    // Statuswechsel protokollieren wie jeder andere.
    await tx.statusWechsel.create({
      data: {
        personId,
        vonCode: person.statusCode,
        nachCode: STATUS.ANONYMISIERT,
        grund: "Anonymisiert nach Art. 17 DSGVO",
        ausgeloestVonId: akteurId,
      },
    });

    // Anmelde-Antworten überschreiben (Name, Adresse, IBAN, Art.-9-Angaben) und
    // den Freitext-Ablehnungsgrund leeren.
    for (const anmeldung of anmeldungen) {
      await tx.anmeldung.update({
        where: { id: anmeldung.id },
        data: {
          antworten: scrubbeAntworten((anmeldung.antworten ?? {}) as Record<string, unknown>),
          ablehnungsgrund: null,
        },
      });
    }

    // Transiente Token-Datensätze mit E-Mail-Bezug entfernen.
    await tx.magicLink.deleteMany({ where: { personId } });
    await tx.emailAenderung.deleteMany({ where: { personId } });
    await tx.datenauskunft.deleteMany({ where: { personId } });

    // Versandprotokoll: die Empfängeradresse ist personenbezogen — überschreiben.
    // Die Zeile bleibt als Betriebsspur, ohne die Adresse.
    await tx.emailVersand.updateMany({ where: { personId }, data: { empfaenger: ANONYM_PLATZHALTER } });
  });

  await protokolliere({
    aktion: "PERSON_ANONYMISIERT",
    objektTyp: "Person",
    objektId: personId,
    akteurId,
    // BEWUSST ohne alte Werte: Das Audit-Log ist lesbar und append-only — die
    // alten personenbezogenen Daten gehören da nicht hinein, sonst wäre die
    // Anonymisierung dort wieder aufgehoben.
    nachher: { status: STATUS.ANONYMISIERT, anmeldungenGescrubbt: anmeldungen.length },
    headers,
  });

  return { status: "ok", anmeldungen: anmeldungen.length };
}
