"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { sendeAnfrage } from "@/lib/api-client";
import { datum } from "@/lib/datum";
import { Icon } from "@/components/icons";
import { Blatt } from "@/components/ui/blatt";
import { knopf } from "@/components/ui/knopf";
import { Abschnitt, Gruppe, Zeile } from "@/components/ui/liste";
import { MeldungsBox } from "@/components/ui/meldung";
import { StatusPunkt } from "@/components/ui/status-punkt";
import {
  art9Eingewilligt,
  beschreibeNichtImZwischenstand,
  hatUngesicherteEingaben,
  nichtImZwischenstand,
  titelListe,
} from "@/lib/anmeldung-antworten";
import { FELD_TITEL } from "@/app/anmelden/oeffentlich";
import { EinwilligungsHaken, Feld } from "./formular-felder";
import { einwilligungsId, elementId, istNurArt9, pruefeAbschnitt, zusammenfassung } from "./schritte";

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

/** Runde Tippfläche in der Kopfzeile (Zurück). */
const KOPF_KNOPF = "grid h-11 w-11 place-items-center rounded-full text-primary hover:bg-muted";

/**
 * Das öffentliche Anmeldeformular — Schritt für Schritt (Oberflächenplan
 * 09/2026): Jeder Abschnitt der veröffentlichten Fassung ist ein Schritt, am
 * Ende steht „Prüfen und absenden“ mit einer Zeile je Abschnitt und den
 * Einwilligungen. Oben Fortschritt, Rückweg und „Später“ (das Zwischenspeichern
 * mit Fortsetzen-Link), unten fest „Weiter“. Vor „Weiter“ prüft der Schritt
 * seine Pflichtangaben (schritte.ts); die Prüfung auf dem Server bleibt, wie
 * sie ist — meldet sie ein Feld, springt das Formular zu dessen Schritt.
 *
 * Unverändert aus der einseitigen Fassung: Fangfeld, Formularstempel,
 * Zwischenstand im URL-Fragment, die Art.-9-Sperre (die Fragen erscheinen erst
 * mit der Einwilligung, die dort abgefragt wird, wo diese Angaben beginnen) und
 * die Warnung beim Verlassen mit ungesicherten Eingaben.
 */
export function OeffentlichesFormular({
  versionId,
  einleitung,
  abschnitte,
  einwilligungen,
  formularStempel,
}: {
  versionId: string;
  einleitung: string | null;
  abschnitte: OeffentlicherAbschnitt[];
  einwilligungen: EinwilligungsAngebot[];
  /** Signierter Auslieferungszeitpunkt (lib/anmelde-schutz.ts) — geht beim Absenden mit. */
  formularStempel: string;
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
  // Dauerhafte Live-Region: sagt an, wenn der Art.-9-Haken Schritte freischaltet
  // oder wieder sperrt.
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

  // Schritte: 0 … abschnitte.length - 1 sind die Abschnitte, danach die Übersicht.
  const [schritt, setSchritt] = useState(0);
  // Über „Ändern“ aus der Übersicht gekommen: „Weiter“ und der Rückweg führen dorthin zurück.
  const [vonUebersicht, setVonUebersicht] = useState(false);
  const [spaeterOffen, setSpaeterOffen] = useState(false);
  const [spaeterFehler, setSpaeterFehler] = useState<string | null>(null);
  // Nach jedem Schrittwechsel (und nach „Weiter“ mit Lücken) setzt ein Effekt
  // den Fokus — erst nach dem Zeichnen, damit Fehlertexte schon am Feld hängen.
  const [fokusAuftrag, setFokusAuftrag] = useState(0);
  const fokusZiel = useRef<string | null>(null);

  const erfolgRef = useRef<HTMLDivElement>(null);
  const titelRef = useRef<HTMLHeadingElement>(null);
  // Der Token, der gerade in dieser Seite steckt (geladen, ladend oder zuletzt
  // gesichert) — für den hashchange-Wächter unten.
  const aktuellerToken = useRef<string | null>(null);

  // Freigeschaltet erst, wenn ALLE Art.-9-Texte erteilt sind — dieselbe Regel
  // wie auf dem Server (art9Eingewilligt in lib/anmeldung-antworten.ts). Ohne
  // jeden Art.-9-Text bleiben die Art.-9-Abschnitte gesperrt.
  const art9Erteilt = art9Eingewilligt(einwilligungen, erteilt);
  const art9Einwilligungen = einwilligungen.filter((e) => e.istArt9);
  const art9Titel = abschnitte.filter(istNurArt9).map((a) => a.titel);
  const ersterArt9Index = abschnitte.findIndex(istNurArt9);
  const uebersicht = abschnitte.length;
  const gesamt = abschnitte.length + 1;

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

  /** Die Einwilligung nach Art. 9 fragt der erste reine Art.-9-Abschnitt selbst ab — dort, wo diese Angaben beginnen. */
  function zustimmungenIn(index: number): EinwilligungsAngebot[] {
    return index === ersterArt9Index ? art9Einwilligungen : [];
  }

  /** Was im Schritt `index` noch fehlt (Schlüssel → Meldung). */
  function offenIn(index: number, stand: Antworten = antworten, zustimmungen: ReadonlySet<string> = erteilt) {
    return pruefeAbschnitt(
      abschnitte[index],
      stand,
      zustimmungen,
      art9Eingewilligt(einwilligungen, zustimmungen),
      zustimmungenIn(index),
    );
  }

  /** Fokus nach dem nächsten Zeichnen: auf ein Element oder (null) auf die Überschrift des Schritts. */
  function fokussiere(ziel: string | null) {
    fokusZiel.current = ziel;
    setFokusAuftrag((n) => n + 1);
  }

  function geheZu(ziel: number, ausUebersicht = false) {
    setSchritt(ziel);
    setVonUebersicht(ausUebersicht);
    setFeldFehler({});
    setFehler(null);
    setConsentFehler(false);
    setWiederherstellung(null);
    fokussiere(null);
  }

  useEffect(() => {
    if (fokusAuftrag === 0) return;
    const id = fokusZiel.current;
    const ziel = id ? document.getElementById(id) : titelRef.current;
    if (!ziel) return;
    if (id) ziel.scrollIntoView({ behavior: bewegungErlaubt() ? "smooth" : "auto", block: "center" });
    else window.scrollTo({ top: 0 });
    ziel.focus({ preventScroll: true });
  }, [fokusAuftrag]);

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
      // Weitermachen, wo es fehlt: im ersten Schritt mit offenen Pflichtangaben
      // (Zustimmungen, Art.-9-Antworten und IBAN liegen nie im Zwischenstand).
      const offen = abschnitte.findIndex((_, i) => Object.keys(offenIn(i, geladen, new Set())).length > 0);
      const start = offen === -1 ? abschnitte.length : offen;
      if (start !== 0) geheZu(start);
      setWiederherstellung({ art: "ok" });
    });
    return () => {
      abgebrochen = true;
    };
  }, []);

  /**
   * Setzt eine Einwilligung — im ersten Art.-9-Schritt oder in der Übersicht.
   * Schaltet der Haken die Art.-9-Fragen frei oder sperrt sie wieder, sagt die
   * Live-Region das an.
   */
  function setzeEinwilligung(code: string, an: boolean) {
    setConsentFehler(false);
    const neu = new Set(erteilt);
    if (an) neu.add(code);
    else neu.delete(code);
    setErteilt(neu);
    setFeldFehler((alt) => {
      const schluessel = einwilligungsId(code);
      if (!(schluessel in alt)) return alt;
      const rest = { ...alt };
      delete rest[schluessel];
      return rest;
    });

    const vorher = art9Eingewilligt(einwilligungen, erteilt);
    const nachher = art9Eingewilligt(einwilligungen, neu);
    if (vorher === nachher || art9Titel.length === 0) return;
    setArt9Ansage(
      nachher
        ? `Freigeschaltet: die Fragen in ${titelListe(art9Titel)}.`
        : `Die Fragen in ${titelListe(art9Titel)} sind wieder ausgeblendet.`,
    );
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

  /** „Weiter“: erst die Pflichtangaben des Schritts, dann der nächste (bzw. zurück zur Übersicht). */
  function weiter() {
    const offen = offenIn(schritt);
    const erstes = Object.keys(offen)[0];
    if (erstes) {
      setFeldFehler(offen);
      fokussiere(elementId(erstes));
      return;
    }
    geheZu(vonUebersicht ? uebersicht : schritt + 1);
  }

  function zurueck() {
    geheZu(vonUebersicht ? uebersicht : schritt - 1);
  }

  /** „Später“: Mit Eingaben, die ein Zwischenstand nicht aufnimmt, erst fragen — sonst gleich speichern. */
  function spaeter() {
    setSpaeterFehler(null);
    setHinweis(null);
    setFortsetzenUrl(null);
    setSpaeterOffen(true);
    if (!warnenVorZwischenstand) void zwischenspeichern();
  }

  async function zwischenspeichern() {
    setSpeichert(true);
    setSpaeterFehler(null);
    // Der Stand, der jetzt gesichert wird — wer während des Speicherns weiter
    // tippt, hat danach wieder ungesicherte Eingaben.
    const stand = antworten;

    const antwort = await sendeAnfrage<{ fortsetzenToken: string; laeuftAb: string }>("/api/anmeldung", {
      methode: "POST",
      rumpf: { aktion: "speichern", versionId, antworten, fortsetzenToken: token ?? undefined },
    });
    setSpeichert(false);

    if (!antwort.ok) {
      setSpaeterFehler(antwort.meldung);
      return;
    }

    setToken(antwort.daten.fortsetzenToken);
    setGesichert(stand);
    const bis = datum(new Date(antwort.daten.laeuftAb));
    setHinweis(
      `Zwischenstand gespeichert. Über den Link unten kommen Sie bis zum ${bis} hierher zurück — ` +
        "am besten kopieren oder als Lesezeichen ablegen." +
        (nichtGesichertText
          ? ` Nicht gespeichert werden ${nichtGesichertText}: Diese Angaben speichern wir erst beim Absenden. ` +
            "Bitte tragen Sie sie beim Fortsetzen noch einmal ein."
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

  async function absenden() {
    // Pflicht-Einwilligungen vorab prüfen: Der Server lehnt sie ohnehin ab, aber
    // ohne diese Prüfung erschiene nur eine allgemeine Meldung, ohne Markierung
    // und ohne Sprung — der häufigste Abbruchgrund bliebe unerklärt.
    const fehlend = einwilligungen.filter((e) => e.pflicht && !erteilt.has(e.code));
    if (fehlend.length > 0) {
      setConsentFehler(true);
      setFehler(`Bitte stimmen Sie noch zu: ${fehlend.map((e) => e.titel).join(", ")}.`);
      fokussiere("einwilligungen");
      return;
    }

    // Jeder Schritt noch einmal: Über „Ändern“ oder den Rückweg lässt sich ein
    // Pflichtfeld leeren, und ein erst hier gesetzter Art.-9-Haken schaltet
    // Fragen frei, die noch leer sind.
    for (let i = 0; i < abschnitte.length; i++) {
      const offen = offenIn(i);
      const erstes = Object.keys(offen)[0];
      if (erstes) {
        geheZu(i, true);
        setFeldFehler(offen);
        fokussiere(elementId(erstes));
        return;
      }
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
        formularStempel,
      },
    });
    setSendet(false);

    if (!antwort.ok) {
      const zuordnung: Record<string, string> = {};
      for (const d of antwort.details ?? []) if (d.feld) zuordnung[d.feld] = d.meldung;
      const erstesFeld = Object.keys(zuordnung)[0];
      const index = erstesFeld ? abschnitte.findIndex((a) => a.felder.some((f) => f.code === erstesFeld)) : -1;
      if (index >= 0) {
        // Zum Schritt des ersten beanstandeten Felds; „Weiter“ führt danach zurück hierher.
        geheZu(index, true);
        setFeldFehler(zuordnung);
        fokussiere(`feld-${erstesFeld}`);
      }
      setFehler(antwort.meldung);
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
      <div className="mx-auto flex min-h-[calc(100dvh-6px)] w-full max-w-xl flex-col px-5">
        <Kopf />
        <div ref={erfolgRef} role="status" tabIndex={-1} className="mt-10 outline-none">
          <Icon name="bestaetigt" className="h-11 w-11 text-credo-gruen" />
          <h2 className="mt-5 hyphens-auto break-words text-[29px] font-bold leading-tight tracking-tight text-foreground">
            Ihre Anmeldung ist eingegangen
          </h2>
          <p className="mt-2.5 text-base leading-relaxed text-muted-foreground">
            Wir haben Ihnen eine Bestätigung per E-Mail geschickt. Die Schulleitung sieht sich Ihre Anmeldung an und
            meldet sich bei Ihnen.
          </p>
        </div>
        <div className="mt-auto pb-8 pt-10">
          <a href="/" className={knopf("sekundaer", "gross")}>
            Zur Startseite
          </a>
        </div>
      </div>
    );
  }

  const laeuft = sendet || speichert || laedtEntwurf;
  const aufUebersicht = schritt === uebersicht;
  const grund = aufUebersicht ? "bg-muted" : "bg-background";

  // Rückweg: im ersten Schritt zur Startseite (ein echter Seitenwechsel, damit
  // die Warnung vor ungesicherten Eingaben greift), sonst einen Schritt zurück.
  const rueckweg =
    schritt === 0 && !vonUebersicht ? (
      <a href="/" aria-label="Zur Startseite" className={KOPF_KNOPF}>
        <Icon name="zurueck" className="h-6 w-6" />
      </a>
    ) : (
      <button
        type="button"
        onClick={zurueck}
        aria-label={vonUebersicht ? "Zurück zur Übersicht" : "Zurück zum vorigen Schritt"}
        className={KOPF_KNOPF}
      >
        <Icon name="zurueck" className="h-6 w-6" />
      </button>
    );

  return (
    <>
      {/* data-formular-stempel: derselbe Wert wie oben — nur, damit die Ende-zu-Ende-Prüfung
          (scripts/durchstich.sh) ihn aus dem ausgelieferten HTML lesen kann. */}
      <form
        onSubmit={(ereignis) => {
          ereignis.preventDefault();
          if (aufUebersicht) void absenden();
          else weiter();
        }}
        noValidate
        data-formular-stempel={formularStempel}
        className={`flex min-h-[calc(100dvh-6px)] flex-col ${grund}`}
      >
        <Kopf
          links={rueckweg}
          rechts={
            <button
              type="button"
              onClick={spaeter}
              disabled={laeuft}
              aria-label="Später weitermachen"
              className="h-11 rounded-lg px-3 text-base font-medium text-primary hover:bg-muted disabled:opacity-60"
            >
              Später
            </button>
          }
        />

        <div className="mx-auto w-full max-w-xl px-5">
          <div aria-hidden="true" className="flex gap-[5px]">
            {Array.from({ length: gesamt }, (_, i) => (
              <span key={i} className={`h-1 flex-1 rounded-full ${i <= schritt ? "bg-primary" : "bg-border"}`} />
            ))}
          </div>
          <p role="status" className="mt-2 text-[12.5px] font-medium text-muted-foreground">
            Schritt {schritt + 1} von {gesamt}
          </p>
        </div>

        {/* scroll-mb: Ein per Tab erreichtes Feld verschwindet nicht hinter der festen Leiste unten. */}
        <div className="mx-auto w-full max-w-xl flex-1 px-5 pb-8 pt-4 [&_*]:scroll-mb-28">
          <div role="status">
            {laedtEntwurf && (
              <p className="mb-5 rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
                Ihre begonnene Anmeldung wird geladen …
              </p>
            )}
            {wiederherstellung?.art === "ok" && (
              // Ehrlich sagen, was NICHT wiederhergestellt ist: Art.-9-Antworten und
              // die IBAN liegen bewusst nie im Zwischenstand, und auch die
              // Zustimmungen stehen wieder offen.
              <p className="mb-5 rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
                {nichtWiederhergestellt
                  ? `Wir haben Ihre begonnene Anmeldung wiederhergestellt. Ihre Angaben sind wieder da — außer ${nichtWiederhergestellt}. ` +
                    "Diese Angaben speichern wir erst beim Absenden; bitte tragen Sie sie noch einmal ein."
                  : "Wir haben Ihre begonnene Anmeldung wiederhergestellt. Sie können weitermachen, wo Sie aufgehört haben."}
                {einwilligungen.length > 0 && " Die Zustimmungen setzen Sie bitte noch einmal."}
              </p>
            )}
            {wiederherstellung?.art === "fehler" && (
              <p className="mb-5 rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">{wiederherstellung.text}</p>
            )}
          </div>

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
            {aufUebersicht ? (
              <>
                <h2
                  ref={titelRef}
                  tabIndex={-1}
                  className="hyphens-auto break-words text-[29px] font-bold leading-tight tracking-tight text-foreground outline-none"
                >
                  Fast geschafft
                </h2>
                <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">Bitte prüfen Sie Ihre Angaben.</p>

                <Gruppe className="mt-5">
                  {abschnitte.map((a, i) => {
                    const gesperrt = istNurArt9(a) && !art9Erteilt;
                    const text = gesperrt ? null : zusammenfassung(a, antworten, art9Erteilt);
                    const luecken = !gesperrt && Object.keys(offenIn(i)).length > 0;
                    return (
                      <Zeile
                        key={i}
                        rechts={
                          <button
                            type="button"
                            onClick={() => geheZu(i, true)}
                            className="-mr-2 inline-flex h-11 items-center rounded-lg px-2 text-[15px] font-medium text-primary hover:bg-muted"
                          >
                            Ändern<span className="sr-only">: {a.titel}</span>
                          </button>
                        }
                      >
                        <div className="text-[13px] text-muted-foreground">{a.titel}</div>
                        {luecken ? (
                          <StatusPunkt ton="gelb" className="mt-0.5">
                            Angaben fehlen noch
                          </StatusPunkt>
                        ) : (
                          <div
                            className={`line-clamp-2 text-[15px] leading-snug ${text ? "font-medium text-foreground" : "text-muted-foreground"}`}
                          >
                            {gesperrt ? "Erst nach Ihrer Zustimmung unten" : (text ?? "Keine Angaben")}
                          </div>
                        )}
                      </Zeile>
                    );
                  })}
                </Gruppe>

                {einwilligungen.length > 0 && (
                  <>
                    <Abschnitt titel="Einwilligungen" className="mt-7" />
                    <div
                      id="einwilligungen"
                      tabIndex={-1}
                      className={`divide-y divide-linie overflow-hidden rounded-xl border bg-card outline-none ${
                        consentFehler ? "border-credo-rot" : "border-linie"
                      }`}
                    >
                      {einwilligungen.map((e) => (
                        <div key={e.code} className="px-4 py-3.5">
                          <EinwilligungsHaken
                            einwilligung={e}
                            erteilt={erteilt.has(e.code)}
                            onAendern={(an) => setzeEinwilligung(e.code, an)}
                            textEingeklappt
                          />
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : (
              <SchrittInhalt
                abschnitt={abschnitte[schritt]}
                titelRef={titelRef}
                vorspann={
                  schritt === 0 ? (
                    <>
                      {einleitung && (
                        <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{einleitung}</p>
                      )}
                      <p className="mt-2 text-[13px] leading-snug text-muted-foreground">
                        Mit „Später“ speichern Sie und machen ein andermal weiter. Mit{" "}
                        <span className="text-credo-rot">*</span> gekennzeichnete Felder sind Pflichtangaben.
                      </p>
                    </>
                  ) : null
                }
                zustimmung={
                  schritt === ersterArt9Index && art9Einwilligungen.length > 0 ? (
                    <div
                      className={`mt-5 space-y-4 rounded-xl border p-4 ${
                        art9Einwilligungen.some((e) => feldFehler[einwilligungsId(e.code)])
                          ? "border-credo-rot bg-credo-rot/5"
                          : "border-linie bg-muted"
                      }`}
                    >
                      {art9Einwilligungen.map((e) => (
                        <EinwilligungsHaken
                          key={e.code}
                          einwilligung={e}
                          erteilt={erteilt.has(e.code)}
                          fehler={feldFehler[einwilligungsId(e.code)]}
                          onAendern={(an) => setzeEinwilligung(e.code, an)}
                          // Wer schon zugestimmt hat und zurückkommt, sieht zuerst die Fragen.
                          textEingeklappt={erteilt.has(e.code)}
                        />
                      ))}
                    </div>
                  ) : null
                }
                gesperrt={istNurArt9(abschnitte[schritt]) && !art9Erteilt}
                zurZustimmung={
                  schritt !== ersterArt9Index && art9Einwilligungen.length > 0 && ersterArt9Index >= 0
                    ? () => geheZu(ersterArt9Index, vonUebersicht)
                    : null
                }
                antworten={antworten}
                feldFehler={feldFehler}
                onAendern={setzeAntwort}
              />
            )}
          </div>

          <p role="status" className="sr-only">
            {art9Ansage}
          </p>

          {/* Beide Live-Regionen stehen immer im DOM — eine erst mit dem Text
              eingefügte Region sagen Screenreader oft nicht an. */}
          <MeldungsBox meldung={fehler ? { art: "fehler", text: fehler } : null} className="mt-6" />
        </div>

        <div className={`sticky bottom-0 border-t border-linie ${grund}`}>
          <div className="mx-auto w-full max-w-xl px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
            <button type="submit" disabled={laeuft} className={knopf("primaer", "gross")}>
              {aufUebersicht
                ? sendet
                  ? "Wird gesendet …"
                  : "Anmeldung absenden"
                : vonUebersicht
                  ? "Zur Übersicht"
                  : "Weiter"}
            </button>
          </div>
        </div>
      </form>

      <Blatt
        offen={spaeterOffen}
        onSchliessen={() => setSpaeterOffen(false)}
        titel="Später weitermachen"
        fuss={
          speichert ? null : hinweis ? (
            <button type="button" onClick={() => setSpaeterOffen(false)} className={knopf("sekundaer")}>
              Weiter ausfüllen
            </button>
          ) : (
            <>
              <button type="button" onClick={() => setSpaeterOffen(false)} className={knopf("sekundaer")}>
                Abbrechen
              </button>
              <button type="button" onClick={() => void zwischenspeichern()} className={knopf("primaer")}>
                {spaeterFehler ? "Noch einmal versuchen" : "Zwischenstand speichern"}
              </button>
            </>
          )
        }
      >
        {!speichert && !hinweis && !spaeterFehler && nichtGesichertText && (
          <p className="text-sm leading-relaxed text-foreground">
            Dabei bleiben {nichtGesichertText} außen vor — diese Angaben speichern wir erst beim Absenden. Was Sie dort
            schon eingetragen haben, bleibt nur erhalten, solange diese Seite geöffnet ist.
          </p>
        )}
        <p role="status" className={speichert || hinweis ? "text-sm leading-relaxed text-foreground" : "sr-only"}>
          {speichert ? "Wird gespeichert …" : (hinweis ?? "")}
        </p>
        <MeldungsBox meldung={spaeterFehler ? { art: "fehler", text: spaeterFehler } : null} />
        {hinweis && fortsetzenUrl && (
          <div className="mt-4">
            <label htmlFor="fortsetzen-link" className={FELD_TITEL}>
              Ihr Link zum Fortsetzen
            </label>
            {/* Nur lesbar statt als anklickbarer Link: Ein Klick darauf lüde die
                Seite neu — und was nicht zwischengespeichert ist, wäre weg. */}
            <input
              id="fortsetzen-link"
              type="text"
              readOnly
              value={fortsetzenUrl}
              onFocus={(e) => e.target.select()}
              className="block h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3 font-mono text-xs text-foreground"
            />
            <button type="button" onClick={linkKopieren} className={`${knopf("primaer", "gross")} mt-3`}>
              Link kopieren
            </button>
            <p role="status" className="mt-1.5 text-[13px] text-foreground">
              {kopiert === "ok"
                ? "Link kopiert."
                : kopiert === "fehler"
                  ? "Kopieren hat nicht geklappt — bitte den Link im Feld markieren und kopieren."
                  : ""}
            </p>
          </div>
        )}
      </Blatt>
    </>
  );
}

/** Kopfzeile: Rückweg links, „Anmeldung“ in der Mitte, „Später“ rechts. */
function Kopf({ links, rechts }: { links?: ReactNode; rechts?: ReactNode }) {
  return (
    <header className="mx-auto grid h-14 w-full max-w-xl grid-cols-[1fr_auto_1fr] items-center px-2">
      <div className="justify-self-start">{links}</div>
      <h1 className="text-base font-semibold text-foreground">Anmeldung</h1>
      <div className="justify-self-end">{rechts}</div>
    </header>
  );
}

/** Ein Abschnitt als Schritt: Titel, Vorspann, ggf. die Art.-9-Zustimmung, dann die Felder. */
function SchrittInhalt({
  abschnitt,
  titelRef,
  vorspann,
  zustimmung,
  gesperrt,
  zurZustimmung,
  antworten,
  feldFehler,
  onAendern,
}: {
  abschnitt: OeffentlicherAbschnitt;
  titelRef: RefObject<HTMLHeadingElement | null>;
  vorspann: ReactNode;
  zustimmung: ReactNode;
  /** Reiner Art.-9-Abschnitt ohne Einwilligung: die Fragen bleiben verborgen. */
  gesperrt: boolean;
  /** Sprung zum Schritt mit der Zustimmung, wenn sie nicht in diesem Schritt steht. */
  zurZustimmung: (() => void) | null;
  antworten: Antworten;
  feldFehler: Record<string, string>;
  onAendern: (code: string, wert: unknown) => void;
}) {
  return (
    <>
      <h2
        ref={titelRef}
        tabIndex={-1}
        className="hyphens-auto break-words text-[29px] font-bold leading-tight tracking-tight text-foreground outline-none"
      >
        {abschnitt.titel}
      </h2>
      {vorspann}
      {abschnitt.beschreibung && (
        <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{abschnitt.beschreibung}</p>
      )}
      {zustimmung}

      {gesperrt ? (
        <p className="mt-5 text-[15px] leading-relaxed text-muted-foreground">
          Diese Fragen erscheinen, sobald Sie der Verarbeitung von Angaben zu Glaube und Gemeindezugehörigkeit
          zugestimmt haben.
          {zurZustimmung && (
            <>
              {" "}
              <button
                type="button"
                onClick={zurZustimmung}
                className="font-medium text-primary underline underline-offset-2"
              >
                Zur Zustimmung
              </button>
            </>
          )}
        </p>
      ) : (
        <div className="mt-6 space-y-6">
          {abschnitt.felder.map((feld) => (
            <Feld
              key={feld.code}
              feld={feld}
              wert={antworten[feld.code]}
              fehler={feldFehler[feld.code]}
              onAendern={(wert) => onAendern(feld.code, wert)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function bewegungErlaubt(): boolean {
  return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
