import { ladeEinwilligungstexte, ladeVeroeffentlichteFassung } from "@/lib/anmeldung";
import { baueFormularStempel, stempelGeheimnis } from "@/lib/anmelde-schutz";
import { EINRICHTUNG } from "@/lib/constants";
import { aktenfeldVerlangtArt9 } from "@/lib/formular-optionen";
import { OeffentlicheSeite } from "@/app/anmelden/oeffentlich";
import {
  EinwilligungsAngebot,
  OeffentlicherAbschnitt,
  OeffentlichesFormular,
} from "./oeffentliches-formular";

export const dynamic = "force-dynamic";

export const metadata = {
  // Die öffentliche Anmeldung trägt den Namen der Schule, nicht den des Portals.
  title: { absolute: `Anmeldung — ${EINRICHTUNG.name}` },
};

/**
 * Das öffentliche Anmeldeformular — Schritt für Schritt, außerhalb des
 * App-Rahmens (Kopfzeile, Fortschritt und „Weiter“ bringt das Formular mit).
 *
 * Eine begonnene Anmeldung lädt das Formular selbst: Der Link zum Fortsetzen
 * trägt den Token im Fragment (#fortsetzen=…), das nie beim Server ankommt —
 * diese Seite sieht ihn deshalb gar nicht (und liest bewusst keine
 * Query-Parameter mehr, siehe oeffentliches-formular.tsx).
 */
export default async function AnmeldungSeite() {
  const version = await ladeVeroeffentlichteFassung();
  if (!version) {
    return (
      <OeffentlicheSeite
        zurueck={{ href: "/", text: "Start" }}
        titel="Anmeldung derzeit nicht möglich"
        satz="Zurzeit ist kein Anmeldeformular veröffentlicht. Bitte wenden Sie sich an die Schulleitung."
      />
    );
  }

  const texte = await ladeEinwilligungstexte();
  const einwilligungen: EinwilligungsAngebot[] = texte.map((t) => ({
    code: t.code,
    titel: t.titel,
    text: t.text,
    istArt9: t.istArt9,
    pflicht: t.pflicht,
  }));

  const abschnitte: OeffentlicherAbschnitt[] = version.abschnitte.map((abschnitt) => ({
    titel: abschnitt.titel,
    beschreibung: abschnitt.beschreibung,
    felder: abschnitt.felder.map((feld) => ({
      code: feld.code,
      typ: feld.typ,
      label: feld.label,
      hilfetext: feld.hilfetext,
      platzhalter: feld.platzhalter,
      pflicht: feld.pflicht,
      optionen: Array.isArray(feld.optionen) ? (feld.optionen as string[]) : null,
      // Die Gemeinde gilt immer als Art. 9 — auch in einer Fassung, die vor
      // dieser Regel ohne Häkchen veröffentlicht wurde (wie `giltAlsArt9` auf
      // dem Server).
      istArt9: feld.istArt9 || aktenfeldVerlangtArt9(feld.personFeld),
      personFeld: feld.personFeld,
    })),
  }));

  return (
    <main>
      <OeffentlichesFormular
        versionId={version.id}
        einleitung={version.einleitung}
        abschnitte={abschnitte}
        einwilligungen={einwilligungen}
        // Wann der Server das Formular ausgeliefert hat, signiert — gegen
        // Roboter, die im selben Moment absenden (lib/anmelde-schutz.ts).
        // Die Seite ist force-dynamic, der Zeitpunkt also je Aufruf neu.
        formularStempel={baueFormularStempel(Date.now(), stempelGeheimnis())}
      />
    </main>
  );
}
