/**
 * GBS Campus — Datenauskunft nach DSGVO Art. 15: Datenbank, Token, PDF
 *
 * Die reine Inhaltslogik (Formatierung, Antwort-Zuordnung, Baustein-Bau) liegt
 * in `auskunft-inhalt.ts` und ist dort ohne Datenbank testbar. Dieses Modul ist
 * der IO-Teil: Token anlegen und einlösen, alle Daten einer Person einsammeln
 * und daraus die PDF erzeugen.
 *
 * Zustellung: NICHT als Mailanhang. Die Auskunft enthaelt Glaubensangaben
 * (Art. 9) und die IBAN im Klartext — beides darf den unverschluesselten
 * Mailkanal nicht verlassen, aus demselben Grund, aus dem schon die IBAN aus
 * dem Excel-Export faellt. Stattdessen bekommt die Person einen kurzlebigen,
 * nur als Hash hinterlegten Link und laedt die PDF selbst im Portal herunter.
 */

import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { entschluesseln } from "@/lib/encryption";
import { erzeugePdf } from "@/lib/pdf";
import { hashToken } from "@/lib/magic-link";
import { STATUS } from "@/lib/constants";
import {
  baueAuskunftBloecke,
  mappeAntworten,
  datum,
  datumZeit,
  teilnahmeformText,
  type AuskunftDaten,
  type FeldInfo,
} from "@/lib/auskunft-inhalt";

export type { AuskunftDaten } from "@/lib/auskunft-inhalt";

/**
 * Gueltigkeit des Abruf-Links. Grosszuegiger als der Anmeldelink (30 Min): die
 * Auskunft ist kein Login, und die Person schaut nicht sofort ins Postfach. Aber
 * kurz genug, dass ein abgefangener Link nicht dauerhaft die volle Datenkopie
 * hergibt.
 */
const GUELTIG_STUNDEN = 72;
export const AUSKUNFT_GUELTIG_MINUTEN = GUELTIG_STUNDEN * 60;

/** Legt ein Auskunftsverlangen an und gibt den Klartext-Token zurueck (nur er kommt in die Mail). */
export async function erzeugeAuskunftToken(personId: string, erstelltVonId: string | null): Promise<string> {
  const token = randomUUID();
  await prisma.datenauskunft.create({
    data: {
      personId,
      tokenHash: hashToken(token),
      laeuftAb: new Date(Date.now() + GUELTIG_STUNDEN * 60 * 60 * 1000),
      erstelltVonId,
    },
  });
  return token;
}

export type AuskunftAbruf =
  | { status: "ok"; personId: string; pdf: Buffer }
  | { status: "ungueltig" }
  | { status: "verstorben" }
  | { status: "weg" };

/**
 * Löst einen Abruf-Token ein und liefert die fertige PDF — oder den Grund, warum
 * nicht. ALLE Entscheidungen liegen hier (nicht in der Route), damit sie ohne
 * HTTP mutationssicher testbar sind:
 *  - Token unbekannt/abgelaufen  → "ungueltig"
 *  - Person nicht mehr vorhanden → "weg"
 *  - Person als verstorben geführt → "verstorben": Das Auskunftsrecht endet mit
 *    dem Tod, und die Sperre muss auch für einen VOR dem Tod ausgestellten,
 *    noch gültigen Token greifen — nicht nur beim Anstoßen.
 *
 * Bewusst NICHT einmalig wie der Anmeldelink: Der Anmeldelink gewaehrt eine
 * Sitzung, ein zweiter Abruf desselben Dokuments tut das nicht — ein
 * abgebrochener Download soll den Link nicht verbrennen. Die Grenze ist der
 * geheime, kurzlebige Link. `abgerufenAm` wird erst NACH erfolgreicher Erzeugung
 * gesetzt: Ein gesperrter (verstorbener) oder fehlgeschlagener Abruf darf nicht
 * als „abgerufen" gelten, obwohl nie eine Kopie floss.
 */
export async function ruftAuskunftAb(token: string): Promise<AuskunftAbruf> {
  const eintrag = await prisma.datenauskunft.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!eintrag) return { status: "ungueltig" };
  if (eintrag.laeuftAb < new Date()) return { status: "ungueltig" };

  const person = await prisma.person.findUnique({
    where: { id: eintrag.personId },
    select: { statusCode: true },
  });
  if (!person) return { status: "weg" };
  if (person.statusCode === STATUS.VERSTORBEN) return { status: "verstorben" };

  const pdf = await erzeugeAuskunftPdf(eintrag.personId);
  if (!pdf) return { status: "weg" }; // zwischenzeitlich gelöscht

  if (!eintrag.abgerufenAm) {
    await prisma.datenauskunft.updateMany({
      where: { id: eintrag.id, abgerufenAm: null },
      data: { abgerufenAm: new Date() },
    });
  }
  return { status: "ok", personId: eintrag.personId, pdf };
}

/** Traegt alle gespeicherten Daten einer Person zusammen. Null, wenn es sie nicht gibt. */
export async function sammleAuskunft(personId: string): Promise<AuskunftDaten | null> {
  const person = await prisma.person.findUnique({
    where: { id: personId },
    include: {
      status: true,
      rollen: { include: { rolle: true } },
      ehepartner: { select: { vorname: true, nachname: true } },
      ermaessigung: true,
      einwilligungen: { include: { text: true }, orderBy: { zeitpunkt: "asc" } },
      statusWechsel: { include: { von: true, nach: true }, orderBy: { erstelltAm: "asc" } },
      teilnahmen: { include: { semester: true }, orderBy: { erstelltAm: "asc" } },
      anmeldungen: {
        orderBy: { erstelltAm: "asc" },
        include: {
          semester: true,
          formularVersion: {
            include: {
              abschnitte: {
                include: { felder: { orderBy: { reihenfolge: "asc" } } },
                orderBy: { reihenfolge: "asc" },
              },
            },
          },
        },
      },
    },
  });
  if (!person) return null;

  // IBAN im Klartext — die Person hat ein Recht auf ihre eigenen Daten. Schlaegt
  // die Entschluesselung fehl (z. B. falscher Schluessel nach einem
  // Wiederherstellen), wird das benannt statt die ganze Auskunft abzubrechen —
  // aber es MUSS laut auffallen, nicht als stiller Ersatztext verschwinden:
  // Ein Decrypt-Fehler deutet auf einen falschen ENCRYPTION_KEY hin und beträfe
  // dann jede Auskunft (gleiche Linie wie /api/personen/[id]/bankverbindung).
  let iban = "(keine hinterlegt)";
  if (person.ibanVerschluesselt) {
    try {
      iban = entschluesseln(person.ibanVerschluesselt);
    } catch (ausnahme) {
      console.error("[AUSKUNFT] IBAN-Entschlüsselung fehlgeschlagen für", personId, ausnahme);
      iban = "(hinterlegt, aber mit dem aktuellen Schlüssel nicht lesbar)";
    }
  }

  const stammdaten: { label: string; wert: string }[] = [
    { label: "Vorname", wert: person.vorname },
    { label: "Nachname", wert: person.nachname },
    { label: "E-Mail-Adresse", wert: person.email },
    { label: "Telefon", wert: person.telefon ?? "—" },
    { label: "Geburtsdatum", wert: person.geburtsdatum ? datum(person.geburtsdatum) : "—" },
    { label: "Straße", wert: person.strasse ?? "—" },
    { label: "PLZ", wert: person.plz ?? "—" },
    { label: "Ort", wert: person.ort ?? "—" },
    { label: "Heimatgemeinde", wert: person.gemeinde ?? "—" },
    { label: "Teilnahmeform", wert: teilnahmeformText(person.teilnahmeform) },
    { label: "Status", wert: person.status.bezeichnung },
    { label: "Kontoinhaber", wert: person.kontoinhaber ?? "—" },
    { label: "IBAN", wert: iban },
    { label: "Passwort gesetzt", wert: person.passwortHash ? "ja" : "nein" },
    { label: "Angelegt am", wert: datumZeit(person.erstelltAm) },
  ];

  return {
    erstelltAm: new Date(),
    stammdaten,
    rollen: person.rollen.map((r) => r.rolle.bezeichnung),
    ehepartner: person.ehepartner ? `${person.ehepartner.vorname} ${person.ehepartner.nachname}` : null,
    ermaessigung: person.ermaessigung ? person.ermaessigung.bezeichnung : null,
    internerVermerkVorhanden: Boolean(person.notiz && person.notiz.trim().length > 0),
    anmeldungen: person.anmeldungen.map((a) => {
      const felder: FeldInfo[] = a.formularVersion.abschnitte
        .flatMap((ab) => ab.felder)
        .map((f) => ({ code: f.code, label: f.label, typ: f.typ, istArt9: f.istArt9 }));
      const antworten = (a.antworten ?? {}) as Record<string, unknown>;
      return {
        semester: a.semester?.bezeichnung ?? null,
        status: a.status,
        eingereichtAm: a.eingereichtAm,
        entschiedenAm: a.entschiedenAm,
        teilnahmeform: a.teilnahmeform,
        antworten: mappeAntworten(antworten, felder),
      };
    }),
    einwilligungen: person.einwilligungen.map((e) => ({
      titel: e.text.titel,
      version: e.text.version,
      istArt9: e.text.istArt9,
      erteilt: e.erteilt,
      zeitpunkt: e.zeitpunkt,
      ipAdresse: e.ipAdresse,
    })),
    statusWechsel: person.statusWechsel.map((s) => ({
      von: s.von?.bezeichnung ?? null,
      nach: s.nach.bezeichnung,
      grund: s.grund,
      automatisch: s.automatisch,
      zeitpunkt: s.erstelltAm,
    })),
    teilnahmen: person.teilnahmen.map((t) => ({
      semester: t.semester.bezeichnung,
      teilnahmeform: teilnahmeformText(t.teilnahmeform),
      bestaetigtAm: t.bestaetigtAm,
    })),
  };
}

/** Glue: sammelt die Daten und gibt die fertige PDF zurueck. Null, wenn es die Person nicht gibt. */
export async function erzeugeAuskunftPdf(personId: string): Promise<Buffer | null> {
  const daten = await sammleAuskunft(personId);
  if (!daten) return null;
  return erzeugePdf(baueAuskunftBloecke(daten));
}
