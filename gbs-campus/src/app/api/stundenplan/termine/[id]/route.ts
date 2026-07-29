import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler, keineBerechtigung } from "@/lib/api";
import { RECHT } from "@/lib/constants";
import { istDozent } from "@/lib/honorar-io";

const putSchema = z.object({
  kurseinheitId: z.string().uuid().nullable().optional(),
  dozentId: z.string().uuid().nullable().optional(),
  thema: z.string().max(200).nullable().optional(),
});

/** Ordnet einem Termin ein Fach (Kurseinheit), einen Dozenten und/oder ein Thema zu. */
export async function PUT(request: NextRequest, kontext: { params: Promise<{ id: string }> }) {
  const benutzer = await ladeMitRecht(RECHT.SEMESTER_VERWALTEN);
  if (!benutzer) return keineBerechtigung();

  const { id } = await kontext.params;
  const geprueft = putSchema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);

  const daten: { kurseinheitId?: string | null; dozentId?: string | null; thema?: string | null } = {};
  if (geprueft.data.kurseinheitId !== undefined) {
    // Nicht-null muss existieren, sonst gäbe der Fremdschlüssel einen 500.
    if (geprueft.data.kurseinheitId !== null) {
      const kurseinheit = await prisma.kurseinheit.findUnique({
        where: { id: geprueft.data.kurseinheitId },
        select: { id: true },
      });
      if (!kurseinheit) return fehler("Diese Kurseinheit gibt es nicht.", 400);
    }
    daten.kurseinheitId = geprueft.data.kurseinheitId;
  }
  if (geprueft.data.dozentId !== undefined) {
    // Nur eine Person mit der Rolle Dozent lässt sich zuordnen — sonst wäre die
    // Honorar-Übersicht eine Zuordnung an beliebige Konten.
    if (geprueft.data.dozentId !== null && !(await istDozent(geprueft.data.dozentId))) {
      return fehler("Diese Person ist kein Dozent.", 400);
    }
    daten.dozentId = geprueft.data.dozentId;
  }
  if (geprueft.data.thema !== undefined) {
    daten.thema = geprueft.data.thema?.trim() || null;
  }

  // updateMany statt update: kein P2025-500, wenn den Termin gerade jemand gelöscht hat.
  const geaendert = await prisma.unterrichtstermin.updateMany({ where: { id }, data: daten });
  if (geaendert.count === 0) return fehler("Diesen Termin gibt es nicht.", 404);

  await protokolliere({
    aktion: "STUNDENPLAN_TERMIN_GEAENDERT",
    objektTyp: "Unterrichtstermin",
    objektId: id,
    akteurId: benutzer.id,
    nachher: daten,
    headers: request.headers,
  });

  return erfolg({ ok: true });
}

/** Löscht einen Termin (samt seiner Anwesenheiten über Cascade). */
export async function DELETE(request: NextRequest, kontext: { params: Promise<{ id: string }> }) {
  const benutzer = await ladeMitRecht(RECHT.SEMESTER_VERWALTEN);
  if (!benutzer) return keineBerechtigung();

  const { id } = await kontext.params;
  const geloescht = await prisma.unterrichtstermin.deleteMany({ where: { id } });
  if (geloescht.count === 0) return fehler("Diesen Termin gibt es nicht.", 404);

  await protokolliere({
    aktion: "STUNDENPLAN_TERMIN_GELOESCHT",
    objektTyp: "Unterrichtstermin",
    objektId: id,
    akteurId: benutzer.id,
    headers: request.headers,
  });

  return erfolg({ ok: true });
}
