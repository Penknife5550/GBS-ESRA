/**
 * GBS Campus — E-Mail-Versand
 *
 * Jeder Versand wird protokolliert (Tabelle email_versand), auch der
 * fehlgeschlagene. Der Magic-Link ist der einzige Kontoschlüssel: Wenn eine
 * Adresse nicht erreichbar ist, muss das in der Akte stehen und nicht nur im
 * Serverlog verschwinden.
 *
 * Ohne konfiguriertes SMTP wird die Nachricht nicht verschickt, sondern in die
 * Konsole geschrieben. Das ist der Entwicklungsmodus — in Produktion fehlt dann
 * die Konfiguration, und das soll auffallen.
 */

import nodemailer from "nodemailer";
import { prisma } from "@/lib/db";
import { smtpKonfiguriert } from "@/lib/konfiguration";

export type MailAuftrag = {
  an: string;
  betreff: string;
  text: string;
  personId?: string | null;
  vorlageCode?: string | null;
};

/**
 * Ein Transport fuer alle Mails statt einer pro Versand.
 *
 * Vorher entstand je Mail ein neuer Transport, also je Mail ein vollstaendiger
 * TCP-, TLS- und AUTH-Handshake. Und ohne Zeitgrenzen wartete nodemailer bis zu
 * zwei Minuten — bei /api/auth/anmelden also genau der Login.
 */
let transport: nodemailer.Transporter | null = null;

function holeTransport(): nodemailer.Transporter {
  if (transport) return transport;
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
    pool: true,
    maxConnections: 3,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transport;
}

/**
 * Schreibt die WARTEND-Zeile. Liefert null, wenn die Datenbank nicht mitspielt.
 *
 * Ein Fehler beim Protokollieren darf den Aufrufer nicht zerreissen: Der
 * Versand haengt an Anmeldung, Aufnahme und Selbstpflege, und ein 500 dort
 * wuerde eine bereits gespeicherte fachliche Aenderung als gescheitert
 * darstellen.
 */
async function legeProtokollAn(auftrag: MailAuftrag): Promise<string | null> {
  try {
    const zeile = await prisma.emailVersand.create({
      data: {
        personId: auftrag.personId ?? null,
        empfaenger: auftrag.an,
        betreff: auftrag.betreff,
        vorlageCode: auftrag.vorlageCode ?? null,
        status: "WARTEND",
      },
    });
    return zeile.id;
  } catch (fehler) {
    console.error("[MAIL] Versandprotokoll konnte nicht angelegt werden fuer", auftrag.an, fehler);
    return null;
  }
}

/**
 * Setzt den Ausgang der Zustellung. Scheitert auch das, bleibt die Zeile auf
 * WARTEND stehen — und genau dafuer gibt es in der Betriebsansicht den
 * Abschnitt „seit mehr als 5 Minuten wartend". Ein stehengebliebenes WARTEND
 * ist unangenehm, aber sichtbar; ein geworfener Fehler an dieser Stelle waere
 * ein 500 fuer eine Sache, die laengst passiert ist.
 */
async function schliesseProtokollAb(
  id: string,
  daten: { status: "GESENDET" | "FEHLER"; fehler?: string; gesendetAm?: Date },
): Promise<void> {
  try {
    await prisma.emailVersand.update({ where: { id }, data: daten });
  } catch (fehler) {
    console.error("[MAIL] Versandprotokoll konnte nicht abgeschlossen werden, Zeile bleibt WARTEND:", id, fehler);
  }
}

export async function sendeMail(auftrag: MailAuftrag): Promise<{ gesendet: boolean }> {
  const protokollId = await legeProtokollAn(auftrag);

  // Ohne Protokollzeile wird nicht verschickt. Eine Mail, von der es keine Spur
  // gibt, waere im Ein-Personen-Betrieb unauffindbar — und eine Datenbank, die
  // keine einzelne Zeile mehr annimmt, ist ohnehin nicht arbeitsfaehig.
  if (!protokollId) return { gesendet: false };

  if (!smtpKonfiguriert()) {
    // Der Text wird NICHT geloggt. Er enthaelt bei Anmeldelinks einen
    // vollwertigen Kontoschluessel — wer Log-Zugriff haette (Docker-Logs,
    // Log-Versand, ein Screenshot im Support), koennte sich damit anmelden.
    // In der Entwicklung braucht man den Link trotzdem, deshalb dort und nur
    // dort die Ausgabe.
    if (process.env.NODE_ENV === "production") {
      console.error(`[MAIL] Nicht verschickt an ${auftrag.an}: SMTP ist nicht konfiguriert.`);
    } else {
      console.warn(
        `\n[MAIL — Entwicklungsmodus, nicht verschickt]\nAn:      ${auftrag.an}\nBetreff: ${auftrag.betreff}\n\n${auftrag.text}\n`,
      );
    }
    await schliesseProtokollAb(protokollId, {
      status: "FEHLER",
      fehler: "SMTP ist nicht konfiguriert (SMTP_HOST / MAIL_ABSENDER_ADRESSE).",
    });
    return { gesendet: false };
  }

  try {
    await holeTransport().sendMail({
      from: {
        name: process.env.MAIL_ABSENDER_NAME ?? "Gemeindebibelschule Minden",
        address: process.env.MAIL_ABSENDER_ADRESSE!,
      },
      replyTo: process.env.MAIL_ANTWORT_AN || undefined,
      to: auftrag.an,
      subject: auftrag.betreff,
      text: auftrag.text,
    });

    await schliesseProtokollAb(protokollId, { status: "GESENDET", gesendetAm: new Date() });
    // Der Rueckgabewert folgt dem, was der Mailserver getan hat, nicht dem, was
    // die Protokollzeile sagt: Die Mail IST raus, auch wenn das Festhalten
    // gerade fehlgeschlagen ist.
    return { gesendet: true };
  } catch (fehler) {
    await schliesseProtokollAb(protokollId, {
      status: "FEHLER",
      fehler: fehler instanceof Error ? fehler.message : "Unbekannter Fehler",
    });
    console.error("[MAIL] Versand fehlgeschlagen an", auftrag.an, fehler);
    return { gesendet: false };
  }
}

/** Ersetzt {{platzhalter}} in einem Vorlagentext. */
export function fuelleVorlage(text: string, werte: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (treffer, schluessel: string) => werte[schluessel] ?? treffer);
}
