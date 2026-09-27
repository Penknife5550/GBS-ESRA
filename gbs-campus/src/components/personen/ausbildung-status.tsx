"use client";

/**
 * GBS Campus — Ausbildungsdaten & Status in der Personen-Detailakte
 *
 * Code-Review 4 (M9): Status, Geburtsdatum, Gemeinde und Teilnahmeform ließen
 * sich nachträglich nirgends ändern, obwohl mehrere Texte auf „eine andere
 * Stelle" verwiesen — ein Tippfehler im Geburtsdatum stand unkorrigierbar auf
 * jedem Zeugnis, und der Not-Aus VERSTORBEN griff nie. Hier ist diese Stelle.
 *
 * Nur mit PERSON_STATUS_WECHSELN (Schulleitung) eingeblendet; die Rechte prüft
 * der Server ohnehin. Dieselben Muster wie `person-aktionen.tsx`:
 * `sendeAnfrage` + `router.refresh()`, Rückfrage vor folgenreichen Änderungen.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { STATUS } from "@/lib/constants";
import { teilnahmeformName } from "@/lib/semester";
import { brauchtGrund, GEMEINDE_MAX_LAENGE, GRUND_MAX_LAENGE, MELDUNG_ANMELDUNG_OFFEN } from "@/lib/status";
import { MeldungsBox, type Meldung } from "@/components/ui/meldung";

export type StatusZiel = { code: string; bezeichnung: string; istTerminal: boolean; istAktiv: boolean };

/** „die Teilnahme im A" bzw. „die Teilnahmen im A und im B" — für die Hinweise zu den offenen Teilnahmen. */
function teilnahmenText(semester: string[]): string {
  const mitIm = semester.map((s) => `im ${s}`);
  const liste = mitIm.length <= 1 ? mitIm.join("") : `${mitIm.slice(0, -1).join(", ")} und ${mitIm[mitIm.length - 1]}`;
  return `${mitIm.length === 1 ? "die Teilnahme" : "die Teilnahmen"} ${liste}`;
}

export function AusbildungStatus({
  personId,
  name,
  status,
  ziele,
  eigeneAkte,
  offeneAnmeldung,
  daten,
  offeneSemester,
  laufendesSemester,
  art9Eingewilligt,
}: {
  personId: string;
  name: string;
  status: { code: string; bezeichnung: string; istTerminal: boolean; istAktiv: boolean };
  /** Bereits nach den Regeln aus `status.ts` gefiltert (`waehlbareZiele`). */
  ziele: StatusZiel[];
  /** Die eigene Akte: Den eigenen Status ändert eine andere Schulleitungsperson. */
  eigeneAkte: boolean;
  /** Eine eingereichte Anmeldung ist noch nicht entschieden — erst dort entscheiden. */
  offeneAnmeldung: boolean;
  /** Geburtsdatum als „JJJJ-MM-TT" oder leer. */
  daten: { geburtsdatum: string; gemeinde: string; teilnahmeform: string };
  /**
   * Semester der offenen Teilnahmen (laufend und noch nicht begonnen) — für sie
   * gilt ein Wechsel der Teilnahmeform mit. Abgemeldete stehen mit dem Zusatz
   * „(abgemeldet)“ darin: Sie gehen mit, damit nach einer Wiederaufnahme nicht
   * die alte Form gilt.
   */
  offeneSemester: string[];
  /** Bezeichnung des laufenden Semesters, wenn die Person dort eine zählende Teilnahme hat. */
  laufendesSemester: string | null;
  art9Eingewilligt: boolean;
}) {
  const router = useRouter();
  const [werte, setWerte] = useState(daten);
  const [ziel, setZiel] = useState("");
  const [grund, setGrund] = useState("");
  const [laeuft, setLaeuft] = useState<null | "daten" | "status">(null);
  const [meldung, setMeldung] = useState<Meldung | null>(null);
  const beschaeftigt = laeuft !== null;

  const datenGeaendert =
    werte.geburtsdatum !== daten.geburtsdatum || werte.gemeinde !== daten.gemeinde || werte.teilnahmeform !== daten.teilnahmeform;
  const zielStatus = ziele.find((z) => z.code === ziel) ?? null;
  // Auch das Verlassen von „Abgebrochen“ (Wiederaufnahme) braucht einen Grund.
  const grundNoetig = zielStatus ? brauchtGrund(zielStatus.code, status.code) : false;
  const wiederaufnahme = status.code === STATUS.ABGEBROCHEN;

  async function datenSpeichern() {
    // Ein Formwechsel im laufenden Semester hat Folgen, die man der Auswahl
    // nicht ansieht: Hörer werden nicht benotet, und statt eines Zeugnisses
    // gibt es eine Teilnahmebescheinigung.
    if (werte.teilnahmeform !== daten.teilnahmeform && werte.teilnahmeform !== "" && laufendesSemester) {
      const neu = teilnahmeformName(werte.teilnahmeform);
      const frage =
        `Die Teilnahmeform von ${name} auf „${neu}“ ändern?\n\n` +
        `Das gilt auch für ${teilnahmenText(offeneSemester)}. ` +
        (werte.teilnahmeform === "HOERER"
          ? "Hörer werden nicht benotet: Bereits erfasste Noten dieses Semesters erscheinen dann nicht mehr " +
            "in Notenliste und Akte, und statt eines Semesterzeugnisses gibt es eine Teilnahmebescheinigung."
          : "Schüler werden benotet und bekommen statt einer Teilnahmebescheinigung ein Semesterzeugnis — " +
            "die Noten dieses Semesters müssen dann erfasst werden.") +
        "\n\nEin bereits ausgestelltes Zeugnis bzw. eine Bescheinigung bleibt unverändert und muss " +
        "gegebenenfalls neu ausgestellt werden.";
      if (!confirm(frage)) return;
    }

    setLaeuft("daten");
    setMeldung(null);
    // Nur die angefassten Felder: Ein nicht mitgeschicktes Feld bleibt auf dem
    // Server unverändert — so steht im Protokoll nur, was wirklich geändert wurde.
    const rumpf: Partial<typeof werte> = {};
    for (const schluessel of ["geburtsdatum", "gemeinde", "teilnahmeform"] as const) {
      if (werte[schluessel] !== daten[schluessel]) rumpf[schluessel] = werte[schluessel];
    }
    const antwort = await sendeAnfrage<{ gespeichert: boolean; geaendert: string[]; teilnahmenAngepasst: number }>(
      `/api/personen/${personId}/ausbildungsdaten`,
      { methode: "PUT", rumpf },
    );
    setLaeuft(null);
    if (!antwort.ok) {
      const einzeln = antwort.details?.map((d) => d.meldung).join(" ");
      setMeldung({ art: "fehler", text: einzeln ? `${antwort.meldung} ${einzeln}` : antwort.meldung });
      return;
    }
    const { geaendert, teilnahmenAngepasst } = antwort.daten;
    const angepasst = teilnahmenAngepasst === 1 ? "einer Teilnahme" : `${teilnahmenAngepasst} Teilnahmen`;
    setMeldung({
      art: "ok",
      text:
        geaendert.length === 0
          ? "Es gab nichts zu ändern."
          : "Ausbildungsdaten gespeichert." +
            (teilnahmenAngepasst > 0 ? ` Die Teilnahmeform wurde auch an ${angepasst} angepasst.` : ""),
    });
    router.refresh();
  }

  async function statusWechseln() {
    if (!zielStatus) return;
    let frage: string;
    if (zielStatus.istTerminal) {
      frage =
        `${name} wirklich auf „${zielStatus.bezeichnung}“ setzen?\n\n` +
        `„${zielStatus.bezeichnung}“ ist ein Endzustand und kann NICHT rückgängig gemacht werden. ` +
        "Der Zugang zum Portal erlischt, die Person fällt aus allen Listen des Semesters, und es " +
        "gehen keine automatischen Mails mehr an sie.";
    } else if (zielStatus.code === STATUS.ABSOLVENT) {
      frage =
        `${name} auf „${zielStatus.bezeichnung}“ setzen?\n\n` +
        "Danach erscheint die Person nicht mehr in den Listen des laufenden Semesters (Teilnehmerliste, " +
        "Anwesenheit, Notenliste), und es gehen keine automatischen Mails mehr an sie. Noten lassen sich dann " +
        "nur noch hier in der Akte erfassen — am besten vorher erledigen.\n\n" +
        "Zeugnisse, auch das Abschlusszeugnis, lassen sich weiter ausstellen, und der Zugang zum Portal bleibt.";
    } else if (zielStatus.code === STATUS.ABGEBROCHEN) {
      frage =
        `${name} auf „${zielStatus.bezeichnung}“ setzen?\n\n` +
        "Danach erscheint die Person nicht mehr in den Listen des laufenden Semesters (Teilnehmerliste, " +
        "Anwesenheit, Noten, Zeugnisse), der Beitragslauf stoppt, und es gehen keine automatischen Mails mehr " +
        "an sie. Noten und Zeugnis für dieses Semester deshalb vorher erfassen bzw. ausstellen.\n\n" +
        "Das ist kein Endzustand: Der Zugang zum Portal bleibt, und die Schulleitung kann die Person später " +
        "mit Grund wieder aufnehmen.";
    } else if (wiederaufnahme && zielStatus.istAktiv) {
      frage =
        `${name} wieder aufnehmen (Status „${zielStatus.bezeichnung}“)?\n\n` +
        "Die Person erscheint danach wieder in den Listen der Semester, in denen sie eine Teilnahme hat, und " +
        "bekommt wieder automatische Mails. Hat sie im laufenden Semester noch keine Teilnahme, übernehmen Sie " +
        "sie anschließend unter „Aktive dieses Semester“.";
    } else if (status.istAktiv && !zielStatus.istAktiv) {
      frage =
        `Den Status von ${name} von „${status.bezeichnung}“ auf „${zielStatus.bezeichnung}“ ändern?\n\n` +
        "Danach erscheint die Person nicht mehr in den Listen des laufenden Semesters (Teilnehmerliste, " +
        "Anwesenheit, Noten, Zeugnisse). Noten und Zeugnis für dieses Semester deshalb vorher erfassen " +
        "bzw. ausstellen.";
    } else {
      frage = `Den Status von ${name} von „${status.bezeichnung}“ auf „${zielStatus.bezeichnung}“ ändern?`;
    }
    if (!confirm(frage)) return;

    setLaeuft("status");
    setMeldung(null);
    const antwort = await sendeAnfrage<{ status: string; bezeichnung: string }>(`/api/personen/${personId}/status`, {
      methode: "POST",
      rumpf: { nachCode: zielStatus.code, grund },
    });
    setLaeuft(null);
    if (!antwort.ok) {
      setMeldung({ art: "fehler", text: antwort.meldung });
      return;
    }
    setZiel("");
    setGrund("");
    setMeldung({ art: "ok", text: `Status auf „${antwort.daten.bezeichnung}“ geändert.` });
    router.refresh();
  }

  const feld = "min-h-11 w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm";
  const primaer = "min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60";

  return (
    <section className="rounded-lg border border-border bg-card p-5" aria-labelledby={`ausbildung-${personId}`}>
      <h2 id={`ausbildung-${personId}`} className="text-sm font-semibold">
        Ausbildungsdaten &amp; Status
      </h2>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={`geburtsdatum-${personId}`} className="mb-1.5 block text-sm font-medium">
            Geburtsdatum
          </label>
          <input
            id={`geburtsdatum-${personId}`}
            type="date"
            value={werte.geburtsdatum}
            onChange={(e) => {
              setWerte((w) => ({ ...w, geburtsdatum: e.target.value }));
              setMeldung(null);
            }}
            className={feld}
          />
        </div>
        <div>
          <label htmlFor={`gemeinde-${personId}`} className="mb-1.5 block text-sm font-medium">
            Gemeinde
          </label>
          <input
            id={`gemeinde-${personId}`}
            value={werte.gemeinde}
            maxLength={GEMEINDE_MAX_LAENGE}
            onChange={(e) => {
              setWerte((w) => ({ ...w, gemeinde: e.target.value }));
              setMeldung(null);
            }}
            aria-describedby={`gemeinde-hinweis-${personId}`}
            className={feld}
          />
        </div>
        <div>
          <label htmlFor={`teilnahmeform-${personId}`} className="mb-1.5 block text-sm font-medium">
            Teilnahmeform
          </label>
          <select
            id={`teilnahmeform-${personId}`}
            value={werte.teilnahmeform}
            onChange={(e) => {
              setWerte((w) => ({ ...w, teilnahmeform: e.target.value }));
              setMeldung(null);
            }}
            className={feld}
          >
            <option value="">nicht festgelegt</option>
            <option value="SCHUELER">Schüler</option>
            <option value="HOERER">Hörer</option>
          </select>
        </div>
      </div>
      <p id={`gemeinde-hinweis-${personId}`} className="mt-2 text-xs text-muted-foreground">
        Die Gemeinde ist eine Angabe nach Art. 9 DSGVO.{" "}
        {art9Eingewilligt
          ? "Die Einwilligung der Person liegt vor."
          : "Es liegt keine Einwilligung der Person vor — eintragen ist deshalb nicht möglich, leeren schon."}{" "}
        {offeneSemester.length > 0
          ? `Die Teilnahmeform gilt auch für ${teilnahmenText(offeneSemester)}; frühere Semester bleiben unverändert.`
          : "Im laufenden und in kommenden Semestern hat die Person keine Teilnahme; die Teilnahmeform gilt, " +
            "wenn sie wieder in ein Semester aufgenommen wird."}
      </p>
      <button
        type="button"
        onClick={datenSpeichern}
        disabled={beschaeftigt || !datenGeaendert}
        className={`mt-3 ${primaer}`}
      >
        {laeuft === "daten" ? "Wird gespeichert …" : "Ausbildungsdaten speichern"}
      </button>

      <div className="mt-6 border-t border-border pt-4">
        <p className="text-sm">
          Aktueller Status: <span className="font-medium">{status.bezeichnung}</span>
        </p>
        {status.istTerminal ? (
          <p className="mt-2 text-xs text-muted-foreground">
            „{status.bezeichnung}“ ist ein Endzustand — daraus führt kein Statuswechsel mehr heraus.
          </p>
        ) : eigeneAkte ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Den eigenen Status ändert eine andere Person mit Schulleitungsrechten.
          </p>
        ) : offeneAnmeldung ? (
          <p className="mt-2 text-xs text-muted-foreground">{MELDUNG_ANMELDUNG_OFFEN}</p>
        ) : (
          <>
            {wiederaufnahme && (
              <p className="mt-2 text-xs text-muted-foreground">
                Wiederaufnahme nach einem Abbruch: Status auf „Aktiv“ setzen und den Grund angeben. Hat die Person
                im laufenden Semester noch keine Teilnahme, übernehmen Sie sie danach unter „Aktive dieses Semester“.
              </p>
            )}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`zielstatus-${personId}`} className="mb-1.5 block text-sm font-medium">
                  Neuer Status
                </label>
                <select
                  id={`zielstatus-${personId}`}
                  value={ziel}
                  onChange={(e) => {
                    setZiel(e.target.value);
                    setMeldung(null);
                  }}
                  className={feld}
                >
                  <option value="">Bitte wählen</option>
                  {ziele.map((z) => (
                    <option key={z.code} value={z.code}>
                      {z.bezeichnung}
                      {z.istTerminal ? " (Endzustand)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={`statusgrund-${personId}`} className="mb-1.5 block text-sm font-medium">
                  Grund {grundNoetig ? "(erforderlich)" : "(freiwillig)"}
                </label>
                <textarea
                  id={`statusgrund-${personId}`}
                  rows={2}
                  value={grund}
                  maxLength={GRUND_MAX_LAENGE}
                  aria-required={grundNoetig}
                  onChange={(e) => {
                    setGrund(e.target.value);
                    setMeldung(null);
                  }}
                  className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm"
                />
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Ein Endzustand (in der Auswahl markiert) beendet den Zugang zum Portal und lässt sich nicht
              zurücknehmen. Anonymisieren läuft über die eigene Aktion „Anonymisieren (Art. 17 DSGVO)“.
            </p>
            <button
              type="button"
              onClick={statusWechseln}
              disabled={beschaeftigt || !zielStatus || (grundNoetig && grund.trim() === "")}
              className={`mt-3 ${primaer}`}
            >
              {laeuft === "status" ? "Wird geändert …" : "Status ändern"}
            </button>
          </>
        )}
      </div>

      <MeldungsBox meldung={meldung} className="mt-3 break-words" />
    </section>
  );
}
