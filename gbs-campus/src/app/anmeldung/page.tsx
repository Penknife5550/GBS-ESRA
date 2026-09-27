import { ladeEinwilligungstexte, ladeVeroeffentlichteFassung } from "@/lib/anmeldung";
import { baueFormularStempel, stempelGeheimnis } from "@/lib/anmelde-schutz";
import { EINRICHTUNG } from "@/lib/constants";
import { aktenfeldVerlangtArt9 } from "@/lib/formular-optionen";
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
 * Das öffentliche Anmeldeformular.
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
      <main className="mx-auto max-w-2xl px-6 py-24">
        <h1 className="text-2xl font-bold tracking-tight">Anmeldung derzeit nicht möglich</h1>
        <p className="mt-3 text-muted-foreground">
          Zurzeit ist kein Anmeldeformular veröffentlicht. Bitte wenden Sie sich an die Schulleitung.
        </p>
      </main>
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
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {EINRICHTUNG.name} · {EINRICHTUNG.traeger}
      </p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight">Anmeldung</h1>

      <div className="mt-10">
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
      </div>

    </main>
  );
}
