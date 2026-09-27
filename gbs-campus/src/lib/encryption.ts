/**
 * GBS Campus — Verschluesselung sensibler Felder
 *
 * AES-256-GCM auf Anwendungsebene. In Release 0.1 betrifft das die IBAN aus
 * der Anmeldung (DSGVO Art. 32).
 *
 * Schluessel erzeugen: openssl rand -hex 32
 *
 * ACHTUNG: Der Schluessel gehoert getrennt vom Backup in den Notfall-Tresor.
 * Ohne ihn ist ein wiederhergestellter Datenbestand in diesen Feldern wertlos.
 */

import crypto from "crypto";

const ALGORITHMUS = "aes-256-gcm";
const IV_LAENGE = 16;

let schluessel: Buffer | null = null;

function getSchluessel(): Buffer {
  if (schluessel) return schluessel;

  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 64 || !/^[0-9a-fA-F]+$/.test(key)) {
    throw new Error(
      "ENCRYPTION_KEY fehlt oder ist ungueltig. Erwartet werden exakt 64 Hex-Zeichen (32 Bytes). " +
        "Erzeugen mit: openssl rand -hex 32",
    );
  }
  schluessel = Buffer.from(key, "hex");
  return schluessel;
}

/** Verschluesselt Klartext. Rueckgabeformat: "iv:authTag:ciphertext" (Base64). */
export function verschluesseln(klartext: string): string {
  if (!klartext) return klartext;

  const iv = crypto.randomBytes(IV_LAENGE);
  const cipher = crypto.createCipheriv(ALGORITHMUS, getSchluessel(), iv);
  const verschluesselt = Buffer.concat([cipher.update(klartext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString("base64"), authTag.toString("base64"), verschluesselt.toString("base64")].join(":");
}

/** Entschluesselt einen mit verschluesseln() erzeugten Wert. */
export function entschluesseln(wert: string): string {
  if (!wert) return wert;

  const teile = wert.split(":");
  if (teile.length !== 3) {
    throw new Error("Verschluesselter Wert hat ein unerwartetes Format.");
  }

  const [ivB64, authTagB64, datenB64] = teile;
  const decipher = crypto.createDecipheriv(ALGORITHMUS, getSchluessel(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));

  return Buffer.concat([decipher.update(Buffer.from(datenB64, "base64")), decipher.final()]).toString("utf8");
}
