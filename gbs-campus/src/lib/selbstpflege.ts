/**
 * GBS Campus — Selbstpflege: Benachrichtigungen und E-Mail-Änderung
 *
 * Der Teil der Selbstpflege, der die Datenbank und den Mailversand braucht.
 * Die reine Prüflogik steht in `lib/eigene-daten.ts`.
 *
 * **Warum die E-Mail-Änderung so umständlich ist:** Die Adresse ist der einzige
 * Kontoschlüssel — es gibt kein Passwort, und in Release 0.1 auch keine
 * Oberfläche, mit der die Verwaltung eine vertippte Adresse korrigieren könnte.
 * Eine sofort wirksame Änderung würde bei einem Tippfehler das Konto dauerhaft
 * aussperren. Deshalb: Bestätigungslink an die neue Adresse, Hinweis an die
 * alte, und bis zur Bestätigung bleibt alles, wie es war.
 */

import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fuelleVorlage, sendeMail } from "@/lib/mailer";
import { zahl } from "@/lib/einstellungen";
import { drosselUeberschritten, gueltigkeitAlsText, hashToken } from "@/lib/magic-link";
import { protokolliere } from "@/lib/audit";
import { MAIL_VORLAGE, ROLLE } from "@/lib/constants";
import { sendeAnRollen, type VerteilerErgebnis } from "@/lib/verteiler";

type PersonKurz = { id: string; vorname: string; nachname: string; email: string };

/**
 * Vorlagencode für den Hinweis an eine bereits belegte Adresse.
 *
 * Er steht hier und nicht in `constants.ts`: Dort steht ausdrücklich nur, was
 * `prisma/seed.ts` wirklich anlegt, und diese Vorlage gibt es dort noch nicht.
 * Bis sie angelegt ist, greift der Ersatztext — der Code landet trotzdem im
 * Versandprotokoll, und sobald jemand die Vorlage unter diesem Code anlegt,
 * wird sie ohne Codeänderung benutzt.
 */
const VORLAGE_ADRESSE_BELEGT = "EMAIL_AENDERUNG_ADRESSE_BELEGT";

function basisUrl(): string {
  return process.env.APP_URL ?? "http://localhost:3000";
}

type EinzelMail = {
  an: string;
  personId: string;
  vorlageCode: string;
  werte: Record<string, string>;
  /** Greift nur, wenn die Vorlage fehlt (frische Datenbank, Seed noch nicht gelaufen). */
  ersatzBetreff: string;
  ersatzText: string;
};

/**
 * Eine Mail nach Vorlage an genau einen Empfänger — das Gegenstück zu
 * `sendeAnRollen` für den Einzelfall.
 *
 * **Wirft nie.** Beim Aufruf steht die fachliche Änderung schon in der
 * Datenbank; weder eine unlesbare Vorlage noch ein hakendes SMTP darf daraus
 * einen 500 machen. Der Aufrufer bekommt stattdessen `gesendet: false` und kann
 * es dem Bedienenden sagen — sichtbar bleibt der Fehlversand außerdem als
 * FEHLER-Zeile in `email_versand`.
 */
async function sendeNachVorlage(auftrag: EinzelMail): Promise<{ gesendet: boolean }> {
  try {
    const vorlage = await prisma.emailVorlage.findUnique({ where: { code: auftrag.vorlageCode } });
    return await sendeMail({
      an: auftrag.an,
      personId: auftrag.personId,
      vorlageCode: auftrag.vorlageCode,
      betreff: fuelleVorlage(vorlage?.betreff ?? auftrag.ersatzBetreff, auftrag.werte),
      text: fuelleVorlage(vorlage?.textMd ?? auftrag.ersatzText, auftrag.werte),
    });
  } catch (ausnahme) {
    console.error("[SELBSTPFLEGE] Versand fehlgeschlagen:", auftrag.vorlageCode, auftrag.an, ausnahme);
    return { gesendet: false };
  }
}

/**
 * Informiert die Verwaltung über geänderte Stammdaten — an alle Personen mit
 * der Rolle Verwaltung, nicht an eine fest hinterlegte Adresse. Ein
 * fehlgeschlagener Versand darf die bereits gespeicherte Änderung nicht
 * zurücknehmen; er steht im Versandprotokoll und damit in der Betriebsansicht.
 *
 * Der Verteiler übernimmt Vorlage, Empfängerkreis und den leeren Fall. Das
 * Ergebnis geht an den Aufrufer zurück, damit die Oberfläche nicht „ist
 * gemeldet" behaupten muss, wenn nichts rausging.
 */
export async function benachrichtigeVerwaltungUeberAenderung(
  person: PersonKurz,
  felder: string[],
): Promise<VerteilerErgebnis> {
  if (felder.length === 0) return { empfaenger: 0, gesendet: 0 };

  return sendeAnRollen({
    rollen: [ROLLE.VERWALTUNG],
    vorlageCode: MAIL_VORLAGE.DATENAENDERUNG_VERWALTUNG,
    werte: {
      name: `${person.vorname} ${person.nachname}`,
      felder: felder.join(", "),
      link: `${basisUrl()}/verwaltung/teilnehmer`,
    },
    ersatzBetreff: "Stammdaten geändert: {{name}}",
    ersatzText:
      "{{name}} hat die eigenen Daten geändert.\n\n" +
      "Geändert wurde: {{felder}}\n\n" +
      "In GBS Campus ansehen: {{link}}",
  });
}

export type BeantragenErgebnis = {
  gedrosselt: boolean;
  /**
   * Ob die Mail an die gewünschte Adresse zugestellt werden konnte. Ohne diese
   * Angabe meldete die Oberfläche „Wir haben einen Bestätigungslink geschickt",
   * auch wenn SMTP ausgefallen war — und jemand wartete auf einen Link, der nie
   * kam.
   */
  gesendet: boolean;
};

/**
 * Beantragt eine neue E-Mail-Adresse.
 *
 * Die Antwort ist immer dieselbe — auch wenn die gewünschte Adresse bereits zu
 * einem anderen Konto gehört. Sonst wäre dieser Endpunkt eine Auskunft darüber,
 * wer die Bibelschule besucht, und das ist eine Angabe zur
 * Religionszugehörigkeit (Art. 9 DSGVO).
 *
 * **Auch die Mails müssen gleich aussehen.** Vor dem Review stieg der Fall
 * „Adresse vergeben" aus, ohne den Hinweis an die eigene bisherige Adresse zu
 * verschicken. Damit hatte der Antragsteller ein sauberes Binärsignal im
 * eigenen Postfach: Hinweis da = Adresse frei, kein Hinweis = die Person hat
 * ein Konto. Deshalb entstehen jetzt in beiden Fällen dieselben zwei Mails an
 * dieselben zwei Adressen; inhaltlich erfährt nur der Inhaber der belegten
 * Adresse etwas — und der erfährt nicht, wer sie haben wollte.
 */
export async function beantrageEmailAenderung(
  person: PersonKurz,
  neueEmail: string,
  ipAdresse: string | null,
  userAgent: string | null,
): Promise<BeantragenErgebnis> {
  const [maxAntraege, fensterMinuten] = await Promise.all([
    zahl("AUTH_EMAIL_AENDERUNG_MAX"),
    zahl("AUTH_DROSSEL_FENSTER_MINUTEN"),
  ]);

  // Eine eigene Grenze und nicht die des Anmeldelinks: Auch hier verschickt das
  // System auf Zuruf eine Mail an eine frei gewählte Adresse, aber wer die
  // Linkgrenze senkt, soll damit nicht unbemerkt die Adressänderung zudrehen.
  if (await drosselUeberschritten(`EMAIL_AENDERUNG:${person.id}`, maxAntraege, fensterMinuten)) {
    return { gedrosselt: true, gesendet: false };
  }

  const vergeben = await prisma.person.findUnique({ where: { email: neueEmail }, select: { id: true } });
  if (vergeben) {
    await protokolliere({
      aktion: "EMAIL_AENDERUNG_ADRESSE_VERGEBEN",
      objektTyp: "Person",
      objektId: person.id,
      akteurId: person.id,
      ipAdresse,
      userAgent,
    });

    // Zwei Mails, genau wie im Normalfall: eine an die gewünschte Adresse (hier
    // an ihren Inhaber, nicht an den Antragsteller) und der Hinweis an die
    // bisherige. Der Text nennt bewusst keinen Namen — sonst erführe der
    // Inhaber, wer sich bei der Bibelschule angemeldet hat.
    const [anBelegte] = await Promise.all([
      sendeNachVorlage({
        an: neueEmail,
        personId: vergeben.id,
        vorlageCode: VORLAGE_ADRESSE_BELEGT,
        werte: { adresse: neueEmail },
        ersatzBetreff: "Diese E-Mail-Adresse wurde bei GBS Campus angefragt",
        ersatzText:
          "Guten Tag,\n\n" +
          "jemand wollte die Adresse {{adresse}} einem anderen Konto bei GBS Campus zuordnen. " +
          "Weil sie bereits vergeben ist, wurde nichts geändert — an deinem Konto ebenso wenig " +
          "wie am anderen.\n\n" +
          "Warst du das nicht, kannst du diese Nachricht ignorieren. Kommt sie öfter, melde dich " +
          "bitte bei der Schulleitung.\n\n" +
          "Gemeindebibelschule Minden",
      }),
      hinweisAnBisherige(person, neueEmail),
    ]);

    await benachrichtigeVerwaltungUeberAenderung(person, [
      "E-Mail-Adresse (Änderung nicht möglich — die gewünschte Adresse ist bereits vergeben)",
    ]);
    return { gedrosselt: false, gesendet: anBelegte.gesendet };
  }

  const stunden = await zahl("AUTH_EMAIL_AENDERUNG_GUELTIG_STUNDEN");
  const token = randomUUID();

  // Ältere offene Anträge derselben Person werden entwertet: Sonst könnte ein
  // vergessener Link von vorgestern eine längst verworfene Adresse setzen.
  await prisma.$transaction([
    prisma.emailAenderung.updateMany({
      where: { personId: person.id, benutztAm: null },
      data: { benutztAm: new Date() },
    }),
    prisma.emailAenderung.create({
      data: {
        personId: person.id,
        neueEmail,
        tokenHash: hashToken(token),
        laeuftAb: new Date(Date.now() + stunden * 60 * 60 * 1000),
        angefordertVonIp: ipAdresse,
        userAgent,
      },
    }),
  ]);

  // Beide Mails parallel: Sie haben nichts miteinander zu tun, und der
  // Antragsteller wartet vor einem Spinner.
  const [anGewuenschte] = await Promise.all([
    sendeNachVorlage({
      an: neueEmail,
      personId: person.id,
      vorlageCode: MAIL_VORLAGE.EMAIL_AENDERUNG_BESTAETIGEN,
      werte: {
        vorname: person.vorname,
        link: `${basisUrl()}/meine-daten/email?token=${token}`,
        gueltigkeit: gueltigkeitAlsText(stunden * 60),
      },
      ersatzBetreff: "Bitte bestätige deine neue E-Mail-Adresse",
      ersatzText: "Hallo {{vorname}},\n\n{{link}}\n\nDer Link gilt {{gueltigkeit}}.",
    }),
    hinweisAnBisherige(person, neueEmail),
  ]);

  return { gedrosselt: false, gesendet: anGewuenschte.gesendet };
}

/**
 * Die Notbremse: Wer diesen Hinweis bekommt, ohne etwas geändert zu haben,
 * weiß, dass jemand an seinem Konto war — und die alte Adresse gilt weiter,
 * solange nicht bestätigt wurde.
 *
 * Geht in BEIDEN Fällen raus, auch wenn die gewünschte Adresse schon vergeben
 * ist. Sein Ausbleiben wäre sonst die Auskunft, die dieser Endpunkt gerade
 * nicht geben darf.
 */
async function hinweisAnBisherige(person: PersonKurz, neueEmail: string): Promise<{ gesendet: boolean }> {
  return sendeNachVorlage({
    an: person.email,
    personId: person.id,
    vorlageCode: MAIL_VORLAGE.EMAIL_AENDERUNG_HINWEIS,
    werte: { vorname: person.vorname, neueAdresse: neueEmail },
    ersatzBetreff: "Änderung deiner E-Mail-Adresse wurde beantragt",
    ersatzText:
      "Hallo {{vorname}},\n\n" +
      "für dein Konto bei GBS Campus wurde eine neue E-Mail-Adresse beantragt: {{neueAdresse}}\n\n" +
      "Warst du das nicht, melde dich bitte umgehend bei der Schulleitung. Solange du nicht " +
      "bestätigst, bleibt alles wie bisher.\n\n" +
      "Gemeindebibelschule Minden",
  });
}

export type EinloesenErgebnis =
  | { ok: true; person: PersonKurz; alteEmail: string; neueEmail: string }
  | { ok: false; status: number; meldung: string };

/**
 * Löst den Bestätigungslink ein und setzt die neue Adresse.
 *
 * Das Entwerten läuft als bedingtes Update — zwei gleichzeitige Klicks können
 * nicht beide gewinnen. Wird die Adresse in der Zwischenzeit von jemand anderem
 * belegt, greift der Unique-Index; das ist ein Wiederholungsfall, kein 500.
 */
export async function loeseEmailAenderungEin(token: string): Promise<EinloesenErgebnis> {
  const eintrag = await prisma.emailAenderung.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { person: true },
  });

  if (!eintrag || eintrag.benutztAm || eintrag.laeuftAb < new Date()) {
    return {
      ok: false,
      status: 401,
      meldung: "Dieser Bestätigungslink ist abgelaufen oder wurde bereits benutzt. Bitte die Änderung erneut beantragen.",
    };
  }

  const alteEmail = eintrag.person.email;

  try {
    const gewonnen = await prisma.$transaction(async (tx) => {
      const entwertet = await tx.emailAenderung.updateMany({
        where: { id: eintrag.id, benutztAm: null },
        data: { benutztAm: new Date() },
      });
      if (entwertet.count !== 1) return false;

      await tx.person.update({ where: { id: eintrag.personId }, data: { email: eintrag.neueEmail } });
      return true;
    });

    if (!gewonnen) {
      return { ok: false, status: 409, meldung: "Dieser Bestätigungslink wurde bereits benutzt." };
    }
  } catch (ausnahme) {
    if (ausnahme instanceof Prisma.PrismaClientKnownRequestError && ausnahme.code === "P2002") {
      return {
        ok: false,
        status: 409,
        meldung: "Diese Adresse ist inzwischen vergeben. Bitte wende dich an die Schulleitung.",
      };
    }
    throw ausnahme;
  }

  return {
    ok: true,
    person: eintrag.person,
    alteEmail,
    neueEmail: eintrag.neueEmail,
  };
}
