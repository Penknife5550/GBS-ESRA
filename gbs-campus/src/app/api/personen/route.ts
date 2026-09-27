import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { pruefeZugriff } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler } from "@/lib/api";
import { RECHT, ROLLE, STATUS } from "@/lib/constants";
import { pruefeNeuePerson } from "@/lib/benutzerverwaltung";
import { geaenderteFeldnamen } from "@/lib/anonymisierung";
import { SYSTEM_GRUND } from "@/lib/status";
import { erfasseErstenStatus } from "@/lib/status-io";

const schema = z.object({
  vorname: z.string().nullish(),
  nachname: z.string().nullish(),
  email: z.string().nullish(),
  telefon: z.string().nullish(),
});

/**
 * Legt von Hand eine Person an (Konten- und Rollenverwaltung, Recht
 * BENUTZER_VERWALTEN) — für Konten, die nicht über die öffentliche Anmeldung
 * entstehen (Dozenten, Mitarbeiter). Die Person startet als AKTIV mit der Rolle
 * TEILNEHMER (der Basiszugang „sieht die eigenen Daten"); weitere Rollen vergibt
 * der Administrator anschließend über „Rollen verwalten". Der Anmeldelink wird
 * bewusst NICHT automatisch verschickt — das geschieht über den vorhandenen
 * Knopf, erst nachdem die Person erkannt wurde.
 */
export async function POST(request: NextRequest) {
  const benutzer = await pruefeZugriff(RECHT.BENUTZER_VERWALTEN);
  if (benutzer instanceof Response) return benutzer;

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);

  const ergebnis = pruefeNeuePerson(geprueft.data);
  if (!ergebnis.ok) return fehler("Bitte prüfe die markierten Felder.", 400, ergebnis.meldungen);
  const { werte } = ergebnis;

  // Vorabprüfung für eine klare Meldung; der Unique-Index unten ist die
  // eigentliche Absicherung gegen den seltenen Wettlauf zweier Anlagen.
  const belegt = await prisma.person.findUnique({ where: { email: werte.email }, select: { id: true } });
  if (belegt) return fehler("Eine Person mit dieser E-Mail-Adresse gibt es bereits.", 409);

  let personId: string;
  try {
    personId = await prisma.$transaction(async (tx) => {
      const person = await tx.person.create({
        data: {
          vorname: werte.vorname,
          nachname: werte.nachname,
          email: werte.email,
          telefon: werte.telefon,
          statusCode: STATUS.AKTIV,
        },
      });
      await tx.personRolle.create({ data: { personId: person.id, rolleCode: ROLLE.TEILNEHMER, erteiltVonId: benutzer.id } });
      // Auch der erste Status wird protokolliert — die Akte soll lückenlos zeigen,
      // wie jemand in den Zustand gekommen ist (wie beim Anmeldeweg).
      await erfasseErstenStatus(tx, {
        personId: person.id,
        nachCode: STATUS.AKTIV,
        grund: SYSTEM_GRUND.VON_HAND_ANGELEGT,
        akteurId: benutzer.id,
      });
      return person.id;
    });
  } catch (ausnahme) {
    if (ausnahme instanceof Prisma.PrismaClientKnownRequestError && ausnahme.code === "P2002") {
      return fehler("Eine Person mit dieser E-Mail-Adresse gibt es bereits.", 409);
    }
    throw ausnahme;
  }

  await protokolliere({
    aktion: "PERSON_ANGELEGT",
    objektTyp: "Person",
    objektId: personId,
    akteurId: benutzer.id,
    // Nur WELCHE Felder angegeben wurden, nicht ihre Werte: Das Audit-Log ist
    // unlöschbar, Name und Adresse stehen in der Akte (und verschwinden dort
    // bei einer Anonymisierung).
    nachher: { status: STATUS.AKTIV, angegebeneFelder: geaenderteFeldnamen({}, werte) },
    headers: request.headers,
  });

  return erfolg({ id: personId }, 201);
}
