import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler, keineBerechtigung } from "@/lib/api";
import { RECHT, ROLLE, STATUS } from "@/lib/constants";
import { entziehtAdmin, rollenDiff, sindRollenBekannt } from "@/lib/benutzerverwaltung";

const schema = z.object({
  rollen: z.array(z.string().min(1).max(40)).max(20),
});

/**
 * Setzt die Rollen einer Person auf die übergebene Menge (Konten- und
 * Rollenverwaltung, Recht BENUTZER_VERWALTEN). Bewusst die vollständige Menge
 * statt einzelner Hinzufügen/Entfernen-Aufrufe: So kann die Oberfläche einfach
 * die angehakten Rollen schicken, und der Server rechnet den Unterschied aus.
 */
export async function PUT(request: NextRequest, kontext: { params: Promise<{ id: string }> }) {
  const benutzer = await ladeMitRecht(RECHT.BENUTZER_VERWALTEN);
  if (!benutzer) return keineBerechtigung();

  const { id } = await kontext.params;
  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);
  const gewuenscht = [...new Set(geprueft.data.rollen)];

  const person = await prisma.person.findUnique({
    where: { id },
    select: { id: true, rollen: { select: { rolleCode: true } }, status: { select: { code: true } } },
  });
  if (!person) return fehler("Diese Person gibt es nicht.", 404);
  if (person.status.code === STATUS.ANONYMISIERT) {
    return fehler("Für eine anonymisierte Person lassen sich keine Rollen ändern.", 409);
  }

  const bekannt = (await prisma.rolle.findMany({ select: { code: true } })).map((r) => r.code);
  if (!sindRollenBekannt(gewuenscht, bekannt)) return fehler("Diese Rolle gibt es nicht.", 400);

  const vorhanden = person.rollen.map((r) => r.rolleCode);
  const diff = rollenDiff(gewuenscht, vorhanden);
  if (diff.hinzu.length === 0 && diff.weg.length === 0) {
    return erfolg({ geaendert: false, rollen: vorhanden });
  }

  // Den letzten Administrator schützen: Ohne ihn kommt niemand mehr an Konten
  // und Rollen. Wird ADMIN entzogen und trägt sonst niemand mehr diese Rolle,
  // wird abgelehnt — auch wenn ein Administrator es bei sich selbst versucht.
  if (entziehtAdmin(diff)) {
    const andereAdmins = await prisma.personRolle.count({
      where: { rolleCode: ROLLE.ADMIN, personId: { not: person.id } },
    });
    if (andereAdmins === 0) {
      return fehler("Das ist der letzte Administrator — diese Rolle lässt sich nicht entziehen.", 409);
    }
  }

  await prisma.$transaction([
    ...(diff.weg.length > 0
      ? [prisma.personRolle.deleteMany({ where: { personId: person.id, rolleCode: { in: diff.weg } } })]
      : []),
    ...(diff.hinzu.length > 0
      ? [
          prisma.personRolle.createMany({
            data: diff.hinzu.map((rolleCode) => ({ personId: person.id, rolleCode, erteiltVonId: benutzer.id })),
          }),
        ]
      : []),
  ]);

  await protokolliere({
    aktion: "ROLLEN_GEAENDERT",
    objektTyp: "Person",
    objektId: person.id,
    akteurId: benutzer.id,
    vorher: { rollen: vorhanden },
    nachher: { rollen: gewuenscht },
    headers: request.headers,
  });

  return erfolg({ geaendert: true, rollen: gewuenscht });
}
