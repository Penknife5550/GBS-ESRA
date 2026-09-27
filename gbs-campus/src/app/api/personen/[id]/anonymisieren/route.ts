import { NextRequest } from "next/server";
import { pruefeZugriff } from "@/lib/berechtigung";
import { erfolg, fehler } from "@/lib/api";
import { RECHT } from "@/lib/constants";
import { MELDUNG_LETZTER_ADMIN } from "@/lib/benutzerverwaltung";
import { anonymisierePerson } from "@/lib/anonymisierung-io";

/**
 * Anonymisiert eine Person nach DSGVO Art. 17 (Recht auf Löschung). Weil das
 * Audit-Log und die Einwilligungen als Nachweis erhalten bleiben müssen, wird
 * nicht gelöscht, sondern jedes personenbezogene Feld überschrieben. Unwiderruflich.
 */
export async function POST(request: NextRequest, kontext: { params: Promise<{ id: string }> }) {
  const benutzer = await pruefeZugriff(RECHT.PERSON_ANONYMISIEREN);
  if (benutzer instanceof Response) return benutzer;

  const { id } = await kontext.params;
  const ergebnis = await anonymisierePerson(id, benutzer.id, request.headers);

  if (ergebnis.status === "person_fehlt") return fehler("Diese Person gibt es nicht.", 404);
  if (ergebnis.status === "schon_anonym") return fehler("Diese Person ist bereits anonymisiert.", 409);
  if (ergebnis.status === "letzter_admin") return fehler(MELDUNG_LETZTER_ADMIN, 409);
  if (ergebnis.status === "gleichzeitig") {
    return fehler("Der Status dieser Person wurde gerade geändert. Bitte die Seite neu laden und erneut versuchen.", 409);
  }

  return erfolg({ anmeldungen: ergebnis.anmeldungen, zeugnisse: ergebnis.zeugnisse });
}
