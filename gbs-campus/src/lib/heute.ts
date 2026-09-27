/**
 * GBS Campus — „Heute“ und die Listen der Verwaltung: DB-freie Regeln und Texte
 *
 * Oberflächenplan 09/2026, Etappe 2: Die Startseite „Heute“ zeigt Aufgaben aus
 * Zahlen, die es schon gibt; die Personenliste sagt zur Anwesenheit „im Soll“,
 * „2× entschuldigt“ oder „3× gefehlt“; die Anmeldungen stehen wie ein Postfach.
 * Hier liegen die Regeln und Wortlaute dafür, ohne Datenbank, damit
 * `scripts/pruefe-heute.ts` sie prüft. Gerechnet wird mit der vorhandenen
 * Quote (Modell A aus `lib/stundenplan.ts`), nicht mit einer zweiten.
 *
 * Wörter: Eine „Einheit“ ist ein Unterrichtstermin, ein „Abend“ ein
 * Kalendertag mit Einheiten (dienstags meist zwei).
 */

import { TAG_MS } from "@/lib/constants";
import { berlinerTag, datum, tagKurz, uhrzeit } from "@/lib/datum";
import { alsHeutigerTag, semesterHatBegonnen } from "@/lib/semester";
import { quoteAusVergangenen, type QuoteModellA } from "@/lib/stundenplan";

// ---------------------------------------------------------------------------
// Anwesenheit: wie oft nicht teilgenommen, und wie knapp es wird
// ---------------------------------------------------------------------------

export type AnwesenheitsTon = "gruen" | "gelb" | "rot";

export type AnwesenheitsStand = {
  quote: QuoteModellA;
  /** Vergangene Einheiten des Semesters, erfasst oder nicht. */
  vergangen: number;
  gefehlt: number;
  entschuldigt: number;
  /** „im Soll“, „erfüllt“, „2× entschuldigt“, „3× gefehlt“ … */
  text: string;
  ton: AnwesenheitsTon;
  /** Rot: höchstens noch eine Einheit Luft, oder die Schwelle ist nicht mehr erreichbar. */
  gefaehrdet: boolean;
};

/** „3× gefehlt“, „2× entschuldigt“ oder bei beidem „3× versäumt“. */
export function versaeumtKurz(gefehlt: number, entschuldigt: number): string {
  if (entschuldigt === 0) return `${gefehlt}× gefehlt`;
  if (gefehlt === 0) return `${entschuldigt}× entschuldigt`;
  return `${gefehlt + entschuldigt}× versäumt`;
}

/**
 * Der Stand einer Teilnahme für die Personenliste und „Heute“.
 *
 * `erfassteStati` sind die erfassten Stati der VERGANGENEN Einheiten (wie in der
 * Akte: eine im Voraus eingetragene künftige Einheit zählt noch nicht), `gesamt`
 * alle Einheiten des Semesters (Nenner von Modell A). Die Farbe folgt dem
 * Puffer `darfNochFehlen`, nicht der bloßen Zahl der Fehltage: Wer einmal
 * entschuldigt fehlte und noch drei Einheiten Luft hat, ist „im Soll“.
 *
 * Ohne vergangene Einheit (vor dem ersten Abend) gibt es nichts zu sagen: null.
 */
export function anwesenheitsStand(
  erfassteStati: readonly string[],
  vergangen: number,
  gesamt: number,
  schwelleProzent: number,
): AnwesenheitsStand | null {
  if (gesamt <= 0 || vergangen <= 0) return null;
  const quote = quoteAusVergangenen([...erfassteStati], gesamt, schwelleProzent);
  const gefehlt = erfassteStati.filter((s) => s === "GEFEHLT").length;
  const entschuldigt = erfassteStati.filter((s) => s === "ENTSCHULDIGT").length;
  const basis = { quote, vergangen, gefehlt, entschuldigt };

  if (quote.zustand === "ERFUELLT") return { ...basis, text: "erfüllt", ton: "gruen", gefaehrdet: false };
  if (quote.versaeumt === 0) return { ...basis, text: "im Soll", ton: "gruen", gefaehrdet: false };

  const gefaehrdet = quote.zustand === "NICHT_ERREICHBAR" || quote.darfNochFehlen <= 1;
  if (gefaehrdet) return { ...basis, text: versaeumtKurz(gefehlt, entschuldigt), ton: "rot", gefaehrdet: true };
  if (quote.darfNochFehlen === 2) {
    return { ...basis, text: versaeumtKurz(gefehlt, entschuldigt), ton: "gelb", gefaehrdet: false };
  }
  return { ...basis, text: "im Soll", ton: "gruen", gefaehrdet: false };
}

const PROZENT = " %";

/** „Viktor Neufeld: 3 von 4 Einheiten gefehlt“ — die Aufgabe auf „Heute“. */
export function gefaehrdungTitel(name: string, stand: AnwesenheitsStand): string {
  const versaeumt = stand.gefehlt + stand.entschuldigt;
  const wort = stand.entschuldigt === 0 ? "gefehlt" : "versäumt";
  return `${name}: ${versaeumt} von ${stand.vergangen} ${stand.vergangen === 1 ? "Einheit" : "Einheiten"} ${wort}`;
}

/** Was daraus folgt, in einem Satz („Darf nur noch einmal fehlen, sonst reicht es nicht für 80 %“). */
export function gefaehrdungText(stand: AnwesenheitsStand): string {
  const schwelle = `${stand.quote.schwelleProzent}${PROZENT}`;
  if (stand.quote.zustand === "NICHT_ERREICHBAR") return `Die ${schwelle} sind in diesem Semester nicht mehr erreichbar`;
  if (stand.quote.darfNochFehlen === 1) return `Darf nur noch einmal fehlen, sonst reicht es nicht für ${schwelle}`;
  return `Darf nicht mehr fehlen, sonst reicht es nicht für ${schwelle}`;
}

// ---------------------------------------------------------------------------
// Zeitangaben wie im Gespräch
// ---------------------------------------------------------------------------

/** Kalendertage (Europe/Berlin) von `von` bis `bis`; 0 am selben Tag. */
export function kalendertageZwischen(von: Date, bis: Date): number {
  const tag = (d: Date) => Date.parse(`${berlinerTag(d)}T00:00:00.000Z`);
  return Math.round((tag(bis) - tag(von)) / TAG_MS);
}

/** „22.09.“ — Tag und Monat in Berliner Zeit, für Listen, in denen das Jahr klar ist. */
export function tagMonat(d: Date): string {
  return datum(d).slice(0, 6);
}

/** „wartet seit heute“, „wartet seit gestern“, „wartet seit 3 Tagen“. */
export function wartetSeit(eingang: Date, jetzt: Date): string {
  const tage = kalendertageZwischen(eingang, jetzt);
  if (tage <= 0) return "wartet seit heute";
  if (tage === 1) return "wartet seit gestern";
  return `wartet seit ${tage} Tagen`;
}

/** Eingang in einer Postfach-Liste: „heute 08:12“, „gestern“, „Do., 24.09.“, aus einem anderen Jahr „24.09.2025“. */
export function eingangKurz(eingang: Date, jetzt: Date): string {
  const tage = kalendertageZwischen(eingang, jetzt);
  if (tage <= 0) return `heute ${uhrzeit(eingang)}`;
  if (tage === 1) return "gestern";
  if (berlinerTag(eingang).slice(0, 4) === berlinerTag(jetzt).slice(0, 4)) return tagKurz(eingang);
  return datum(eingang);
}

/** „Nelli Bergen, Paul Dück, Ruth Hamm“, bei mehr Namen „… und 2 weitere“. */
export function namensListe(namen: readonly string[], hoechstens = 3): string {
  const gezeigt = namen.slice(0, hoechstens).join(", ");
  const rest = namen.length - hoechstens;
  return rest > 0 ? `${gezeigt} und ${rest} weitere` : gezeigt;
}

/** „1 neue Anmeldung“ / „3 neue Anmeldungen“. */
export function anzahl(n: number, einzahl: string, mehrzahl: string): string {
  return `${n} ${n === 1 ? einzahl : mehrzahl}`;
}

/**
 * Teilt eine Aufgabenart für „Heute“: bis `hoechstens + 1` Einträge stehen
 * einzeln (eine Sammelzeile für genau einen wäre sinnlos), sonst die ersten
 * `hoechstens` einzeln und der Rest in einer Sammelzeile.
 */
export function aufteilen<T>(liste: readonly T[], hoechstens: number): { einzeln: T[]; rest: T[] } {
  if (liste.length <= hoechstens + 1) return { einzeln: [...liste], rest: [] };
  return { einzeln: liste.slice(0, hoechstens), rest: liste.slice(hoechstens) };
}

// ---------------------------------------------------------------------------
// Abende eines Semesters
// ---------------------------------------------------------------------------

const WOCHENTAG = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", weekday: "long" });

export type AbendStand = {
  /** Kalendertage mit Einheiten. */
  gesamt: number;
  /** Davon begonnen (mindestens eine Einheit hat angefangen). */
  gehalten: number;
  /** „dienstags“, wenn alle Abende auf denselben Wochentag fallen. */
  wochentag: string | null;
  /** Beginn der letzten Einheit des Semesters. */
  letzterAbend: Date | null;
};

export function abendStand(termine: readonly { beginn: Date }[], jetzt: Date): AbendStand {
  const erster = new Map<string, Date>();
  for (const t of termine) {
    const tag = berlinerTag(t.beginn);
    const bisher = erster.get(tag);
    if (!bisher || t.beginn < bisher) erster.set(tag, t.beginn);
  }
  const anfaenge = [...erster.values()];
  const wochentage = new Set(anfaenge.map((d) => WOCHENTAG.format(d)));
  const letzter = termine.reduce<Date | null>((max, t) => (!max || t.beginn > max ? t.beginn : max), null);
  return {
    gesamt: anfaenge.length,
    gehalten: anfaenge.filter((d) => d.getTime() <= jetzt.getTime()).length,
    wochentag: wochentage.size === 1 ? `${[...wochentage][0].toLowerCase()}s` : null,
    letzterAbend: letzter,
  };
}

/** „Abend 2 von 10 gehalten“, vorher „10 Abende geplant“, am Ende „Alle 10 Abende gehalten“. */
export function abendText(stand: AbendStand): string {
  if (stand.gesamt === 0) return "Noch keine Abende geplant";
  if (stand.gehalten === 0) return `${anzahl(stand.gesamt, "Abend", "Abende")} geplant`;
  if (stand.gehalten >= stand.gesamt) return stand.gesamt === 1 ? "Der Abend ist gehalten" : `Alle ${stand.gesamt} Abende gehalten`;
  return `Abend ${stand.gehalten} von ${stand.gesamt} gehalten`;
}

/** Ein Kalendertag (@db.Date, UTC-Mitternacht) als „15.09.“ bzw. mit Jahr „01.12.2026“. */
export function kalendertag(d: Date, mitJahr: boolean): string {
  const tt = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return mitJahr ? `${tt}.${mm}.${d.getUTCFullYear()}` : `${tt}.${mm}.`;
}

/** „15.09. bis 01.12.2026, dienstags“ — Beginn ohne Jahr, wenn es dasselbe ist. */
export function zeitraumText(start: Date, ende: Date, wochentag: string | null): string {
  const gleichesJahr = start.getUTCFullYear() === ende.getUTCFullYear();
  const zeitraum = `${kalendertag(start, !gleichesJahr)} bis ${kalendertag(ende, true)}`;
  return wochentag ? `${zeitraum}, ${wochentag}` : zeitraum;
}

/** Ist die Einheit vorbei? Ohne Ende gilt der Beginn (wie `terminVergangen`). */
export function einheitVorbei(beginn: Date, ende: Date | null, jetzt: Date): boolean {
  return (ende ?? beginn).getTime() <= jetzt.getTime();
}

/**
 * Die Einheiten des nächsten Abends: der früheste Kalendertag mit einer Einheit,
 * die noch nicht vorbei ist, und davon alle Einheiten dieses Tages. So bleibt
 * ein laufender Abend „der nächste“, bis seine letzte Einheit endet.
 */
export function naechsterAbend<T extends { beginn: Date; ende: Date | null }>(termine: readonly T[], jetzt: Date): T[] {
  const offen = termine
    .filter((t) => !einheitVorbei(t.beginn, t.ende, jetzt))
    .sort((a, b) => a.beginn.getTime() - b.beginn.getTime());
  if (offen.length === 0) return [];
  const tag = berlinerTag(offen[0].beginn);
  return termine
    .filter((t) => berlinerTag(t.beginn) === tag)
    .sort((a, b) => a.beginn.getTime() - b.beginn.getTime());
}

/** „5 von 20 haben sich schon selbst eingetragen“, „12 von 20 erfasst“ oder „noch niemand erfasst“. */
export function erfassungsText(erfasst: number, gesamt: number, selbst: number): string {
  if (erfasst <= 0) return "noch niemand erfasst";
  if (selbst === erfasst) {
    return `${erfasst} von ${gesamt} ${erfasst === 1 ? "hat sich" : "haben sich"} schon selbst eingetragen`;
  }
  return `${erfasst} von ${gesamt} erfasst`;
}

// ---------------------------------------------------------------------------
// Semesterüberleitung: bis wann einladen?
// ---------------------------------------------------------------------------

/**
 * Bis wann die Einladung ins neue Semester am besten verschickt ist: am Stichtag
 * der ersten Erinnerung (Einstellung SEMESTER_ERINNERUNG_1_TAGE, Standard 14
 * Tage vor Beginn). Wer später einlädt, erledigt diese Stufe mit der Einladung
 * (`erledigteStufenBeiEinladung`) — die Teilnehmer bekommen dann eine Erinnerung weniger.
 */
export function einladungEmpfohlenBis(start: Date, ersteErinnerungTage: number): Date {
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()) - ersteErinnerungTage * TAG_MS);
}

/**
 * Gehört die Einladung auf „Zu erledigen“? Ab `vorlaufTage` vor dem empfohlenen
 * Tag, solange sie nicht gestartet ist und das Semester nicht begonnen hat (in
 * ein begonnenes Semester lädt keine Überleitung mehr ein).
 */
export function ueberleitungFaellig(p: {
  start: Date;
  gestartet: boolean;
  jetzt: Date;
  ersteErinnerungTage: number;
  vorlaufTage?: number;
}): boolean {
  if (p.gestartet || semesterHatBegonnen(p.start, p.jetzt)) return false;
  const ab = einladungEmpfohlenBis(p.start, p.ersteErinnerungTage).getTime() - (p.vorlaufTage ?? 14) * TAG_MS;
  return alsHeutigerTag(p.jetzt).getTime() >= ab;
}

// ---------------------------------------------------------------------------
// Personenstatus als Status-Punkt
// ---------------------------------------------------------------------------

/**
 * Farbe des Status-Punkts in der Personenliste. „Aktiv“ ist der Normalfall und
 * steht leise ohne Punkt (null); Farbe nur, wo sie etwas sagt: neu angenommen
 * (blau), beurlaubt (gelb), Abschluss (grün), ausgeschlossen (rot).
 */
export function personStatusTon(code: string): "blau" | "gelb" | "gruen" | "rot" | "grau" | null {
  switch (code) {
    case "AKTIV":
      return null;
    case "ANGENOMMEN":
      return "blau";
    case "BEURLAUBT":
      return "gelb";
    case "ABSOLVENT":
      return "gruen";
    case "AUSGESCHLOSSEN":
      return "rot";
    default:
      return "grau";
  }
}

// ---------------------------------------------------------------------------
// „Zuletzt“: Protokolleinträge als Sätze
// ---------------------------------------------------------------------------

export type ZuletztEreignis =
  | { art: "aufgenommen"; am: Date; name: string }
  | { art: "abgelehnt"; am: Date; name: string }
  | { art: "status"; am: Date; name: string; status: string }
  | { art: "selbst"; am: Date; person: string; einheit: Date }
  | { art: "erfasst"; am: Date; einheit: Date; von: string | null }
  | { art: "ueberleitung"; am: Date; semester: string };

export type ZuletztZeile = { am: Date; text: string };

/**
 * Macht aus Protokolleinträgen wenige Sätze, neueste zuerst. Selbstbestätigungen
 * werden je Abend zusammengefasst („5 Teilnehmer haben den Abend vom 22.09. selbst
 * bestätigt“), Erfassungen je Abend und Person. Namen kommen vom Aufrufer, der
 * sie nur mit dem passenden Recht auflöst.
 */
export function zuletztZeilen(ereignisse: readonly ZuletztEreignis[], hoechstens = 4): ZuletztZeile[] {
  const zeilen: ZuletztZeile[] = [];
  const selbst = new Map<string, { am: Date; personen: Set<string> }>();
  const erfasst = new Map<string, { am: Date; tag: Date; von: string | null }>();

  for (const e of ereignisse) {
    if (e.art === "selbst") {
      const tag = berlinerTag(e.einheit);
      const gruppe = selbst.get(tag) ?? { am: e.am, personen: new Set<string>() };
      gruppe.personen.add(e.person);
      if (e.am > gruppe.am) gruppe.am = e.am;
      selbst.set(tag, gruppe);
    } else if (e.art === "erfasst") {
      const schluessel = `${berlinerTag(e.einheit)}|${e.von ?? ""}`;
      const gruppe = erfasst.get(schluessel);
      if (!gruppe || e.am > gruppe.am) erfasst.set(schluessel, { am: e.am, tag: e.einheit, von: e.von });
    } else if (e.art === "aufgenommen" || e.art === "abgelehnt") {
      zeilen.push({ am: e.am, text: e.art === "aufgenommen" ? `${e.name} aufgenommen` : `Anmeldung von ${e.name} abgelehnt` });
    } else if (e.art === "status") {
      zeilen.push({ am: e.am, text: `${e.name}: Status „${e.status}“` });
    } else {
      zeilen.push({ am: e.am, text: `Einladung ins ${e.semester} gestartet` });
    }
  }

  for (const [tag, gruppe] of selbst) {
    const n = gruppe.personen.size;
    const abend = kalendertag(new Date(`${tag}T00:00:00.000Z`), false);
    zeilen.push({
      am: gruppe.am,
      text: `${n} ${n === 1 ? "Teilnehmer hat" : "Teilnehmer haben"} den Abend vom ${abend} selbst bestätigt`,
    });
  }
  for (const gruppe of erfasst.values()) {
    zeilen.push({ am: gruppe.am, text: `Anwesenheit vom ${tagMonat(gruppe.tag)} erfasst${gruppe.von ? ` (${gruppe.von})` : ""}` });
  }

  return zeilen.sort((a, b) => b.am.getTime() - a.am.getTime()).slice(0, hoechstens);
}
