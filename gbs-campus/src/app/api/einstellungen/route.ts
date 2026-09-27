import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { pruefeZugriff } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { istEinstellungSchluessel, setzeZahl } from "@/lib/einstellungen";
import { RECHT } from "@/lib/constants";
import { erfolg, fehler } from "@/lib/api";

const schema = z.object({
  schluessel: z.string().min(1),
  wert: z.number().int(),
});

export async function PUT(request: NextRequest) {
  const benutzer = await pruefeZugriff(RECHT.SYSTEM_EINSTELLUNGEN);
  if (benutzer instanceof Response) return benutzer;

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) {
    return fehler("Ungültige Anfrage.", 400);
  }

  // Nur bekannte Schlüssel: sonst liessen sich über diesen Endpunkt beliebige
  // Zeilen anlegen, für die es im Code weder Grenzen noch Rückfallwert gibt.
  // Nicht mit `in` prüfen — das ließe „constructor" & Co. durch (siehe
  // istEinstellungSchluessel).
  const schluessel = geprueft.data.schluessel;
  if (!istEinstellungSchluessel(schluessel)) {
    return fehler("Diese Einstellung gibt es nicht.", 404);
  }

  const vorher = await prisma.einstellung.findUnique({ where: { schluessel } });

  const ergebnis = await setzeZahl(schluessel, geprueft.data.wert);
  if (!ergebnis.ok) {
    return fehler(ergebnis.meldung, 400);
  }

  await protokolliere({
    aktion: "EINSTELLUNG_GEAENDERT",
    objektTyp: "Einstellung",
    objektId: schluessel,
    akteurId: benutzer.id,
    vorher: { wert: vorher?.wert },
    nachher: { wert: String(geprueft.data.wert) },
    headers: request.headers,
  });

  return erfolg({ gespeichert: true });
}
