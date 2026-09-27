import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { pruefeZugriff } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler } from "@/lib/api";
import { MAIL_VORLAGE, RECHT } from "@/lib/constants";
import { zahl } from "@/lib/einstellungen";
import { hashePasswort, pruefePasswort } from "@/lib/passwort";
import { fuelleVorlage, sendeMail } from "@/lib/mailer";
import { sitzungAnlegen } from "@/lib/session";

const schema = z.object({ passwort: z.string() });

/**
 * Passwort setzen oder ändern.
 *
 * **Ohne Abfrage des bisherigen Passworts** — und das ist Absicht: Genau der
 * Fall „ich habe es vergessen" führt hierher. Wer angemeldet ist, hat den
 * Besitz seines Postfachs schon nachgewiesen (Anmeldelink) oder das bisherige
 * Passwort gekannt. Eine Abfrage des alten Passworts würde ausgerechnet den
 * Vergessensfall blockieren und ein zweites Zurücksetzen-Verfahren nötig
 * machen.
 *
 * Die Absicherung liegt woanders: Jede Änderung geht als Hinweis an die
 * hinterlegte Adresse. Wer ihn bekommt, ohne etwas getan zu haben, weiß, dass
 * jemand an seinem Konto war.
 */
export async function PUT(request: NextRequest) {
  const benutzer = await pruefeZugriff(RECHT.PERSON_BEARBEITEN_EIGENE);
  if (benutzer instanceof Response) return benutzer;

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Bitte ein Passwort angeben.", 400);

  const person = await prisma.person.findUnique({ where: { id: benutzer.id } });
  if (!person) return fehler("Ihre Akte wurde nicht gefunden.", 404);

  const mindestLaenge = await zahl("AUTH_PASSWORT_MIN_LAENGE");
  const maengel = pruefePasswort(geprueft.data.passwort, mindestLaenge, person.email);
  if (maengel.length > 0) return fehler(maengel[0].meldung, 400, maengel);

  const neu = !person.passwortHash;

  await prisma.person.update({
    where: { id: person.id },
    data: { passwortHash: await hashePasswort(geprueft.data.passwort), passwortGeaendertAm: new Date() },
  });

  // Eine Passwortänderung beendet alle älteren Sitzungen: `ladeAngemeldeten`
  // verwirft jede Sitzung, die vor `passwortGeaendertAm` ausgestellt wurde.
  // Genau das soll sie — wer ein fremdes Cookie hat, ist damit draußen. Ohne
  // diese Zeile sperrte sich aber ausgerechnet derjenige mit aus, der sein
  // Passwort gerade selbst gesetzt hat. Also sofort eine frische Sitzung.
  await sitzungAnlegen(person.id);

  // Im Audit steht, DASS gesetzt wurde — nie der Wert und nie der Hash.
  await protokolliere({
    aktion: neu ? "PASSWORT_GESETZT" : "PASSWORT_GEAENDERT",
    objektTyp: "Person",
    objektId: person.id,
    akteurId: person.id,
    headers: request.headers,
  });

  const mailGesendet = await benachrichtige({
    personId: person.id,
    vorname: person.vorname,
    email: person.email,
    vorgang: neu ? "ein Passwort gesetzt" : "das Passwort geändert",
  });

  return erfolg({ gesetzt: true, neu, mailGesendet });
}

/**
 * Passwort entfernen — zurück zum Anmeldelink als einzigem Weg.
 * Wer es nicht mehr will, soll es loswerden können, ohne jemanden zu fragen.
 */
export async function DELETE(request: NextRequest) {
  const benutzer = await pruefeZugriff(RECHT.PERSON_BEARBEITEN_EIGENE);
  if (benutzer instanceof Response) return benutzer;

  const person = await prisma.person.findUnique({ where: { id: benutzer.id } });
  if (!person) return fehler("Ihre Akte wurde nicht gefunden.", 404);
  // Nichts zu tun, also auch keine Mail — `null` statt `false`, damit die
  // Oberfläche das nicht als Fehlversand anzeigt.
  if (!person.passwortHash) return erfolg({ entfernt: true, mailGesendet: null });

  await prisma.person.update({
    where: { id: person.id },
    data: { passwortHash: null, passwortGeaendertAm: new Date() },
  });

  // Auch das Entfernen setzt `passwortGeaendertAm` und entwertet damit ältere
  // Sitzungen — dieselbe Falle wie beim Setzen, deshalb auch hier eine frische
  // Sitzung. Wer sein Passwort loswird, soll nicht als Nebenwirkung aus dem
  // Portal fliegen.
  await sitzungAnlegen(person.id);

  await protokolliere({
    aktion: "PASSWORT_ENTFERNT",
    objektTyp: "Person",
    objektId: person.id,
    akteurId: person.id,
    headers: request.headers,
  });

  const mailGesendet = await benachrichtige({
    personId: person.id,
    vorname: person.vorname,
    email: person.email,
    vorgang: "das Passwort entfernt",
  });

  return erfolg({ entfernt: true, mailGesendet });
}

/**
 * Der Hinweis an die hinterlegte Adresse. Ein Objekt statt vier gleichartiger
 * Zeichenketten: Vertauschte Reihenfolge fiele bei `(id, vorname, email,
 * vorgang)` keinem Compiler auf, und im schlimmsten Fall ginge die Nachricht an
 * den Namen statt an die Adresse.
 *
 * Meldet zurück, ob sie rausging. Sie ist die EINZIGE Absicherung dafür, dass
 * das bisherige Passwort nicht abgefragt wird (siehe Kopf dieser Datei) —
 * bleibt sie unbemerkt aus, fehlt die Absicherung ganz.
 */
async function benachrichtige(auftrag: {
  personId: string;
  vorname: string;
  email: string;
  vorgang: string;
}): Promise<boolean> {
  try {
    const vorlage = await prisma.emailVorlage.findUnique({ where: { code: MAIL_VORLAGE.PASSWORT_GEAENDERT } });
    const werte = { vorname: auftrag.vorname, vorgang: auftrag.vorgang };
    const versand = await sendeMail({
      an: auftrag.email,
      personId: auftrag.personId,
      vorlageCode: MAIL_VORLAGE.PASSWORT_GEAENDERT,
      betreff: fuelleVorlage(vorlage?.betreff ?? "Ihr Passwort wurde geändert", werte),
      text: fuelleVorlage(vorlage?.textMd ?? "Hallo {{vorname}},\n\nfür Ihr Konto wurde {{vorgang}}.", werte),
    });
    return versand.gesendet;
  } catch (ausnahme) {
    // Der Hinweis ist wichtig, aber er darf die bereits gespeicherte Änderung
    // nicht zurücknehmen. Fehlversand steht im Versandprotokoll.
    console.error("[PASSWORT] Hinweis konnte nicht verschickt werden:", auftrag.personId, ausnahme);
    return false;
  }
}
