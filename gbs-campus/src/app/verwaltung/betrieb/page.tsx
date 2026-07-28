import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { MINUTE_MS, RECHT, ROLLE } from "@/lib/constants";

export const dynamic = "force-dynamic";

/**
 * Ab wann eine wartende Mail als hängengeblieben gilt.
 *
 * `sendeMail` legt zuerst eine Zeile mit WARTEND an und setzt danach das
 * Ergebnis. Zwischen beiden Schritten liegt der Versand — also Sekunden. Fünf
 * Minuten sind großzügig genug, dass ein gerade laufender Versand hier nicht
 * auftaucht, und kurz genug, dass ein abgestürzter Prozess noch am selben Tag
 * auffällt.
 */
const WARTEND_GRENZE_MS = 5 * MINUTE_MS;

/** Ab wann der Aufräumlauf als überfällig gilt — er läuft höchstens stündlich. */
const AUFRAEUMEN_GRENZE_MS = 48 * 60 * MINUTE_MS;

/**
 * Betriebsansicht für den Mailversand.
 *
 * Der Grund für diese Seite: Fehlgeschlagene Mails wurden zwar sauber in
 * `email_versand` protokolliert — aber keine Oberfläche las diese Tabelle. Fiel
 * SMTP aus, kam niemand mehr ins Portal (der Magic-Link ist der einzige Zugang),
 * alle sahen die beruhigende Meldung „Link ist unterwegs", und die einzige Spur
 * war ein `console.error` im Container-Log, das bei einem Ein-Personen-Betrieb
 * niemand liest.
 *
 * Nach demselben Leitsatz stehen hier drei weitere Dinge, die es vorher nur im
 * Log oder gar nicht gab: hängengebliebene WARTEND-Zeilen, die Zahl der
 * Personen, die Verwaltungsmeldungen überhaupt erreichen, und der letzte
 * Aufräumlauf.
 */
export default async function BetriebSeite() {
  const benutzer = await ladeMitRecht(RECHT.SYSTEM_EINSTELLUNGEN);
  if (!benutzer) redirect("/anmelden");

  const jetzt = Date.now();

  const [fehlgeschlagen, wartend, letzte, anzahlFehler, empfaengerVerwaltung, letzterLauf] = await Promise.all([
    prisma.emailVersand.findMany({
      where: { status: { in: ["FEHLER", "BOUNCE"] } },
      orderBy: { erstelltAm: "desc" },
      take: 50,
      select: { id: true, empfaenger: true, betreff: true, status: true, fehler: true, erstelltAm: true },
    }),
    prisma.emailVersand.findMany({
      where: { status: "WARTEND", erstelltAm: { lt: new Date(jetzt - WARTEND_GRENZE_MS) } },
      orderBy: { erstelltAm: "desc" },
      take: 50,
      select: { id: true, empfaenger: true, betreff: true, erstelltAm: true },
    }),
    prisma.emailVersand.findFirst({
      where: { status: "GESENDET" },
      orderBy: { gesendetAm: "desc" },
      select: { gesendetAm: true },
    }),
    prisma.emailVersand.count({ where: { status: { in: ["FEHLER", "BOUNCE"] } } }),
    // Wer bekommt die Meldungen aus dem Hilfeformular und die Hinweise auf neue
    // Anmeldungen? Dieselbe Bedingung wie in `lib/verteiler.ts`. Steht hier eine
    // 0, geht jede Verwaltungsmeldung ins Leere — sichtbar wird das sonst erst
    // hinterher an einer FEHLER-Zeile „(kein Empfänger)".
    prisma.person.count({
      where: {
        rollen: { some: { rolleCode: { in: [ROLLE.SCHULLEITER, ROLLE.VERWALTUNG] } } },
        status: { automatikMails: true },
      },
    }),
    prisma.auditLog.findFirst({
      where: { aktion: "AUFRAEUMEN_GELAUFEN" },
      orderBy: { erstelltAm: "desc" },
      select: { erstelltAm: true },
    }),
  ]);

  const aufraeumenUeberfaellig =
    !letzterLauf || jetzt - letzterLauf.erstelltAm.getTime() > AUFRAEUMEN_GRENZE_MS;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/verwaltung" className="text-sm text-muted-foreground underline underline-offset-4">
        ← Verwaltung
      </Link>

      <h1 className="mt-6 text-2xl font-bold tracking-tight">Betrieb</h1>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Der Anmeldelink per E-Mail ist der einzige Weg ins Portal. Wenn hier Fehler stehen, kommen die
        betroffenen Personen nicht hinein — und merken es selbst nicht.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-5">
          <p className={`text-3xl font-bold leading-none ${anzahlFehler > 0 ? "text-credo-rot" : ""}`}>
            {anzahlFehler}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">nicht zugestellte E-Mails insgesamt</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-lg font-semibold leading-tight">
            {letzte?.gesendetAm
              ? letzte.gesendetAm.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })
              : "noch keine"}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">zuletzt erfolgreich versendet</p>
        </div>

        <div
          className={`rounded-lg border bg-card p-5 ${
            empfaengerVerwaltung === 0 ? "border-credo-rot/50" : "border-border"
          }`}
        >
          <p className={`text-3xl font-bold leading-none ${empfaengerVerwaltung === 0 ? "text-credo-rot" : ""}`}>
            {empfaengerVerwaltung}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Empfänger für Verwaltungsmeldungen (Schulleitung oder Verwaltung, Automatik-Mails
            eingeschaltet)
          </p>
          {empfaengerVerwaltung === 0 && (
            <p className="mt-3 text-xs text-credo-rot">
              Niemand bekommt Verwaltungsmeldungen. Wer sich über „Ich komme nicht mehr rein" meldet,
              erreicht damit keinen Menschen — die Meldung landet nur als Fehlerzeile unten in dieser
              Liste. Bitte jemandem die Rolle Schulleiter oder Verwaltung geben und darauf achten, dass
              sein Status nicht Automatik-Mails abschaltet (etwa AUSGESCHLOSSEN oder VERSTORBEN).
            </p>
          )}
        </div>

        <div
          className={`rounded-lg border bg-card p-5 ${
            aufraeumenUeberfaellig ? "border-credo-rot/50" : "border-border"
          }`}
        >
          <p className={`text-lg font-semibold leading-tight ${aufraeumenUeberfaellig ? "text-credo-rot" : ""}`}>
            {letzterLauf
              ? letzterLauf.erstelltAm.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })
              : "noch nie"}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">zuletzt aufgeräumt</p>
          {aufraeumenUeberfaellig && (
            <p className="mt-3 text-xs text-credo-rot">
              Der Aufräumlauf ist die einzige Stelle, die abgelaufene Anmeldeentwürfe mit ihren
              personenbezogenen Angaben löscht (Art. 5 Abs. 1 lit. e DSGVO). Er hängt an der Anforderung
              eines Anmeldelinks — kommt lange keine, läuft er auch nicht. Bleibt das trotz Anmeldungen
              so, steht der Grund im Container-Log unter „[AUFRAEUMEN]".
            </p>
          )}
        </div>
      </div>

      <h2 className="mt-10 text-lg font-semibold">Seit mehr als fünf Minuten wartend</h2>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        „Wartend" heißt: Der Versand wurde begonnen, aber sein Ausgang nie festgehalten — der Prozess
        ist dazwischen gestorben (Neustart, Deploy, Speichermangel) oder die Datenbank hat den Abschluss
        nicht mehr angenommen. Ob die Mail draußen ist, weiß niemand. Bei einem Anmeldelink ist das der
        unangenehmste Fall: Er kann angekommen sein — oder jemand wartet vergeblich vor der Tür.
      </p>
      {wartend.length === 0 ? (
        <p className="mt-4 rounded-lg border border-credo-gruen/40 bg-credo-gruen/5 px-4 py-6 text-center text-sm">
          Keine hängengebliebene E-Mail.
        </p>
      ) : (
        <>
          <p className="mt-4 max-w-prose text-sm">
            Zu tun: bei den Betroffenen nachfragen, ob etwas angekommen ist. Wenn nicht, unter{" "}
            <Link href="/verwaltung/personen" className="underline underline-offset-4">
              Verwaltung → Personen
            </Link>{" "}
            einen neuen Anmeldelink schicken. Von allein wird aus diesen Zeilen nichts mehr.
          </p>
          <ul className="mt-4 divide-y divide-border rounded-lg border border-credo-rot/40 bg-card">
            {wartend.map((eintrag) => (
              <li key={eintrag.id} className="px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{eintrag.empfaenger}</span>
                  <span className="text-xs text-muted-foreground">
                    {eintrag.erstelltAm.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{eintrag.betreff}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="mt-10 text-lg font-semibold">Nicht zugestellt</h2>
      {fehlgeschlagen.length === 0 ? (
        <p className="mt-4 rounded-lg border border-credo-gruen/40 bg-credo-gruen/5 px-4 py-6 text-center text-sm">
          Alle E-Mails wurden zugestellt.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-card">
          {fehlgeschlagen.map((eintrag) => (
            <li key={eintrag.id} className="px-5 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{eintrag.empfaenger}</span>
                <span className="text-xs text-muted-foreground">
                  {eintrag.erstelltAm.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{eintrag.betreff}</p>
              {eintrag.fehler && <p className="mt-1 text-xs text-credo-rot">{eintrag.fehler}</p>}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
