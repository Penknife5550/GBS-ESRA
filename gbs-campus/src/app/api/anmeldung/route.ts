import { NextRequest, after } from "next/server";
import { z } from "zod";
import { drosselSchluesselFuerIp, ermittleRequestKontext } from "@/lib/request-kontext";
import { zahl } from "@/lib/einstellungen";
import { ladeEntwurf, nimmAnmeldungEntgegen, speichereEntwurf } from "@/lib/anmeldung";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler } from "@/lib/api";
import { drosselUeberschritten } from "@/lib/magic-link";
import {
  SCHLUESSEL_EINGANG,
  entwurfGrenzen,
  gesamtgrenzeErreicht,
  gesamtgrenzeMeldung,
  pruefeFormularStempel,
  stempelGeheimnis,
  stempelMeldung,
} from "@/lib/anmelde-schutz";
import {
  gibKontingentFrei,
  ladeGesamtgrenzen,
  reserviereKontingent,
  warneBeiGesamtgrenze,
  zaehleNeueAnmeldezeilen,
} from "@/lib/anmelde-schutz-io";

/**
 * Öffentliche Endpunkte des Anmeldeformulars — die einzigen ohne Anmeldung.
 * Entsprechend gedrosselt und mit knapper Fehlerausgabe. Die Schutzschichten
 * gegen Massenanmeldungen (Anschlussdrossel, Fangfeld, Mindestdauer,
 * Gesamtgrenze) beschreibt `lib/anmelde-schutz.ts`.
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
  /**
   * Fangfeld für Formular-Roboter: im Formular für Menschen unsichtbar und
   * nicht erreichbar. Wer es füllt, ist kein Mensch — siehe POST. Bewusst ohne
   * sprechenden Namen: „website“ füllten Passwortmanager mit Identitätsprofilen
   * gern selbst aus, und eine echte Anmeldung verschwände still.
   */
  hp_feld: z.string().max(500).optional(),
  /** Wann der Server das Formular ausgeliefert hat, signiert — siehe `lib/anmelde-schutz.ts`. */
  formularStempel: z.string().max(200).optional(),
});

/**
 * Einen Zwischenstand laden. Der Token kommt im Rumpf und nicht in der Adresse:
 * Das Formular liest ihn aus dem URL-Fragment (#fortsetzen=…), das der Browser
 * nie an den Server schickt. Als ?fortsetzen=… stand er vorher in jedem
 * Zugriffslog des Reverse Proxy — 14 Tage gültig, mit Kontaktdaten und
 * Freitexten dahinter.
 */
const ladenSchema = z.object({
  aktion: z.literal("laden"),
  fortsetzenToken: z.string().uuid(),
});

const schema = z.discriminatedUnion("aktion", [speichernSchema, absendenSchema, ladenSchema]);

/**
 * Zählt eine Anfrage im Drosselfenster und meldet, ob die Grenze erreicht ist.
 * Über die gemeinsame `drosselUeberschritten` (atomar je Schlüssel, IPv6 auf /64
 * gekürzt) — vorher stand hier eine eigene Kopie mit Zählen und Schreiben ohne
 * Sperre.
 */
async function gedrosselt(ipAdresse: string | null, aktion: string): Promise<boolean> {
  // Ohne erkennbare Herkunft wird abgewiesen, nicht durchgelassen. Vorher war
  // das fail-open: Wer den Header unterdrueckte, umging die Drossel vollstaendig.
  if (!ipAdresse) return true;

  const [hoechstzahl, fensterMinuten] = await Promise.all([
    zahl("ANMELDUNG_MAX_PRO_IP"),
    zahl("AUTH_DROSSEL_FENSTER_MINUTEN"),
  ]);

  // Getrennte Kontingente: Wer zehnmal zwischenspeichert, muss trotzdem absenden koennen.
  return drosselUeberschritten(`ANMELDUNG_${aktion}_IP:${drosselSchluesselFuerIp(ipAdresse)}`, hoechstzahl, fensterMinuten);
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
    return fehler("Zu viele Anfragen von diesem Anschluss. Bitte versuchen Sie es später erneut.", 429);
  }

  if (geprueft.data.aktion === "laden") {
    const entwurf = await ladeEntwurf(geprueft.data.fortsetzenToken);
    // Unbekannt, abgelaufen oder schon abgeschickt — für den Aufrufer dasselbe.
    if (!entwurf) return fehler("Dieser Link zum Fortsetzen ist abgelaufen oder ungültig.", 404);
    return erfolg({ antworten: entwurf.antworten ?? {} });
  }

  if (geprueft.data.aktion === "speichern") {
    // Gesamtgrenze für neue Anmeldezeilen (das Dreifache der Einreichungen).
    // Geprüft wird jede Anfrage, nicht nur die ohne Token — ein erfundener
    // Token legt ebenfalls eine neue Zeile an.
    const fenster = gesamtgrenzeErreicht(await zaehleNeueAnmeldezeilen(), entwurfGrenzen(await ladeGesamtgrenzen()));
    if (fenster) {
      await protokolliere({
        aktion: "ANMELDUNG_GESAMT_GEDROSSELT",
        objektTyp: "Anmeldung",
        quelle: "SYSTEM",
        nachher: { art: "ZWISCHENSTAND", fenster },
        headers: request.headers,
      });
      return fehler(gesamtgrenzeMeldung(fenster, "ZWISCHENSTAND"), 429);
    }

    const ergebnis = await speichereEntwurf(
      geprueft.data.versionId,
      geprueft.data.antworten,
      geprueft.data.fortsetzenToken,
    );
    if ("fehler" in ergebnis) return fehler(ergebnis.fehler, 409);
    return erfolg({ fortsetzenToken: ergebnis.token, laeuftAb: ergebnis.laeuftAb.toISOString() });
  }

  // Honeypot: Das Fangfeld füllt nur ein Roboter. Er bekommt dieselbe Antwort
  // wie ein Mensch (sonst lernt er dazu), aber es entsteht keine Akte und keine
  // Mail — jede echte Einreichung legt eine nicht löschbare Akte an und schreibt
  // an die eingegebene, womöglich fremde Adresse. Im Protokoll nur die Tatsache,
  // keine Werte.
  if (geprueft.data.hp_feld?.trim()) {
    await protokolliere({
      aktion: "ANMELDUNG_VERWORFEN_FANGFELD",
      objektTyp: "Anmeldung",
      quelle: "SYSTEM",
      headers: request.headers,
    });
    return erfolg({ eingereicht: true });
  }

  // Mindestdauer: Ein Roboter sendet im selben Moment ab, in dem er die Seite
  // lädt. Anders als das Fangfeld mit sichtbarer Meldung — ein Mensch, der
  // hier landet, soll es merken und kann einfach erneut absenden.
  const mindestSekunden = await zahl("ANMELDUNG_MINDESTDAUER_SEKUNDEN");
  if (mindestSekunden > 0) {
    const stempel = pruefeFormularStempel(
      geprueft.data.formularStempel,
      Date.now(),
      mindestSekunden,
      stempelGeheimnis(),
    );
    if (!stempel.ok) {
      await protokolliere({
        aktion: "ANMELDUNG_ABGEWIESEN_STEMPEL",
        objektTyp: "Anmeldung",
        quelle: "SYSTEM",
        nachher: { grund: stempel.grund },
        headers: request.headers,
      });
      return fehler(stempelMeldung(stempel.grund), 400);
    }
  }

  // Gesamtgrenze über alle Anschlüsse: einen Platz reservieren, bevor die
  // Anmeldung angelegt wird. Scheitert sie fachlich, wird er wieder frei.
  const grenzen = await ladeGesamtgrenzen();
  const reservierung = await reserviereKontingent(SCHLUESSEL_EINGANG, grenzen);
  if ("fenster" in reservierung) {
    await protokolliere({
      aktion: "ANMELDUNG_GESAMT_GEDROSSELT",
      objektTyp: "Anmeldung",
      quelle: "SYSTEM",
      nachher: { art: "ANMELDUNG", fenster: reservierung.fenster },
      headers: request.headers,
    });
    // Nach der Antwort: Der Absender soll nicht auf den Mailserver warten.
    after(() => warneBeiGesamtgrenze(reservierung.fenster, grenzen));
    return fehler(gesamtgrenzeMeldung(reservierung.fenster, "ABSENDEN"), 429);
  }

  let angenommen = false;
  try {
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

    angenommen = true;
    return erfolg({ eingereicht: true });
  } finally {
    // Gezählt wird nur, was angenommen wurde: Ein vergessenes Pflichtfeld oder
    // ein Fehler auf unserer Seite verbraucht kein Kontingent.
    if (!angenommen) await gibKontingentFrei(reservierung.platzId);
  }
}
