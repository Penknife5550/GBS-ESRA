import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { pruefeZugriff } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler } from "@/lib/api";
import { RECHT, STATUS, MAIL_VORLAGE } from "@/lib/constants";
import { pruefeNeueEmail } from "@/lib/eigene-daten";
import { gueltigkeitAlsText } from "@/lib/magic-link";
import { sendeNachVorlage } from "@/lib/selbstpflege";
import { erzeugeAuskunftToken, AUSKUNFT_GUELTIG_MINUTEN } from "@/lib/auskunft";

/**
 * Stößt eine Datenauskunft nach Art. 15 DSGVO an.
 *
 * Der Auslösende (Schulleitung/Verwaltung) bekommt die Daten NICHT zu sehen —
 * er verursacht nur, dass ein kurzlebiger Abruf-Link an die hinterlegte Adresse
 * geht. Die vollständige Kopie (inkl. Glaubensangaben und IBAN im Klartext)
 * erzeugt der Server erst beim Abruf durch die Person selbst und schickt sie nie
 * über den Mailkanal. Der Link geht ausschließlich an die hinterlegte Adresse,
 * nie an den Auslösenden.
 */
export async function POST(request: NextRequest, kontext: { params: Promise<{ id: string }> }) {
  const benutzer = await pruefeZugriff(RECHT.PERSON_EXPORTIEREN);
  if (benutzer instanceof Response) return benutzer;

  const { id } = await kontext.params;
  const person = await prisma.person.findUnique({ where: { id }, include: { status: true } });
  if (!person) return fehler("Diese Person gibt es nicht.", 404);

  // Verstorbene: keine Auskunft an das Postfach. Das Auskunftsrecht endet mit dem
  // Tod, und eine Mail an das Postfach eines Verstorbenen wäre unangemessen.
  // Andere Zustände (ausgeschlossen, abgebrochen, Absolvent) bleiben zulässig:
  // Das sind lebende Personen mit fortbestehendem Recht auf ihre Daten.
  if (person.statusCode === STATUS.VERSTORBEN) {
    return fehler("Für ein als verstorben geführtes Konto wird keine Datenauskunft verschickt.", 409);
  }
  // Anonymisiert: Es gibt keine personenbezogenen Daten mehr, über die Auskunft
  // zu geben wäre, und die Platzhalter-Adresse ist nicht zustellbar.
  if (person.statusCode === STATUS.ANONYMISIERT) {
    return fehler("Diese Person ist anonymisiert — es gibt keine Daten mehr, über die Auskunft zu geben wäre.", 409);
  }

  // Ohne brauchbare Adresse ginge der Link ins Leere. Gleiche Prüfung wie beim
  // Anmeldelink — der Vergleichswert ist leer, weil es keine „bisherige" gibt.
  const adresse = pruefeNeueEmail(person.email, "");
  if (!adresse.ok) {
    return fehler(
      "Für dieses Konto ist keine brauchbare E-Mail-Adresse hinterlegt. Bitte zuerst die Anmeldeadresse ändern.",
      409,
    );
  }

  const token = await erzeugeAuskunftToken(person.id, benutzer.id);
  const basis = process.env.APP_URL ?? "http://localhost:3000";
  // Token im URL-FRAGMENT (#), nicht im Query-String: Das Fragment schickt der
  // Browser nicht an den Server, es landet also in keinem Zugriffslog des
  // Reverse Proxy — wie beim Anmelde-, Dabei- und E-Mail-Bestätigungslink. Ein
  // Link-Scanner, der die URL vorab abruft, bekommt den Token ebenfalls nicht
  // zu sehen. Die Abrufseite liest ihn clientseitig.
  const link = `${basis}/auskunft/token#token=${token}`;

  // Ab hier steht der Token in der Datenbank. `sendeNachVorlage` wirft nie —
  // eine unlesbare Vorlage oder ein hakendes SMTP wird zu `gesendet: false`
  // statt zu einem 500, und das Protokoll unten entsteht in jedem Fall
  // (Code-Review 4). Es bleibt hinter dem Versand, damit es dessen Ausgang trägt.
  const { gesendet } = await sendeNachVorlage({
    an: person.email,
    personId: person.id,
    vorlageCode: MAIL_VORLAGE.AUSKUNFT_BEREIT,
    werte: { vorname: person.vorname, link, gueltigkeit: gueltigkeitAlsText(AUSKUNFT_GUELTIG_MINUTEN) },
    ersatzBetreff: "Deine Datenauskunft steht bereit",
    ersatzText: "Hallo {{vorname}},\n\n{{link}}",
  });

  await protokolliere({
    aktion: "AUSKUNFT_ERSTELLT",
    objektTyp: "Person",
    objektId: person.id,
    akteurId: benutzer.id,
    // Ohne die Adresse (Code-Review 4, M6c): Sie steht im Versandprotokoll,
    // wo eine Anonymisierung sie erreicht — im unlöschbaren Audit nicht.
    nachher: { gesendet },
    headers: request.headers,
  });

  return erfolg({ gesendet, empfaenger: person.email });
}
