/**
 * GBS Campus — Zeugnis/Bescheinigung: PDF-Bausteine (reine Inhaltslogik)
 *
 * DB-frei: baut aus einem eingefrorenen Snapshot die PDF-Blöcke über den
 * abhängigkeitsfreien `pdf.ts` (Helvetica, kein Logo, nur Grau fürs
 * Kleingedruckte). Ein „schönes" Zeugnis (Logo/Farbe/Montserrat) wäre eine
 * eigene Architekturentscheidung mit neuer PDF-Bibliothek — bewusst nicht hier.
 *
 * Für den Seriendruck werden mehrere Snapshots mit einem Seitenumbruch
 * aneinandergehängt, damit jede Person auf einem eigenen Blatt beginnt.
 *
 * Ein nicht mehr gültiges Dokument (ERSETZT oder STORNIERT) bekommt im Nachdruck
 * der Schulleitung einen Kopfvermerk; für den Storno gibt es zusätzlich einen
 * kurzen Vermerk an das DMS (Beleg-Nr., Datum, „ungültig" — ohne Namen und ohne
 * den Grund).
 */

import type { PdfBlock } from "@/lib/pdf";
import type { ZeugnisSnapshot } from "@/lib/zeugnis";
import { EINRICHTUNG } from "@/lib/constants";

/** Einleitungssatz je Typ — neutral und faktisch. */
function einleitung(snapshot: ZeugnisSnapshot): string {
  switch (snapshot.typ) {
    case "ABSCHLUSS":
      return `Die ${EINRICHTUNG.name} bescheinigt die Teilnahme an der Ausbildung mit den folgenden Gesamtleistungen.`;
    case "BESCHEINIGUNG":
      return `Die ${EINRICHTUNG.name} bescheinigt die Teilnahme an den folgenden Fächern als Hörer (ohne Prüfung).`;
    default:
      return `Die ${EINRICHTUNG.name} bescheinigt die Teilnahme und die erbrachten Leistungen im folgenden Ausbildungsabschnitt.`;
  }
}

/** Die rechte Spalte einer Fach-Zeile: Ergebnis, dazu — falls vorhanden — Punkte und Note. */
function leistungWert(l: ZeugnisSnapshot["leistungen"][number]): string {
  const teile = [l.ergebnisText];
  if (l.punkte !== null) teile.push(`${l.punkte} Punkte`);
  if (l.note) teile.push(`Note ${l.note}`);
  return teile.join(" · ");
}

/**
 * Vermerk für ein ERSETZTES Zeugnis: welche Ausfertigung an seine Stelle trat und
 * wann (bereits formatiert). Beide Angaben können fehlen, wenn der Nachfolger
 * nicht mehr auffindbar ist — der Vermerk „ungültig“ bleibt trotzdem.
 */
export type UngueltigVermerk = { durchBelegNr: string | null; am: string | null };

/** Der Kopfvermerk eines ersetzten Zeugnisses, z. B. „UNGÜLTIG – ersetzt durch Beleg ZEU-… am 01.08.2026“. */
export function ungueltigVermerkText(v: UngueltigVermerk): string {
  if (!v.durchBelegNr) return "UNGÜLTIG – dieses Dokument wurde durch eine neue Ausfertigung ersetzt.";
  return `UNGÜLTIG – ersetzt durch Beleg ${v.durchBelegNr}${v.am ? ` am ${v.am}` : ""}.`;
}

/** Vermerk für ein STORNIERTES Zeugnis: der Tag des Stornos (bereits formatiert). */
export type StornoVermerk = { storniertAm: string };

/** Der Kopfvermerk eines stornierten Zeugnisses, z. B. „STORNIERT am 28.09.2026 — ungültig“. */
export function stornoVermerkText(v: StornoVermerk): string {
  return `STORNIERT am ${v.storniertAm} — ungültig`;
}

/**
 * Baut die PDF-Bausteine EINES Zeugnisses aus seinem Snapshot. Rein, ohne
 * Datenbank. Mit `ungueltig` (für ein ERSETZTES oder STORNIERTES Zeugnis,
 * Nachdruck durch die Schulleitung) steht vor allem anderen ein Kopfvermerk —
 * der Snapshot selbst bleibt unverändert, sonst sähe der Nachdruck wie ein
 * gültiges Zeugnis aus.
 */
export function baueZeugnisBloecke(
  snapshot: ZeugnisSnapshot,
  ungueltig: UngueltigVermerk | StornoVermerk | null = null,
): PdfBlock[] {
  const b: PdfBlock[] = [];

  if (ungueltig && "storniertAm" in ungueltig) {
    b.push({ art: "h2", text: stornoVermerkText(ungueltig) });
    b.push({
      art: "absatz",
      // Ohne den Grund: Er ist Freitext der Schulleitung und gehört nicht auf
      // ein Blatt, das das Haus verlassen kann.
      text: "Dieses Dokument wurde ohne Ersatz zurückgezogen und ist nicht mehr gültig. Es bleibt nur als Nachweis gespeichert.",
    });
  } else if (ungueltig) {
    b.push({ art: "h2", text: ungueltigVermerkText(ungueltig) });
    b.push({
      art: "absatz",
      // Neutral gefasst: Das Dokument kann auch eine Teilnahmebescheinigung sein,
      // und der genannte Nachfolger kann selbst schon wieder ersetzt sein.
      text: "Dieses Dokument ist nicht mehr gültig. Maßgeblich ist allein die jeweils gültige Ausfertigung.",
    });
  }

  b.push({ art: "titel", text: snapshot.titel });
  b.push({
    art: "klein",
    text: `${EINRICHTUNG.name} · ${EINRICHTUNG.traeger} · Beleg-Nr. ${snapshot.belegNr}${
      snapshot.version > 1 ? ` · Ausfertigung ${snapshot.version}` : ""
    }`,
  });

  // Ersetzt-Vermerk: diese Ausfertigung ersetzt einen früheren Beleg — der alte,
  // bereits gedruckte, ist damit entwertet.
  if (snapshot.ersetztBelegNr) {
    b.push({
      art: "absatz",
      text: `Diese Ausfertigung ersetzt den Beleg ${snapshot.ersetztBelegNr}. Frühere Ausdrucke sind damit ungültig.`,
    });
  }

  b.push({ art: "absatz", text: einleitung(snapshot) });

  b.push({ art: "h2", text: "Teilnehmer" });
  b.push({ art: "kv", label: "Name", wert: snapshot.person.name });
  if (snapshot.person.geburtsdatum) b.push({ art: "kv", label: "Geburtsdatum", wert: snapshot.person.geburtsdatum });
  b.push({ art: "kv", label: "Ausbildungsabschnitt", wert: snapshot.abschnitt });

  b.push({ art: "h2", text: snapshot.typ === "BESCHEINIGUNG" ? "Besuchte Fächer" : "Leistungen" });
  if (snapshot.leistungen.length === 0) {
    b.push({ art: "absatz", text: "Für diesen Abschnitt sind keine Fächer erfasst." });
  }
  for (const l of snapshot.leistungen) {
    b.push({ art: "kv", label: l.titel ? `${l.fach} · ${l.titel}` : l.fach, wert: leistungWert(l) });
  }

  b.push({ art: "leer" });
  b.push({
    art: "absatz",
    text: `${snapshot.ort}, den ${snapshot.ausgestelltAm}${
      snapshot.ausgestelltVon ? ` — ausgestellt durch ${snapshot.ausgestelltVon}` : ""
    }`,
  });
  b.push({ art: "leer" });
  b.push({ art: "absatz", text: "________________________________________" });
  b.push({ art: "klein", text: "Schulleitung" });

  b.push({ art: "leer" });
  b.push({
    art: "klein",
    text: "Maschinell erzeugt aus dem festgeschriebenen Ausstellungsstand. Rückfragen an die Schulverwaltung unter Angabe der Beleg-Nummer.",
  });

  return b;
}

/**
 * Baut EIN PDF für den Seriendruck: die Bausteine aller Snapshots hintereinander,
 * je Person durch einen Seitenumbruch getrennt (jede beginnt auf einem eigenen
 * Blatt).
 */
export function baueSeriendruckBloecke(snapshots: ZeugnisSnapshot[]): PdfBlock[] {
  const bloecke: PdfBlock[] = [];
  snapshots.forEach((snapshot, i) => {
    if (i > 0) bloecke.push({ art: "seitenumbruch" });
    bloecke.push(...baueZeugnisBloecke(snapshot));
  });
  return bloecke;
}

/** Was der Storno-Vermerk an das DMS nennt (Datum bereits formatiert). */
export type StornoVermerkDaten = { belegNr: string; titel: string; abschnitt: string; storniertAm: string };

/**
 * Der kurze Storno-Vermerk an das DMS: Beleg-Nr., Dokument, Datum und
 * „ungültig". Kein Name — die Archivkopie mit Namen liegt dort schon, und der
 * Betreff bliebe im Versandprotokoll stehen — und kein Grund (Freitext der
 * Schulleitung).
 */
export function baueStornoVermerk(v: StornoVermerkDaten): {
  betreff: string;
  text: string;
  dateiname: string;
  bloecke: PdfBlock[];
} {
  const dokument = `${v.titel} · ${v.abschnitt}`;
  const hinweis =
    "Das Dokument mit dieser Beleg-Nummer wurde ohne Ersatz storniert und ist ungültig. " +
    "Die archivierte Kopie bleibt als Nachweis bestehen.";
  return {
    betreff: `Storno-Vermerk ${v.belegNr} — ungültig`,
    text:
      `Storno-Vermerk der ${EINRICHTUNG.name}.\n\n` +
      `Beleg-Nr.: ${v.belegNr}\nDokument: ${dokument}\nStorniert am: ${v.storniertAm}\nStatus: ungültig\n\n` +
      `${hinweis} Der Vermerk liegt als PDF bei.`,
    dateiname: `${v.belegNr}-STORNO.pdf`,
    bloecke: [
      { art: "titel", text: "Storno-Vermerk" },
      { art: "klein", text: `${EINRICHTUNG.name} · ${EINRICHTUNG.traeger}` },
      { art: "h2", text: stornoVermerkText({ storniertAm: v.storniertAm }) },
      { art: "kv", label: "Beleg-Nr.", wert: v.belegNr },
      { art: "kv", label: "Dokument", wert: dokument },
      { art: "kv", label: "Storniert am", wert: v.storniertAm },
      { art: "kv", label: "Status", wert: "ungültig" },
      { art: "leer" },
      { art: "absatz", text: hinweis },
    ],
  };
}
