import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler, keineBerechtigung } from "@/lib/api";
import { RECHT } from "@/lib/constants";
import { pruefeNeueEmail } from "@/lib/eigene-daten";
import { ermittleRequestKontext } from "@/lib/request-kontext";
import { beantrageEmailAenderung } from "@/lib/selbstpflege";

const schema = z.object({ email: z.string() });

/**
 * Beantragt eine neue E-Mail-Adresse. Wirksam wird sie erst mit dem
 * Bestätigungslink an die neue Adresse — die Adresse ist der einzige Zugang
 * zum Portal, ein Tippfehler würde sonst dauerhaft aussperren.
 */
export async function POST(request: NextRequest) {
  const benutzer = await ladeMitRecht(RECHT.PERSON_BEARBEITEN_EIGENE);
  if (!benutzer) return keineBerechtigung();

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Bitte eine gültige E-Mail-Adresse angeben.", 400);

  const person = await prisma.person.findUnique({
    where: { id: benutzer.id },
    select: { id: true, vorname: true, nachname: true, email: true },
  });
  if (!person) return fehler("Deine Akte wurde nicht gefunden.", 404);

  const ergebnis = pruefeNeueEmail(geprueft.data.email, person.email);
  if (!ergebnis.ok) return fehler(ergebnis.meldung, 400, [{ feld: "email", meldung: ergebnis.meldung }]);

  const { ipAdresse, userAgent } = ermittleRequestKontext(request.headers);
  const antrag = await beantrageEmailAenderung(person, ergebnis.email, ipAdresse, userAgent);

  if (antrag.gedrosselt) {
    return fehler("Zu viele Versuche. Bitte später noch einmal probieren.", 429);
  }

  await protokolliere({
    aktion: "EMAIL_AENDERUNG_BEANTRAGT",
    objektTyp: "Person",
    objektId: person.id,
    akteurId: person.id,
    // Die gewünschte Adresse steht bewusst im Protokoll: Wer sich selbst
    // aussperrt, muss nachvollziehbar sein.
    nachher: { neueEmail: ergebnis.email },
    headers: request.headers,
  });

  // `mailGesendet` sagt, ob der Bestätigungslink an die gewünschte Adresse
  // wirklich rausging. Vorher meldete die Route immer Erfolg, und die Oberfläche
  // schrieb „Wir haben einen Bestätigungslink geschickt" — auch bei
  // ausgefallenem SMTP. Dann wartet jemand auf einen Link, der nie kommt, und
  // hält das Portal für kaputt statt den Versand.
  return erfolg({ beantragt: true, mailGesendet: antrag.gesendet });
}
