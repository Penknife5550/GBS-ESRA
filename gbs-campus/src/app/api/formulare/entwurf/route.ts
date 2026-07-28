import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { holeOderErzeugeEntwurf } from "@/lib/formular";

const schema = z.object({ formularCode: z.string().min(1).max(50) });

/**
 * Liefert die bearbeitbare Fassung eines Formulars. Gibt es keinen offenen
 * Entwurf, entsteht eine Kopie der zuletzt veröffentlichten Fassung — so wird
 * nie versehentlich an einer Fassung gearbeitet, die bereits jemand ausfüllt.
 */
export async function POST(request: NextRequest) {
  const benutzer = await ladeMitRecht("FORMULAR_BEARBEITEN");
  if (!benutzer) {
    return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
  }

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  const formular = await prisma.formular.findUnique({ where: { code: geprueft.data.formularCode } });
  if (!formular) return NextResponse.json({ error: "Dieses Formular gibt es nicht." }, { status: 404 });

  const versionId = await holeOderErzeugeEntwurf(formular.id);

  await protokolliere({
    aktion: "FORMULAR_ENTWURF_GEOEFFNET",
    objektTyp: "FormularVersion",
    objektId: versionId,
    akteurId: benutzer.id,
    headers: request.headers,
  });

  return NextResponse.json({ data: { versionId } });
}
