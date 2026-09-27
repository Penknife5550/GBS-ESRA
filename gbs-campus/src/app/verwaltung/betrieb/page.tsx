import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { MINUTE_MS, RECHT, ROLLE, STUNDE_MS } from "@/lib/constants";
import { datumZeit } from "@/lib/datum";
import { dmsAdresse } from "@/lib/konfiguration";
import { zaehleOffeneDmsArchivierungen } from "@/lib/zeugnis-io";
import { SCHLUESSEL_EINGANG } from "@/lib/anmelde-schutz";
import { ladeGesamtgrenzen, zaehlstand } from "@/lib/anmelde-schutz-io";
import { ZurueckLeiste } from "@/components/ui/zurueck-leiste";

/**
 * Die Abweisungen des öffentlichen Anmeldeformulars (lib/anmelde-schutz.ts) in
 * der Reihenfolge der Schutzschichten — die Audit-Aktionen aus
 * api/anmeldung/route.ts.
 */
const ANMELDESCHUTZ_AKTIONEN = [
  { aktion: "ANMELDUNG_GESAMT_GEDROSSELT", text: "Gesamtgrenze" },
  { aktion: "ANMELDUNG_GEDROSSELT", text: "je Anschluss" },
  { aktion: "ANMELDUNG_ABGEWIESEN_STEMPEL", text: "Mindestdauer" },
  { aktion: "ANMELDUNG_VERWORFEN_FANGFELD", text: "Fangfeld" },
] as const;

export const metadata = { title: "Betrieb" };
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
const AUFRAEUMEN_GRENZE_MS = 48 * STUNDE_MS;

/**
 * Ab wann der Worker als ausgefallen gilt. Er schreibt sein Lebenszeichen ins
 * Protokoll bei jeder Löschung, sonst spätestens alle 12 Stunden
 * (HEARTBEAT_ABSTAND_MS) — 26 Stunden heißen also: mindestens zwei
 * Lebenszeichen fehlen. Dieselbe Grenze gilt für einen gescheiterten Lauf;
 * „jünger als das letzte Lebenszeichen" bliebe nach einem einmaligen Fehler bis
 * zu 12 Stunden rot.
 */
const WORKER_GRENZE_MS = 26 * STUNDE_MS;

/**
 * Betriebsansicht für den Mailversand.
 *
 * Der Grund für diese Seite: Fehlgeschlagene Mails wurden zwar sauber in
 * `email_versand` protokolliert — aber keine Oberfläche las diese Tabelle. Fiel
 * SMTP aus, kam niemand mehr ins Portal (damals war der Magic-Link der einzige Zugang),
 * alle sahen die beruhigende Meldung „Link ist unterwegs", und die einzige Spur
 * war ein `console.error` im Container-Log, das bei einem Ein-Personen-Betrieb
 * niemand liest.
 *
 * Nach demselben Leitsatz stehen hier drei weitere Dinge, die es vorher nur im
 * Log oder gar nicht gab: hängengebliebene WARTEND-Zeilen, die Zahl der
 * Personen, die Verwaltungsmeldungen überhaupt erreichen, und der letzte
 * Aufräumlauf. Dazu die Belege, die noch nicht beim DMS angekommen sind
 * (Honorarsatz, Zahlungsbeleg, Zeugnis-Archivkopie) samt fehlender DMS_EMAIL —
 * die Meldungen dieser Bereiche verweisen hierher.
 */
export default async function BetriebSeite() {
  const benutzer = await ladeMitRecht(RECHT.SYSTEM_EINSTELLUNGEN);
  if (!benutzer) redirect("/anmelden");

  const jetzt = Date.now();

  const [
    fehlgeschlagen,
    wartend,
    letzte,
    anzahlFehler,
    empfaengerVerwaltung,
    letzterLauf,
    offeneZahlungsbelege,
    offeneSatzBelege,
    offeneZeugnisse,
    letzterWorkerLauf,
    letzterWorkerFehler,
    anmeldeEingaenge,
    anmeldeGrenzen,
    anmeldeAbweisungen,
  ] = await Promise.all([
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
    // Offene DMS-Belege — dieselben Bedingungen wie die Nachsende-Knöpfe
    // (pruefeAbrechnungNachversand / pruefeSatzNachversand in
    // lib/honorar-korrektur.ts, offenImDms in lib/zeugnis-io.ts).
    prisma.honorarAbrechnung.count({
      where: { status: { not: "OFFEN" }, belegNr: { not: null }, dmsGesendetAm: null },
    }),
    prisma.honorarSatz.count({ where: { dmsBelegNr: { not: null }, dmsGesendetAm: null } }),
    zaehleOffeneDmsArchivierungen(),
    // Lebenszeichen des Workers (scripts/worker.ts) — getrennt von den
    // gelegentlichen Läufen der App (objektId APP).
    prisma.auditLog.findFirst({
      where: { aktion: "AUFRAEUMEN_GELAUFEN", objektTyp: "System", objektId: "WORKER" },
      orderBy: { erstelltAm: "desc" },
      select: { erstelltAm: true },
    }),
    // Gescheiterte Teilläufe aus Worker oder Cron-Endpunkt; `nachher` trägt nur
    // die Namen der Teilläufe, keine Fehlermeldung.
    prisma.auditLog.findFirst({
      where: { aktion: "WORKER_LAUF_FEHLGESCHLAGEN" },
      orderBy: { erstelltAm: "desc" },
      select: { erstelltAm: true, objektId: true, nachher: true },
    }),
    // Schutz des Anmeldeformulars: angenommene Einreichungen gegen die
    // Gesamtgrenzen und die Abweisungen der letzten 24 Stunden je Schicht.
    zaehlstand(SCHLUESSEL_EINGANG, new Date(jetzt)),
    ladeGesamtgrenzen(),
    prisma.auditLog.groupBy({
      by: ["aktion"],
      where: {
        aktion: { in: ANMELDESCHUTZ_AKTIONEN.map((a) => a.aktion) },
        erstelltAm: { gte: new Date(jetzt - 24 * STUNDE_MS) },
      },
      _count: { _all: true },
    }),
  ]);

  const aufraeumenUeberfaellig =
    !letzterLauf || jetzt - letzterLauf.erstelltAm.getTime() > AUFRAEUMEN_GRENZE_MS;
  const workerAusgefallen =
    !letzterWorkerLauf || jetzt - letzterWorkerLauf.erstelltAm.getTime() > WORKER_GRENZE_MS;
  const workerFehlerFrisch =
    letzterWorkerFehler !== null && jetzt - letzterWorkerFehler.erstelltAm.getTime() <= WORKER_GRENZE_MS;
  const fehlerTeillaeufe = (() => {
    const nachher = letzterWorkerFehler?.nachher as { teillaeufe?: unknown } | null | undefined;
    return Array.isArray(nachher?.teillaeufe) ? nachher.teillaeufe.map(String).join(", ") : "";
  })();
  const dmsOffen = offeneZahlungsbelege + offeneSatzBelege + offeneZeugnisse;
  const dmsEingerichtet = dmsAdresse() !== null;
  const abweisungen = ANMELDESCHUTZ_AKTIONEN.map((a) => ({
    ...a,
    anzahl: anmeldeAbweisungen.find((g) => g.aktion === a.aktion)?._count._all ?? 0,
  }));
  const gesamtgrenzeGegriffen = (abweisungen.find((a) => a.aktion === "ANMELDUNG_GESAMT_GEDROSSELT")?.anzahl ?? 0) > 0;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <ZurueckLeiste href="/verwaltung" label="Verwaltung" breadcrumb="Verwaltung · Betrieb" />

      <h1 className="mt-6 text-2xl font-bold tracking-tight">Betrieb</h1>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Für alle ohne Passwort ist der Anmeldelink per E-Mail der einzige Weg ins Portal. Wenn hier
        Fehler stehen, kommen die betroffenen Personen nicht hinein — und merken es selbst nicht.
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
              ? datumZeit(letzte.gesendetAm)
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
              ? datumZeit(letzterLauf.erstelltAm)
              : "noch nie"}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">zuletzt aufgeräumt</p>
          {aufraeumenUeberfaellig && (
            <p className="mt-3 text-xs text-credo-rot">
              Der Aufräumlauf ist die einzige Stelle, die abgelaufene Anmeldeentwürfe mit ihren
              personenbezogenen Angaben löscht (Art. 5 Abs. 1 lit. e DSGVO). Er läuft stündlich im Worker
              und steht im Protokoll, wenn er etwas gelöscht hat, sonst spätestens alle 12 Stunden je
              Herkunft. Fehlt der Eintrag so lange, steht der Grund im Container-Log unter „[WORKER]"
              bzw. „[AUFRAEUMEN]".
            </p>
          )}
        </div>

        <div
          className={`rounded-lg border bg-card p-5 sm:col-span-2 ${
            workerAusgefallen || workerFehlerFrisch ? "border-credo-rot/50" : "border-border"
          }`}
        >
          <p className={`text-lg font-semibold leading-tight ${workerAusgefallen ? "text-credo-rot" : ""}`}>
            {letzterWorkerLauf ? datumZeit(letzterWorkerLauf.erstelltAm) : "noch nie"}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Worker zuletzt gelaufen (Erinnerungen der Semesterüberleitung und Aufräumlauf)
          </p>
          {workerAusgefallen && (
            <p className="mt-3 text-xs text-credo-rot">
              Seit über 26 Stunden kein Lebenszeichen des Workers. Ohne ihn gehen keine Erinnerungen zur
              Semesterüberleitung raus, und abgelaufene Anmeldeentwürfe werden nicht gelöscht. Bitte den
              Dienst „worker" auf dem Server prüfen (Container-Log unter „[WORKER]").
            </p>
          )}
          {workerFehlerFrisch && letzterWorkerFehler && (
            <p className="mt-3 text-xs text-credo-rot">
              Am {datumZeit(letzterWorkerFehler.erstelltAm)} ist ein Lauf gescheitert (
              {letzterWorkerFehler.objektId === "CRON" ? "Cron-Endpunkt" : "Worker"}
              {fehlerTeillaeufe ? `, Teilläufe: ${fehlerTeillaeufe}` : ""}). Einzelheiten stehen im
              Container-Log.
            </p>
          )}
        </div>

        <div
          className={`rounded-lg border bg-card p-5 sm:col-span-2 ${
            dmsOffen > 0 || !dmsEingerichtet ? "border-credo-rot/50" : "border-border"
          }`}
        >
          <p className={`text-3xl font-bold leading-none ${dmsOffen > 0 ? "text-credo-rot" : ""}`}>{dmsOffen}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Belege noch nicht im DMS — Zahlungsbelege (Honorar-Abrechnung): {offeneZahlungsbelege} ·
            Honorarsatz-Belege: {offeneSatzBelege} · Zeugnis-Archivkopien: {offeneZeugnisse}
          </p>
          {!dmsEingerichtet && (
            <p className="mt-3 text-xs text-credo-rot">
              Es ist keine DMS-Adresse eingerichtet (DMS_EMAIL). Honorar-Belege und Zeugnis-Archivkopien
              werden erzeugt, aber nicht zugestellt, und bleiben hier als offen stehen. Bitte DMS_EMAIL in
              der .env auf dem Server eintragen und den Server neu starten — danach lassen sie sich
              nachsenden.
            </p>
          )}
          {dmsEingerichtet && dmsOffen > 0 && (
            <p className="mt-3 text-xs text-credo-rot">
              Nachsenden können die jeweils Berechtigten: Honorarsatz-Belege unter Dozentenhonorar →
              Honorarsätze, Zahlungsbelege in der einzelnen Abrechnung (Dozentenhonorar →
              Honorar-Abrechnungen), Zeugnisse unter Zeugnisse („An das DMS nachsenden"). Warum der Versand
              gescheitert ist, steht unten unter „Nicht zugestellt".
            </p>
          )}
        </div>

        <div
          className={`rounded-lg border bg-card p-5 sm:col-span-2 ${
            gesamtgrenzeGegriffen ? "border-credo-rot/50" : "border-border"
          }`}
        >
          <p className="text-lg font-semibold leading-tight tabular-nums">
            {anmeldeEingaenge.letzteStunde} / {anmeldeGrenzen.proStunde} in der letzten Stunde ·{" "}
            {anmeldeEingaenge.letzterTag} / {anmeldeGrenzen.proTag} in 24 Stunden
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Anmeldeformular: angenommene Anmeldungen gegen die Gesamtgrenzen. Abgewiesen in den letzten
            24 Stunden —{" "}
            {abweisungen.map((a, i) => (
              <span key={a.aktion}>
                {i > 0 && " · "}
                {a.text}: <span className="tabular-nums">{a.anzahl}</span>
              </span>
            ))}
          </p>
          {gesamtgrenzeGegriffen && (
            <p className="mt-3 text-xs text-credo-rot">
              Die Gesamtgrenze hat in den letzten 24 Stunden gegriffen: Das Formular hat Anmeldungen
              abgewiesen, und Schulleitung und Verwaltung wurden per Mail gewarnt. Bitte die zuletzt
              eingegangenen Anmeldungen prüfen. Sind es echte Bewerbungen, lässt sich die Grenze unter
              Verwaltung → Einstellungen („Anmeldungen je Stunde“ bzw. „je Tag“) anheben.
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
                    {datumZeit(eintrag.erstelltAm)}
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
                  {datumZeit(eintrag.erstelltAm)}
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
