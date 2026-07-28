import { NextRequest, NextResponse } from "next/server";
import { angemeldetePersonId, sitzungBeenden } from "@/lib/session";
import { protokolliere } from "@/lib/audit";

/**
 * Abmelden.
 *
 * Vor dem Review gab es das nicht: `sitzungBeenden()` war implementiert, wurde
 * aber nirgends aufgerufen, und in der Oberfläche fehlte jeder Weg dorthin. In
 * einer Schule mit geteilten Geräten — dem iPad des Schulleiters, dem Rechner
 * der Verwaltung — blieb die Sitzung damit bis zu ihrem Ablauf offen.
 *
 * Bewusst POST, nicht GET: Ein GET liesse sich von fremden Seiten aus auslösen
 * und Nutzer grundlos abmelden.
 */
export async function POST(request: NextRequest) {
  // `angemeldetePersonId` liefert seit der Einführung des Sitzungswiderrufs
  // nicht mehr nur die Id, sondern auch den Ausstellungszeitpunkt — hier wird
  // nur die Id gebraucht.
  const sitzung = await angemeldetePersonId();

  await sitzungBeenden();

  if (sitzung) {
    await protokolliere({
      aktion: "ABGEMELDET",
      objektTyp: "Person",
      objektId: sitzung.personId,
      akteurId: sitzung.personId,
      headers: request.headers,
    });
  }

  return NextResponse.json({ data: { abgemeldet: true } });
}
