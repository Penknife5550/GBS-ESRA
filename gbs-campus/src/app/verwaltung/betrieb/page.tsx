import type { ReactNode } from "react";
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
import { Inhalt, Seitenkopf } from "@/components/ui/seitenkopf";
import { Abschnitt, Gruppe, Zeile } from "@/components/ui/liste";
import { StatusPunkt } from "@/components/ui/status-punkt";
import { Hinweis } from "@/components/ui/hinweis";
import { knopf } from "@/components/ui/knopf";

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
    <main>
      <Seitenkopf titel="Betrieb" />
      <Inhalt breite="lesen">
        <Abschnitt titel="E-Mail" />
        <Gruppe>
          <LageZeile titel="Nicht zugestellte E-Mails" text="insgesamt">
            {anzahlFehler > 0 ? <StatusPunkt ton="rot">{anzahlFehler}</StatusPunkt> : <StatusPunkt ton="gruen">keine</StatusPunkt>}
          </LageZeile>
          <LageZeile titel="Seit mehr als fünf Minuten wartend" text="Versand begonnen, Ausgang unbekannt">
            {wartend.length > 0 ? (
              <StatusPunkt ton="rot">{wartend.length}</StatusPunkt>
            ) : (
              <StatusPunkt ton="gruen">keine</StatusPunkt>
            )}
          </LageZeile>
          <LageZeile titel="Zuletzt erfolgreich versendet">
            <span className="text-[13px] tabular-nums text-muted-foreground">
              {letzte?.gesendetAm ? datumZeit(letzte.gesendetAm) : "noch keine"}
            </span>
          </LageZeile>
          <LageZeile
            titel="Empfänger für Verwaltungsmeldungen"
            text="Schulleitung oder Verwaltung, Automatik-Mails eingeschaltet"
          >
            {empfaengerVerwaltung === 0 ? (
              <StatusPunkt ton="rot">niemand</StatusPunkt>
            ) : (
              <StatusPunkt ton="gruen">
                {empfaengerVerwaltung === 1 ? "1 Person" : `${empfaengerVerwaltung} Personen`}
              </StatusPunkt>
            )}
          </LageZeile>
        </Gruppe>
        {(anzahlFehler > 0 || wartend.length > 0) && (
          <Hinweis className="mt-3">
            Für alle ohne Passwort ist der Anmeldelink per E-Mail der einzige Weg ins Portal. Wenn hier
            Fehler stehen, kommen die betroffenen Personen nicht hinein — und merken es selbst nicht.
          </Hinweis>
        )}
        {empfaengerVerwaltung === 0 && (
          <Hinweis className="mt-3">
            Niemand bekommt Verwaltungsmeldungen. Wer sich über „Ich komme nicht mehr rein“ meldet, erreicht damit
            keinen Menschen — die Meldung landet nur als Fehlerzeile unten in dieser Liste. Bitte jemandem die Rolle
            Schulleiter oder Verwaltung geben und darauf achten, dass sein Status nicht Automatik-Mails abschaltet
            (etwa AUSGESCHLOSSEN oder VERSTORBEN).
          </Hinweis>
        )}

        <Abschnitt titel="Hintergrunddienst" />
        <Gruppe>
          <LageZeile titel="Worker zuletzt gelaufen" text="Erinnerungen der Semesterüberleitung und Aufräumlauf">
            <StatusPunkt ton={workerAusgefallen ? "rot" : workerFehlerFrisch ? "gelb" : "gruen"}>
              {letzterWorkerLauf ? datumZeit(letzterWorkerLauf.erstelltAm) : "noch nie"}
            </StatusPunkt>
          </LageZeile>
          <LageZeile titel="Zuletzt aufgeräumt" text="löscht abgelaufene Anmeldeentwürfe">
            <StatusPunkt ton={aufraeumenUeberfaellig ? "rot" : "gruen"}>
              {letzterLauf ? datumZeit(letzterLauf.erstelltAm) : "noch nie"}
            </StatusPunkt>
          </LageZeile>
        </Gruppe>
        {workerAusgefallen && (
          <Hinweis className="mt-3">
            Seit über 26 Stunden kein Lebenszeichen des Workers. Ohne ihn gehen keine Erinnerungen zur
            Semesterüberleitung raus, und abgelaufene Anmeldeentwürfe werden nicht gelöscht. Bitte den
            Dienst „worker“ auf dem Server prüfen (Container-Log unter „[WORKER]“).
          </Hinweis>
        )}
        {workerFehlerFrisch && letzterWorkerFehler && (
          <Hinweis className="mt-3">
            Am {datumZeit(letzterWorkerFehler.erstelltAm)} ist ein Lauf gescheitert (
            {letzterWorkerFehler.objektId === "CRON" ? "Cron-Endpunkt" : "Worker"}
            {fehlerTeillaeufe ? `, Teilläufe: ${fehlerTeillaeufe}` : ""}). Einzelheiten stehen im
            Container-Log.
          </Hinweis>
        )}
        {aufraeumenUeberfaellig && (
          <Hinweis className="mt-3">
            Der Aufräumlauf ist die einzige Stelle, die abgelaufene Anmeldeentwürfe mit ihren
            personenbezogenen Angaben löscht (Art. 5 Abs. 1 lit. e DSGVO). Er läuft stündlich im Worker
            und steht im Protokoll, wenn er etwas gelöscht hat, sonst spätestens alle 12 Stunden je
            Herkunft. Fehlt der Eintrag so lange, steht der Grund im Container-Log unter „[WORKER]“
            bzw. „[AUFRAEUMEN]“.
          </Hinweis>
        )}

        <Abschnitt titel="DMS" />
        <Gruppe>
          <LageZeile
            titel="Belege noch nicht im DMS"
            text={`Zahlungsbelege (Honorar-Abrechnung): ${offeneZahlungsbelege} · Honorarsatz-Belege: ${offeneSatzBelege} · Zeugnis-Archivkopien: ${offeneZeugnisse}`}
          >
            {dmsOffen > 0 ? <StatusPunkt ton="rot">{dmsOffen}</StatusPunkt> : <StatusPunkt ton="gruen">keine</StatusPunkt>}
          </LageZeile>
          <LageZeile titel="DMS-Adresse" text="DMS_EMAIL auf dem Server">
            {dmsEingerichtet ? (
              <StatusPunkt ton="gruen">eingerichtet</StatusPunkt>
            ) : (
              <StatusPunkt ton="rot">fehlt</StatusPunkt>
            )}
          </LageZeile>
        </Gruppe>
        {!dmsEingerichtet && (
          <Hinweis className="mt-3">
            Es ist keine DMS-Adresse eingerichtet (DMS_EMAIL). Honorar-Belege und Zeugnis-Archivkopien
            werden erzeugt, aber nicht zugestellt, und bleiben hier als offen stehen. Bitte DMS_EMAIL in
            der .env auf dem Server eintragen und den Server neu starten — danach lassen sie sich
            nachsenden.
          </Hinweis>
        )}
        {dmsEingerichtet && dmsOffen > 0 && (
          <Hinweis className="mt-3">
            Nachsenden können die jeweils Berechtigten: Honorarsatz-Belege unter Honorar → Sätze,
            Zahlungsbelege in der einzelnen Abrechnung (Honorar → Abrechnungen), Zeugnisse unter Noten &amp;
            Zeugnisse („An das DMS nachsenden“). Warum der Versand gescheitert ist, steht unten unter
            „Nicht zugestellt“.
          </Hinweis>
        )}

        <Abschnitt titel="Schutz vor Massenanmeldungen" />
        <Gruppe>
          <LageZeile
            titel="Anmeldeformular: angenommene Anmeldungen"
            text={
              <span className="tabular-nums">
                {anmeldeEingaenge.letzteStunde} / {anmeldeGrenzen.proStunde} in der letzten Stunde ·{" "}
                {anmeldeEingaenge.letzterTag} / {anmeldeGrenzen.proTag} in 24 Stunden
              </span>
            }
          >
            {gesamtgrenzeGegriffen ? (
              <StatusPunkt ton="rot">Gesamtgrenze hat gegriffen</StatusPunkt>
            ) : (
              <StatusPunkt ton="gruen">unter der Grenze</StatusPunkt>
            )}
          </LageZeile>
          <LageZeile
            titel="Abgewiesen in den letzten 24 Stunden"
            text={abweisungen.map((a, i) => (
              <span key={a.aktion}>
                {i > 0 && " · "}
                {a.text}: <span className="tabular-nums">{a.anzahl}</span>
              </span>
            ))}
          />
        </Gruppe>
        {gesamtgrenzeGegriffen && (
          <Hinweis
            className="mt-3"
            aktion={
              <Link href="/verwaltung/einstellungen" className={knopf("sekundaer", "klein")}>
                Einstellungen
              </Link>
            }
          >
            Die Gesamtgrenze hat in den letzten 24 Stunden gegriffen: Das Formular hat Anmeldungen
            abgewiesen, und Schulleitung und Verwaltung wurden per Mail gewarnt. Bitte die zuletzt
            eingegangenen Anmeldungen prüfen. Sind es echte Bewerbungen, lässt sich die Grenze unter
            Einstellungen („Anmeldungen je Stunde“ bzw. „je Tag“) anheben.
          </Hinweis>
        )}

        {wartend.length > 0 && (
          <>
            <Abschnitt titel="Seit mehr als fünf Minuten wartend" />
            <Hinweis
              className="mb-3"
              aktion={
                <Link href="/verwaltung/personen" className={knopf("sekundaer", "klein")}>
                  Personen
                </Link>
              }
            >
              Der Versand wurde begonnen, aber sein Ausgang nie festgehalten — ob die Mail draußen ist, weiß
              niemand. Bitte bei den Betroffenen nachfragen und, wenn nichts ankam, unter Personen einen neuen
              Anmeldelink schicken. Von allein wird aus diesen Zeilen nichts mehr.
            </Hinweis>
            <Gruppe>
              {wartend.map((eintrag) => (
                <VersandZeile key={eintrag.id} am={eintrag.erstelltAm} empfaenger={eintrag.empfaenger} betreff={eintrag.betreff} />
              ))}
            </Gruppe>
          </>
        )}

        {fehlgeschlagen.length > 0 && (
          <>
            <Abschnitt titel="Nicht zugestellt" />
            <Gruppe>
              {fehlgeschlagen.map((eintrag) => (
                <VersandZeile
                  key={eintrag.id}
                  am={eintrag.erstelltAm}
                  empfaenger={eintrag.empfaenger}
                  betreff={eintrag.betreff}
                  fehler={eintrag.fehler}
                />
              ))}
            </Gruppe>
          </>
        )}
      </Inhalt>
    </main>
  );
}

/** Eine Zeile der Betriebslage: links was, rechts der Stand als Punkt mit Wort. */
function LageZeile({ titel, text, children }: { titel: string; text?: ReactNode; children?: ReactNode }) {
  return (
    <Zeile rechts={children}>
      <p className="text-sm font-semibold text-foreground">{titel}</p>
      {text && <p className="text-[13px] text-muted-foreground">{text}</p>}
    </Zeile>
  );
}

/** Eine Mail aus dem Versandprotokoll: Zeitpunkt, Empfänger, Betreff und ggf. der Fehler. */
function VersandZeile({
  am,
  empfaenger,
  betreff,
  fehler,
}: {
  am: Date;
  empfaenger: string;
  betreff: string;
  fehler?: string | null;
}) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:gap-4">
      <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground sm:w-36 sm:pt-px">{datumZeit(am)}</span>
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-medium text-foreground">{empfaenger}</p>
        <p className="break-words text-[13px] text-muted-foreground">{betreff}</p>
        {fehler && <p className="break-words text-[13px] text-muted-foreground">Fehler: {fehler}</p>}
      </div>
    </div>
  );
}
