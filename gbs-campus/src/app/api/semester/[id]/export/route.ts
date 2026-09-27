import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { pruefeZugriff } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { alsDownloadFehler, downloadFehler } from "@/lib/api";
import { RECHT } from "@/lib/constants";
import { EXPORT_SPALTEN, alsHeutigerTag, alsTagText } from "@/lib/semester";
import { ladeTeilnehmer } from "@/lib/teilnehmerliste";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Die Teilnehmerliste als Excel-Datei — das, was der Schulleiter im Interview von Hand
 * gepflegt hat.
 *
 * Zwei Dinge sind hier wichtiger als der Komfort:
 *
 *  - **Keine Bankverbindung in der Datei.** Die Spalten stehen in
 *    `EXPORT_SPALTEN`, und dort fehlt die IBAN mit Absicht: Eine Exportdatei
 *    verlässt das System und liegt danach unverschlüsselt auf Notebooks und in
 *    Mailanhängen.
 *  - **Jeder Export steht im Audit-Log.** Hier verlassen personenbezogene
 *    Daten die Anwendung; das muss nachvollziehbar sein, wer wann getan hat.
 *
 * Fehler gehen über `downloadFehler`: Der Export ist ein Link, im Browser gibt
 * es deshalb eine Fehlerseite bzw. die Anmeldung statt rohem JSON.
 */
export async function GET(request: NextRequest, kontext: { params: Promise<{ id: string }> }) {
  const benutzer = await pruefeZugriff(RECHT.PERSON_EXPORTIEREN);
  if (benutzer instanceof Response) return alsDownloadFehler(request, benutzer);

  const { id } = await kontext.params;
  // Beide Abfragen hängen nur an der Id, nicht voneinander — nacheinander war
  // hier nur langsamer.
  const [semester, zeilen] = await Promise.all([
    prisma.semester.findUnique({ where: { id } }),
    ladeTeilnehmer(id),
  ]);
  if (!semester) return downloadFehler(request, "Dieses Semester gibt es nicht.", 404);

  // Der Nachweis steht VOR der Auslieferung, und das ist keine Förmlichkeit:
  // `protokolliere` wirft bewusst nicht, es kann also keinen Fehler geben, der
  // die Auslieferung noch aufhält. Stand der Eintrag hinter dem Erzeugen der
  // Datei, konnte jeder Abbruch dazwischen — ein Speicherfehler beim Aufbau der
  // Mappe genügt — eine Liste mit Namen, Adressen und Geburtsdaten ohne jede
  // Spur nach draußen gehen lassen.
  await protokolliere({
    aktion: "TEILNEHMERLISTE_EXPORTIERT",
    objektTyp: "Semester",
    objektId: id,
    akteurId: benutzer.id,
    nachher: { code: semester.code, zeilen: zeilen.length },
    headers: request.headers,
  });

  const mappe = new ExcelJS.Workbook();
  mappe.creator = "GBS Campus";
  mappe.created = new Date();

  const blatt = mappe.addWorksheet(semester.code);
  blatt.columns = EXPORT_SPALTEN.map((spalte) => ({ header: spalte.titel, width: spalte.breite }));
  blatt.getRow(1).font = { bold: true };
  // Kopfzeile bleibt beim Blättern stehen — bei 60 Zeilen ist das der
  // Unterschied zwischen benutzbar und nicht.
  blatt.views = [{ state: "frozen", ySplit: 1 }];

  for (const zeile of zeilen) {
    blatt.addRow(EXPORT_SPALTEN.map((spalte) => spalte.wert(zeile)));
  }

  const inhalt = await mappe.xlsx.writeBuffer();

  // Datum in ISO-Schreibweise: sortiert sich im Dateimanager richtig, und der
  // Semestercode enthält nur Buchstaben, Ziffern und Bindestriche — der
  // Dateiname braucht deshalb keine Maskierung.
  const dateiname = `Teilnehmer_${semester.code}_${alsTagText(alsHeutigerTag(new Date()))}.xlsx`;

  return new NextResponse(new Uint8Array(inhalt), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${dateiname}"`,
      // Eine Liste mit Namen und Adressen gehört in keinen Zwischenspeicher.
      "Cache-Control": "no-store",
    },
  });
}
