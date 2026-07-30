/**
 * Erzeugt ein Muster des DMS-Honorarsatz-Belegs als PDF — mit erfundenen Daten,
 * ohne Datenbank. Dient dem Abnehmen des Layouts; im Betrieb baut
 * `genehmigeHonorarSatz` denselben Beleg aus dem echten Datenbestand.
 *
 * Aufruf:  tsx scripts/muster-honorar-dms.ts [ausgabepfad.pdf]
 */

import { writeFileSync } from "fs";
import { baueHonorarBelegBloecke, type HonorarBelegDaten, type BelegTag } from "../src/lib/honorar-beleg";
import { erzeugePdf } from "../src/lib/pdf";
import { satzFuer, type SatzZeile } from "../src/lib/honorar";

// Die Historie: 60 € seit Umstellung, 70 € ab 01.09.2026 (die auslösende Genehmigung).
const historie: SatzZeile[] = [
  { betrag: 60, gueltigAb: new Date("2000-01-01"), genehmigtAm: new Date("2000-01-01") },
  { betrag: 70, gueltigAb: new Date("2026-09-01"), genehmigtAm: new Date("2026-07-30T10:15:00") },
];

// Ein paar Dienstagabende rund um die Satzänderung — der 25.08. liegt noch bei
// 60 €, alle ab 01.09. bei 70 €. So zeigt der Beleg, dass jeder Tag den zu
// seinem Datum geltenden Satz nimmt.
const termine: { datum: string; semester: string; fach: string }[] = [
  { datum: "2026-08-25T19:00:00", semester: "Herbstsemester 2026", fach: "Bibelkunde Altes Testament" },
  { datum: "2026-09-01T19:00:00", semester: "Herbstsemester 2026", fach: "Bibelkunde Altes Testament" },
  { datum: "2026-09-08T19:00:00", semester: "Herbstsemester 2026", fach: "Kirchengeschichte" },
  { datum: "2026-09-15T19:00:00", semester: "Herbstsemester 2026", fach: "Kirchengeschichte" },
  { datum: "2026-09-22T19:00:00", semester: "Herbstsemester 2026", fach: "Dogmatik" },
  { datum: "2026-09-29T19:00:00", semester: "Herbstsemester 2026", fach: "Dogmatik" },
  { datum: "2026-10-06T19:00:00", semester: "Herbstsemester 2026", fach: "Bibelkunde Neues Testament" },
  { datum: "2026-10-13T19:00:00", semester: "Herbstsemester 2026", fach: "Bibelkunde Neues Testament" },
];

const tage: BelegTag[] = termine.map((t) => ({
  datum: new Date(t.datum),
  semester: t.semester,
  fach: t.fach,
  satz: satzFuer(new Date(t.datum), historie),
}));

const daten: HonorarBelegDaten = {
  belegNr: "HON-2026-07-30-3F7A9C21",
  erzeugtAm: new Date("2026-07-30T10:15:00"),
  genehmigtVon: "Beispiel, Schulleitung",
  genehmigtAm: new Date("2026-07-30T10:15:00"),
  anlass: "70 € je Unterrichtsabend, gültig ab 01.09.2026",
  saetze: [
    {
      betrag: 70,
      gueltigAb: new Date("2026-09-01"),
      notiz: "Beschluss der Schulleitung vom 30.06.2026",
      genehmigtVon: "Beispiel, Schulleitung",
      genehmigtAm: new Date("2026-07-30T10:15:00"),
    },
    {
      betrag: 60,
      gueltigAb: new Date("2000-01-01"),
      notiz: "Aus dem bisherigen Honorarsatz übernommen (Umstellung auf die Satz-Historie).",
      genehmigtVon: null,
      genehmigtAm: new Date("2000-01-01"),
    },
  ],
  tage,
};

const pfad = process.argv[2] ?? "Muster-Honorarbeleg-DMS.pdf";
writeFileSync(pfad, erzeugePdf(baueHonorarBelegBloecke(daten)));
console.log("Muster-Beleg geschrieben:", pfad);
