import { NextRequest } from "next/server";
import { z } from "zod";
import { erfolg, fehler } from "@/lib/api";
import { protokolliere } from "@/lib/audit";
import { zahl } from "@/lib/einstellungen";
import { drosselUeberschritten } from "@/lib/magic-link";
import { ermittleRequestKontext } from "@/lib/request-kontext";
import { ROLLE } from "@/lib/constants";
import { sendeAnRollen } from "@/lib/verteiler";
import { hilfeMeldung, hilfeWerte, pruefeHilfeAnfrage } from "@/lib/zugang-hilfe";

/**
 * Obergrenzen für die einzelnen Felder — dieselben Werte wie in
 * `@/lib/zugang-hilfe`. Sie stehen hier ein zweites Mal, weil die fachliche
 * Prüfung erst nach `request.json()` läuft: Ohne Grenze im Schema hätte ein
 * einzelner Aufruf mit einem Megabyte im Vornamen den Speicher belegt, bevor
 * überhaupt jemand hinsieht.
 */
const schema = z.object({
  vorname: z.string().max(80),
  nachname: z.string().max(80),
  bisherigeEmail: z.string().max(120).nullish(),
  erreichbarEmail: z.string().max(120).nullish(),
  erreichbarTelefon: z.string().max(30).nullish(),
  nachricht: z.string().max(1000).nullish(),
});

/**
 * Grenze für den gesamten Anfragerumpf. `request.json()` liest alles in den
 * Speicher, bevor irgendeine Prüfung greift. 64 KB sind für sechs kurze Felder
 * großzügig und für einen Speicherangriff zu wenig.
 *
 * Fehlt die Kopfzeile (chunked), greift die Grenze nicht — dann fangen die
 * Feldgrenzen im Schema den Rest ab.
 */
const MAX_RUMPF_BYTES = 64 * 1024;

/**
 * Vorlage für die Meldung. Der Code darf in `email_vorlagen` fehlen: Dann
 * greifen `ersatzBetreff`/`ersatzText`, und die Meldung geht trotzdem raus.
 */
const VORLAGE_CODE = "ZUGANG_HILFE_MELDUNG";

/**
 * Meldung „Ich komme nicht mehr ins Portal".
 *
 * Öffentlich, ohne Anmeldung — es ist ja gerade die Situation, in der niemand
 * hineinkommt. Entsprechend zurückhaltend:
 *
 *  - **Ändert nichts.** Keine Adresse, kein Konto, kein Link. Die Meldung geht
 *    an Menschen, die die Person erkennen können.
 *  - **Verrät nichts.** Die Antwort ist immer dieselbe, egal ob es die Person
 *    gibt. Sonst wäre der Endpunkt eine Auskunft darüber, wer die Bibelschule
 *    besucht — eine Angabe zur Religionszugehörigkeit (Art. 9 DSGVO).
 *  - **Gedrosselt, doppelt.** Sonst ließe sich das Postfach der Schulleitung
 *    fluten.
 *  - **Sagt die Wahrheit.** Erreicht die Meldung niemanden, steht das in der
 *    Antwort. Ein freundliches „ist eingegangen" wäre hier die schlimmste
 *    Auskunft: Der Absender ist ausgesperrt und wartete auf eine Antwort, die
 *    nie kommt.
 */
export async function POST(request: NextRequest) {
  const { ipAdresse, userAgent } = ermittleRequestKontext(request.headers);

  const laenge = Number(request.headers.get("content-length"));
  if (Number.isFinite(laenge) && laenge > MAX_RUMPF_BYTES) {
    return fehler("Die Anfrage ist zu groß.", 413);
  }

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);

  const ergebnis = pruefeHilfeAnfrage(geprueft.data);
  if (!ergebnis.ok) return fehler("Bitte prüfe die markierten Felder.", 400, ergebnis.meldungen);

  // Eigene Schlüssel und nicht die des Anmeldelinks: Jede Meldung hier erzeugt
  // Mails an ALLE in Schulleitung und Verwaltung. Mit dem Wert des Anmeldelinks
  // (20 je Anschluss und Stunde) und einem Dutzend Anschlüssen wäre der
  // Zustellruf der Absenderdomain in einer Nacht ruiniert — und danach landet
  // der Anmeldelink selbst im Spam-Ordner.
  const [maxProIp, maxGesamt, fensterMinuten] = await Promise.all([
    zahl("ZUGANG_HILFE_MAX_PRO_IP"),
    zahl("ZUGANG_HILFE_MAX_GESAMT"),
    zahl("AUTH_DROSSEL_FENSTER_MINUTEN"),
  ]);

  // Ohne erkennbare Herkunft wird abgewiesen statt durchgelassen — dieselbe
  // Linie wie beim öffentlichen Anmeldeformular. Die Gesamtgrenze steht
  // absichtlich hinter der Anschlussgrenze: Ein bereits gesperrter Anschluss
  // soll das gemeinsame Kontingent nicht auch noch aufbrauchen.
  const gedrosselt =
    !ipAdresse ||
    (await drosselUeberschritten(`ZUGANG_HILFE_IP:${ipAdresse}`, maxProIp, fensterMinuten)) ||
    (await drosselUeberschritten("ZUGANG_HILFE_GESAMT", maxGesamt, fensterMinuten));

  if (gedrosselt) {
    await protokolliere({
      aktion: "ZUGANG_HILFE_GEDROSSELT",
      objektTyp: "Person",
      quelle: "SYSTEM",
      ipAdresse,
      userAgent,
    });
    return fehler(
      "Zu viele Meldungen in kurzer Zeit. Bitte versuche es später noch einmal — oder melde dich " +
        "telefonisch bei der Schule, damit dir jemand direkt weiterhilft.",
      429,
    );
  }

  const { werte } = ergebnis;

  // An Schulleitung UND Verwaltung: Wer ausgesperrt ist, darf nicht warten
  // müssen, bis eine bestimmte Person wieder am Schreibtisch sitzt. Der
  // Verteiler hinterlässt auch dann eine sichtbare Spur in `email_versand`,
  // wenn es niemanden mit diesen Rollen gibt.
  const versand = await sendeAnRollen({
    rollen: [ROLLE.SCHULLEITER, ROLLE.VERWALTUNG],
    vorlageCode: VORLAGE_CODE,
    werte: hilfeWerte(werte),
    ersatzBetreff: `Kommt nicht ins Portal: ${werte.vorname} ${werte.nachname}`,
    ersatzText: hilfeMeldung(werte),
  });

  // Bewusst OHNE die Angaben aus dem Formular: Hier trägt ein Unangemeldeter
  // Namen, zwei Adressen und eine Telefonnummer beliebiger Dritter ein, und das
  // Audit-Log ist per Trigger unlöschbar — ein Löschbegehren nach Art. 17 DSGVO
  // ließe sich dafür nicht erfüllen. Der Inhalt steht ohnehin in der Mail und
  // in `email_versand`; hier reichen das Ereignis und die Zustellzahlen.
  await protokolliere({
    aktion: "ZUGANG_HILFE_GEMELDET",
    objektTyp: "Person",
    quelle: "SYSTEM",
    nachher: { empfaenger: versand.empfaenger, gesendet: versand.gesendet },
    ipAdresse,
    userAgent,
  });

  return erfolg({
    hinweis:
      versand.gesendet > 0
        ? "Deine Meldung ist bei der Schulleitung eingegangen. Wir melden uns bei dir — in der Regel innerhalb weniger Tage."
        : "Deine Meldung wurde aufgenommen, konnte aber gerade nicht an die Schulleitung zugestellt werden. " +
          "Bitte melde dich zusätzlich telefonisch bei der Schule — sonst erreicht dich möglicherweise keine Antwort.",
  });
}
