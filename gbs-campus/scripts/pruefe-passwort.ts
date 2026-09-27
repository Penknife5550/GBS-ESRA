/**
 * Gegenprobe für die Passwortlogik.
 *
 * Ohne Datenbank. Läuft über `npm run pruefen` mit.
 *
 * ACHTUNG beim Erweitern: Eine Prüfung beweist erst dann etwas, wenn sie ROT
 * wird, sobald man die geprüfte Regel entfernt. Regel in `src/lib/passwort.ts`
 * auskommentieren, Skript laufen lassen — bleibt es grün, prüft die neue Zeile
 * nicht das, was sie behauptet.
 */

import { readFileSync } from "fs";
import {
  hashePasswort,
  PASSWORT_MAX_LAENGE,
  passwortStimmt,
  pruefePasswort,
  verbrenneZeitWieEinePruefung,
} from "../src/lib/passwort";

let geprueft = 0;
let fehlgeschlagen = 0;

function pruefe(bezeichnung: string, bedingung: boolean, zusatz?: unknown) {
  geprueft++;
  if (bedingung) {
    console.log(`  ok    ${bezeichnung}`);
  } else {
    fehlgeschlagen++;
    console.log(`  FEHLT ${bezeichnung}`);
    if (zusatz !== undefined) console.log("        ", JSON.stringify(zusatz));
  }
}

const MIN = 10;

/**
 * Laufzeit einer Rechenoperation als MEDIAN mehrerer Läufe.
 *
 * Ein einzelner Lauf taugt hier nicht: Der erste scrypt-Aufruf eines Prozesses
 * ist regelmäßig der langsamste (deshalb der ungewertete Aufwärmlauf), und ein
 * einzelner Ausreißer durch Speicherbereinigung oder fremde Last auf der
 * Maschine entschiede sonst über Grün und Rot. Der Median wirft beides hinaus,
 * ohne dass die Grenzen dafür aufgeweicht werden müssten.
 */
async function medianMs(lauf: () => Promise<unknown>, laeufe = 5): Promise<number> {
  await lauf();

  const zeiten: number[] = [];
  for (let i = 0; i < laeufe; i++) {
    const begonnen = process.hrtime.bigint();
    await lauf();
    zeiten.push(Number(process.hrtime.bigint() - begonnen) / 1_000_000);
  }
  zeiten.sort((a, b) => a - b);
  return zeiten[Math.floor(zeiten.length / 2)];
}

async function main() {
  console.log("\n1. Regeln");
  pruefe("ausreichend langes Passwort wird angenommen", pruefePasswort("Der Herr ist mein Hirte", MIN).length === 0);
  // Auf die MELDUNG statt auf die Anzahl: „irgendeine Meldung" käme auch von
  // einer ganz anderen Regel, und die Zeile bliebe grün, wenn man die
  // Längenprüfung entfernte.
  pruefe(
    "zu kurzes Passwort wird abgewiesen",
    pruefePasswort("kurz", MIN).some((m) => m.meldung.includes("mindestens")),
  );
  pruefe(
    "genau die Mindestlänge reicht",
    pruefePasswort("a".repeat(MIN), MIN).length === 0,
  );
  pruefe(
    "ein Zeichen zu wenig reicht nicht",
    pruefePasswort("a".repeat(MIN - 1), MIN).some((m) => m.meldung.includes("mindestens")),
  );
  pruefe(
    "überlanges Passwort wird abgewiesen",
    pruefePasswort("a".repeat(PASSWORT_MAX_LAENGE + 1), MIN).some((m) => m.meldung.includes("höchstens")),
  );
  pruefe(
    "Zahl statt Text wird abgewiesen",
    pruefePasswort(12345678901, MIN).some((m) => m.meldung.includes("Bitte ein Passwort angeben")),
  );
  pruefe(
    "die eigene E-Mail-Adresse ist kein Passwort",
    pruefePasswort("petra@beispiel.de", 8, "Petra@Beispiel.DE").some((m) => m.meldung.includes("E-Mail")),
  );
  // Leerzeichen am Rand sind erlaubte Zeichen und zählen zur Länge. Wer hier ein
  // `trim()` einbaut, macht aus einem gültigen Passwort ein anderes: Diese
  // Eingabe wäre dann acht Zeichen lang und würde abgewiesen — und alle, die ihr
  // Passwort mit einem Leerzeichen aus der Zwischenablage einfügen, kämen nicht
  // mehr hinein.
  pruefe(
    "Leerzeichen am Rand zählen zur Länge des Passworts",
    pruefePasswort("  12345678", MIN).length === 0,
    pruefePasswort("  12345678", MIN),
  );
  // Keine Regeln über Sonderzeichen: Sie erzeugen „Passwort1!" und Zettel am
  // Bildschirm. Ein langer Satz aus Kleinbuchstaben ist besser.
  pruefe(
    "ein reiner Kleinbuchstaben-Satz ist erlaubt",
    pruefePasswort("mein hund heisst bello und ist braun", MIN).length === 0,
  );

  console.log("\n2. Hashen und Prüfen");
  const hash = await hashePasswort("Der Herr ist mein Hirte");
  pruefe("der Hash trägt das erwartete Format", /^scrypt\$\d+\$\d+\$\d+\$[^$]+\$[^$]+$/.test(hash), hash.slice(0, 30));
  pruefe("das Passwort steht NICHT im Hash", !hash.includes("Hirte"));
  pruefe("richtiges Passwort wird erkannt", await passwortStimmt("Der Herr ist mein Hirte", hash));
  pruefe("falsches Passwort wird abgewiesen", !(await passwortStimmt("Der Herr ist mein Hirt", hash)));
  pruefe("Groß- und Kleinschreibung zählt", !(await passwortStimmt("der herr ist mein hirte", hash)));
  pruefe("leeres Passwort wird abgewiesen", !(await passwortStimmt("", hash)));

  // Dieselbe Regel eine Ebene tiefer: `passwort.ts` trimmt bewusst nicht und
  // schreibt das ausdrücklich hin. Ohne diese Gegenprobe fiele ein später
  // eingefügtes `.trim()` erst auf, wenn sich jemand mit Randleerzeichen im
  // Passwort nicht mehr anmelden kann — und die Ursache wäre nicht zu erraten.
  const mitRand = await hashePasswort(" Der Herr ist mein Hirte ");
  pruefe("Randleerzeichen gehören zum Passwort", await passwortStimmt(" Der Herr ist mein Hirte ", mitRand));
  pruefe(
    "ohne die Randleerzeichen passt dasselbe Passwort nicht",
    !(await passwortStimmt("Der Herr ist mein Hirte", mitRand)),
  );

  const zweiter = await hashePasswort("Der Herr ist mein Hirte");
  // Ohne eigenen Zufallswert je Passwort verrieten gleiche Hashes, dass zwei
  // Konten dasselbe Passwort haben — und eine einzige Regenbogentabelle träfe alle.
  pruefe("gleiches Passwort ergibt zweimal einen anderen Hash", hash !== zweiter);
  pruefe("trotzdem passt auch der zweite Hash", await passwortStimmt("Der Herr ist mein Hirte", zweiter));

  console.log("\n3. Kaputte gespeicherte Werte legen nichts lahm");
  pruefe("kein Passwort hinterlegt", !(await passwortStimmt("egal", null)));
  pruefe("leerer Wert", !(await passwortStimmt("egal", "")));
  pruefe("fremdes Format", !(await passwortStimmt("egal", "bcrypt$2b$12$abc")));
  pruefe("abgeschnittener Wert", !(await passwortStimmt("egal", "scrypt$32768$8$1$abc")));
  pruefe("unsinnige Parameter", !(await passwortStimmt("egal", "scrypt$x$y$z$abc$def")));
  pruefe("Klartext statt Hash", !(await passwortStimmt("Der Herr ist mein Hirte", "Der Herr ist mein Hirte")));

  console.log("\n4. Gleiche Laufzeit bei unbekannter Adresse");
  // Ohne diesen Ausgleich verriete die Antwortzeit, ob es ein Konto gibt — und
  // damit, wer die Bibelschule besucht (Art. 9 DSGVO).
  const echt = await medianMs(() => passwortStimmt("Der Herr ist mein Hirte", hash));
  const leer = await medianMs(() => verbrenneZeitWieEinePruefung());

  pruefe("eine echte Prüfung kostet messbar Zeit (Aufwand greift)", echt >= 20, `${echt.toFixed(1)} ms`);
  // NUR noch eine Verhältnistoleranz. Vorher stand hier zusätzlich
  // `Math.abs(leer - echt) <= 30`, und genau dieser Zweig machte die Prüfung
  // wertlos: Braucht die echte Prüfung auf einer schnellen Maschine 25 ms, dann
  // liegt auch ein vollständig entfernter Ausgleich (leer ≈ 0 ms) innerhalb von
  // 30 ms — die Zeile wäre grün geblieben, obwohl der Schutz weg ist.
  //
  // Faktor 2 auf dem Median: eng genug, um „gar nicht gerechnet" zu erkennen
  // (ohne Ausgleich liegt `leer` bei Bruchteilen einer Millisekunde), und weit
  // genug für die Schwankungen einer belasteten Maschine.
  pruefe(
    "der Ausgleich kostet dieselbe Größenordnung",
    leer >= echt / 2 && leer <= echt * 2,
    `echt ${echt.toFixed(1)} ms, Ausgleich ${leer.toFixed(1)} ms`,
  );

  // Aufgeblasene Kostenparameter im gespeicherten Wert: 128 * N * r Byte sind
  // bei N = 2^22 vier Gigabyte — je Anmeldeversuch. Wer eine Zeile in `person`
  // schreiben kann, legt damit den Dienst mit einer einzigen Anfrage um.
  // Abgewiesen wird, BEVOR scrypt anläuft; messbar daran, dass die Abweisung
  // keine Rechenzeit kostet.
  //
  // Gegenprobe zu Regel 2, und die fällt hier anders aus als sonst: Diese Zeile
  // wird von keiner EINZELNEN Änderung rot, weil der Schutz doppelt liegt.
  // Nimmt man nur die Grenze `128 * n * r > MAXMEM` heraus, weist Node selbst ab
  // (ERR_CRYPTO_INVALID_SCRYPT_PARAMS, gemessen 4 ms). Nimmt man nur
  // `maxmem: MAXMEM` heraus und zieht die Grenze aus dem Datensatz, fängt es die
  // Grenze oben ab. Erst beides zusammen rechnet wirklich: gemessen 15.866 ms
  // für einen Anmeldeversuch. Genau dann wird diese Zeile rot — deshalb steht
  // sie hier, obwohl die Einzelmutation grün bleibt.
  const aufgeblasen =
    "scrypt$4194304$8$1$" + Buffer.alloc(16, 1).toString("base64") + "$" + Buffer.alloc(64, 2).toString("base64");
  const vorAbweisung = process.hrtime.bigint();
  const grossAbgewiesen = !(await passwortStimmt("egal", aufgeblasen));
  const abweisungMs = Number(process.hrtime.bigint() - vorAbweisung) / 1_000_000;

  pruefe("aufgeblasene Kostenparameter werden abgewiesen", grossAbgewiesen);
  // Verhältnis statt fester Grenze: Zwischen 0,8 ms und einer echten Prüfung
  // liegen drei Größenordnungen, der Faktor 4 ist also nicht knapp bemessen und
  // schlägt auch auf einer belasteten Maschine nicht grundlos aus.
  pruefe(
    "die Abweisung kostet keine scrypt-Runde",
    abweisungMs <= echt / 4,
    `Abweisung ${abweisungMs.toFixed(1)} ms, echte Prüfung ${echt.toFixed(1)} ms`,
  );

  console.log("\n5. Der Anmeldeweg verrät nichts");
  let quelltext = "";
  try {
    quelltext = readFileSync("src/app/api/auth/passwort/route.ts", "utf8");
  } catch {
    quelltext = "";
  }
  pruefe("Quelltext der Anmelderoute ist lesbar", quelltext.length > 0);
  // Genau eine Meldung für „kein Konto", „kein Passwort gesetzt" und „falsches
  // Passwort" — sonst ist der Endpunkt ein Verzeichnis aller Teilnehmer. Geprüft
  // wird auf die gemeinsame Konstante, nicht auf einzelne Wörter: Ein neuer Text
  // ließe eine Wortsuche durchgehen, eine abweichende Konstante nicht.
  const abgelehnt = quelltext.match(/fehler\(ABGELEHNT, 401\)/g) ?? [];
  pruefe("jede Ablehnung nutzt dieselbe Konstante", abgelehnt.length >= 3, `${abgelehnt.length} Stellen`);
  pruefe(
    "keine Ablehnung mit eigenem Text",
    quelltext.length > 0 && !/fehler\(\s*"[^"]*",\s*401\s*\)/.test(quelltext),
  );
  // Gesucht ist der AUFRUF, nicht der Name: `quelltext.includes("verbrenne…")`
  // war schon durch die Import-Zeile erfüllt. Wer den Aufruf löschte und den
  // Import stehen ließ — was der Linter erst beim nächsten Lauf meldet —, blieb
  // grün, obwohl die Laufzeit wieder verriet, ob es das Konto gibt.
  pruefe(
    "bei unbekannter Adresse wird trotzdem gerechnet",
    /await\s+verbrenneZeitWieEinePruefung\s*\(/.test(quelltext),
  );

  // Dasselbe für die Drossel — und zusätzlich ihre Stellung: Sie muss VOR der
  // Passwortprüfung greifen. Steht sie dahinter, kostet jeder Fehlversuch eine
  // volle scrypt-Berechnung (32 MB Arbeitsspeicher, ~100 ms). Ein paar Dutzend
  // gleichzeitige Versuche legen den Dienst dann lahm, ohne dass ein einziges
  // Passwort erraten werden müsste. Verglichen werden die Fundstellen im Text;
  // die Import-Zeilen zählen nicht mit, weil dort auf den Namen kein „(" folgt.
  const drosselStelle = quelltext.indexOf("drosselUeberschritten(");
  const pruefStelle = quelltext.indexOf("passwortStimmt(");
  pruefe("die Anmeldung ist gedrosselt", drosselStelle >= 0);
  pruefe(
    "die Drossel greift VOR der Passwortprüfung",
    drosselStelle >= 0 && pruefStelle > drosselStelle,
    { drosselStelle, pruefStelle },
  );

  console.log("\n6. Die Drossel zählt atomar (Sperre je Schlüssel)");
  let magicLink = "";
  let anmeldung = "";
  try {
    magicLink = readFileSync("src/lib/magic-link.ts", "utf8");
    anmeldung = readFileSync("src/app/api/anmeldung/route.ts", "utf8");
  } catch {
    // leer lassen — die Prüfungen unten werden dann rot
  }
  const drossel = magicLink.slice(
    magicLink.indexOf("export async function drosselUeberschritten("),
    magicLink.indexOf("export type LinkErgebnis"),
  );
  // Ohne Sperre lasen gleichzeitige Anfragen denselben Stand „noch unter der
  // Grenze" und kamen alle durch. Zählen und Schreiben müssen deshalb in einer
  // Transaktion HINTER der Sperre stehen, und zwar über `tx`, nicht `prisma`.
  pruefe(
    "Zählen und Schreiben laufen in einer Transaktion hinter pg_advisory_xact_lock je Schlüssel",
    /return prisma\.\$transaction\(async \(tx\) => \{\s*await tx\.\$executeRaw`SELECT pg_advisory_xact_lock\(hashtextextended\(\$\{schluessel\}, 0\)\)`;\s*const bisher = await tx\.rateLimit\.count\(/.test(
      drossel,
    ) &&
      /await tx\.rateLimit\.create\(/.test(drossel) &&
      !/prisma\.rateLimit\./.test(drossel),
  );
  pruefe(
    "das Anmeldeformular hat keine eigene Drossel-Kopie mehr (nutzt drosselUeberschritten)",
    anmeldung.length > 0 && /drosselUeberschritten\(/.test(anmeldung) && !/rateLimit\.(count|create)\(/.test(anmeldung),
  );

  // Soll-Anzahl: Ein nicht gelaufener Test schlägt nicht fehl, er fehlt nur —
  // und die Schlusszeile meldete trotzdem „0 fehlgeschlagen". Beim Ergänzen
  // einer Prüfung gehört diese Zahl mit angehoben.
  const ERWARTET = 38;
  // `geprueft` steht beim Auswerten der Bedingung noch auf dem Stand VOR dieser
  // Zeile — `pruefe` zählt erst im Rumpf hoch. Deshalb hier um eins
  // vorgegriffen, damit sich die Prüfung selbst mitzählt.
  const gelaufen = geprueft + 1;
  pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

  console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
  process.exit(fehlgeschlagen === 0 ? 0 : 1);
}

main().catch((fehler) => {
  console.error(fehler);
  process.exit(1);
});
