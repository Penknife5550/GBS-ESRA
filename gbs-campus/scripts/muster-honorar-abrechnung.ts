/**
 * Erzeugt ein Muster des Honorar-Abrechnungs-Zahlungsbelegs als PDF (erfundene
 * Daten, ohne Datenbank). Nur zum Abnehmen des Layouts.
 *
 * Aufruf:  tsx scripts/muster-honorar-abrechnung.ts [ausgabepfad.pdf]
 */

import { writeFileSync } from "fs";
import { baueAbrechnungBelegBloecke, type AbrechnungBelegDaten } from "../src/lib/honorar-abrechnung-beleg";
import { erzeugePdf } from "../src/lib/pdf";

const daten: AbrechnungBelegDaten = {
  belegNr: "HONA-2026-07-30-3F7A9C21",
  erzeugtAm: new Date("2026-07-30T10:15:00"),
  dozent: "Dozento, Dora",
  semester: "Herbstsemester 2026",
  statusText: "Freigegeben zur Auszahlung",
  kontoinhaber: "Dora Dozento",
  iban: "DE02120300000000202051", // Beispiel-IBAN (Bundesbank-Testkonto)
  freigegebenVon: "Verwalta, Vera",
  freigegebenAm: new Date("2026-07-30T10:15:00"),
  ausgezahltAm: null,
  posten: [
    { datum: new Date("2026-08-25T19:00:00"), fach: "Bibelkunde Altes Testament", betrag: 60 },
    { datum: new Date("2026-09-01T19:00:00"), fach: "Bibelkunde Altes Testament", betrag: 70 },
    { datum: new Date("2026-09-08T19:00:00"), fach: "Kirchengeschichte", betrag: 70 },
    { datum: new Date("2026-09-15T19:00:00"), fach: "Kirchengeschichte", betrag: 70 },
    { datum: new Date("2026-09-22T19:00:00"), fach: "Dogmatik", betrag: 70 },
  ],
  summe: 340,
  notiz: "Herbstsemester, Beschluss vom 30.06.2026",
};

const pfad = process.argv[2] ?? "Muster-Honorar-Abrechnung.pdf";
writeFileSync(pfad, erzeugePdf(baueAbrechnungBelegBloecke(daten)));
console.log("Muster-Zahlungsbeleg geschrieben:", pfad);
