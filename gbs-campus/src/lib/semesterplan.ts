/**
 * GBS Campus — Semester als Liste, die Einladung als Zeitleiste (DB-frei)
 *
 * Die Seite „Semester“ (Oberflächenplan 09/2026) zeigt links die Semester —
 * das laufende und das nächste markiert — und rechts das gewählte. Darunter
 * steht der Weg ins nächste Semester als Zeitleiste mit den echten Daten:
 * Einladung, die drei Erinnerungen (Tage vor Beginn aus den Einstellungen) und
 * der Beginn. Hier steht, wie Liste und Zeitleiste entstehen; die Stichtage
 * rechnen wie `faelligeErinnerungsstufe` Tag gegen Tag in UTC.
 */

import { TAG_MS } from "@/lib/constants";
import { alsHeutigerTag } from "@/lib/semester";
import { tagMonat } from "@/lib/abendplan";

type SemesterZeitraum = { id: string; start: Date; ende: Date; istAktuell: boolean };

export type SemesterOrdnung<T> = {
  laufend: T | null;
  /** Das erste Semester nach dem laufenden, das noch nicht vorbei ist. */
  naechstes: T | null;
  /** Laufendes und kommende Semester, nach Beginn aufsteigend. */
  aktuelle: T[];
  /** Vergangene Semester, das jüngste zuerst. */
  fruehere: T[];
};

/**
 * Ordnet die Semester für Liste und Auswahl: oben das laufende und die kommenden
 * (aufsteigend, so wie man plant), darunter die vergangenen (das jüngste zuerst).
 * „Vorbei“ ist ein Semester ab dem Tag nach seinem Ende.
 */
export function ordneSemester<T extends SemesterZeitraum>(semester: readonly T[], jetzt: Date): SemesterOrdnung<T> {
  const heute = alsHeutigerTag(jetzt).getTime();
  const laufend = semester.find((s) => s.istAktuell) ?? null;
  const nachStart = (a: T, b: T) => a.start.getTime() - b.start.getTime();
  const kommende = semester.filter((s) => s !== laufend && s.ende.getTime() >= heute).sort(nachStart);
  const fruehere = semester
    .filter((s) => s !== laufend && s.ende.getTime() < heute)
    .sort((a, b) => nachStart(b, a));
  const naechstes = kommende.find((s) => !laufend || s.start.getTime() > laufend.start.getTime()) ?? null;
  return { laufend, naechstes, aktuelle: laufend ? [laufend, ...kommende] : kommende, fruehere };
}

/** Kalendertag (UTC-Mitternacht) als „16.02.“. */
export function kalenderTagMonat(tag: Date): string {
  return `${String(tag.getUTCDate()).padStart(2, "0")}.${String(tag.getUTCMonth() + 1).padStart(2, "0")}.`;
}

/** Kalendertag als „15.09. – 01.12.2026“ (das Jahr nur am Ende, wie in der Semesterliste). */
export function kurzZeitraum(start: Date, ende: Date): string {
  return `${kalenderTagMonat(start)} – ${kalenderTagMonat(ende)}${ende.getUTCFullYear()}`;
}

const MONAT = new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", month: "long" });

export type ZeitleistenPunkt = {
  /** Oben, fett: „im Januar“, „jetzt“, „02.02.“ … */
  wann: string;
  /** Darunter: „Einladung“, „1. Erinnerung“ … */
  was: string;
  /** erledigt (gefüllt), der nächste Schritt (gefüllt, betont), später (leer) oder entfällt. */
  stand: "erledigt" | "naechster" | "spaeter" | "entfaellt";
};

/**
 * Die Zeitleiste der Einladung in ein Semester: Einladung, drei Erinnerungen
 * (`offsetsTage` vor Beginn, etwa [14, 7, 3]) und der Beginn.
 *
 * Die Einladung zeigt ihr Datum, sobald sie verschickt ist. Vorher steht dort der
 * Monat, in dem sie sinnvoll ist — zwei Wochen vor der ersten Erinnerung, damit
 * alle Zeit zum Antworten haben —, und „jetzt“, sobald dieser Zeitpunkt erreicht
 * ist. Eine Erinnerung ist erledigt, wenn eingeladen wurde und ihr Stichtag heute
 * oder früher liegt; ohne Einladung entfällt ein verstrichener Stichtag (die
 * spätere Einladung erledigt ihn mit, `erledigteStufenBeiEinladung`).
 */
export function einladungsZeitleiste(e: {
  start: Date;
  offsetsTage: [number, number, number];
  eingeladenAm: Date | null;
  jetzt: Date;
}): ZeitleistenPunkt[] {
  const heute = alsHeutigerTag(e.jetzt).getTime();
  const startTag = Date.UTC(e.start.getUTCFullYear(), e.start.getUTCMonth(), e.start.getUTCDate());
  const stichtag = (tage: number) => new Date(startTag - tage * TAG_MS);
  const eingeladen = e.eingeladenAm !== null;
  const empfohlen = stichtag(e.offsetsTage[0] + 14);

  const punkte: ZeitleistenPunkt[] = [
    {
      wann: e.eingeladenAm ? tagMonat(e.eingeladenAm) : heute >= empfohlen.getTime() ? "jetzt" : `im ${MONAT.format(empfohlen)}`,
      was: "Einladung",
      stand: eingeladen ? "erledigt" : "spaeter",
    },
    ...e.offsetsTage.map((tage, i): ZeitleistenPunkt => {
      const tag = stichtag(tage);
      const verstrichen = heute >= tag.getTime();
      return {
        wann: kalenderTagMonat(tag),
        was: i === e.offsetsTage.length - 1 ? "letzte Erinnerung" : `${i + 1}. Erinnerung`,
        stand: verstrichen ? (eingeladen ? "erledigt" : "entfaellt") : "spaeter",
      };
    }),
    {
      wann: kalenderTagMonat(new Date(startTag)),
      was: "Beginn",
      stand: heute >= startTag ? "erledigt" : "spaeter",
    },
  ];
  const naechster = punkte.find((p) => p.stand === "spaeter");
  if (naechster) naechster.stand = "naechster";
  return punkte;
}
