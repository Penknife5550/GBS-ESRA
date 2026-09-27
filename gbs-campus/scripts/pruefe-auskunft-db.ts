/**
 * Laufzeit-Roundtrip der Datenauskunft — GEGEN eine Datenbank.
 *
 * Ergänzt die datenbankfreien Prüfungen aus `pruefe-auskunft.ts` um den Teil,
 * der nur mit Prisma prüfbar ist: Token anlegen und einlösen, IBAN aus der
 * verschlüsselten Spalte für die Auskunft entschlüsseln, PDF aus echten Daten
 * erzeugen. Läuft über `npm run pruefen:db` (braucht DB + ENCRYPTION_KEY),
 * NICHT über das DB-freie `npm run pruefen`.
 *
 * Die DB muss migriert und geseedet sein (der TeilnehmerStatus wird als
 * Fremdschlüssel gebraucht). Das Skript legt eine Testperson und ein
 * Testsemester (vergangen, nicht laufend) an und räumt beides am Ende wieder weg.
 */

import { createHash, randomUUID } from "crypto";
import { prisma } from "../src/lib/db";
import { verschluesseln } from "../src/lib/encryption";
import { erzeugeAuskunftToken, ruftAuskunftAb, sammleAuskunft, erzeugeAuskunftPdf } from "../src/lib/auskunft";

let geprueft = 0;
let fehlgeschlagen = 0;
function pruefe(bezeichnung: string, bedingung: boolean, zusatz?: unknown) {
  geprueft++;
  if (bedingung) console.log(`  ok    ${bezeichnung}`);
  else {
    fehlgeschlagen++;
    console.log(`  FEHLT ${bezeichnung}`);
    if (zusatz !== undefined) console.log("        ", JSON.stringify(zusatz));
  }
}
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

const EMAIL = "auskunft-roundtrip@example.invalid";
const SEMESTER_CODE = "AUSKUNFT-ROUNDTRIP";

async function lauf() {
  // Vorher aufräumen, falls ein früherer Lauf abgebrochen ist.
  await prisma.datenauskunft.deleteMany({ where: { person: { email: EMAIL } } });
  await prisma.person.deleteMany({ where: { email: EMAIL } });
  await prisma.semester.deleteMany({ where: { code: SEMESTER_CODE } });

  const person = await prisma.person.create({
    data: {
      vorname: "Test",
      nachname: "Auskunft",
      email: EMAIL,
      ibanVerschluesselt: verschluesseln("DE02120300000000202051"),
      kontoinhaber: "Test Auskunft",
      statusCode: "INTERESSENT",
    },
  });

  console.log("\n1. Abruf-Roundtrip (ruftAuskunftAb)");
  const token = await erzeugeAuskunftToken(person.id, null);
  const gespeichert = await prisma.datenauskunft.findFirst({ where: { personId: person.id } });
  pruefe(
    "Token liegt nur als SHA-256-Hash in der DB, nicht im Klartext",
    gespeichert !== null && gespeichert.tokenHash === sha256(token) && gespeichert.tokenHash !== token,
  );

  const abruf1 = await ruftAuskunftAb(token);
  pruefe("gültiger Token → status ok mit richtiger personId", abruf1.status === "ok" && abruf1.personId === person.id, abruf1.status);
  pruefe(
    "der Abruf liefert eine PDF (beginnt mit %PDF)",
    abruf1.status === "ok" && abruf1.pdf.subarray(0, 5).toString("latin1") === "%PDF-",
  );

  const nachAbruf = await prisma.datenauskunft.findFirst({ where: { personId: person.id } });
  pruefe("abgerufenAm wird beim ersten (erfolgreichen) Abruf gesetzt", nachAbruf?.abgerufenAm != null);

  const abruf2 = await ruftAuskunftAb(token);
  pruefe("zweiter Abruf vor Ablauf ist weiterhin erlaubt (bewusst nicht einmalig)", abruf2.status === "ok");

  pruefe("unbekannter Token → status ungueltig", (await ruftAuskunftAb(randomUUID())).status === "ungueltig");

  const abgelaufen = randomUUID();
  await prisma.datenauskunft.create({
    data: { personId: person.id, tokenHash: sha256(abgelaufen), laeuftAb: new Date(Date.now() - 1000) },
  });
  pruefe("abgelaufener Token → status ungueltig", (await ruftAuskunftAb(abgelaufen)).status === "ungueltig");

  console.log("\n2. Verstorbenen-Sperre beim Abruf");
  // Die rechtliche Sperre liegt jetzt in ruftAuskunftAb (testbar). Ein vor dem
  // Tod ausgestellter, noch gültiger Token darf keine Kopie mehr liefern.
  const verstToken = randomUUID();
  await prisma.datenauskunft.create({
    data: { personId: person.id, tokenHash: sha256(verstToken), laeuftAb: new Date(Date.now() + 3_600_000) },
  });
  await prisma.person.update({ where: { id: person.id }, data: { statusCode: "VERSTORBEN" } });
  const abrufVerst = await ruftAuskunftAb(verstToken);
  pruefe("verstorbene Person → status verstorben (keine PDF)", abrufVerst.status === "verstorben", abrufVerst.status);
  const verstEintrag = await prisma.datenauskunft.findFirst({ where: { personId: person.id, tokenHash: sha256(verstToken) } });
  pruefe("ein gesperrter Abruf setzt abgerufenAm NICHT", verstEintrag?.abgerufenAm == null);
  await prisma.person.update({ where: { id: person.id }, data: { statusCode: "INTERESSENT" } });

  console.log("\n3. Datensammlung und PDF");
  const daten = await sammleAuskunft(person.id);
  pruefe(
    "IBAN wird für die Auskunft entschlüsselt (Klartext, vollständige Kopie)",
    Boolean(daten?.stammdaten.find((s) => s.label === "IBAN")?.wert.includes("DE02120300000000202051")),
  );
  pruefe(
    "keine Anmeldung vorhanden führt nicht zum Absturz",
    Array.isArray(daten?.anmeldungen) && daten!.anmeldungen.length === 0,
  );
  pruefe(
    "ohne Teilnahme, Noten, Zeugnis und Unterricht sind die Abschnitte leer (kein Absturz)",
    daten !== null &&
      [daten.teilnahmen, daten.anwesenheiten, daten.leistungen, daten.zeugnisse, daten.unterrichtsabende, daten.honorarAbrechnungen].every(
        (liste) => Array.isArray(liste) && liste.length === 0,
      ),
  );

  const pdf = await erzeugeAuskunftPdf(person.id);
  pruefe("PDF wird aus echten Daten erzeugt und beginnt mit %PDF", pdf?.subarray(0, 5).toString("latin1") === "%PDF-");

  pruefe("PDF für eine unbekannte Person ist null", (await erzeugeAuskunftPdf(randomUUID())) === null);

  console.log("\n4. IBAN-Entschlüsselungsfehler bricht die Auskunft nicht ab");
  // Ein unbrauchbarer Chiffretext (z. B. falscher Schlüssel nach Restore) darf
  // die ganze Auskunft nicht sprengen — er wird benannt und laut geloggt (die
  // erwartete [AUSKUNFT]-Fehlermeldung erscheint hier absichtlich).
  await prisma.person.update({ where: { id: person.id }, data: { ibanVerschluesselt: "kaputt:kaputt:kaputt" } });
  const datenKaputt = await sammleAuskunft(person.id);
  pruefe(
    "unlesbare IBAN → Ersatztext statt Absturz",
    Boolean(datenKaputt?.stammdaten.find((s) => s.label === "IBAN")?.wert.includes("nicht lesbar")),
  );

  console.log("\n5. Abgemeldete Teilnahme und selbst bestätigte Anwesenheit aus echten Daten");
  // Code-Review 4: Rückmeldung zur Semesterüberleitung und Selbstbestätigung
  // gehören in die Auskunft — eine abgemeldete Teilnahme darf dort nicht wie
  // eine gewöhnliche aussehen.
  const semester = await prisma.semester.create({
    data: {
      code: SEMESTER_CODE,
      bezeichnung: "Auskunft-Testsemester",
      start: new Date("2020-09-01T00:00:00Z"),
      ende: new Date("2020-12-31T00:00:00Z"),
    },
  });
  const teilnahme = await prisma.teilnahme.create({
    data: {
      personId: person.id,
      semesterId: semester.id,
      teilnahmeform: "SCHUELER",
      eingeladenAm: new Date("2020-08-15T10:00:00Z"),
      abgemeldetAm: new Date("2020-08-20T10:00:00Z"),
      abmeldeGrund: "BIN_RAUS",
    },
  });
  const termin = await prisma.unterrichtstermin.create({
    data: { semesterId: semester.id, beginn: new Date("2020-09-08T17:00:00Z") },
  });
  await prisma.anwesenheit.create({
    data: { terminId: termin.id, teilnahmeId: teilnahme.id, status: "ANWESEND", erfasstVonId: person.id },
  });
  const mitTeilnahme = await sammleAuskunft(person.id);
  const t = mitTeilnahme?.teilnahmen[0];
  pruefe(
    "Einladung, Abmeldung und Abmeldegrund der Teilnahme stehen in den Auskunftsdaten",
    t?.eingeladenAm != null && t.abgemeldetAm != null && t.abmeldeGrund === "BIN_RAUS",
    t,
  );
  const a = mitTeilnahme?.anwesenheiten[0];
  pruefe("eine selbst gesetzte Anwesenheit gilt als selbst bestätigt", a?.status === "ANWESEND" && a.selbstBestaetigt === true, a);

  // Aufräumen (Cascade entfernt die Auskunfts-Token, Teilnahme und Anwesenheit
  // mit; das Semester nimmt den Termin mit).
  await prisma.person.delete({ where: { id: person.id } });
  await prisma.semester.delete({ where: { id: semester.id } });

  const ERWARTET = 18;
  const gelaufen = geprueft + 1;
  pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);
}

lauf()
  .then(async () => {
    await prisma.$disconnect();
    console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
    process.exit(fehlgeschlagen === 0 ? 0 : 1);
  })
  .catch(async (fehler) => {
    console.error(fehler);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
