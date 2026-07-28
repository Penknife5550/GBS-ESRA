/**
 * GBS Campus — Passwörter
 *
 * Das Passwort ist der **zweite** Anmeldeweg, nicht der erste. Es ist
 * freiwillig, und es gibt genau einen Grund dafür: Der Magic-Link hängt am
 * Postfach. Wer den Zugriff darauf verliert, käme ohne Passwort nicht mehr
 * hinein und wäre auf einen Menschen angewiesen. Mit Passwort meldet er sich
 * an und trägt selbst eine neue Adresse ein.
 *
 * Umgekehrt braucht es **kein** eigenes Zurücksetzen-Verfahren: Wer das
 * Passwort vergisst, fordert einen Anmeldelink an und setzt im Portal ein
 * neues. Ein zweiter Token-Typ mit eigener Tabelle, eigener Frist und eigenem
 * Missbrauchsweg wäre reine Verdopplung.
 *
 * **scrypt statt bcrypt oder Argon2** — und das ist kein Geschmacksurteil:
 * Beide anderen brauchen eine native Abhängigkeit, die im Image mit
 * `npm ci --ignore-scripts` gar nicht gebaut würde. scrypt steckt in Node
 * selbst, ist speicherhart und damit gegen Grafikkarten-Angriffe brauchbar.
 *
 * Was hier NICHT passiert: Es gibt keine Regeln über Groß- und Kleinschreibung,
 * Sonderzeichen oder Ziffern. Sie führen nachweislich zu „Passwort1!" und zu
 * Zetteln am Bildschirm. Was zählt, ist die Länge.
 */

import { randomBytes, scrypt, ScryptOptions, timingSafeEqual } from "crypto";

/**
 * scrypt mit Rückruf in ein Versprechen gewickelt — von Hand statt mit
 * `promisify`. Grund: `crypto.scrypt` hat zwei Signaturen (mit und ohne
 * Optionen), und `promisify` greift sich die erste. Der Aufruf mit Optionen
 * ließe sich dann nicht mehr typsicher schreiben, und die Kostenparameter sind
 * genau das, was hier nicht verloren gehen darf.
 */
function scryptAsync(passwort: string, salt: Buffer, laenge: number, optionen: ScryptOptions): Promise<Buffer> {
  return new Promise((aufloesen, ablehnen) => {
    scrypt(passwort, salt, laenge, optionen, (fehler, ergebnis) => {
      if (fehler) ablehnen(fehler);
      else aufloesen(ergebnis);
    });
  });
}

// 128 * N * r Bytes Arbeitsspeicher je Prüfung = 32 MB. Node begrenzt scrypt
// standardmäßig auf 32 MB, deshalb wird maxmem ausdrücklich angehoben — sonst
// scheitert jede Prüfung mit einem Speicherfehler statt mit „falsch".
//
// MAXMEM ist zugleich die Obergrenze für gespeicherte Kostenparameter: Sie ist
// eine Konstante im Code und wird nie aus einem Datensatz hochgezogen (siehe
// passwortStimmt).
const N = 32768;
const R = 8;
const P = 1;
const SCHLUESSEL_LAENGE = 64;
const MAXMEM = 128 * N * R * 2;

/** Obergrenze, damit niemand mit einem Megabyte Passwort den Server beschäftigt. */
export const PASSWORT_MAX_LAENGE = 200;

export type Pruefmeldung = { feld?: string; meldung: string };

/**
 * Prüft ein gewünschtes Passwort. Die Mindestlänge kommt aus den Einstellungen
 * und wird übergeben — diese Datei bleibt dadurch ohne Datenbankzugriff und
 * ist im Prüfskript nachvollziehbar.
 */
export function pruefePasswort(passwort: unknown, mindestLaenge: number, email?: string): Pruefmeldung[] {
  if (typeof passwort !== "string") {
    return [{ feld: "passwort", meldung: "Bitte ein Passwort angeben." }];
  }

  const meldungen: Pruefmeldung[] = [];

  // Nicht getrimmt: Leerzeichen am Rand sind erlaubte Zeichen. Wer sie
  // wegschneidet, macht aus einem gültigen Passwort ein anderes — und beim
  // nächsten Anmelden passt es nicht mehr.
  if (passwort.length < mindestLaenge) {
    meldungen.push({
      feld: "passwort",
      meldung: `Das Passwort muss mindestens ${mindestLaenge} Zeichen lang sein. Ein ganzer Satz ist leichter zu merken und sicherer als ein kurzes Kunstwort.`,
    });
  }
  if (passwort.length > PASSWORT_MAX_LAENGE) {
    meldungen.push({ feld: "passwort", meldung: `Das Passwort darf höchstens ${PASSWORT_MAX_LAENGE} Zeichen lang sein.` });
  }
  // Die eigene Adresse als Passwort ist der erste Versuch jedes Angreifers.
  if (email && passwort.trim().toLowerCase() === email.trim().toLowerCase()) {
    meldungen.push({ feld: "passwort", meldung: "Die eigene E-Mail-Adresse ist als Passwort nicht geeignet." });
  }

  return meldungen;
}

/** Erzeugt den zu speichernden Wert: "scrypt$N$r$p$salt$hash", alles Base64. */
export async function hashePasswort(passwort: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(passwort, salt, SCHLUESSEL_LAENGE, { N, r: R, p: P, maxmem: MAXMEM });

  return ["scrypt", N, R, P, salt.toString("base64"), hash.toString("base64")].join("$");
}

/**
 * Prüft ein Passwort gegen einen gespeicherten Wert.
 *
 * Verglichen wird in konstanter Zeit. Ein `===` auf den Hashes würde beim
 * ersten abweichenden Byte abbrechen und über die Laufzeit verraten, wie viele
 * Stellen schon stimmen.
 *
 * Die Parameter werden aus dem gespeicherten Wert gelesen, nicht aus den
 * Konstanten oben: Sonst wäre jedes vorhandene Passwort ungültig, sobald
 * jemand den Aufwand hochsetzt.
 *
 * Gelesen heißt aber nicht geglaubt: Die Kostenparameter bestimmen, wie viel
 * Arbeitsspeicher scrypt belegt, und sie stehen in einem Datensatz. Wer eine
 * Zeile in `person` schreiben kann, würde mit N = 2^22 sonst vier Gigabyte je
 * Anmeldeversuch anfordern und den Dienst mit einer einzigen Anfrage umlegen.
 * Deshalb wird gegen die feste Obergrenze MAXMEM geprüft und abgewiesen, statt
 * die Grenze passend hochzusetzen.
 */
export async function passwortStimmt(passwort: string, gespeichert: string | null): Promise<boolean> {
  // Kein Passwort gesetzt — der Normalfall für alle, die nur den Anmeldelink
  // benutzen. Bewusst ohne Logausgabe, sonst stünde bei jedem Anmeldeversuch
  // dieser Personen eine Meldung im Protokoll.
  if (!gespeichert) return false;

  const teile = gespeichert.split("$");
  if (teile.length !== 6 || teile[0] !== "scrypt") {
    // Ab hier ist der gespeicherte Wert kaputt, nicht das eingegebene Passwort.
    // Ohne Meldung sähe das für den Betroffenen wie ein falsches Passwort aus,
    // und niemand käme dem Grund je auf die Spur. Protokolliert wird nur die
    // Form, nie der Wert: Er ist zwar ein Hash, gehört aber nicht ins Log.
    console.error("[PASSWORT] Gespeicherter Wert hat nicht die Form scrypt$N$r$p$salt$hash.");
    return false;
  }

  const n = Number(teile[1]);
  const r = Number(teile[2]);
  const p = Number(teile[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    console.error(`[PASSWORT] Gespeicherte Kostenparameter sind keine ganzen Zahlen (N=${n}, r=${r}, p=${p}).`);
    return false;
  }

  // Der Speicherbedarf steht fest, bevor scrypt überhaupt anläuft: 128 * N * r
  // Bytes. Passt er nicht in die vorgesehene Grenze, wird hier abgewiesen —
  // nicht nachträglich mehr Speicher freigegeben.
  if (128 * n * r > MAXMEM) {
    console.error(`[PASSWORT] Gespeicherte Kostenparameter verlangen zu viel Speicher (N=${n}, r=${r}).`);
    return false;
  }

  const salt = Buffer.from(teile[4], "base64");
  const erwartet = Buffer.from(teile[5], "base64");
  if (salt.length === 0 || erwartet.length === 0) {
    console.error("[PASSWORT] Gespeicherter Wert hat leeres Salz oder leeren Hash.");
    return false;
  }

  let berechnet: Buffer;
  try {
    berechnet = await scryptAsync(passwort, salt, erwartet.length, {
      N: n,
      r,
      p,
      maxmem: MAXMEM,
    });
  } catch (fehler) {
    // Unbrauchbare Parameter im gespeicherten Wert (N keine Zweierpotenz, p zu
    // groß): als „stimmt nicht" behandeln, nicht als Serverfehler — aber nicht
    // stillschweigend. Im Log stehen nur die Parameter, nie Salz oder Hash.
    console.error(`[PASSWORT] scrypt mit gespeicherten Parametern fehlgeschlagen (N=${n}, r=${r}, p=${p}):`, fehler);
    return false;
  }

  return berechnet.length === erwartet.length && timingSafeEqual(berechnet, erwartet);
}

/**
 * Verbrennt dieselbe Rechenzeit wie eine echte Prüfung.
 *
 * Ohne das wäre die Anmeldung ein Verzeichnis aller Teilnehmer: Bei einer
 * unbekannten Adresse käme die Antwort in Mikrosekunden, bei einer bekannten
 * erst nach der scrypt-Berechnung. Der Unterschied ist im Netz messbar — und
 * die Auskunft „diese Person besucht die Bibelschule" ist eine Angabe zur
 * Religionszugehörigkeit (Art. 9 DSGVO).
 *
 * Eine Einschränkung, die man kennen muss: Hier wird mit den AKTUELLEN
 * Konstanten gerechnet, `passwortStimmt` dagegen mit den im Datensatz
 * GESPEICHERTEN. Solange beide gleich sind, stimmen die Laufzeiten überein.
 * Wer N heraufsetzt, verlängert nur den echten Weg — bestehende Passwörter
 * behalten ihre alten Parameter —, und der Unterschied wird wieder messbar.
 * Nach einer Änderung der Kostenparameter gehören deshalb alle vorhandenen
 * Hashes bei der nächsten erfolgreichen Anmeldung neu berechnet; bis dahin ist
 * dieser Ausgleich nur noch näherungsweise wirksam.
 */
export async function verbrenneZeitWieEinePruefung(): Promise<void> {
  await scryptAsync("platzhalter", randomBytes(16), SCHLUESSEL_LAENGE, { N, r: R, p: P, maxmem: MAXMEM });
}
