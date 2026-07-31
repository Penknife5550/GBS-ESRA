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
 */

import type { PdfBlock } from "@/lib/pdf";
import type { ZeugnisSnapshot } from "@/lib/zeugnis";

/** Einleitungssatz je Typ — neutral und faktisch. */
function einleitung(snapshot: ZeugnisSnapshot): string {
  switch (snapshot.typ) {
    case "ABSCHLUSS":
      return "Die Gemeindebibelschule Minden bescheinigt die Teilnahme an der Ausbildung mit den folgenden Gesamtleistungen.";
    case "BESCHEINIGUNG":
      return "Die Gemeindebibelschule Minden bescheinigt die Teilnahme an den folgenden Fächern als Hörer (ohne Prüfung).";
    default:
      return "Die Gemeindebibelschule Minden bescheinigt die Teilnahme und die erbrachten Leistungen im folgenden Ausbildungsabschnitt.";
  }
}

/** Die rechte Spalte einer Fach-Zeile: Ergebnis, dazu — falls vorhanden — Punkte und Note. */
function leistungWert(l: ZeugnisSnapshot["leistungen"][number]): string {
  const teile = [l.ergebnisText];
  if (l.punkte !== null) teile.push(`${l.punkte} Punkte`);
  if (l.note) teile.push(`Note ${l.note}`);
  return teile.join(" · ");
}

/** Baut die PDF-Bausteine EINES Zeugnisses aus seinem Snapshot. Rein, ohne Datenbank. */
export function baueZeugnisBloecke(snapshot: ZeugnisSnapshot): PdfBlock[] {
  const b: PdfBlock[] = [];

  b.push({ art: "titel", text: snapshot.titel });
  b.push({
    art: "klein",
    text: `Gemeindebibelschule Minden · Christliches Werk Esra e.V. · Beleg-Nr. ${snapshot.belegNr}${
      snapshot.version > 1 ? ` · Ausfertigung ${snapshot.version}` : ""
    }`,
  });

  // Storno-Vermerk: diese Ausfertigung ersetzt einen früheren Beleg — der alte,
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
