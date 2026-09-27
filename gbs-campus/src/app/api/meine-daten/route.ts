import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { pruefeZugriff } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler } from "@/lib/api";
import { RECHT, STATUS } from "@/lib/constants";
import { verschluesseln } from "@/lib/encryption";
import { FELD_BEZEICHNUNG, geaenderteFelder, pruefeEigeneDaten } from "@/lib/eigene-daten";
import { benachrichtigeKontoinhaberUeberBankverbindung, benachrichtigeVerwaltungUeberAenderung } from "@/lib/selbstpflege";
import { geaenderteFeldnamen } from "@/lib/anonymisierung";

const schema = z.object({
  telefon: z.string().nullish(),
  strasse: z.string().nullish(),
  plz: z.string().nullish(),
  ort: z.string().nullish(),
  kontoinhaber: z.string().nullish(),
  iban: z.string().nullish(),
});

/**
 * Selbstpflege der eigenen Stammdaten.
 *
 * Bewusst NICHT dabei: Name, Geburtsdatum, Gemeinde, Status und Teilnahmeform.
 * Das sind entweder Angaben, an denen die Aufnahmeentscheidung hängt, oder
 * Angaben nach Art. 9 DSGVO — beides ändert die Schulleitung, nicht der
 * Teilnehmer im Vorbeigehen. Die E-Mail-Adresse läuft über
 * `/api/meine-daten/email`, weil sie erst nach Bestätigung wirksam werden darf.
 *
 * **Teilangaben sind erlaubt:** Ein Feld, das nicht im Rumpf steht, bleibt
 * unverändert; ein leer mitgeschicktes Feld wird geleert.
 */
export async function PUT(request: NextRequest) {
  const benutzer = await pruefeZugriff(RECHT.PERSON_BEARBEITEN_EIGENE);
  if (benutzer instanceof Response) return benutzer;

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);

  const ergebnis = pruefeEigeneDaten(geprueft.data);
  if (!ergebnis.ok) return fehler("Bitte prüfen Sie die markierten Felder.", 400, ergebnis.meldungen);

  const person = await prisma.person.findUnique({ where: { id: benutzer.id } });
  if (!person) return fehler("Ihre Akte wurde nicht gefunden.", 404);

  const { werte } = ergebnis;

  // Ein nicht mitgeschicktes Feld bleibt, wie es ist — dieselbe Regel, die für
  // die IBAN von Anfang an galt (siehe Kopf von `lib/eigene-daten.ts`). Vorher
  // ersetzte jedes PUT sämtliche Stammdaten: Ein Client, der nur `{ iban }`
  // nachträgt, leerte damit Telefon, Straße, PLZ und Ort. Ausdrücklich leer
  // mitgeschickt (leerer Text oder `null`) leert weiterhin — das bleibt der Weg,
  // eine Angabe wieder loszuwerden.
  const mitgeschickt = {
    telefon: geprueft.data.telefon !== undefined,
    strasse: geprueft.data.strasse !== undefined,
    plz: geprueft.data.plz !== undefined,
    ort: geprueft.data.ort !== undefined,
    kontoinhaber: geprueft.data.kontoinhaber !== undefined,
  };

  // Die IBAN wird nicht im Klartext verglichen — sie liegt verschlüsselt, und
  // zum Entschlüsseln gäbe es hier keinen Grund. Verglichen wird deshalb nur,
  // OB eine hinterlegt war und ob jetzt eine eingegeben wurde. Wer dieselbe
  // IBAN noch einmal einträgt, löst dadurch eine Meldung an die Verwaltung aus;
  // das ist die harmlosere Richtung.
  const vorher = {
    telefon: person.telefon,
    strasse: person.strasse,
    plz: person.plz,
    ort: person.ort,
    kontoinhaber: person.kontoinhaber,
    iban: person.ibanVerschluesselt ? "vorhanden" : null,
  };
  // `undefined` heißt für `geaenderteFelder` ausdrücklich „nicht mitgeschickt"
  // und zählt nicht als Änderung.
  const nachher = {
    telefon: mitgeschickt.telefon ? werte.telefon : undefined,
    strasse: mitgeschickt.strasse ? werte.strasse : undefined,
    plz: mitgeschickt.plz ? werte.plz : undefined,
    ort: mitgeschickt.ort ? werte.ort : undefined,
    kontoinhaber: mitgeschickt.kontoinhaber ? werte.kontoinhaber : undefined,
    iban: werte.iban ? "neu" : undefined,
  };

  const geaendert = geaenderteFelder(vorher, nachher);
  if (geaendert.length === 0) {
    return erfolg({ gespeichert: true, geaendert: [], mailGesendet: null, hinweisGesendet: null });
  }

  // Bedingt statt Prüfen-dann-Schreiben: Eine Anfrage, die vor einer
  // Anonymisierung begonnen hat, schriebe Anschrift und IBAN sonst in den
  // gerade gelöschten Datensatz zurück. `data` ist hier nie leer (mindestens ein
  // Feld hat sich geändert, siehe oben).
  const geschrieben = await prisma.person.updateMany({
    where: { id: person.id, statusCode: { not: STATUS.ANONYMISIERT } },
    data: {
      ...(mitgeschickt.telefon ? { telefon: werte.telefon } : {}),
      ...(mitgeschickt.strasse ? { strasse: werte.strasse } : {}),
      ...(mitgeschickt.plz ? { plz: werte.plz } : {}),
      ...(mitgeschickt.ort ? { ort: werte.ort } : {}),
      ...(mitgeschickt.kontoinhaber ? { kontoinhaber: werte.kontoinhaber } : {}),
      ...(werte.iban ? { ibanVerschluesselt: verschluesseln(werte.iban) } : {}),
    },
  });
  if (geschrieben.count !== 1) {
    return fehler("Ihr Konto wurde gerade geschlossen. Die Änderung wurde nicht gespeichert.", 409);
  }

  // Bankverbindung geändert: Hinweis an die hinterlegte Adresse der Person
  // selbst. Die Mail an die Verwaltung erreicht sie nicht — und wer über eine
  // übernommene Sitzung die IBAN tauscht, soll nicht unbemerkt bleiben.
  // Gestartet VOR der Verwaltungsmeldung und erst danach abgewartet: Beide
  // warten auf SMTP (bis zu 10 + 10 + 20 s) — nacheinander liefe die Anfrage in
  // die 30-s-Grenze der Oberfläche, obwohl längst gespeichert ist, und ein
  // Wiederholversuch löste beide Mails erneut aus. `null`, wenn es nichts zu
  // melden gab. Der Helfer wirft nie; der catch hält trotzdem eine unerwartete
  // Ablehnung ab, die sonst bis zum Abwarten unbehandelt stünde.
  const bankFelder = geaendert.filter((f) => f === FELD_BEZEICHNUNG.iban || f === FELD_BEZEICHNUNG.kontoinhaber);
  const hinweis =
    bankFelder.length > 0
      ? benachrichtigeKontoinhaberUeberBankverbindung(person, bankFelder).catch((ausnahme: unknown) => {
          console.error("[MEINE-DATEN] Hinweis zur Bankverbindung fehlgeschlagen:", person.id, ausnahme);
          return { gesendet: false };
        })
      : null;

  // Ab hier sind die Daten gespeichert. Protokoll und Meldung an die Verwaltung
  // sind Nachlauf: Scheitert davon etwas, sähe der Teilnehmer sonst einen 500
  // und hielte seine Änderung für verloren, obwohl sie steht. Also laut loggen
  // und Erfolg melden — mit der ehrlichen Angabe, ob die Meldung rausging.
  let mailGesendet = false;
  try {
    await protokolliere({
      aktion: "EIGENE_DATEN_GEAENDERT",
      objektTyp: "Person",
      objektId: person.id,
      akteurId: person.id,
      // Nur die Namen der geänderten Felder, nie die Werte (Code-Review 4, M6c):
      // Das Audit-Log ist unlöschbar — eine Anschrift darin überlebte jede
      // Anonymisierung.
      nachher: { geaenderteFelder: geaenderteFeldnamen(vorher, nachher) },
      headers: request.headers,
    });

    // Direkter Wunsch aus dem Interview: Die Verwaltung soll von Änderungen
    // erfahren, ohne nachsehen zu müssen.
    const versand = await benachrichtigeVerwaltungUeberAenderung(person, geaendert);
    mailGesendet = versand.gesendet > 0;
  } catch (ausnahme) {
    console.error("[MEINE-DATEN] Nachbereitung der Stammdatenänderung fehlgeschlagen:", person.id, ausnahme);
  }

  const hinweisGesendet = hinweis ? (await hinweis).gesendet : null;

  return erfolg({ gespeichert: true, geaendert, mailGesendet, hinweisGesendet });
}
