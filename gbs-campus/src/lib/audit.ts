/**
 * GBS Campus — Audit-Log
 *
 * Zentral, append-only, auch fuer den Administrator nicht loeschbar. Die
 * Unveraenderbarkeit wird auf Datenbankebene durchgesetzt (Trigger + REVOKE,
 * siehe prisma/migrations/.../audit_append_only.sql) — dieses Modul ist nur
 * der bequeme Schreibweg, nicht die Absicherung.
 *
 * Grundsatz: schreiben, ohne den Aufrufer zum Absturz zu bringen. Ein
 * fehlgeschlagener Audit-Eintrag darf keine fachliche Aktion zurueckrollen —
 * er muss aber laut in den Logs stehen.
 */

import { prisma } from "@/lib/db";
import { ermittleRequestKontext } from "@/lib/request-kontext";

export type AuditQuelle = "WEB" | "SYSTEM" | "IMPERSONATION";

export type AuditEintrag = {
  aktion: string;
  objektTyp: string;
  objektId?: string | null;
  akteurId?: string | null;
  quelle?: AuditQuelle;
  vorher?: unknown;
  nachher?: unknown;
  /** Headers der ausloesenden Anfrage — liefert IP und User-Agent. */
  headers?: Headers;
  /** Alternative zu headers, wenn die Herkunft schon ermittelt wurde. */
  ipAdresse?: string | null;
  userAgent?: string | null;
  /** Gesetzt, wenn ein Administrator im Namen einer anderen Person handelt. */
  impersoniertPersonId?: string | null;
};

/** Felder, die niemals im Audit-Log landen duerfen. */
const GEHEIM = new Set([
  "ibanVerschluesselt",
  "iban",
  "tokenHash",
  "fortsetzenTokenHash",
  "passwort",
  "passwortHash",
  "smtpPassword",
]);

/**
 * Entfernt Geheimnisse aus einem Objekt, bevor es protokolliert wird.
 * Die IBAN steht verschluesselt in der Datenbank — sie gehoert nicht in ein
 * Protokoll, das breiter lesbar ist als der Datensatz selbst.
 */
function bereinigen(wert: unknown): unknown {
  if (wert === null || typeof wert !== "object") return wert;
  if (Array.isArray(wert)) return wert.map(bereinigen);

  const ergebnis: Record<string, unknown> = {};
  for (const [schluessel, inhalt] of Object.entries(wert as Record<string, unknown>)) {
    ergebnis[schluessel] = GEHEIM.has(schluessel) ? "[entfernt]" : bereinigen(inhalt);
  }
  return ergebnis;
}

export async function protokolliere(eintrag: AuditEintrag): Promise<void> {
  const kontext = eintrag.headers
    ? ermittleRequestKontext(eintrag.headers)
    : { ipAdresse: eintrag.ipAdresse ?? null, userAgent: eintrag.userAgent ?? null };

  try {
    await prisma.auditLog.create({
      data: {
        aktion: eintrag.aktion,
        objektTyp: eintrag.objektTyp,
        objektId: eintrag.objektId ?? null,
        akteurId: eintrag.akteurId ?? null,
        quelle: eintrag.quelle ?? (eintrag.akteurId ? "WEB" : "SYSTEM"),
        vorher: eintrag.vorher === undefined ? undefined : (bereinigen(eintrag.vorher) as never),
        nachher: eintrag.nachher === undefined ? undefined : (bereinigen(eintrag.nachher) as never),
        ipAdresse: kontext.ipAdresse,
        userAgent: kontext.userAgent,
        impersoniertPersonId: eintrag.impersoniertPersonId ?? null,
      },
    });
  } catch (fehler) {
    // Bewusst nicht weiterwerfen: ein fehlgeschlagenes Protokoll darf die
    // fachliche Aktion nicht rueckgaengig machen. Aber es muss auffallen.
    console.error("[AUDIT] Eintrag konnte nicht geschrieben werden:", eintrag.aktion, fehler);
  }
}
