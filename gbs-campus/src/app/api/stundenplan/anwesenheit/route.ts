import { NextRequest } from "next/server";
import { z } from "zod";
import { pruefeZugriff } from "@/lib/berechtigung";
import { erfolg, fehler } from "@/lib/api";
import { RECHT } from "@/lib/constants";
import { ANWESENHEIT_WERTE } from "@/lib/stundenplan";
import { erfasseAnwesenheit } from "@/lib/stundenplan-io";

// Alle vier Zustände — die Verwaltung darf auch „entschuldigt" setzen.
const status = z.enum(ANWESENHEIT_WERTE);

const schema = z.object({
  terminId: z.string().uuid(),
  eintraege: z
    .array(z.object({ teilnahmeId: z.string().uuid(), status }))
    .min(1)
    .max(500),
});

/**
 * Erfasst die Anwesenheit eines Termins für mehrere Teilnehmer auf einmal.
 * Upsert je (Termin, Teilnahme) — idempotent, kein Doppeleintrag.
 */
export async function POST(request: NextRequest) {
  const benutzer = await pruefeZugriff(RECHT.SEMESTER_VERWALTEN);
  if (benutzer instanceof Response) return benutzer;

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);

  const ergebnis = await erfasseAnwesenheit({
    terminId: geprueft.data.terminId,
    eintraege: geprueft.data.eintraege,
    akteurId: benutzer.id,
    headers: request.headers,
  });
  if ("fehler" in ergebnis) return fehler("Diesen Termin gibt es nicht.", 404);

  return erfolg(ergebnis);
}
