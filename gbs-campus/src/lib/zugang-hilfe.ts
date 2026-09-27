/**
 * GBS Campus — „Ich komme nicht mehr rein"
 *
 * Für jeden EINZELNEN Verlust gibt es einen Weg ohne Menschen: Wer sein
 * Passwort vergisst, fordert einen Anmeldelink an und setzt im Portal ein
 * neues. Wer an sein Postfach nicht mehr herankommt, meldet sich mit Passwort
 * an und trägt selbst eine neue Adresse ein.
 *
 * Dieses Formular ist für den Fall, in dem BEIDES fehlt — kein erreichbares
 * Postfach und kein Passwort — oder in dem jemand nicht mehr weiß, welche
 * Adresse überhaupt hinterlegt ist. Dafür gibt es keinen dritten Faktor und
 * deshalb keinen Automatismus: Die Schule muss den Menschen erkennen. Genau das
 * leistet dieses Formular: Es ändert **nichts** und bestätigt **nichts**, es
 * meldet den Fall an Schulleitung und Verwaltung. Die kennen bei 20 bis 60
 * Teilnehmern jeden persönlich und tragen die neue Adresse ein.
 *
 * Alles andere wäre eine Kontoübernahme per Formular: Wer eine fremde Adresse
 * eintragen könnte, ohne dass ein Mensch hinsieht, hätte den Zugang zum Konto.
 */

export type Pruefmeldung = { feld?: string; meldung: string };

export type HilfeAnfrage = {
  vorname: string;
  nachname: string;
  /** Die bisher hinterlegte Adresse, soweit erinnerlich. */
  bisherigeEmail?: string | null;
  /** Wie die Schule zurückkommen kann — mindestens eines von beiden. */
  erreichbarEmail?: string | null;
  erreichbarTelefon?: string | null;
  nachricht?: string | null;
};

export type GepruefteAnfrage = {
  vorname: string;
  nachname: string;
  bisherigeEmail: string | null;
  erreichbarEmail: string | null;
  erreichbarTelefon: string | null;
  nachricht: string | null;
};

export type HilfeErgebnis =
  | { ok: true; werte: GepruefteAnfrage }
  | { ok: false; meldungen: Pruefmeldung[] };

const EMAIL_MUSTER = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TELEFON_MUSTER = /^[0-9+\-\s()/]{5,30}$/;
/** Genug für einen erklärenden Absatz, zu wenig für einen Datenablageplatz. */
const NACHRICHT_MAX = 1000;

function text(wert: unknown): string | null {
  if (typeof wert !== "string") return null;
  // Zeilenumbrüche werden zu Leerzeichen, nicht nur an den Rändern getrimmt:
  // Vorname und Nachname landen im Betreff der Meldungsmail, und ein CR/LF im
  // Betreff erlaubt es, weitere Kopfzeilen einzuschleusen. Die übrigen Felder
  // sind aus demselben Grund mit erfasst — eine Ausnahme wäre nur eine Stelle,
  // an der man es beim nächsten Mal vergisst.
  const sauber = wert.replace(/[\r\n]+/g, " ").trim();
  return sauber.length === 0 ? null : sauber;
}

export function pruefeHilfeAnfrage(eingabe: HilfeAnfrage): HilfeErgebnis {
  const meldungen: Pruefmeldung[] = [];

  const vorname = text(eingabe.vorname);
  const nachname = text(eingabe.nachname);
  if (!vorname || vorname.length > 80) {
    meldungen.push({ feld: "vorname", meldung: "Bitte Ihren Vornamen angeben." });
  }
  if (!nachname || nachname.length > 80) {
    meldungen.push({ feld: "nachname", meldung: "Bitte Ihren Nachnamen angeben." });
  }

  const bisherigeEmail = text(eingabe.bisherigeEmail)?.toLowerCase() ?? null;
  if (bisherigeEmail && !EMAIL_MUSTER.test(bisherigeEmail)) {
    meldungen.push({ feld: "bisherigeEmail", meldung: "Diese Adresse sieht nicht wie eine E-Mail-Adresse aus." });
  }

  const erreichbarEmail = text(eingabe.erreichbarEmail)?.toLowerCase() ?? null;
  if (erreichbarEmail && !EMAIL_MUSTER.test(erreichbarEmail)) {
    meldungen.push({ feld: "erreichbarEmail", meldung: "Bitte eine gültige E-Mail-Adresse angeben." });
  }

  const erreichbarTelefon = text(eingabe.erreichbarTelefon);
  if (erreichbarTelefon && !TELEFON_MUSTER.test(erreichbarTelefon)) {
    meldungen.push({ feld: "erreichbarTelefon", meldung: "Bitte eine gültige Telefonnummer angeben." });
  }

  // Ohne Rückweg ist die Meldung wertlos: Die Schule könnte den Menschen nicht
  // erreichen, und der Wartende hielte seine Bitte für unterwegs.
  if (!erreichbarEmail && !erreichbarTelefon) {
    meldungen.push({
      feld: "erreichbarEmail",
      meldung: "Bitte eine E-Mail-Adresse oder eine Telefonnummer angeben, unter der wir Sie erreichen.",
    });
  }

  const nachricht = text(eingabe.nachricht);
  if (nachricht && nachricht.length > NACHRICHT_MAX) {
    meldungen.push({ feld: "nachricht", meldung: `Bitte auf ${NACHRICHT_MAX} Zeichen kürzen.` });
  }

  if (meldungen.length > 0) return { ok: false, meldungen };

  return {
    ok: true,
    werte: {
      vorname: vorname!,
      nachname: nachname!,
      bisherigeEmail,
      erreichbarEmail,
      erreichbarTelefon,
      nachricht,
    },
  };
}

/**
 * Die Platzhalterwerte der Meldung.
 *
 * Der Versand läuft über eine Vorlage aus `email_vorlagen`, damit der Text ohne
 * Deploy änderbar bleibt. Ohne diese Werte stünde in einer selbst angelegten
 * Vorlage zwar ein schöner Satz, aber nicht, um wen es geht — die Meldung wäre
 * unbrauchbar, ohne dass es jemandem auffiele.
 */
export function hilfeWerte(anfrage: GepruefteAnfrage): Record<string, string> {
  return {
    name: `${anfrage.vorname} ${anfrage.nachname}`,
    erreichbar: [anfrage.erreichbarEmail, anfrage.erreichbarTelefon].filter(Boolean).join(" · "),
    bisherigeEmail: anfrage.bisherigeEmail ?? "unbekannt",
    mitteilung: anfrage.nachricht ?? "—",
  };
}

/**
 * Der Meldungstext für Schulleitung und Verwaltung.
 *
 * Bewusst mit dem ausdrücklichen Hinweis, dass die Angaben ungeprüft sind: Die
 * Meldung kommt aus einem öffentlichen Formular, jeder kann jeden Namen
 * eintragen. Wer daraufhin eine Adresse ändert, muss wissen, dass er die Person
 * vorher erkennen muss.
 */
export function hilfeMeldung(anfrage: GepruefteAnfrage): string {
  const werte = hilfeWerte(anfrage);
  const zeilen = [
    `${werte.name} kommt nicht mehr ins Portal.`,
    "",
    `Erreichbar unter: ${werte.erreichbar}`,
    `Bisher hinterlegte Adresse laut eigener Angabe: ${werte.bisherigeEmail}`,
  ];

  if (anfrage.nachricht) {
    zeilen.push("", "Mitteilung:", anfrage.nachricht);
  }

  zeilen.push(
    "",
    "ACHTUNG: Diese Angaben stammen aus einem öffentlichen Formular und sind ungeprüft.",
    "Bitte erst die Person erkennen (Anruf, persönlich), dann unter Verwaltung → Personen die",
    "E-Mail-Adresse ändern und den Anmeldelink schicken.",
  );

  return zeilen.join("\n");
}
