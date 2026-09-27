"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { sendeAnfrage } from "@/lib/api-client";
import { istIbanGueltig } from "@/lib/pruefwerte";
import { datum } from "@/lib/datum";
import { MeldungsBox } from "@/components/ui/meldung";
import {
  art9Eingewilligt,
  beschreibeNichtImZwischenstand,
  hatUngesicherteEingaben,
  nichtImZwischenstand,
  titelListe,
} from "@/lib/anmeldung-antworten";

export type OeffentlichesFeld = {
  code: string;
  typ: string;
  label: string;
  hilfetext: string | null;
  platzhalter: string | null;
  pflicht: boolean;
  optionen: string[] | null;
  istArt9: boolean;
  /** Aktenfeld-Zuordnung — steuert nur das Autofill des Browsers. */
  personFeld: string;
};

export type OeffentlicherAbschnitt = {
  titel: string;
  beschreibung: string | null;
  felder: OeffentlichesFeld[];
};

export type EinwilligungsAngebot = {
  code: string;
  titel: string;
  text: string;
  istArt9: boolean;
  pflicht: boolean;
};

type Antworten = Record<string, unknown>;

/**
 * Gemeinsamer Startwert für `antworten` und `gesichert`: Ungesichert heißt
 * „anderes Objekt als beim letzten Sichern" — zwei getrennte `{}` wären schon
 * beim ersten Rendern verschieden. Wird nie verändert, nur ersetzt.
 */
const KEINE_ANTWORTEN: Antworten = {};

/** Feldtypen, die als Gruppe mehrerer Bedienelemente dargestellt werden. */
const GRUPPENTYPEN = ["JA_NEIN", "AUSWAHL_EINFACH", "AUSWAHL_MEHRFACH"];

/** Ein Abschnitt, der erst nach der Art.-9-Einwilligung erscheint. */
function istNurArt9(abschnitt: OeffentlicherAbschnitt): boolean {
  return abschnitt.felder.length > 0 && abschnitt.felder.every((f) => f.istArt9);
}

/**
 * Autofill-Zuordnung. Ohne sie müssen auf dem Tablet sieben Felder von Hand
 * getippt werden, obwohl das Betriebssystem sie kennt — ein spürbarer Grund,
 * eine Anmeldung abzubrechen.
 */
const AUTOCOMPLETE: Record<string, string> = {
  VORNAME: "given-name",
  NACHNAME: "family-name",
  EMAIL: "email",
  TELEFON: "tel",
  GEBURTSDATUM: "bday",
  STRASSE: "street-address",
  PLZ: "postal-code",
  ORT: "address-level2",
  KONTOINHABER: "name",
};

export function OeffentlichesFormular({
  versionId,
  einleitung,
  abschnitte,
  einwilligungen,
}: {
  versionId: string;
  einleitung: string | null;
  abschnitte: OeffentlicherAbschnitt[];
  einwilligungen: EinwilligungsAngebot[];
}) {
  const [antworten, setAntworten] = useState<Antworten>(KEINE_ANTWORTEN);
  // Stand beim letzten Zwischenspeichern bzw. Laden — für die Warnung beim
  // Verlassen der Seite.
  const [gesichert, setGesichert] = useState<Antworten>(KEINE_ANTWORTEN);
  const [erteilt, setErteilt] = useState<Set<string>>(new Set());
  const [token, setToken] = useState<string | null>(null);
  // Zwischenstand über den Link #fortsetzen=… laden (siehe useEffect unten).
  const [laedtEntwurf, setLaedtEntwurf] = useState(false);
  const [wiederherstellung, setWiederherstellung] = useState<
    { art: "ok" } | { art: "fehler"; text: string } | null
  >(null);
  // Fangfeld für Formular-Roboter (Honeypot) — Menschen sehen es nicht. Bewusst
  // ohne sprechenden Namen: „website“/„Webseite“ füllen Passwortmanager mit
  // Identitätsprofilen gern selbst aus — dann verwürfe der Server still eine
  // echte Anmeldung.
  const [hpFeld, setHpFeld] = useState("");
  // Dauerhafte Live-Region: sagt an, wenn der Art.-9-Haken weiter oben
  // Abschnitte freischaltet oder wieder sperrt.
  const [art9Ansage, setArt9Ansage] = useState("");
  // Getrennte Zustände: Sonst wechselt der Absende-Knopf beim Zwischenspeichern
  // auf „Wird gesendet …", und der Nutzer glaubt, er hätte abgeschickt.
  const [sendet, setSendet] = useState(false);
  const [speichert, setSpeichert] = useState(false);
  const [fertig, setFertig] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [feldFehler, setFeldFehler] = useState<Record<string, string>>({});
  const [hinweis, setHinweis] = useState<string | null>(null);
  // Der Rückweg nach dem Zwischenspeichern — sichtbar und kopierbar statt nur in
  // der Adresszeile.
  const [fortsetzenUrl, setFortsetzenUrl] = useState<string | null>(null);
  const [kopiert, setKopiert] = useState<"ok" | "fehler" | null>(null);
  const [consentFehler, setConsentFehler] = useState(false);

  const erfolgRef = useRef<HTMLDivElement>(null);
  const consentRef = useRef<HTMLDivElement>(null);
  // Der Token, der gerade in dieser Seite steckt (geladen, ladend oder zuletzt
  // gesichert) — für den hashchange-Wächter unten.
  const aktuellerToken = useRef<string | null>(null);
  const art9StartRef = useRef<HTMLHeadingElement>(null);
  // Nur wer im Platzhalter-Abschnitt anhakt, wird zu den Fragen geführt — wer
  // unten im Datenschutz-Block anhakt, bleibt dort (und hört die Ansage).
  const art9Springen = useRef(false);

  // Freigeschaltet erst, wenn ALLE Art.-9-Texte erteilt sind — dieselbe Regel
  // wie auf dem Server (art9Eingewilligt in lib/anmeldung-antworten.ts). Ohne
  // jeden Art.-9-Text bleiben die Art.-9-Abschnitte gesperrt.
  const art9Erteilt = art9Eingewilligt(einwilligungen, erteilt);
  const art9Einwilligungen = einwilligungen.filter((e) => e.istArt9);
  const art9Titel = abschnitte.filter(istNurArt9).map((a) => a.titel);
  const ersterArt9Index = abschnitte.findIndex(istNurArt9);

  // Was „Später weitermachen" bewusst NICHT speichert (Art.-9-Felder und IBAN,
  // siehe bereinigeEntwurf in lib/formular.ts) — aus den Formulardaten
  // abgeleitet. Vorher nannte die Meldung fest nur „Glaube und Gemeinde": die
  // IBAN fehlte, und dass Motivation und Ziele dazugehören, sah niemand.
  const nichtGesichert = nichtImZwischenstand(abschnitte);
  const nichtGesichertText = beschreibeNichtImZwischenstand(nichtGesichert, "nominativ");
  const warnenVorZwischenstand = nichtGesichertText !== null && hatUngesicherteEingaben(nichtGesichert, antworten);
  const nichtWiederhergestellt = beschreibeNichtImZwischenstand(nichtGesichert, "dativ");

  // Ungesichert ist, was seit dem letzten Zwischenspeichern geändert wurde —
  // und immer, was ein Zwischenstand gar nicht aufnimmt (Art.-9-Freitexte,
  // IBAN): Das ginge beim Schließen des Tabs still verloren.
  const ungespeichert = !fertig && (antworten !== gesichert || hatUngesicherteEingaben(nichtGesichert, antworten));

  useEffect(() => {
    if (fertig) erfolgRef.current?.focus();
  }, [fertig]);

  useEffect(() => {
    if (token) aktuellerToken.current = token;
  }, [token]);

  // Ein Lesezeichen oder eingefügter Link #fortsetzen=… in einem Tab, in dem
  // /anmeldung schon offen ist, lädt die Seite nicht neu: Der Browser springt
  // nur innerhalb des Dokuments (hashchange), der Lade-Effekt unten läuft nicht
  // noch einmal — es passierte nichts. Dann neu laden; der Lade-Effekt liest
  // den neuen Token, ungesicherte Eingaben schützt die beforeunload-Warnung.
  // replaceState (Zwischenspeichern, Absenden) löst kein hashchange aus — eine
  // Schleife entsteht nicht.
  useEffect(() => {
    function fragmentGeaendert() {
      const neu = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("fortsetzen");
      if (neu && neu !== aktuellerToken.current) window.location.reload();
    }
    window.addEventListener("hashchange", fragmentGeaendert);
    return () => window.removeEventListener("hashchange", fragmentGeaendert);
  }, []);

  useEffect(() => {
    if (!ungespeichert) return;
    function warnen(ereignis: BeforeUnloadEvent) {
      ereignis.preventDefault();
      // Ältere Browser (Safari, Chrome vor 119) warnen nur mit gesetztem returnValue.
      ereignis.returnValue = "";
    }
    window.addEventListener("beforeunload", warnen);
    return () => window.removeEventListener("beforeunload", warnen);
  }, [ungespeichert]);

  useEffect(() => {
    if (!art9Erteilt || !art9Springen.current) return;
    art9Springen.current = false;
    art9StartRef.current?.focus();
  }, [art9Erteilt]);

  // Zwischenstand fortsetzen. Der Token steht im URL-FRAGMENT (#fortsetzen=…),
  // das der Browser nie an den Server schickt — als ?fortsetzen=… stand er in
  // jedem Zugriffslog des Reverse Proxy, 14 Tage gültig, mit Kontaktdaten und
  // Freitexten dahinter. Geladen wird per POST.
  useEffect(() => {
    const url = new URL(window.location.href);
    const ausAdresse = url.searchParams.get("fortsetzen");
    const ausFragment = new URLSearchParams(url.hash.replace(/^#/, "")).get("fortsetzen");
    // Alte Links (?fortsetzen=…) werden ins Fragment umgeschrieben, damit der
    // Token beim nächsten Neuladen nicht wieder an den Server geht.
    if (ausAdresse) {
      url.searchParams.delete("fortsetzen");
      url.hash = `fortsetzen=${ausAdresse}`;
      window.history.replaceState({}, "", url.toString());
    }
    const gefunden = ausFragment ?? ausAdresse;
    if (!gefunden) return;
    aktuellerToken.current = gefunden;

    const abgelaufenText = "Dieser Link zum Fortsetzen ist abgelaufen oder ungültig — die Anmeldung beginnt deshalb leer.";
    if (!/^[0-9a-f-]{36}$/i.test(gefunden)) {
      setWiederherstellung({ art: "fehler", text: abgelaufenText });
      return;
    }

    let abgebrochen = false;
    setLaedtEntwurf(true);
    void sendeAnfrage<{ antworten: Antworten }>("/api/anmeldung", {
      methode: "POST",
      rumpf: { aktion: "laden", fortsetzenToken: gefunden },
    }).then((antwort) => {
      if (abgebrochen) return;
      setLaedtEntwurf(false);
      if (!antwort.ok) {
        // 404 unbekannt/abgelaufen, 400 kein gültiger Token — für den Menschen dasselbe.
        const ungueltig = antwort.status === 404 || antwort.status === 400;
        setWiederherstellung({ art: "fehler", text: ungueltig ? abgelaufenText : antwort.meldung });
        return;
      }
      const roh: unknown = antwort.daten.antworten;
      const geladen = roh && typeof roh === "object" && !Array.isArray(roh) ? (roh as Antworten) : KEINE_ANTWORTEN;
      setAntworten(geladen);
      setGesichert(geladen);
      setToken(gefunden);
      setWiederherstellung({ art: "ok" });
    });
    return () => {
      abgebrochen = true;
    };
  }, []);

  /**
   * Setzt eine Einwilligung — aus dem Datenschutz-Block oder aus dem
   * Platzhalter eines Art.-9-Abschnitts (`springen`). Schaltet der Haken die
   * Art.-9-Abschnitte frei oder sperrt sie wieder, sagt die Live-Region das an:
   * Die Abschnitte liegen weiter oben, außer Sicht.
   */
  function setzeEinwilligung(code: string, an: boolean, springen = false) {
    setConsentFehler(false);
    const neu = new Set(erteilt);
    if (an) neu.add(code);
    else neu.delete(code);
    setErteilt(neu);

    const vorher = art9Eingewilligt(einwilligungen, erteilt);
    const nachher = art9Eingewilligt(einwilligungen, neu);
    if (vorher === nachher || art9Titel.length === 0) return;
    setArt9Ansage(
      nachher
        ? `Freigeschaltet: die Fragen in ${titelListe(art9Titel)} weiter oben im Formular.`
        : `Die Fragen in ${titelListe(art9Titel)} sind wieder ausgeblendet.`,
    );
    art9Springen.current = nachher && springen;
  }

  function zurZustimmung() {
    consentRef.current?.scrollIntoView({ behavior: bewegungErlaubt() ? "smooth" : "auto", block: "start" });
    consentRef.current?.focus({ preventScroll: true });
  }

  function zuDenArt9Fragen() {
    const ziel = art9StartRef.current;
    ziel?.scrollIntoView({ behavior: bewegungErlaubt() ? "smooth" : "auto", block: "start" });
    ziel?.focus({ preventScroll: true });
  }

  function setzeAntwort(code: string, wert: unknown) {
    setAntworten((alt) => ({ ...alt, [code]: wert }));
    setFeldFehler((alt) => {
      if (!(code in alt)) return alt;
      const neu = { ...alt };
      delete neu[code];
      return neu;
    });
  }

  async function zwischenspeichern() {
    setSpeichert(true);
    setFehler(null);
    // Der Stand, der jetzt gesichert wird — wer während des Speicherns weiter
    // tippt, hat danach wieder ungesicherte Eingaben.
    const stand = antworten;

    const antwort = await sendeAnfrage<{ fortsetzenToken: string; laeuftAb: string }>("/api/anmeldung", {
      methode: "POST",
      rumpf: { aktion: "speichern", versionId, antworten, fortsetzenToken: token ?? undefined },
    });
    setSpeichert(false);

    if (!antwort.ok) {
      setFehler(antwort.meldung);
      return;
    }

    setToken(antwort.daten.fortsetzenToken);
    setGesichert(stand);
    const bis = datum(new Date(antwort.daten.laeuftAb));
    setHinweis(
      `Zwischenstand gespeichert. Über den Link unten kommst du bis zum ${bis} hierher zurück — ` +
        "am besten kopieren oder als Lesezeichen ablegen." +
        (nichtGesichertText
          ? ` Nicht gespeichert werden ${nichtGesichertText}: Diese Angaben speichern wir erst beim Absenden. ` +
            "Bitte trage sie beim Fortsetzen noch einmal ein."
          : ""),
    );

    // Im Fragment, nicht im Query-String: So erreicht der Token beim Aufruf des
    // Lesezeichens nie den Server und steht in keinem Zugriffslog.
    const url = new URL(window.location.href);
    url.searchParams.delete("fortsetzen");
    url.hash = `fortsetzen=${antwort.daten.fortsetzenToken}`;
    window.history.replaceState({}, "", url.toString());
    setFortsetzenUrl(url.toString());
    setKopiert(null);
  }

  async function linkKopieren() {
    if (!fortsetzenUrl) return;
    // Ohne HTTPS (oder in manchen eingebetteten Browsern) fehlt die
    // Zwischenablage ganz — dann bleibt das Feld zum Markieren.
    try {
      await navigator.clipboard.writeText(fortsetzenUrl);
      setKopiert("ok");
    } catch {
      setKopiert("fehler");
    }
  }

  async function absenden(ereignis: React.FormEvent) {
    ereignis.preventDefault();

    // Pflicht-Einwilligungen vorab prüfen: Der Server lehnt sie ohnehin ab, aber
    // ohne diese Prüfung erschiene nur eine allgemeine rote Box am Seitenende,
    // ohne Markierung und ohne Sprung — der häufigste Abbruchgrund bliebe
    // unerklärt.
    const fehlend = einwilligungen.filter((e) => e.pflicht && !erteilt.has(e.code));
    if (fehlend.length > 0) {
      setConsentFehler(true);
      setFehler(`Bitte stimme noch zu: ${fehlend.map((e) => e.titel).join(", ")}.`);
      consentRef.current?.scrollIntoView({ behavior: bewegungErlaubt() ? "smooth" : "auto", block: "center" });
      consentRef.current?.focus();
      return;
    }

    setSendet(true);
    setFehler(null);
    setConsentFehler(false);
    setFeldFehler({});

    const antwort = await sendeAnfrage<{ eingereicht: boolean }>("/api/anmeldung", {
      methode: "POST",
      rumpf: {
        aktion: "absenden",
        versionId,
        antworten,
        einwilligungen: [...erteilt],
        fortsetzenToken: token ?? undefined,
        hp_feld: hpFeld,
      },
    });
    setSendet(false);

    if (!antwort.ok) {
      setFehler(antwort.meldung);
      if (antwort.details && antwort.details.length > 0) {
        const zuordnung: Record<string, string> = {};
        for (const d of antwort.details) if (d.feld) zuordnung[d.feld] = d.meldung;
        setFeldFehler(zuordnung);

        const erstesFeld = antwort.details.find((d) => d.feld)?.feld;
        if (erstesFeld) {
          const ziel = document.getElementById(`feld-${erstesFeld}`);
          ziel?.scrollIntoView({ behavior: bewegungErlaubt() ? "smooth" : "auto", block: "center" });
          ziel?.focus();
        }
      }
      return;
    }

    // Der Link zum Fortsetzen ist mit dem Absenden entwertet — raus aus der Adresse.
    if (window.location.hash) {
      window.history.replaceState({}, "", window.location.pathname + window.location.search);
    }
    setFertig(true);
  }

  if (fertig) {
    return (
      <div
        ref={erfolgRef}
        role="status"
        tabIndex={-1}
        className="rounded-lg border border-credo-gruen/40 bg-credo-gruen/5 p-8 outline-none"
      >
        <h2 className="text-xl font-semibold">Deine Anmeldung ist angekommen</h2>
        <p className="mt-3 max-w-prose text-sm">
          Wir haben dir eine Bestätigung per E-Mail geschickt. Die Schulleitung sieht sich deine Anmeldung an und
          meldet sich bei dir.
        </p>
      </div>
    );
  }

  const laeuft = sendet || speichert || laedtEntwurf;

  return (
    <form onSubmit={absenden} noValidate>
      <div role="status">
        {laedtEntwurf && (
          <p className="mb-6 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
            Deine begonnene Anmeldung wird geladen …
          </p>
        )}
        {wiederherstellung?.art === "ok" && (
          // Ehrlich sagen, was NICHT wiederhergestellt ist: Art.-9-Antworten und
          // die IBAN liegen bewusst nie im Zwischenstand, und auch die
          // Zustimmungen stehen wieder offen.
          <p className="mb-6 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
            {nichtWiederhergestellt
              ? `Wir haben deine begonnene Anmeldung wiederhergestellt. Deine Angaben sind wieder da — außer ${nichtWiederhergestellt}. ` +
                "Diese Angaben speichern wir erst beim Absenden; bitte trage sie noch einmal ein."
              : "Wir haben deine begonnene Anmeldung wiederhergestellt. Du kannst weitermachen, wo du aufgehört hast."}
            {einwilligungen.length > 0 && " Die Zustimmungen unter „Datenschutz“ setzt du bitte noch einmal."}
          </p>
        )}
        {wiederherstellung?.art === "fehler" && (
          <p className="mb-6 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
            {wiederherstellung.text}
          </p>
        )}
      </div>

      {einleitung && <p className="mb-6 max-w-prose text-muted-foreground">{einleitung}</p>}
      <p className="mb-10 text-sm text-muted-foreground">
        Mit <span className="text-credo-rot">*</span> gekennzeichnete Felder sind Pflichtangaben.
      </p>

      {/* Fangfeld für Formular-Roboter (Honeypot): außerhalb des sichtbaren
          Bereichs, nicht per Tab erreichbar und für Vorlesesoftware verborgen.
          Ein Mensch lässt es leer; ist es gefüllt, legt der Server keine Akte an
          und verschickt keine Mail, antwortet aber wie immer. */}
      <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
        <label htmlFor="hp_feld">Bitte leer lassen</label>
        <input
          id="hp_feld"
          name="hp_feld"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={hpFeld}
          onChange={(e) => setHpFeld(e.target.value)}
        />
      </div>

      {/* Solange ein Zwischenstand lädt, nimmt das Formular keine Eingaben an —
          sie würden beim Eintreffen überschrieben. */}
      <div inert={laedtEntwurf} className={laedtEntwurf ? "opacity-60" : undefined}>
        {abschnitte.map((abschnitt, i) => {
          const nurArt9 = istNurArt9(abschnitt);
          if (nurArt9 && !art9Erteilt) {
            // Die Zustimmung auch gleich hier: Sie steht sonst nur am Seitenende,
            // und die Fragen erschienen nach dem Haken außer Sicht.
            const mitZustimmung = i === ersterArt9Index && art9Einwilligungen.length > 0;
            return (
              <section key={i} className="mb-10 rounded-lg border border-dashed border-border p-5">
                <h2 className="text-lg font-semibold text-muted-foreground">{abschnitt.titel}</h2>
                <p className="mt-2 max-w-prose text-sm text-muted-foreground">
                  Diese Fragen erscheinen, sobald du der Verarbeitung von Angaben zu Glaube und
                  Gemeindezugehörigkeit zugestimmt hast
                  {mitZustimmung ? " — gleich hier oder unten unter „Datenschutz“." : "."}{" "}
                  {!mitZustimmung && (
                    <a
                      href="#datenschutz"
                      // Ohne Wechsel des Fragments: Dort steht nach dem
                      // Zwischenspeichern der Link zum Fortsetzen (#fortsetzen=…).
                      onClick={(ereignis) => {
                        ereignis.preventDefault();
                        zurZustimmung();
                      }}
                      className="underline underline-offset-2"
                    >
                      Zur Zustimmung springen
                    </a>
                  )}
                </p>
                {mitZustimmung && (
                  <div className="mt-4 space-y-4">
                    {art9Einwilligungen.map((e) => (
                      <EinwilligungsHaken
                        key={e.code}
                        einwilligung={e}
                        erteilt={erteilt.has(e.code)}
                        onAendern={(an) => setzeEinwilligung(e.code, an, true)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          }

          return (
            <section key={i} className="mb-10">
              <h2
                ref={i === ersterArt9Index ? art9StartRef : undefined}
                tabIndex={i === ersterArt9Index ? -1 : undefined}
                className="text-lg font-semibold outline-none"
              >
                {abschnitt.titel}
              </h2>
              {abschnitt.beschreibung && (
                <p className="mt-1 max-w-prose text-sm text-muted-foreground">{abschnitt.beschreibung}</p>
              )}

              <div className="mt-5 space-y-6">
                {abschnitt.felder.map((feld) => (
                  <Feld
                    key={feld.code}
                    feld={feld}
                    wert={antworten[feld.code]}
                    fehler={feldFehler[feld.code]}
                    onAendern={(wert) => setzeAntwort(feld.code, wert)}
                  />
                ))}
              </div>
            </section>
          );
        })}

        <section
          id="datenschutz"
          ref={consentRef}
          tabIndex={-1}
          className={`mb-10 rounded-lg border p-5 outline-none ${
            consentFehler ? "border-credo-rot bg-credo-rot/5" : "border-border bg-muted"
          }`}
        >
          <h2 className="text-lg font-semibold">Datenschutz</h2>
          <div className="mt-4 space-y-4">
            {einwilligungen.map((e) => (
              <EinwilligungsHaken
                key={e.code}
                einwilligung={e}
                erteilt={erteilt.has(e.code)}
                onAendern={(an) => setzeEinwilligung(e.code, an)}
              />
            ))}
          </div>
          {art9Erteilt && art9Titel.length > 0 && (
            <p className="mt-4 text-sm">
              Freigeschaltet: die Fragen in {titelListe(art9Titel)} weiter oben.{" "}
              <button type="button" onClick={zuDenArt9Fragen} className="underline underline-offset-2">
                Zu den Fragen springen
              </button>
            </p>
          )}
        </section>
      </div>

      <p role="status" className="sr-only">
        {art9Ansage}
      </p>

      {/* Beide Live-Regionen stehen immer im DOM — eine erst mit dem Text
          eingefügte Region sagen Screenreader oft nicht an. */}
      <MeldungsBox meldung={fehler ? { art: "fehler", text: fehler } : null} className="mb-6" />
      <div
        className={
          hinweis ? "mb-6 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground" : undefined
        }
      >
        <p role="status" className={hinweis ? undefined : "sr-only"}>
          {hinweis ?? ""}
        </p>
        {hinweis && fortsetzenUrl && (
          <div className="mt-3">
            <label htmlFor="fortsetzen-link" className="mb-1 block text-xs font-medium text-foreground">
              Dein Link zum Fortsetzen
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {/* Nur lesbar statt als anklickbarer Link: Ein Klick darauf lüde die
                  Seite neu — und was nicht zwischengespeichert ist, wäre weg. */}
              <input
                id="fortsetzen-link"
                type="text"
                readOnly
                value={fortsetzenUrl}
                onFocus={(e) => e.target.select()}
                // Enter in einem Textfeld schickt sonst das ganze Formular ab.
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.preventDefault();
                }}
                className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs text-foreground"
              />
              <button
                type="button"
                onClick={linkKopieren}
                className="rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium text-foreground"
              >
                Link kopieren
              </button>
            </div>
            <p role="status" className="mt-1 text-xs">
              {kopiert === "ok"
                ? "Link kopiert."
                : kopiert === "fehler"
                  ? "Kopieren hat nicht geklappt — bitte den Link im Feld markieren und kopieren."
                  : ""}
            </p>
          </div>
        )}
      </div>

      {warnenVorZwischenstand && (
        <p id="zwischenstand-hinweis" className="mb-4 rounded-lg bg-credo-gelb/15 px-4 py-3 text-sm">
          Hinweis zu „Später weitermachen“: Dabei bleiben {nichtGesichertText} außen vor — diese Angaben speichern wir
          erst beim Absenden. Was du dort schon eingetragen hast, bleibt nur erhalten, solange diese Seite geöffnet ist.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={laeuft}
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {sendet ? "Wird gesendet …" : "Anmeldung abschicken"}
        </button>
        <button
          type="button"
          onClick={zwischenspeichern}
          disabled={laeuft}
          aria-describedby={warnenVorZwischenstand ? "zwischenstand-hinweis" : undefined}
          className="rounded-lg border border-input px-5 py-2.5 text-sm font-medium disabled:opacity-60"
        >
          {speichert ? "Wird gespeichert …" : "Später weitermachen"}
        </button>
      </div>
    </form>
  );
}

function bewegungErlaubt(): boolean {
  return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Das rote Sternchen für Pflichtangaben. Vorlesesoftware bekommt statt „Stern"
 * den Text „(Pflichtangabe)" — ein `aria-label` auf einem schlichten `span` wird
 * nicht vorgelesen. Wichtig vor allem bei Auswahlgruppen und Einwilligungen:
 * Dort sagt kein `required` am Textfeld, dass die Frage Pflicht ist.
 */
function Pflichtstern() {
  return (
    <>
      <span className="ml-1 text-credo-rot" aria-hidden="true">
        *
      </span>
      <span className="sr-only"> (Pflichtangabe)</span>
    </>
  );
}

/** Eine Einwilligung zum Anhaken — im Datenschutz-Block und im Art.-9-Platzhalter derselbe Zustand. */
function EinwilligungsHaken({
  einwilligung,
  erteilt,
  onAendern,
}: {
  einwilligung: EinwilligungsAngebot;
  erteilt: boolean;
  onAendern: (an: boolean) => void;
}) {
  return (
    <label className="flex gap-3 text-sm">
      <input
        type="checkbox"
        className="mt-1 shrink-0"
        checked={erteilt}
        required={einwilligung.pflicht}
        aria-required={einwilligung.pflicht}
        onChange={(ereignis) => onAendern(ereignis.target.checked)}
      />
      <span>
        <span className="font-medium">
          {einwilligung.titel}
          {einwilligung.pflicht && <Pflichtstern />}
        </span>
        <span className="mt-1 block text-muted-foreground">{einwilligung.text}</span>
      </span>
    </label>
  );
}

/** IBAN in Vierergruppen: "DE89370400440532013000" → "DE89 3704 0044 …". */
function formatiereIban(roh: string): string {
  const bereinigt = roh.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return bereinigt.replace(/(.{4})(?=.)/g, "$1 ");
}

/**
 * Eigene Eingabe für die IBAN: gruppiert die Ziffern während des Tippens, prüft
 * die Prüfziffer live (dieselbe Regel wie der Server) und meldet das Ergebnis
 * ruhig zurück — mit Häkchen und Hinweis, sobald sie stimmt, rot erst, wenn das
 * Feld verlassen wurde. Ein Zahlendreher fällt so beim Ausfüllen auf, nicht
 * erst, wenn die Lastschrift Wochen später zurückkommt.
 *
 * Der Cursor bleibt beim Umformatieren an der richtigen Stelle: gezählt wird
 * über die echten Zeichen vor der Einfügemarke, die eingefügten Leerzeichen
 * verschieben ihn nicht.
 */
function IbanEingabe({
  id,
  text,
  pflicht,
  fehler,
  hilfeId,
  onAendern,
}: {
  id: string;
  text: string;
  pflicht: boolean;
  fehler?: string;
  hilfeId?: string;
  onAendern: (wert: unknown) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [beruehrt, setBeruehrt] = useState(false);

  const bereinigt = text.replace(/\s+/g, "");
  const gueltig = bereinigt.length >= 15 && istIbanGueltig(bereinigt);
  const serverFehler = Boolean(fehler);
  // Gültig hat Vorrang: sobald die Prüfziffer stimmt, ist der Zustand grün — auch wenn beim letzten
  // Absenden noch ein Serverfehler kam. Umgekehrt zeigt ein Serverfehler auch bei LEEREM Pflichtfeld
  // rot; sonst schluckt die Bedingung "length > 0" die Meldung, und der Nutzer sieht am IBAN-Feld
  // gar nichts, obwohl der Server es als Pflichtfeld abgewiesen hat.
  const liveFehler = !gueltig && (serverFehler || (beruehrt && bereinigt.length > 0));
  const statusId = `${id}-status`;
  const beschreibung = [hilfeId, liveFehler || gueltig ? statusId : undefined].filter(Boolean).join(" ") || undefined;

  function beiEingabe(e: ChangeEvent<HTMLInputElement>) {
    const el = e.target;
    const echteVorCursor = el.value.slice(0, el.selectionStart ?? el.value.length).replace(/[^A-Za-z0-9]/g, "").length;
    const formatiert = formatiereIban(el.value);
    onAendern(formatiert);
    requestAnimationFrame(() => {
      const node = ref.current;
      if (!node) return;
      let pos = 0;
      let echte = 0;
      while (pos < formatiert.length && echte < echteVorCursor) {
        if (/[A-Za-z0-9]/.test(formatiert[pos])) echte += 1;
        pos += 1;
      }
      node.setSelectionRange(pos, pos);
    });
  }

  // Grün allein trägt den Zustand nicht (Rahmen und Grün auf Weiß liegen unter
  // 3:1): Häkchen und Hinweistext stehen in Textfarbe daneben.
  const rahmen = liveFehler ? "border-credo-rot" : gueltig ? "border-credo-gruen" : "border-input";

  return (
    <div>
      <div className="relative">
        <input
          ref={ref}
          id={id}
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={text}
          placeholder="DE00 0000 0000 0000 0000 00"
          required={pflicht}
          aria-required={pflicht}
          aria-invalid={liveFehler}
          aria-describedby={beschreibung}
          onChange={beiEingabe}
          onBlur={() => setBeruehrt(true)}
          className={`w-full rounded-lg border bg-background px-4 py-2.5 pr-10 font-mono text-sm tracking-wider ${rahmen}`}
        />
        {gueltig && (
          <span
            className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-base font-semibold text-foreground"
            aria-hidden
          >
            ✓
          </span>
        )}
      </div>
      {gueltig ? (
        <p id={statusId} className="mt-1.5 inline-block rounded bg-credo-gruen/15 px-2 py-0.5 text-xs text-foreground">
          <span aria-hidden="true">✓ </span>
          IBAN geprüft — die Prüfziffer stimmt.
        </p>
      ) : liveFehler ? (
        <p id={statusId} className="mt-1.5 text-xs text-credo-rot" role="alert">
          {fehler ?? "Diese IBAN stimmt nicht. Bitte Länderkürzel und Ziffern prüfen."}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Ein Feld.
 *
 * Auswahl- und Ja/Nein-Fragen werden als `fieldset` mit `legend` dargestellt.
 * Vorher zeigte ein `label htmlFor` auf eine ID, die es bei diesen Typen gar
 * nicht gab: Vorlesesoftware las nur die Antwortmöglichkeiten vor, nie die
 * Frage — auf dem Pflichtfeld „Wie möchtest du teilnehmen?" also gar nichts
 * Verständliches. Und ein Klick auf die Beschriftung wählte nichts aus.
 */
function Feld({
  feld,
  wert,
  fehler,
  onAendern,
}: {
  feld: OeffentlichesFeld;
  wert: unknown;
  fehler?: string;
  onAendern: (wert: unknown) => void;
}) {
  if (feld.typ === "HINWEIS") {
    return <p className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">{feld.label}</p>;
  }

  const id = `feld-${feld.code}`;
  const hilfeId = feld.hilfetext ? `${id}-hilfe` : undefined;
  const fehlerId = fehler ? `${id}-fehler` : undefined;
  const beschreibung = [hilfeId, fehlerId].filter(Boolean).join(" ") || undefined;
  const stil = `w-full rounded-lg border bg-background px-4 py-2.5 text-sm ${
    fehler ? "border-credo-rot" : "border-input"
  }`;
  const text = typeof wert === "string" ? wert : typeof wert === "number" ? String(wert) : "";
  const istGruppe = GRUPPENTYPEN.includes(feld.typ);

  const beschriftung = (
    <>
      {feld.label}
      {feld.pflicht && <Pflichtstern />}
    </>
  );

  const hinweise = (
    <>
      {feld.hilfetext && (
        <p id={hilfeId} className="mb-1.5 text-xs text-muted-foreground">
          {feld.hilfetext}
        </p>
      )}
    </>
  );

  const fehlermeldung = fehler ? (
    <p id={fehlerId} role="alert" className="mt-1.5 text-xs text-credo-rot">
      {fehler}
    </p>
  ) : null;

  if (istGruppe) {
    return (
      // tabIndex am fieldset, damit der Sprung zum ersten Fehler auch bei
      // Auswahlfragen ein Ziel findet. `required` steht an jedem Radio der
      // Gruppe (gültiges HTML): So sagt Vorlesesoftware „erforderlich" auch an,
      // wenn der Fokus nicht auf dem ersten landet. Die Mehrfachauswahl hat kein
      // passendes Attribut — dort trägt die Legende „(Pflichtangabe)".
      <fieldset
        id={id}
        tabIndex={-1}
        aria-describedby={beschreibung}
        aria-invalid={Boolean(fehler)}
        className="border-0 p-0 outline-none"
      >
        <legend className="mb-1.5 block text-sm font-medium">{beschriftung}</legend>
        {hinweise}

        {feld.typ === "JA_NEIN" ? (
          <div className="flex gap-6 text-sm">
            {[
              { wert: true, name: "Ja" },
              { wert: false, name: "Nein" },
            ].map((o) => (
              <label key={o.name} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={id}
                  required={feld.pflicht}
                  checked={wert === o.wert}
                  onChange={() => onAendern(o.wert)}
                />
                {o.name}
              </label>
            ))}
          </div>
        ) : feld.typ === "AUSWAHL_EINFACH" ? (
          <div className="space-y-2 text-sm">
            {(feld.optionen ?? []).map((option) => (
              <label key={option} className="flex items-start gap-2">
                <input
                  type="radio"
                  name={id}
                  className="mt-1"
                  required={feld.pflicht}
                  checked={wert === option}
                  onChange={() => onAendern(option)}
                />
                {option}
              </label>
            ))}
            {!feld.pflicht && wert !== undefined && wert !== null && (
              <button
                type="button"
                onClick={() => onAendern(null)}
                className="text-xs text-muted-foreground underline underline-offset-2"
              >
                Auswahl aufheben
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            {(feld.optionen ?? []).map((option) => {
              const gewaehlt = Array.isArray(wert) ? (wert as string[]) : [];
              return (
                <label key={option} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={gewaehlt.includes(option)}
                    onChange={(e) =>
                      onAendern(e.target.checked ? [...gewaehlt, option] : gewaehlt.filter((g) => g !== option))
                    }
                  />
                  {option}
                </label>
              );
            })}
          </div>
        )}

        {fehlermeldung}
      </fieldset>
    );
  }

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {beschriftung}
      </label>
      {hinweise}

      {feld.typ === "MEHRZEILIG" ? (
        <textarea
          id={id}
          rows={4}
          value={text}
          required={feld.pflicht}
          aria-required={feld.pflicht}
          aria-invalid={Boolean(fehler)}
          aria-describedby={beschreibung}
          onChange={(e) => onAendern(e.target.value)}
          className={stil}
        />
      ) : feld.typ === "IBAN" ? (
        <IbanEingabe
          id={id}
          text={text}
          pflicht={feld.pflicht}
          fehler={fehler}
          hilfeId={hilfeId}
          onAendern={onAendern}
        />
      ) : (
        <input
          id={id}
          type={
            feld.typ === "EMAIL" ? "email" : feld.typ === "TELEFON" ? "tel" : feld.typ === "DATUM" ? "date" : feld.typ === "ZAHL" ? "number" : "text"
          }
          inputMode={feld.personFeld === "PLZ" ? "numeric" : undefined}
          autoComplete={AUTOCOMPLETE[feld.personFeld]}
          value={text}
          placeholder={feld.platzhalter ?? ""}
          required={feld.pflicht}
          aria-required={feld.pflicht}
          aria-invalid={Boolean(fehler)}
          aria-describedby={beschreibung}
          onChange={(e) => onAendern(e.target.value)}
          className={stil}
        />
      )}

      {/* Die IBAN-Eingabe meldet Fehler selbst (grün/rot), sonst doppelt es sich. */}
      {feld.typ !== "IBAN" && fehlermeldung}
    </div>
  );
}
