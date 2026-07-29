import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler, keineBerechtigung } from "@/lib/api";
import { RECHT, STATUS, MAIL_VORLAGE } from "@/lib/constants";
import { pruefeNeueEmail } from "@/lib/eigene-daten";
import { fuelleVorlage, sendeMail } from "@/lib/mailer";
import { gueltigkeitAlsText } from "@/lib/magic-link";
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
  const benutzer = await ladeMitRecht(RECHT.PERSON_EXPORTIEREN);
  if (!benutzer) return keineBerechtigung();

  const { id } = await kontext.params;
  const person = await prisma.person.findUnique({ where: { id }, include: { status: true } });
  if (!person) return fehler("Diese Person gibt es nicht.", 404);

  // Verstorbene: keine Auskunft an das Postfach. Das Auskunftsrecht endet mit dem
  // Tod, und eine Mail an das Postfach eines Verstorbenen wäre unangemessen.
  // Andere Endzustände (ausgeschlossen, abgebrochen, Absolvent) bleiben zulässig:
  // Das sind lebende Personen mit fortbestehendem Recht auf ihre Daten.
  if (person.statusCode === STATUS.VERSTORBEN) {
    return fehler("Für ein als verstorben geführtes Konto wird keine Datenauskunft verschickt.", 409);
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
  // Reverse Proxy — anders als beim Anmeldelink, wo dieser Punkt noch offen ist
  // (UEBERGABE.md). Ein Link-Scanner, der die URL vorab abruft, bekommt den
  // Token ebenfalls nicht zu sehen. Die Abrufseite liest ihn clientseitig.
  const link = `${basis}/auskunft/token#token=${token}`;

  const vorlage = await prisma.emailVorlage.findUnique({ where: { code: MAIL_VORLAGE.AUSKUNFT_BEREIT } });
  const werte = { vorname: person.vorname, link, gueltigkeit: gueltigkeitAlsText(AUSKUNFT_GUELTIG_MINUTEN) };

  const { gesendet } = await sendeMail({
    an: person.email,
    personId: person.id,
    vorlageCode: MAIL_VORLAGE.AUSKUNFT_BEREIT,
    betreff: fuelleVorlage(vorlage?.betreff ?? "Deine Datenauskunft steht bereit", werte),
    text: fuelleVorlage(vorlage?.textMd ?? "Hallo {{vorname}},\n\n{{link}}", werte),
  });

  await protokolliere({
    aktion: "AUSKUNFT_ERSTELLT",
    objektTyp: "Person",
    objektId: person.id,
    akteurId: benutzer.id,
    nachher: { empfaenger: person.email, gesendet },
    headers: request.headers,
  });

  return erfolg({ gesendet, empfaenger: person.email });
}
