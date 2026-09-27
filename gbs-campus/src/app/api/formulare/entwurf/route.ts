import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { pruefeZugriff } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { protokolliere } from "@/lib/audit";
import { holeOderErzeugeEntwurf } from "@/lib/formular";
import { erfolg, fehler } from "@/lib/api";

const schema = z.object({ formularCode: z.string().min(1).max(50) });

/**
 * Liefert die bearbeitbare Fassung eines Formulars. Gibt es keinen offenen
 * Entwurf, entsteht eine Kopie der zuletzt veröffentlichten Fassung — so wird
 * nie versehentlich an einer Fassung gearbeitet, die bereits jemand ausfüllt.
 */
export async function POST(request: NextRequest) {
  const benutzer = await pruefeZugriff(RECHT.FORMULAR_BEARBEITEN);
  if (benutzer instanceof Response) return benutzer;

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);

  const formular = await prisma.formular.findUnique({ where: { code: geprueft.data.formularCode } });
  if (!formular) return fehler("Dieses Formular gibt es nicht.", 404);

  const versionId = await holeOderErzeugeEntwurf(formular.id);

  await protokolliere({
    aktion: "FORMULAR_ENTWURF_GEOEFFNET",
    objektTyp: "FormularVersion",
    objektId: versionId,
    akteurId: benutzer.id,
    headers: request.headers,
  });

  return erfolg({ versionId });
}
