import { NextRequest } from "next/server";
import { z } from "zod";
import { ladeMitRecht } from "@/lib/berechtigung";
import { erfolg, fehler, keineBerechtigung } from "@/lib/api";
import { RECHT } from "@/lib/constants";
import { generiereDienstagstermine } from "@/lib/stundenplan-io";

const schema = z.object({
  semesterId: z.string().uuid(),
  anzahl: z.number().int().min(1).max(30).optional(),
});

/**
 * Legt die Dienstagabende eines Semesters an (Standard: 10, ab Semesterbeginn,
 * wöchentlich). Idempotent — ein zweiter Aufruf legt nichts doppelt an.
 */
export async function POST(request: NextRequest) {
  const benutzer = await ladeMitRecht(RECHT.SEMESTER_VERWALTEN);
  if (!benutzer) return keineBerechtigung();

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);

  const ergebnis = await generiereDienstagstermine(
    geprueft.data.semesterId,
    geprueft.data.anzahl ?? 10,
    benutzer.id,
    request.headers,
  );
  if ("fehler" in ergebnis) return fehler("Dieses Semester gibt es nicht.", 404);

  return erfolg(ergebnis);
}
