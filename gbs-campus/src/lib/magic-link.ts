/**
 * GBS Campus — Magic-Link
 *
 * Der Regelweg ins Portal — und für alle, die kein Passwort gesetzt haben, der
 * einzige. Entsprechend gehärtet:
 *  - Der Token ist eine UUID (122 Bit) und liegt nur als SHA-256-Hash in der DB.
 *    Ein Datenbankleck erlaubt damit keine Kontoübernahme.
 *  - Einmalig: nach dem Einlösen wird benutztAm gesetzt und der Link ist tot.
 *    Eingeloest wird per POST von einer Bestaetigungsseite aus, damit Link-Scanner
 *    in Mail-Sicherheitsloesungen den Token nicht vorab verbrauchen.
 *  - Kurzlebig: standardmaessig 30 Minuten, einstellbar zwischen 5 Minuten und
 *    24 Stunden unter /verwaltung/einstellungen.
 *  - Gedrosselt, je Adresse und je IP.
 *  - Die Antwort verrät nie, ob es die Adresse gibt — sonst wäre der Endpunkt
 *    ein Verzeichnis aller Teilnehmer. Das gilt für den Inhalt der Antwort UND
 *    für ihre Laufzeit, siehe MINDESTLAUFZEIT_MS.
 */

import { createHash, randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { fuelleVorlage, sendeMail } from "@/lib/mailer";
import { zahl } from "@/lib/einstellungen";
import { raeumeGelegentlichAuf } from "@/lib/aufraeumen";
import { MAIL_VORLAGE, MINUTE_MS } from "@/lib/constants";
import { drosselSchluesselFuerIp } from "@/lib/request-kontext";

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Zählt Anfragen im Zeitfenster und schreibt die aktuelle mit.
 * Bewusst in Postgres statt in Redis — siehe README, Abschnitt „Abweichungen".
 *
 * Exportiert, weil die E-Mail-Änderung dieselbe Drossel braucht: Auch dort
 * verschickt das System auf Zuruf eine Mail an eine frei gewählte Adresse.
 * Alle Drosseln des Systems laufen hierüber (auch die des Anmeldeformulars).
 *
 * Zählen und Schreiben stehen in EINER Transaktion unter einer Sperre je
 * Schlüssel (`pg_advisory_xact_lock`, Muster wie `mitDmsSperre` in
 * dms.ts, hier aber wartend). Vorher lasen gleichzeitige Anfragen alle
 * denselben Stand „noch unter der Grenze" und kamen alle durch — mit parallelen
 * Anfragen ließ sich jede Drossel um ein Vielfaches überschreiten. Die Sperre
 * gilt nur für diesen einen Schlüssel und endet mit der Transaktion; sie wird
 * per `$executeRaw` genommen, weil `$queryRaw` den Rückgabetyp void nicht lesen
 * kann.
 *
 * Für Schlüssel je Anschluss die Adresse über `drosselSchluesselFuerIp`
 * kürzen (IPv6 → /64), sonst bekommt jedes Gerät mit IPv6 beliebig viele
 * Kontingente.
 */
export async function drosselUeberschritten(schluessel: string, hoechstzahl: number, fensterMinuten: number): Promise<boolean> {
  const seit = new Date(Date.now() - fensterMinuten * MINUTE_MS);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${schluessel}, 0))`;
    const bisher = await tx.rateLimit.count({ where: { schluessel, zeitpunkt: { gte: seit } } });
    if (bisher >= hoechstzahl) return true;

    await tx.rateLimit.create({ data: { schluessel } });
    return false;
  });
}

/**
 * `gedrosselt` ist alles, was die öffentliche Route `/api/auth/anmelden`
 * auswertet — sie darf nichts darüber sagen, ob es die Adresse gibt.
 * `drossel` und `gesendet` sind für den Weg der Verwaltung
 * (`/api/personen/[id]/anmeldelink`): Die Person ist dort bekannt, und wer am
 * Telefon „ist unterwegs" sagt, muss wissen, ob das stimmt (Code-Review 4).
 */
export type LinkErgebnis = {
  gedrosselt: boolean;
  /** Welche Drossel gegriffen hat: je Adresse oder je Anschluss (IP); sonst null. */
  drossel: "ADRESSE" | "IP" | null;
  /** Ob die Mail den Mailserver erreicht hat. false auch bei unbekannter Adresse oder Endzustand. */
  gesendet: boolean;
};

/**
 * „30 Minuten" statt „90 Minuten", wenn der Wert glatt in Stunden aufgeht.
 * Der Text steht so in der Mail — „1440 Minuten" würde niemand lesen wollen.
 */
export function gueltigkeitAlsText(minuten: number): string {
  if (minuten < 60) return `${minuten} Minuten`;
  if (minuten % 1440 === 0) {
    const tage = minuten / 1440;
    return tage === 1 ? "einen Tag" : `${tage} Tage`;
  }
  if (minuten % 60 === 0) {
    const stunden = minuten / 60;
    return stunden === 1 ? "eine Stunde" : `${stunden} Stunden`;
  }
  return `${minuten} Minuten`;
}

/**
 * Untergrenze für die Laufzeit einer Anfrage nach einem Anmeldelink.
 *
 * Ohne sie verrät der Endpunkt trotz gleichlautender Antwort, wer hier
 * Teilnehmer ist: Bei einer unbekannten Adresse steigt die Funktion direkt nach
 * der Datenbankabfrage aus (wenige Millisekunden), bei einer bekannten kommt
 * die Antwort erst nach dem abgewarteten Versand über den Mailserver (je nach
 * Gegenstelle 150–400 ms). Dieser Unterschied ist über das Internet messbar,
 * und die Auskunft „diese Person besucht die Bibelschule" ist eine Angabe zur
 * Religionszugehörigkeit (Art. 9 DSGVO).
 *
 * Der Wert liegt bewusst deutlich über dem längsten erwarteten Versand. Wird
 * der Mailserver einmal langsamer als die Untergrenze, verlängert sich nur der
 * Zweig mit bekannter Adresse — und der Unterschied wäre wieder messbar.
 * Deshalb großzügig gewählt und nicht knapp auf den Durchschnitt gesetzt.
 */
const MINDESTLAUFZEIT_MS = 700;

/**
 * Wartet, bis seit `begonnen` die Mindestlaufzeit vergangen ist.
 *
 * Das ist keine vergessene Debug-Bremse und kein Schönheitsfehler: Die
 * Verzögerung IST die Schutzmaßnahme (siehe MINDESTLAUFZEIT_MS). Wer sie
 * herausnimmt, weil sich die Anmeldung träge anfühlt, macht diesen Endpunkt
 * wieder zur Auskunftsstelle darüber, wer die Bibelschule besucht.
 */
async function warteAufMindestlaufzeit(begonnen: number): Promise<void> {
  const rest = MINDESTLAUFZEIT_MS - (Date.now() - begonnen);
  if (rest <= 0) return;
  await new Promise<void>((aufloesen) => {
    setTimeout(() => aufloesen(), rest);
  });
}

/**
 * Fordert einen Magic-Link an. Gibt absichtlich keine Auskunft darüber, ob die
 * Adresse bekannt ist — weder über den Rückgabewert noch über die Laufzeit.
 */
export async function fordereMagicLinkAn(
  email: string,
  ipAdresse: string | null,
  userAgent: string | null,
): Promise<LinkErgebnis> {
  const begonnen = Date.now();

  // Gelegenheit zum Aufraeumen — hoechstens stuendlich, nicht blockierend.
  raeumeGelegentlichAuf();

  const adresse = email.trim().toLowerCase();

  const [gueltigMinuten, maxProAdresse, maxProIp, fensterMinuten] = await Promise.all([
    zahl("AUTH_MAGIC_LINK_GUELTIG_MINUTEN"),
    zahl("AUTH_MAGIC_LINK_MAX_PRO_ADRESSE"),
    zahl("AUTH_MAGIC_LINK_MAX_PRO_IP"),
    zahl("AUTH_DROSSEL_FENSTER_MINUTEN"),
  ]);

  // Beide Drosseln laufen VOR der Abfrage nach der Person. Sie können deshalb
  // nichts darüber verraten, ob es die Adresse gibt — ihre Laufzeit hängt allein
  // von der Zahl der bisherigen Anfragen ab. Sie werden bewusst NICHT auf die
  // Mindestlaufzeit gestreckt: Was sie mitteilen, steht ohnehin offen in der
  // Antwort (429), und eine langsame Drossel hält niemanden auf, der sowieso
  // abgewiesen wird.
  if (await drosselUeberschritten(`MAGIC_LINK:${adresse}`, maxProAdresse, fensterMinuten)) {
    return { gedrosselt: true, drossel: "ADRESSE", gesendet: false };
  }
  if (
    ipAdresse &&
    (await drosselUeberschritten(`MAGIC_LINK_IP:${drosselSchluesselFuerIp(ipAdresse)}`, maxProIp, fensterMinuten))
  ) {
    return { gedrosselt: true, drossel: "IP", gesendet: false };
  }

  const person = await prisma.person.findUnique({ where: { email: adresse }, include: { status: true } });
  // Unbekannte Adresse oder Endzustand: still aussteigen, aber so tun, als sei
  // alles normal — einschließlich der Zeit, die ein echter Versand gebraucht
  // hätte. Ab hier hängt jeder Ausgang davon ab, ob es die Person gibt; deshalb
  // steht vor jedem weiteren `return` die Mindestlaufzeit.
  if (!person || person.status.istTerminal) {
    await warteAufMindestlaufzeit(begonnen);
    return { gedrosselt: false, drossel: null, gesendet: false };
  }

  const token = randomUUID();
  await prisma.magicLink.create({
    data: {
      personId: person.id,
      tokenHash: hashToken(token),
      laeuftAb: new Date(Date.now() + gueltigMinuten * MINUTE_MS),
      angefordertVonIp: ipAdresse,
      userAgent,
    },
  });

  const basis = process.env.APP_URL ?? "http://localhost:3000";
  // Token im URL-FRAGMENT (#), nicht im Query-String: Das Fragment schickt der
  // Browser nicht an den Server, es landet also in keinem Zugriffslog des
  // Reverse Proxy und in keiner Browser-History-Weitergabe an Dritte. Die
  // Bestaetigungsseite liest ihn clientseitig aus location.hash. Ein Link-Scanner,
  // der die URL vorab abruft, bekommt den Token damit gar nicht erst zu sehen.
  const link = `${basis}/anmelden/token#token=${token}`;

  const vorlage = await prisma.emailVorlage.findUnique({ where: { code: MAIL_VORLAGE.MAGIC_LINK } });
  const werte = {
    vorname: person.vorname,
    link,
    gueltigkeit: gueltigkeitAlsText(gueltigMinuten),
  };

  const { gesendet } = await sendeMail({
    an: person.email,
    personId: person.id,
    vorlageCode: MAIL_VORLAGE.MAGIC_LINK,
    betreff: fuelleVorlage(vorlage?.betreff ?? "Ihr Zugang zu GBS Campus", werte),
    text: fuelleVorlage(vorlage?.textMd ?? `Hallo {{vorname}},\n\n{{link}}`, werte),
  });

  // Meist ist die Mindestlaufzeit hier schon verstrichen und es wird gar nicht
  // gewartet. Der Aufruf steht trotzdem da: Antwortet der Mailserver einmal
  // ungewöhnlich schnell, wäre der bekannte Fall sonst der kürzere.
  await warteAufMindestlaufzeit(begonnen);
  return { gedrosselt: false, drossel: null, gesendet };
}

/**
 * Löst einen Token ein. Liefert die Personen-ID oder null.
 * Das Entwerten läuft als bedingtes Update: Zwei gleichzeitige Aufrufe mit
 * demselben Token können nicht beide gewinnen.
 *
 * Entwertet wird hier, also VOR dem Anlegen der Sitzung in
 * api/auth/token — Begründung dort.
 */
export async function loeseMagicLinkEin(token: string): Promise<string | null> {
  const eintrag = await prisma.magicLink.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!eintrag) return null;
  if (eintrag.benutztAm) return null;
  if (eintrag.laeuftAb < new Date()) return null;

  const entwertet = await prisma.magicLink.updateMany({
    where: { id: eintrag.id, benutztAm: null },
    data: { benutztAm: new Date() },
  });
  if (entwertet.count !== 1) return null;

  return eintrag.personId;
}
