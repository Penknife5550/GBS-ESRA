import { NextRequest } from "next/server";
import { z } from "zod";
import { FeldTyp, FormularVersionStatus, PersonFeld, Prisma, Teilnahmeform } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { alsFeldEingaben, pruefeFelddefinition } from "@/lib/formular";
import { erfolg, fehler, keineBerechtigung } from "@/lib/api";

const feldSchema = z.object({
  code: z.string().min(2).max(50),
  typ: z.nativeEnum(FeldTyp),
  label: z.string().min(1).max(300),
  hilfetext: z.string().max(2000).nullable().optional(),
  platzhalter: z.string().max(200).nullable().optional(),
  pflicht: z.boolean(),
  optionen: z.array(z.string().min(1).max(200)).max(50).nullable().optional(),
  personFeld: z.nativeEnum(PersonFeld),
  istArt9: z.boolean(),
  /** Nur bei TEILNAHMEFORM: welche Antwortmöglichkeit Schüler bzw. Hörer bedeutet. */
  teilnahmeformZuordnung: z.record(z.string(), z.nativeEnum(Teilnahmeform)).nullable().optional(),
});

const abschnittSchema = z.object({
  titel: z.string().min(1).max(200),
  beschreibung: z.string().max(2000).nullable().optional(),
  felder: z.array(feldSchema).max(100),
});

const speichernSchema = z.object({
  einleitung: z.string().max(4000).nullable().optional(),
  abschnitte: z.array(abschnittSchema).min(1).max(30),
});

/**
 * Speichert einen Entwurf. Eine veröffentlichte Fassung wird niemals überschrieben —
 * das ist die Regel, die die Versionierung überhaupt erst etwas wert macht.
 */
export async function PUT(request: NextRequest, kontext: { params: Promise<{ versionId: string }> }) {
  const benutzer = await ladeMitRecht("FORMULAR_BEARBEITEN");
  if (!benutzer) {
    return keineBerechtigung();
  }

  const { versionId } = await kontext.params;

  const version = await prisma.formularVersion.findUnique({
    where: { id: versionId },
    include: { abschnitte: { include: { felder: true } } },
  });
  if (!version) {
    return fehler("Diese Formularfassung gibt es nicht.", 404);
  }
  if (version.status !== FormularVersionStatus.ENTWURF) {
    return fehler("Diese Fassung ist veröffentlicht und kann nicht mehr geändert werden. Bitte einen neuen Entwurf anlegen.", 409);
  }

  const rumpf = await request.json().catch(() => null);
  const geprueft = speichernSchema.safeParse(rumpf);
  if (!geprueft.success) {
    return fehler("Die Formulardefinition ist unvollständig oder fehlerhaft.", 400);
  }

  const felder = geprueft.data.abschnitte.flatMap((abschnitt, abschnittIndex) =>
    abschnitt.felder.map((feld, feldIndex) => ({
      ...feld,
      hilfetext: feld.hilfetext ?? null,
      platzhalter: feld.platzhalter ?? null,
      optionen: feld.optionen ?? null,
      reihenfolge: abschnittIndex * 1000 + feldIndex,
      teilnahmeformZuordnung: feld.teilnahmeformZuordnung ?? null,
    })),
  );

  const maengel = pruefeFelddefinition(felder);
  if (maengel.length > 0) {
    return fehler(
      "Das Formular ist noch nicht stimmig.",
      400,
      maengel.map((m) => ({ feld: m.feldCode, meldung: m.meldung })),
    );
  }

  const vorher = { abschnitte: version.abschnitte.length, felder: version.abschnitte.reduce((s, a) => s + a.felder.length, 0) };

  try {
    await prisma.$transaction(async (tx) => {
    // Vollständig ersetzen statt abgleichen: Der Entwurf ist noch von niemandem
    // ausgefüllt worden, es hängen keine Antworten daran.
    await tx.formularAbschnitt.deleteMany({ where: { versionId } });

    for (const [abschnittIndex, abschnitt] of geprueft.data.abschnitte.entries()) {
      await tx.formularAbschnitt.create({
        data: {
          versionId,
          titel: abschnitt.titel,
          beschreibung: abschnitt.beschreibung ?? null,
          reihenfolge: abschnittIndex,
          felder: {
            create: abschnitt.felder.map((feld, feldIndex) => ({
              code: feld.code,
              typ: feld.typ,
              label: feld.label,
              hilfetext: feld.hilfetext ?? null,
              platzhalter: feld.platzhalter ?? null,
              pflicht: feld.pflicht,
              reihenfolge: feldIndex,
              optionen: feld.optionen ? (feld.optionen as Prisma.InputJsonValue) : Prisma.DbNull,
              personFeld: feld.personFeld,
              istArt9: feld.istArt9,
              validierung: feld.teilnahmeformZuordnung
                ? ({ teilnahmeform: feld.teilnahmeformZuordnung } as Prisma.InputJsonValue)
                : Prisma.DbNull,
            })),
          },
        },
      });
    }

    // Statuspruefung in die schreibende Anweisung: Wird die Fassung zwischen
    // Pruefung und Schreiben veroeffentlicht (zweiter Tab), wuerde sonst eine
    // bereits veroeffentlichte Fassung ueberschrieben — genau die Regel, auf
    // der die ganze Versionierung beruht.
    const gewonnen = await tx.formularVersion.updateMany({
      where: { id: versionId, status: FormularVersionStatus.ENTWURF },
      data: { einleitung: geprueft.data.einleitung ?? null },
    });
    if (gewonnen.count !== 1) {
      throw new Error("VERSION_NICHT_MEHR_ENTWURF");
    }
    });
  } catch (f) {
    if (f instanceof Error && f.message === "VERSION_NICHT_MEHR_ENTWURF") {
      return fehler("Diese Fassung wurde inzwischen veröffentlicht und kann nicht mehr geändert werden.", 409);
    }
    throw f;
  }

  await protokolliere({
    aktion: "FORMULAR_ENTWURF_GESPEICHERT",
    objektTyp: "FormularVersion",
    objektId: versionId,
    akteurId: benutzer.id,
    vorher,
    nachher: { abschnitte: geprueft.data.abschnitte.length, felder: felder.length },
    headers: request.headers,
  });

  return erfolg({ gespeichert: true, felder: felder.length });
}

export async function GET(_request: NextRequest, kontext: { params: Promise<{ versionId: string }> }) {
  const benutzer = await ladeMitRecht("FORMULAR_BEARBEITEN");
  if (!benutzer) {
    return keineBerechtigung();
  }

  const { versionId } = await kontext.params;
  const version = await prisma.formularVersion.findUnique({
    where: { id: versionId },
    include: {
      abschnitte: { include: { felder: { orderBy: { reihenfolge: "asc" } } }, orderBy: { reihenfolge: "asc" } },
    },
  });
  if (!version) return fehler("Diese Formularfassung gibt es nicht.", 404);

  return erfolg({ version, felder: alsFeldEingaben(version.abschnitte).length });
}
