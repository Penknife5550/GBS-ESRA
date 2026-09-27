import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { pruefeZugriff } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler } from "@/lib/api";
import { MAIL_VORLAGE, RECHT, STATUS } from "@/lib/constants";
import { pruefeNeueEmail } from "@/lib/eigene-daten";
import { sendeNachVorlage } from "@/lib/selbstpflege";

const schema = z.object({ email: z.string() });

/**
 * Ändert die E-Mail-Adresse eines fremden Kontos.
 *
 * Das ist der Ausweg aus dem einzigen Fall, den die Software sonst nicht lösen
 * kann: Jemand kommt an sein Postfach nicht mehr heran und wäre ohne Passwort
 * dauerhaft ausgesperrt. Wer den Weg über `/anmelden/hilfe` meldet, wird hier
 * wieder hereingelassen — **nachdem** ihn ein Mensch erkannt hat.
 *
 * Weil das faktisch eine Kontoübernahme ist, hängt einiges daran:
 *  - Recht `PERSON_BEARBEITEN_ALLE` (Schulleitung und Verwaltung, nicht der
 *    Administrator — der trifft keine fachlichen Entscheidungen).
 *  - **Nur Konten, die nicht mehr können als der Handelnde.** Ohne diese
 *    Schranke genügten zwei Aufrufe, um das Administratorkonto zu übernehmen:
 *    Adresse auf die eigene ändern, Anmeldelink schicken. Jeder mit
 *    Verwaltungsrechten hätte damit Administratorrechte.
 *  - **Nicht die eigene Adresse.** Dafür gibt es `/api/meine-daten/email` mit
 *    Bestätigung über die neue Adresse; hier gibt es die nicht, und ein
 *    Tippfehler sperrte den Bedienenden sofort selbst aus.
 *  - Beide Adressen werden benachrichtigt, die alte und die neue.
 *  - Der alte Zugang wird vollständig entwertet: offene Änderungsanträge,
 *    offene Anmeldelinks, offene Auskunftslinks und ein etwaiges Passwort.
 *  - Der Vorgang steht im Audit-Log, das niemand löschen kann — mit Akteur,
 *    Zeitpunkt und IP, aber ohne die Adressen selbst (Code-Review 4, M6c): Die
 *    stehen im Versandprotokoll (Benachrichtigung an alt und neu), wo eine
 *    Anonymisierung sie erreicht.
 */
export async function PUT(request: NextRequest, kontext: { params: Promise<{ id: string }> }) {
  const benutzer = await pruefeZugriff(RECHT.PERSON_BEARBEITEN_ALLE);
  if (benutzer instanceof Response) return benutzer;

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Bitte eine gültige E-Mail-Adresse angeben.", 400);

  const { id } = await kontext.params;
  const person = await prisma.person.findUnique({
    where: { id },
    include: { rollen: { include: { rolle: { include: { rechte: true } } } } },
  });
  if (!person) return fehler("Diese Person gibt es nicht.", 404);
  // Eine anonymisierte Person hat kein Konto mehr, das jemand zurückbekommen
  // könnte — eine neue Adresse wäre nur neuer Personenbezug.
  if (person.statusCode === STATUS.ANONYMISIERT) {
    return fehler("Für eine anonymisierte Person lässt sich keine Anmeldeadresse setzen.", 409);
  }

  if (person.id === benutzer.id) {
    return fehler(
      "Die eigene Anmeldeadresse lässt sich hier nicht ändern. Bitte unter „Meine Daten“ ändern — " +
        "dort wird die neue Adresse erst nach Bestätigung wirksam.",
      403,
    );
  }

  // Die Rechte des Zielkontos gegen die eigenen halten. Wer ein Konto umhängen
  // kann, hat dessen Rechte faktisch selbst — die Grenze muss deshalb hier
  // liegen und nicht in der Oberfläche.
  const zielKannMehr = person.rollen.some((zuweisung) =>
    zuweisung.rolle.rechte.some((rolleRecht) => !benutzer.rechte.has(rolleRecht.rechtCode)),
  );
  if (zielKannMehr) {
    return fehler(
      "Dieses Konto hat Rechte, die Sie selbst nicht haben. Ein Konto mit weitergehenden Rechten lässt " +
        "sich über diesen Weg nicht ändern — das wäre eine Kontoübernahme.",
      403,
    );
  }

  const ergebnis = pruefeNeueEmail(geprueft.data.email, person.email);
  if (!ergebnis.ok) return fehler(ergebnis.meldung, 400);

  const alteEmail = person.email;
  const passwortWarGesetzt = person.passwortHash !== null;

  let entwerteteLinks = 0;
  let entwerteteAuskuenfte = 0;
  const jetzt = new Date();
  try {
    // Reihenfolge wie bei der Anonymisierung: erst die Zeilen, die an der
    // Person hängen, dann die Person — in umgekehrter Reihenfolge warteten
    // beide aufeinander (Deadlock).
    const [, links, auskuenfte, geschrieben] = await prisma.$transaction([
      prisma.emailAenderung.updateMany({
        where: { personId: id, benutztAm: null },
        data: { benutztAm: new Date() },
      }),
      // Offene Anmeldelinks der alten Adresse: Sie gelten bis zu 24 Stunden und
      // lägen sonst weiter im übernommenen Postfach — der neue Zugang wäre
      // sofort wieder offen.
      prisma.magicLink.updateMany({
        where: { personId: id, benutztAm: null },
        data: { benutztAm: new Date() },
      }),
      // Offene Auskunftslinks ebenso: Sie gelten 72 Stunden, lassen sich
      // beliebig oft abrufen und liefern die volle Datenkopie mit IBAN und
      // Glaubensangaben — genau in das Postfach, um dessen Verlust es hier geht
      // (Code-Review 4). Abgelaufen heißt: `laeuftAb` liegt ab jetzt zurück.
      prisma.datenauskunft.updateMany({
        where: { personId: id, laeuftAb: { gt: jetzt } },
        data: { laeuftAb: jetzt },
      }),
      // Bedingt: Committet zwischen der Prüfung oben und hier eine
      // Anonymisierung, stünde sonst wieder eine echte Adresse im gelöschten
      // Datensatz — und es gingen Mails an alt und neu.
      prisma.person.updateMany({
        where: { id, statusCode: { not: STATUS.ANONYMISIERT } },
        data: {
          email: ergebnis.email,
          // Ein etwaiges Passwort fliegt mit hinaus. Der ganze Zweck dieses
          // Weges ist „jemand anderes hat mein Postfach"; wer es übernommen und
          // dort ein Passwort gesetzt hat, behielte sonst vollen Zugang, und die
          // neue Adresse änderte daran nichts.
          passwortHash: null,
          // Wird an anderer Stelle zum Widerruf laufender Sitzungen ausgewertet.
          // Damit fliegt auch eine bereits offene fremde Sitzung sofort hinaus —
          // das ist hier ausdrücklich erwünscht.
          passwortGeaendertAm: new Date(),
        },
      }),
    ]);
    // Ohne Treffer ist die Person inzwischen anonymisiert. Die Entwertungen
    // davor haben dann nichts gefunden — die Anonymisierung löscht diese
    // Zeilen selbst.
    if (geschrieben.count !== 1) {
      return fehler("Für eine anonymisierte Person lässt sich keine Anmeldeadresse setzen.", 409);
    }
    entwerteteLinks = links.count;
    entwerteteAuskuenfte = auskuenfte.count;
  } catch (ausnahme) {
    if (ausnahme instanceof Prisma.PrismaClientKnownRequestError && ausnahme.code === "P2002") {
      // Hier darf die Auskunft deutlich sein: Wer dieses Recht hat, sieht die
      // Personenliste ohnehin. Neutral zu antworten würde nur verwirren.
      return fehler("Diese Adresse gehört bereits zu einem anderen Konto.", 409);
    }
    throw ausnahme;
  }

  await protokolliere({
    aktion: "EMAIL_GEAENDERT_DURCH_VERWALTUNG",
    objektTyp: "Person",
    objektId: id,
    akteurId: benutzer.id,
    vorher: { passwortGesetzt: passwortWarGesetzt },
    // Ob ein Passwort entfernt wurde, nicht welches — der Hash gehört nirgends
    // hin, wo er breiter lesbar ist als der Datensatz selbst. Ebenso nur, DASS
    // sich die Adresse geändert hat, nicht die Adressen (siehe Kopf).
    nachher: {
      geaenderteFelder: ["email"],
      passwortEntfernt: passwortWarGesetzt,
      entwerteteAnmeldelinks: entwerteteLinks,
      entwerteteAuskunftslinks: entwerteteAuskuenfte,
    },
    headers: request.headers,
  });

  // Ab hier ist die Adresse geändert und committet. `sendeNachVorlage` wirft
  // nie: Eine unlesbare Vorlage oder ein hakendes SMTP wird zu
  // `mailGesendet: false` statt zu einem 500 — sonst hielte die Verwaltung die
  // Änderung für gescheitert, und ein zweiter Versuch liefe auf „identische
  // Adresse“ (Code-Review 4).
  const mail = {
    personId: id,
    vorlageCode: MAIL_VORLAGE.EMAIL_GEAENDERT_DURCH_VERWALTUNG,
    werte: { vorname: person.vorname, neueAdresse: ergebnis.email },
    ersatzBetreff: "Ihre E-Mail-Adresse wurde geändert",
    ersatzText: "Hallo {{vorname}},\n\nIhre Adresse wurde auf {{neueAdresse}} geändert.",
    // Der Hinweis auf das entfernte Passwort wird angehängt und nicht in die
    // Vorlage geschrieben (siehe `anhang` in selbstpflege.ts).
    anhang: passwortWarGesetzt
      ? "\n\nHinweis: Ein für dieses Konto gesetztes Passwort wurde dabei entfernt. Melden Sie sich mit " +
        "einem Anmeldelink an; danach können Sie unter „Meine Daten“ ein neues Passwort setzen."
      : undefined,
  };

  // An die neue Adresse, damit die Person weiß, dass es geklappt hat — und an
  // die alte, falls sie doch noch erreichbar ist und jemand ohne Auftrag
  // gehandelt hat.
  const neu = await sendeNachVorlage({ ...mail, an: ergebnis.email });
  await sendeNachVorlage({ ...mail, an: alteEmail });

  return erfolg({
    gespeichert: true,
    email: ergebnis.email,
    mailGesendet: neu.gesendet,
    passwortEntfernt: passwortWarGesetzt,
  });
}
