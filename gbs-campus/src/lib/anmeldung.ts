/**
 * GBS Campus — Anmeldung entgegennehmen
 *
 * Das ist der Vorgang, der Microsoft Forms ablöst. Entsprechend sorgfältig:
 *
 *  - **Alles oder nichts.** Person, Anmeldung, Einwilligungen und der erste
 *    Statuswechsel entstehen in einer Transaktion. Eine halb angelegte Akte
 *    ohne Einwilligungsnachweis wäre schlimmer als gar keine.
 *  - **Kein Datenabgleich über die öffentliche Schnittstelle.** Existiert die
 *    Adresse bereits, wird nichts überschrieben und nichts verraten — sonst
 *    ließen sich über das Anmeldeformular fremde Stammdaten ändern, und die
 *    Antwort würde bestätigen, wer die Bibelschule besucht (eine Angabe nach
 *    Art. 9 DSGVO).
 *  - **Pflichteinwilligungen sind echte Pflicht.** Fehlt eine, wird abgelehnt
 *    statt die betroffenen Antworten stillschweigend zu verwerfen.
 */

import { randomUUID } from "crypto";
import { AnmeldungStatus, FormularVersionStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { verschluesseln } from "@/lib/encryption";
import { hashToken } from "@/lib/magic-link";
import { fuelleVorlage, sendeMail } from "@/lib/mailer";
import { zahl } from "@/lib/einstellungen";
import { semesterFuerAnmeldung } from "@/lib/semester";
import { alsFeldEingaben, bereinigeEntwurf, geheimeFeldcodes, ohneGeheimeAntworten, pruefeAntworten } from "@/lib/formular";
import { protokolliere } from "@/lib/audit";
import { EINRICHTUNG, MAIL_VORLAGE, ROLLE, STATUS, TAG_MS } from "@/lib/constants";
import { sendeAnRollen } from "@/lib/verteiler";
import { SYSTEM_GRUND } from "@/lib/status";
import { erfasseErstenStatus } from "@/lib/status-io";
import { art9Eingewilligt } from "@/lib/anmeldung-antworten";

/** Wohin die Verwaltung in den Meldungen geschickt wird. */
function anmeldungenUrl(): string {
  return `${process.env.APP_URL ?? ""}/verwaltung/anmeldungen`;
}

/** Die aktuell gültige Fassung samt Abschnitten und Feldern. */
export async function ladeVeroeffentlichteFassung(formularCode = "ANMELDUNG") {
  return prisma.formularVersion.findFirst({
    where: { status: FormularVersionStatus.VEROEFFENTLICHT, formular: { code: formularCode } },
    include: {
      formular: true,
      abschnitte: { include: { felder: { orderBy: { reihenfolge: "asc" } } }, orderBy: { reihenfolge: "asc" } },
    },
    orderBy: { version: "desc" },
  });
}

/** Die aktuell gültigen Einwilligungstexte. */
export async function ladeEinwilligungstexte() {
  const jetzt = new Date();
  const alle = await prisma.einwilligungsText.findMany({
    where: { aktivAb: { lte: jetzt }, OR: [{ aktivBis: null }, { aktivBis: { gte: jetzt } }] },
    orderBy: [{ code: "asc" }, { version: "desc" }],
  });

  // Je Code nur die neueste gültige Fassung.
  const neueste = new Map<string, (typeof alle)[number]>();
  for (const text of alle) {
    if (!neueste.has(text.code)) neueste.set(text.code, text);
  }
  return [...neueste.values()].sort((a, b) => (a.istArt9 ? 1 : 0) - (b.istArt9 ? 1 : 0));
}

// -----------------------------------------------------------------------------
// Entwurf speichern und fortsetzen
// -----------------------------------------------------------------------------

export type EntwurfErgebnis = { token: string; laeuftAb: Date };

/**
 * Legt einen Entwurf an oder aktualisiert einen bestehenden. Der Rückgabe-Token
 * ist der Klartext; gespeichert wird nur sein Hash.
 */
export async function speichereEntwurf(
  versionId: string,
  antworten: Record<string, unknown>,
  vorhandenerToken?: string,
): Promise<EntwurfErgebnis | { fehler: string }> {
  // Die Version wird geladen, nicht geglaubt. Zwei Gruende: Ohne die
  // Felddefinition liesse sich der Entwurf nicht bereinigen, und eine erfundene
  // versionId erzeugte sonst eine Fremdschluesselverletzung und damit einen 500
  // statt einer verstaendlichen Meldung.
  const version = await prisma.formularVersion.findUnique({
    where: { id: versionId },
    include: { abschnitte: { include: { felder: { orderBy: { reihenfolge: "asc" } } } } },
  });
  if (!version || version.status !== FormularVersionStatus.VEROEFFENTLICHT) {
    return { fehler: "Das Anmeldeformular wurde zwischenzeitlich geändert. Bitte laden Sie die Seite neu." };
  }

  // Art.-9-Angaben und die IBAN werden hier verworfen: Ein Zwischenstand
  // entsteht ohne Einwilligungsnachweis, und ohne den duerfen Angaben zu Glaube
  // und Gemeindezugehoerigkeit nicht gespeichert werden — auch nicht
  // voruebergehend. Vor dem Review kamen sie an dieser Stelle ungefiltert durch.
  const sauber = bereinigeEntwurf(alsFeldEingaben(version.abschnitte), antworten);

  const tage = await zahl("ANMELDUNG_FORTSETZEN_TAGE");
  const laeuftAb = new Date(Date.now() + tage * TAG_MS);

  if (vorhandenerToken) {
    const bestehend = await prisma.anmeldung.findUnique({
      where: { fortsetzenTokenHash: hashToken(vorhandenerToken) },
    });
    // Nur Entwürfe sind änderbar. Eine eingereichte Anmeldung bleibt, wie sie
    // abgeschickt wurde — sonst stimmte der Nachweis nicht mehr.
    if (
      bestehend &&
      bestehend.status === AnmeldungStatus.ENTWURF &&
      bestehend.fortsetzenLaeuftAb != null &&
      bestehend.fortsetzenLaeuftAb > new Date()
    ) {
      await prisma.anmeldung.update({
        where: { id: bestehend.id },
        data: { antworten: sauber as Prisma.InputJsonValue, fortsetzenLaeuftAb: laeuftAb },
      });
      return { token: vorhandenerToken, laeuftAb };
    }
  }

  const token = randomUUID();
  await prisma.anmeldung.create({
    data: {
      formularVersionId: versionId,
      status: AnmeldungStatus.ENTWURF,
      antworten: sauber as Prisma.InputJsonValue,
      fortsetzenTokenHash: hashToken(token),
      fortsetzenLaeuftAb: laeuftAb,
    },
  });

  return { token, laeuftAb };
}

/** Lädt einen Entwurf über den Fortsetzen-Token. Abgelaufene gelten als nicht vorhanden. */
export async function ladeEntwurf(token: string) {
  const entwurf = await prisma.anmeldung.findUnique({
    where: { fortsetzenTokenHash: hashToken(token) },
  });
  if (!entwurf) return null;
  if (entwurf.status !== AnmeldungStatus.ENTWURF) return null;
  if (!entwurf.fortsetzenLaeuftAb || entwurf.fortsetzenLaeuftAb < new Date()) return null;
  return entwurf;
}

// -----------------------------------------------------------------------------
// Absenden
// -----------------------------------------------------------------------------

export type AbsendeEingabe = {
  versionId: string;
  antworten: Record<string, unknown>;
  /** Codes der erteilten Einwilligungen. */
  einwilligungen: string[];
  fortsetzenToken?: string;
  ipAdresse: string | null;
  userAgent: string | null;
};

export type AbsendeErgebnis =
  | { ok: true }
  | { ok: false; status: number; meldung: string; felder?: { feldCode: string; meldung: string }[] };

export async function nimmAnmeldungEntgegen(eingabe: AbsendeEingabe): Promise<AbsendeErgebnis> {
  const version = await prisma.formularVersion.findUnique({
    where: { id: eingabe.versionId },
    include: { abschnitte: { include: { felder: { orderBy: { reihenfolge: "asc" } } } } },
  });
  if (!version || version.status !== FormularVersionStatus.VEROEFFENTLICHT) {
    return { ok: false, status: 409, meldung: "Das Anmeldeformular wurde zwischenzeitlich geändert. Bitte laden Sie die Seite neu." };
  }

  // --- Einwilligungen prüfen -------------------------------------------------
  const texte = await ladeEinwilligungstexte();
  const erteilt = new Set(eingabe.einwilligungen);

  const fehlendePflicht = texte.filter((t) => t.pflicht && !erteilt.has(t.code));
  if (fehlendePflicht.length > 0) {
    return {
      ok: false,
      status: 400,
      meldung: `Ohne diese Zustimmung können wir die Anmeldung nicht annehmen: ${fehlendePflicht
        .map((t) => t.titel)
        .join(", ")}.`,
    };
  }

  // Alle angebotenen Art.-9-Texte, nicht ein fest verdrahteter Code — dieselbe
  // Regel, nach der das Formular die Art.-9-Abschnitte freischaltet.
  const art9Erteilt = art9Eingewilligt(texte, erteilt);

  // --- Antworten prüfen ------------------------------------------------------
  const felder = alsFeldEingaben(version.abschnitte);
  const geprueft = pruefeAntworten(felder, eingabe.antworten, art9Erteilt);
  if (!geprueft.ok) {
    return { ok: false, status: 400, meldung: "Bitte prüfen Sie die markierten Felder.", felder: geprueft.fehler };
  }

  // Die IBAN wird an der Person verschluesselt abgelegt und darf deshalb NICHT
  // zusaetzlich im Klartext im Antwort-JSON stehen — beides laege sonst in
  // derselben Datenbank und in demselben Dump, und die Verschluesselung waere
  // wirkungslos. Genau das war vor dem Review der Fall.
  const { personDaten } = geprueft;
  const werte = ohneGeheimeAntworten(geprueft.werte, geheimeFeldcodes(felder));
  if (!personDaten.email || !personDaten.vorname || !personDaten.nachname) {
    return { ok: false, status: 400, meldung: "Name und E-Mail-Adresse sind erforderlich." };
  }

  // --- Doppelanmeldung -------------------------------------------------------
  // Nach außen bleibt die Antwort neutral: Eine Auskunft, dass eine Adresse
  // bekannt ist, würde bestätigen, dass jemand eine Bibelschule besucht — eine
  // Angabe zur Religionszugehörigkeit. Der Hinweis geht nur an die Adresse
  // selbst und an die Verwaltung.
  const vorhanden = await prisma.person.findUnique({ where: { email: personDaten.email } });
  if (vorhanden) {
    await protokolliere({
      aktion: "ANMELDUNG_DOPPELT_VERSUCHT",
      objektTyp: "Person",
      objektId: vorhanden.id,
      quelle: "SYSTEM",
      // Ohne die Adresse: Die Person steht über objektId fest, und das Audit-Log
      // ist unlöschbar (Code-Review 4, M6c).
      ipAdresse: eingabe.ipAdresse,
      userAgent: eingabe.userAgent,
    });

    // Text aus der Vorlage und nicht aus dem Code: Die Verwaltung soll ihn
    // ändern können, ohne auf einen Deploy zu warten.
    const doppelt = await prisma.emailVorlage.findUnique({
      where: { code: MAIL_VORLAGE.ANMELDUNG_DOPPELT },
    });
    const werteDoppelt = { vorname: vorhanden.vorname };
    await sendeMail({
      an: personDaten.email,
      personId: vorhanden.id,
      vorlageCode: MAIL_VORLAGE.ANMELDUNG_DOPPELT,
      betreff: fuelleVorlage(doppelt?.betreff ?? "Zu Ihrer Adresse liegt uns bereits eine Anmeldung vor", werteDoppelt),
      text: fuelleVorlage(
        doppelt?.textMd ??
          "Hallo {{vorname}},\n\n" +
            `Sie haben gerade eine Anmeldung zur ${EINRICHTUNG.name} abgeschickt. Zu Ihrer ` +
            "E-Mail-Adresse ist bei uns aber schon eine Anmeldung hinterlegt, deshalb haben wir keine " +
            "zweite angelegt.\n\n" +
            "Wenn das ein Versehen war, können Sie diese Nachricht ignorieren. Andernfalls melden Sie sich " +
            "einfach bei der Schulleitung.\n\n" +
            EINRICHTUNG.name,
        werteDoppelt,
      ),
    });

    await sendeAnRollen({
      rollen: [ROLLE.VERWALTUNG],
      // Die Vorlage legt der Seed an; der Ersatztext greift nur, wenn sie in
      // einer Installation fehlt.
      vorlageCode: MAIL_VORLAGE.ANMELDUNG_DOPPELT_VERWALTUNG,
      werte: { email: personDaten.email!, link: anmeldungenUrl() },
      ersatzBetreff: "Doppelte Anmeldung abgefangen",
      ersatzText:
        "Zur Adresse {{email}} wurde erneut eine Anmeldung abgeschickt. Es wurde nichts angelegt " +
        "und nichts überschrieben. Bitte prüfen, ob sich jemand ein zweites Mal anmelden möchte.\n\n" +
        "In GBS Campus ansehen: {{link}}",
    });

    return { ok: true };
  }

  // --- Semesterbezug ---------------------------------------------------------
  // Für welches Semester diese Anmeldung gilt, wird JETZT festgehalten und
  // nicht später aus `eingereichtAm` erraten. Ist noch kein Semester angelegt,
  // bleibt das Feld leer — die Anmeldung geht trotzdem durch, denn eine
  // fehlende Verwaltungsangabe darf niemanden an der Anmeldung hindern.
  const semesterId = await ermittleSemester();

  // --- Anlegen ---------------------------------------------------------------
  // Zwischen der Pruefung oben und dem Anlegen hier liegt ein Zeitfenster. Der
  // realistische Ausloeser ist kein Angreifer, sondern ein Doppelklick auf
  // „Absenden": Beide Anfragen sehen keine Person, die zweite laeuft in den
  // Unique-Index auf der E-Mail. Ohne Behandlung saehe der Anmeldende einen 500
  // und wuesste nicht, ob seine Anmeldung angekommen ist — obwohl sie es ist.
  let angelegt: { anmeldungId: string; personId: string };
  try {
    angelegt = await prisma.$transaction(async (tx) => {
      const person = await tx.person.create({
        data: {
          vorname: personDaten.vorname!,
          nachname: personDaten.nachname!,
          email: personDaten.email!,
          telefon: personDaten.telefon ?? null,
          geburtsdatum: personDaten.geburtsdatum ?? null,
          strasse: personDaten.strasse ?? null,
          plz: personDaten.plz ?? null,
          ort: personDaten.ort ?? null,
          gemeinde: personDaten.gemeinde ?? null,
          kontoinhaber: personDaten.kontoinhaber ?? null,
          ibanVerschluesselt: personDaten.iban ? verschluesseln(personDaten.iban) : null,
          teilnahmeform: personDaten.teilnahmeform ?? null,
          statusCode: STATUS.INTERESSENT,
        },
      });

      await tx.personRolle.create({ data: { personId: person.id, rolleCode: ROLLE.TEILNEHMER } });

      // Auch der erste Status wird protokolliert — die Akte soll lückenlos zeigen,
      // wie jemand in den Zustand gekommen ist, in dem er steht.
      await erfasseErstenStatus(tx, {
        personId: person.id,
        nachCode: STATUS.INTERESSENT,
        grund: SYSTEM_GRUND.ANMELDUNG_EINGEGANGEN,
        automatisch: true,
      });

      const bestehenderEntwurf = eingabe.fortsetzenToken
        ? await tx.anmeldung.findUnique({ where: { fortsetzenTokenHash: hashToken(eingabe.fortsetzenToken) } })
        : null;

      const daten = {
        personId: person.id,
        formularVersionId: version.id,
        status: AnmeldungStatus.EINGEREICHT,
        antworten: werte as Prisma.InputJsonValue,
        teilnahmeform: personDaten.teilnahmeform ?? null,
        semesterId,
        eingereichtAm: new Date(),
        // Der Fortsetzen-Link wird mit dem Absenden entwertet.
        fortsetzenTokenHash: null,
        fortsetzenLaeuftAb: null,
      };

      const anmeldung =
        bestehenderEntwurf && bestehenderEntwurf.status === AnmeldungStatus.ENTWURF
          ? await tx.anmeldung.update({ where: { id: bestehenderEntwurf.id }, data: daten })
          : await tx.anmeldung.create({ data: daten });

      for (const text of texte) {
        await tx.einwilligung.create({
          data: {
            personId: person.id,
            anmeldungId: anmeldung.id,
            textId: text.id,
            erteilt: erteilt.has(text.code),
            ipAdresse: eingabe.ipAdresse,
            userAgent: eingabe.userAgent,
          },
        });
      }

      return { anmeldungId: anmeldung.id, personId: person.id };
    });
  } catch (fehler) {
    if (fehler instanceof Prisma.PrismaClientKnownRequestError && fehler.code === "P2002") {
      await protokolliere({
        aktion: "ANMELDUNG_DOPPELT_VERSUCHT",
        objektTyp: "Person",
        quelle: "SYSTEM",
        // Ohne die Adresse — siehe oben; der Grund reicht als Spur.
        nachher: { grund: "zeitgleiche Einreichung" },
        ipAdresse: eingabe.ipAdresse,
        userAgent: eingabe.userAgent,
      });
      return { ok: true };
    }
    throw fehler;
  }

  // Ab hier ist die Transaktion committet: Person, Anmeldung, Einwilligungen und
  // Statuswechsel stehen. Was jetzt noch scheitert (Protokoll, Mailversand),
  // darf den Anmeldenden nicht mehr mit einem Fehler behelligen — seine
  // Anmeldung IST angekommen. Also laut loggen, aber Erfolg melden.
  const { anmeldungId, personId } = angelegt;
  try {
    await protokolliere({
      aktion: "ANMELDUNG_EINGEREICHT",
      objektTyp: "Anmeldung",
      objektId: anmeldungId,
      quelle: "SYSTEM",
      nachher: { formularVersion: version.version, art9Eingewilligt: art9Erteilt },
      ipAdresse: eingabe.ipAdresse,
      userAgent: eingabe.userAgent,
    });

    await sendeBestaetigung(personDaten.vorname!, personDaten.email!, personId);

    // Direkter Wunsch aus dem Interview: Die Verwaltung soll von neuen
    // Anmeldungen erfahren, ohne nachsehen zu müssen. An alle mit der Rolle
    // VERWALTUNG statt an eine fest hinterlegte Adresse — und über den
    // Verteiler, weil dort auch der leere Empfängerkreis eine sichtbare Spur
    // hinterlässt.
    await sendeAnRollen({
      rollen: [ROLLE.VERWALTUNG],
      vorlageCode: MAIL_VORLAGE.ANMELDUNG_VERWALTUNG,
      // Genau die Platzhalter, die die Vorlage im Seed kennt.
      werte: {
        name: `${personDaten.vorname} ${personDaten.nachname}`,
        email: personDaten.email!,
        teilnahmeform: personDaten.teilnahmeform ?? "nicht angegeben",
        link: anmeldungenUrl(),
      },
      // Ohne Namen, wie die Vorlage im Seed: Der Betreff steht im
      // Versandprotokoll an der personId der EMPFÄNGER (Code-Review 4, M6b).
      ersatzBetreff: "Neue Anmeldung eingegangen",
      ersatzText:
        "Es ist eine neue Anmeldung eingegangen:\n\n" +
        "{{name}}, {{email}}\nTeilnahmeform: {{teilnahmeform}}\n\n" +
        "In GBS Campus ansehen: {{link}}",
    });
  } catch (fehler) {
    console.error("[ANMELDUNG] Nachbereitung nach erfolgreicher Anlage fehlgeschlagen:", anmeldungId, fehler);
  }

  return { ok: true };
}

/**
 * Das Semester, für das eine jetzt eingehende Anmeldung gilt. Die Entscheidung
 * selbst steht in `lib/semester.ts` und ist dort ohne Datenbank nachprüfbar —
 * hier wird nur geladen.
 */
async function ermittleSemester(): Promise<string | null> {
  const kandidaten = await prisma.semester.findMany({
    select: { id: true, start: true, anmeldungVon: true, anmeldungBis: true, istAktuell: true },
  });
  return semesterFuerAnmeldung(kandidaten, new Date());
}

async function sendeBestaetigung(vorname: string, email: string, personId: string): Promise<void> {
  const vorlage = await prisma.emailVorlage.findUnique({ where: { code: MAIL_VORLAGE.ANMELDUNG_EINGEGANGEN } });
  await sendeMail({
    an: email,
    // Mit Personenbezug, damit die Anonymisierung die Zeile findet (vorher
    // hing die Eingangsbestätigung an niemandem).
    personId,
    vorlageCode: MAIL_VORLAGE.ANMELDUNG_EINGEGANGEN,
    betreff: vorlage?.betreff ?? "Ihre Anmeldung ist eingegangen",
    text: fuelleVorlage(vorlage?.textMd ?? "Hallo {{vorname}},\n\nIhre Anmeldung ist eingegangen.", { vorname }),
  });
}
