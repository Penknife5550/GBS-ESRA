import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler, keineBerechtigung } from "@/lib/api";
import { RECHT } from "@/lib/constants";
import { verschluesseln } from "@/lib/encryption";
import { geaenderteFelder, pruefeEigeneDaten } from "@/lib/eigene-daten";
import { benachrichtigeVerwaltungUeberAenderung } from "@/lib/selbstpflege";

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
  const benutzer = await ladeMitRecht(RECHT.PERSON_BEARBEITEN_EIGENE);
  if (!benutzer) return keineBerechtigung();

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);

  const ergebnis = pruefeEigeneDaten(geprueft.data);
  if (!ergebnis.ok) return fehler("Bitte prüfe die markierten Felder.", 400, ergebnis.meldungen);

  const person = await prisma.person.findUnique({ where: { id: benutzer.id } });
  if (!person) return fehler("Deine Akte wurde nicht gefunden.", 404);

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
    return erfolg({ gespeichert: true, geaendert: [], mailGesendet: null });
  }

  await prisma.person.update({
    where: { id: person.id },
    data: {
      ...(mitgeschickt.telefon ? { telefon: werte.telefon } : {}),
      ...(mitgeschickt.strasse ? { strasse: werte.strasse } : {}),
      ...(mitgeschickt.plz ? { plz: werte.plz } : {}),
      ...(mitgeschickt.ort ? { ort: werte.ort } : {}),
      ...(mitgeschickt.kontoinhaber ? { kontoinhaber: werte.kontoinhaber } : {}),
      ...(werte.iban ? { ibanVerschluesselt: verschluesseln(werte.iban) } : {}),
    },
  });

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
      vorher,
      nachher,
      headers: request.headers,
    });

    // Direkter Wunsch aus dem Interview: Die Verwaltung soll von Änderungen
    // erfahren, ohne nachsehen zu müssen.
    const versand = await benachrichtigeVerwaltungUeberAenderung(person, geaendert);
    mailGesendet = versand.gesendet > 0;
  } catch (ausnahme) {
    console.error("[MEINE-DATEN] Nachbereitung der Stammdatenänderung fehlgeschlagen:", person.id, ausnahme);
  }

  return erfolg({ gespeichert: true, geaendert, mailGesendet });
}
