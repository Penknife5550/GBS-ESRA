/**
 * GBS Campus — Kursraster (Fächer & Kurseinheiten)
 *
 * EINE Quelle für den Seed (`prisma/seed.ts`) UND das Prüfskript
 * (`scripts/pruefe-faecher.ts`) — wie bei `anmeldeformular-definition.ts`. So
 * kann das Prüfskript die Datenintegrität (Stundensummen, Rasterplätze) ohne
 * Datenbank gegenprüfen, ohne dass die Werte doppelt gepflegt werden.
 *
 * Quelle der Werte: Kursübersicht auf gbs-minden.de (Stand 29.07.2026). Das
 * Raster ist fest: drei Lehrjahre, je zwei Halbjahre (1 = Herbst, 2 = Frühling).
 */

export type FachDef = {
  code: string;
  bezeichnung: string;
  gesamtstunden: number;
  beschreibung: string;
  aktiv: boolean;
  sortierung: number;
};

export type KurseinheitDef = {
  fachCode: string;
  titel: string;
  jahrgangsjahr: number; // Lehrjahr 1-3
  halbjahr: number; // 1 = Herbst, 2 = Frühling
  stunden: number;
  aktiv: boolean;
  sortierung: number;
};

export const FAECHER: FachDef[] = [
  { code: "BIBELKUNDE", bezeichnung: "Bibelkunde", gesamtstunden: 80, beschreibung: "In zwei Jahren einmal durch den gesamten biblischen Kanon (Altes und Neues Testament), mit Kontext und rotem Faden.", aktiv: true, sortierung: 10 },
  { code: "KIRCHENGESCHICHTE", bezeichnung: "Kirchengeschichte", gesamtstunden: 20, beschreibung: "Geschichte der christlichen Gemeinde: Antike und Mittelalter, Reformation und Neuzeit.", aktiv: true, sortierung: 20 },
  { code: "DOGMATIK", bezeichnung: "Dogmatik", gesamtstunden: 30, beschreibung: "Wie der Inhalt des christlichen Glaubens verständlich erklärt und verantwortet wird.", aktiv: true, sortierung: 30 },
  { code: "HERMENEUTIK", bezeichnung: "Hermeneutik", gesamtstunden: 20, beschreibung: "Werkzeuge und Methoden, die Bibel tiefgehend und verantwortlich auszulegen.", aktiv: true, sortierung: 40 },
  { code: "EXEGESE", bezeichnung: "Exegese", gesamtstunden: 10, beschreibung: "Auslegung eines Bibeltextes exemplarisch an einem biblischen Buch.", aktiv: true, sortierung: 50 },
  { code: "HOMILETIK", bezeichnung: "Homiletik", gesamtstunden: 10, beschreibung: "Wie die Botschaft der Bibel in Andachten und Predigten vermittelt wird.", aktiv: true, sortierung: 60 },
  { code: "GEMEINDEARBEIT", bezeichnung: "Gemeindearbeit", gesamtstunden: 10, beschreibung: "Praktische und relevante Fragen der Gemeindearbeit.", aktiv: true, sortierung: 70 },
];

export const KURSEINHEITEN: KurseinheitDef[] = [
  // 1. Lehrjahr — Herbst
  { fachCode: "BIBELKUNDE", titel: "AT-Bibelkunde: Tora und Geschichte", jahrgangsjahr: 1, halbjahr: 1, stunden: 20, aktiv: true, sortierung: 10 },
  { fachCode: "KIRCHENGESCHICHTE", titel: "Kirchengeschichte: Antike und Mittelalter", jahrgangsjahr: 1, halbjahr: 1, stunden: 10, aktiv: true, sortierung: 20 },
  // 1. Lehrjahr — Frühling
  { fachCode: "BIBELKUNDE", titel: "AT-Bibelkunde: Weisheitsliteratur & Propheten", jahrgangsjahr: 1, halbjahr: 2, stunden: 20, aktiv: true, sortierung: 10 },
  { fachCode: "KIRCHENGESCHICHTE", titel: "Kirchengeschichte: Reformation und Neuzeit", jahrgangsjahr: 1, halbjahr: 2, stunden: 10, aktiv: true, sortierung: 20 },
  // 2. Lehrjahr — Herbst
  { fachCode: "BIBELKUNDE", titel: "NT-Bibelkunde & -Zeitgeschichte", jahrgangsjahr: 2, halbjahr: 1, stunden: 20, aktiv: true, sortierung: 10 },
  { fachCode: "DOGMATIK", titel: "Dogmatik", jahrgangsjahr: 2, halbjahr: 1, stunden: 10, aktiv: true, sortierung: 20 },
  // 2. Lehrjahr — Frühling
  { fachCode: "BIBELKUNDE", titel: "NT-Bibelkunde & -Zeitgeschichte", jahrgangsjahr: 2, halbjahr: 2, stunden: 20, aktiv: true, sortierung: 10 },
  { fachCode: "DOGMATIK", titel: "Dogmatik", jahrgangsjahr: 2, halbjahr: 2, stunden: 10, aktiv: true, sortierung: 20 },
  // 3. Lehrjahr — Herbst
  { fachCode: "DOGMATIK", titel: "Dogmatik", jahrgangsjahr: 3, halbjahr: 1, stunden: 10, aktiv: true, sortierung: 10 },
  { fachCode: "HERMENEUTIK", titel: "Hermeneutik", jahrgangsjahr: 3, halbjahr: 1, stunden: 20, aktiv: true, sortierung: 20 },
  // 3. Lehrjahr — Frühling
  { fachCode: "HOMILETIK", titel: "Homiletik", jahrgangsjahr: 3, halbjahr: 2, stunden: 10, aktiv: true, sortierung: 10 },
  { fachCode: "GEMEINDEARBEIT", titel: "Gemeindearbeit", jahrgangsjahr: 3, halbjahr: 2, stunden: 10, aktiv: true, sortierung: 20 },
  { fachCode: "EXEGESE", titel: "Exegese", jahrgangsjahr: 3, halbjahr: 2, stunden: 10, aktiv: true, sortierung: 30 },
];
