/**
 * GBS Campus — lesbare Namen zu Personen-Ids
 *
 * Für Genehmiger, Freigeber und Aussteller auf Belegen, Zeugnissen und in
 * Übersichten. Lag vorher im Honorarmodul und wurde von dort auch ins
 * Zeugnismodul importiert.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Ordnet Akteur-/Personen-Ids lesbare Namen („Nachname, Vorname") zu. Unter der
 * DMS-Sperre mit deren Transaktion (`client` = tx) aufrufen — sonst belegt jeder
 * Versand eine zweite Pool-Verbindung, waehrend die erste auf SMTP wartet.
 */
export async function ladeAkteurNamen(
  ids: string[],
  client: Prisma.TransactionClient = prisma,
): Promise<Map<string, string>> {
  const eindeutige = [...new Set(ids.filter(Boolean))];
  if (eindeutige.length === 0) return new Map();
  const personen = await client.person.findMany({
    where: { id: { in: eindeutige } },
    select: { id: true, vorname: true, nachname: true },
  });
  return new Map(personen.map((p) => [p.id, `${p.nachname}, ${p.vorname}`]));
}
