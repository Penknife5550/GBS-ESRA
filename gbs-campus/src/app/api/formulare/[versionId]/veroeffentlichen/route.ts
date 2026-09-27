import { NextRequest } from "next/server";
import { FormularVersionStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { pruefeZugriff } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { protokolliere } from "@/lib/audit";
import { alsFeldEingaben, pruefeFelddefinition, pruefeVeroeffentlichung } from "@/lib/formular";
import { erfolg, fehler } from "@/lib/api";

/**
 * Veröffentlicht einen Entwurf. Ab diesem Moment ist die Fassung unveränderlich
 * und die bisher veröffentlichte wird archiviert — nicht gelöscht, denn an ihr
 * hängen die bereits eingegangenen Anmeldungen.
 */
export async function POST(request: NextRequest, kontext: { params: Promise<{ versionId: string }> }) {
  const benutzer = await pruefeZugriff(RECHT.FORMULAR_VEROEFFENTLICHEN);
  if (benutzer instanceof Response) return benutzer;

  const { versionId } = await kontext.params;

  const version = await prisma.formularVersion.findUnique({
    where: { id: versionId },
    include: {
      abschnitte: { include: { felder: { orderBy: { reihenfolge: "asc" } } }, orderBy: { reihenfolge: "asc" } },
    },
  });
  if (!version) return fehler("Diese Formularfassung gibt es nicht.", 404);

  if (version.status !== FormularVersionStatus.ENTWURF) {
    return fehler("Nur ein Entwurf kann veröffentlicht werden.", 409);
  }

  // Auch die Felddefinition selbst wird hier noch einmal geprueft, nicht nur
  // beim Speichern: Ein Entwurf entsteht auch als Kopie einer frueheren Fassung
  // (holeOderErzeugeEntwurf) und kann ohne Speichern veroeffentlicht werden —
  // eine vor einer neuen Regel (etwa Art. 9 fuer die Gemeinde) entstandene
  // Fassung ginge sonst ungeprueft wieder online.
  const felder = alsFeldEingaben(version.abschnitte);
  const maengel = [
    ...pruefeFelddefinition(felder).map((m) => ({ feld: m.feldCode, meldung: m.meldung })),
    ...pruefeVeroeffentlichung(felder).map((m) => ({ meldung: m })),
  ];
  if (maengel.length > 0) {
    return fehler("Das Formular ist noch nicht veröffentlichungsreif.", 400, maengel);
  }

  // Auch hier die Bedingung in die schreibende Anweisung: Zwei gleichzeitige
  // Klicks duerfen nicht zweimal archivieren und veroeffentlichen.
  const gewonnen = await prisma.$transaction(async (tx) => {
    const beansprucht = await tx.formularVersion.updateMany({
      where: { id: versionId, status: FormularVersionStatus.ENTWURF },
      data: {
        status: FormularVersionStatus.VEROEFFENTLICHT,
        veroeffentlichtAm: new Date(),
        veroeffentlichtVonId: benutzer.id,
      },
    });
    if (beansprucht.count !== 1) return false;

    // Die bisher gültige Fassung wandert ins Archiv. Sie bleibt lesbar, weil
    // eingegangene Anmeldungen auf sie verweisen.
    await tx.formularVersion.updateMany({
      where: {
        formularId: version.formularId,
        status: FormularVersionStatus.VEROEFFENTLICHT,
        id: { not: versionId },
      },
      data: { status: FormularVersionStatus.ARCHIVIERT },
    });
    return true;
  });

  if (!gewonnen) {
    return fehler("Diese Fassung wurde inzwischen bereits veröffentlicht.", 409);
  }

  await protokolliere({
    aktion: "FORMULAR_VEROEFFENTLICHT",
    objektTyp: "FormularVersion",
    objektId: versionId,
    akteurId: benutzer.id,
    nachher: { version: version.version },
    headers: request.headers,
  });

  return erfolg({ veroeffentlicht: true, version: version.version });
}
