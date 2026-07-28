import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ermittleRequestKontext } from "@/lib/request-kontext";
import { zahl } from "@/lib/einstellungen";
import { nimmAnmeldungEntgegen, speichereEntwurf } from "@/lib/anmeldung";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler } from "@/lib/api";

/**
 * Öffentliche Endpunkte des Anmeldeformulars — die einzigen ohne Anmeldung.
 * Entsprechend gedrosselt und mit knapper Fehlerausgabe.
 */

/**
 * Grenze für den gesamten Anfragerumpf. `request.json()` liest alles in den
 * Speicher, bevor die Drossel überhaupt gezählt hat. 64 KB reichen für ein
 * langes Anmeldeformular samt Freitextfeldern und sind zu wenig, um damit den
 * Prozess zu beschäftigen.
 *
 * Fehlt die Kopfzeile (chunked), greift die Grenze nicht — dann fängt das
 * Schema den Rest ab.
 */
const MAX_RUMPF_BYTES = 64 * 1024;

/** So viele Felder hat kein Anmeldeformular. Die Grenze fängt aufgeblähte Rümpfe ab. */
const MAX_ANTWORT_FELDER = 200;

// Unbekannte Schlüssel verwirft `bereinigeEntwurf` bzw. `pruefeAntworten`
// ohnehin; hier geht es allein um die Größe dessen, was vorher im Speicher
// landet.
const antwortenSchema = z
  .record(z.string(), z.unknown())
  .refine((antworten) => Object.keys(antworten).length <= MAX_ANTWORT_FELDER, {
    message: `Höchstens ${MAX_ANTWORT_FELDER} Felder.`,
  });

const speichernSchema = z.object({
  aktion: z.literal("speichern"),
  versionId: z.string().uuid(),
  antworten: antwortenSchema,
  fortsetzenToken: z.string().uuid().optional(),
});

const absendenSchema = z.object({
  aktion: z.literal("absenden"),
  versionId: z.string().uuid(),
  antworten: antwortenSchema,
  einwilligungen: z.array(z.string().max(60)).max(20),
  fortsetzenToken: z.string().uuid().optional(),
});

const schema = z.discriminatedUnion("aktion", [speichernSchema, absendenSchema]);

/** Zählt eine Anfrage im Drosselfenster und meldet, ob die Grenze erreicht ist. */
async function gedrosselt(ipAdresse: string | null, aktion: string): Promise<boolean> {
  // Ohne erkennbare Herkunft wird abgewiesen, nicht durchgelassen. Vorher war
  // das fail-open: Wer den Header unterdrueckte, umging die Drossel vollstaendig.
  if (!ipAdresse) return true;

  const [hoechstzahl, fensterMinuten] = await Promise.all([
    zahl("ANMELDUNG_MAX_PRO_IP"),
    zahl("AUTH_DROSSEL_FENSTER_MINUTEN"),
  ]);

  // Getrennte Kontingente: Wer zehnmal zwischenspeichert, muss trotzdem absenden koennen.
  const schluessel = `ANMELDUNG_${aktion}_IP:${ipAdresse}`;
  const seit = new Date(Date.now() - fensterMinuten * 60 * 1000);
  const bisher = await prisma.rateLimit.count({ where: { schluessel, zeitpunkt: { gte: seit } } });
  if (bisher >= hoechstzahl) return true;

  await prisma.rateLimit.create({ data: { schluessel } });
  return false;
}

export async function POST(request: NextRequest) {
  const { ipAdresse, userAgent } = ermittleRequestKontext(request.headers);

  const laenge = Number(request.headers.get("content-length"));
  if (Number.isFinite(laenge) && laenge > MAX_RUMPF_BYTES) {
    return fehler("Die Anfrage ist zu groß.", 413);
  }

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) {
    return fehler("Ungültige Anfrage.", 400);
  }

  if (await gedrosselt(ipAdresse, geprueft.data.aktion)) {
    await protokolliere({
      aktion: "ANMELDUNG_GEDROSSELT",
      objektTyp: "Anmeldung",
      quelle: "SYSTEM",
      headers: request.headers,
    });
    return fehler("Zu viele Anfragen von diesem Anschluss. Bitte später erneut versuchen.", 429);
  }

  if (geprueft.data.aktion === "speichern") {
    const ergebnis = await speichereEntwurf(
      geprueft.data.versionId,
      geprueft.data.antworten,
      geprueft.data.fortsetzenToken,
    );
    if ("fehler" in ergebnis) return fehler(ergebnis.fehler, 409);
    return erfolg({ fortsetzenToken: ergebnis.token, laeuftAb: ergebnis.laeuftAb.toISOString() });
  }

  const ergebnis = await nimmAnmeldungEntgegen({
    versionId: geprueft.data.versionId,
    antworten: geprueft.data.antworten,
    einwilligungen: geprueft.data.einwilligungen,
    fortsetzenToken: geprueft.data.fortsetzenToken,
    ipAdresse,
    userAgent,
  });

  if (!ergebnis.ok) {
    return fehler(
      ergebnis.meldung,
      ergebnis.status,
      ergebnis.felder?.map((f) => ({ feld: f.feldCode, meldung: f.meldung })),
    );
  }

  return erfolg({ eingereicht: true });
}
