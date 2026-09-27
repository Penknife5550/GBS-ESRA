import { NextRequest } from "next/server";
import { pruefeZugriff } from "@/lib/berechtigung";
import { erfolg, fehler } from "@/lib/api";
import { RECHT } from "@/lib/constants";
import { sendeOffeneZeugnisseAnDms } from "@/lib/zeugnis-io";

/**
 * Sammel-Nachversand der DMS-Archivkopien (Schulleitung, Recht NOTEN_VERWALTEN):
 * alle gültigen Zeugnisse, deren Archivkopie beim Ausstellen nicht ans DMS ging
 * (`dmsGesendetAm = null`, z. B. SMTP-Aussetzer oder fehlende DMS-Adresse).
 * Ohne Rumpf — es gibt nichts auszuwählen. Ein zweiter, gleichzeitiger Lauf
 * (zweiter Tab, zweiter Klick) bekommt 409 statt die Archivkopien doppelt zu
 * schicken.
 */
export async function POST(request: NextRequest) {
  const benutzer = await pruefeZugriff(RECHT.NOTEN_VERWALTEN);
  if (benutzer instanceof Response) return benutzer;

  let ergebnis;
  try {
    ergebnis = await sendeOffeneZeugnisseAnDms(benutzer.id, request.headers);
  } catch (ausnahme) {
    console.error("[ZEUGNIS] DMS-Nachversand fehlgeschlagen", ausnahme);
    return fehler("Der Nachversand an das DMS ist fehlgeschlagen. Bitte versuche es später noch einmal.", 500);
  }

  if ("fehler" in ergebnis) {
    if (ergebnis.fehler === "laeuft") {
      return fehler("Der Nachversand an das DMS läuft gerade schon (etwa in einem zweiten Fenster). Bitte die Seite gleich neu laden.", 409);
    }
    return fehler("Es ist keine DMS-Adresse eingerichtet (DMS_EMAIL). Der Nachversand ist erst danach möglich.", 409);
  }
  return erfolg(ergebnis);
}
