import { Hinweis } from "@/components/ui/hinweis";
import { OeffentlicheSeite } from "@/app/anmelden/oeffentlich";
import { AuskunftAbrufen } from "./abrufen";

/**
 * Abrufseite für die Datenauskunft nach Art. 15 DSGVO.
 *
 * Öffentlich erreichbar (keine Anmeldung nötig) — der Besitz des kurzlebigen,
 * geheimen Links ist der Nachweis. Der Token steht im URL-FRAGMENT (#token=…),
 * das der Browser nicht an den Server schickt; diese Seite kennt ihn also gar
 * nicht, sondern die Client-Komponente liest ihn und löst per POST auf. Damit
 * landet der Token in keinem Zugriffslog, und Link-Scanner in
 * Mail-Sicherheitslösungen bekommen ihn nicht zu sehen.
 */
export const metadata = { title: "Datenauskunft abrufen" };

export default function AuskunftSeite() {
  return (
    <OeffentlicheSeite
      titel="Ihre Datenauskunft"
      satz="Hier können Sie die Auskunft über die zu Ihnen gespeicherten Daten nach Art. 15 DSGVO als PDF herunterladen."
    >
      <Hinweis className="mt-6">
        Die Auskunft enthält persönliche Angaben — laden Sie sie an einem Ort herunter, zu dem nur Sie Zugang haben.
      </Hinweis>
      <AuskunftAbrufen />
    </OeffentlicheSeite>
  );
}
