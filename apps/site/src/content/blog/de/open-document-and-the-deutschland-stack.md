---
title: 'Open Document und der Deutschland-Stack: was beschlossen wurde und was es bedeutet'
description: 'Deutschland nennt ODF und PDF/UA als Dokumentenformate seiner öffentlichen digitalen Infrastruktur. Was die Beschlüsse sagen, was sie nicht sagen und worin sich ODF von DOCX unterscheidet.'
date: 2026-11-17
tag: Guide
accent: green
cover: { kind: slide }
readingTime: 5 Min. Lesezeit
shortAnswer:
  text: Der Deutschland-Stack führt ODF und PDF/UA als seine Dokumentenformate. Die Länder sollen ODF ab dem 1. Januar 2027 schrittweise unterstützen. Ein Verbot anderer Formate ist das nicht, aber wer mit Behörden arbeitet, sollte ODF lesen und schreiben können.
  facts:
    - ODF für Dokumente, die bearbeitet werden, PDF/UA für fertige
    - Länderverwaltungen unterstützen ODF ab 1. Januar 2027, Auswertung 2028
    - ODF ist ein ZIP mit lesbarem XML, festgelegt von OASIS und ISO
faq:
  - q: Sind DOCX und PPTX in der deutschen Verwaltung jetzt verboten?
    a: Nein. Die Beschlüsse setzen ODF als Standard für den Austausch und als Grundlage der Lösungen im Deutschland-Stack. Andere Formate verbieten sie nicht.
  - q: Öffnet Microsoft Office ODF-Dateien?
    a: Ja, Word, Excel und PowerPoint lesen und schreiben ODF. Aufwendige Layouts können sich verschieben, prüfe wichtige Dateien.
  - q: Was ist der Unterschied zwischen ODF und PDF/UA?
    a: ODF ist für Dokumente, an denen weitergearbeitet wird. PDF/UA ist ein festes, barrierefreies PDF für Dokumente, die fertig sind.
related:
  - bertro-office-vs-libreoffice
  - slider-vs-powerpoint-comments
---

Im März 2026 hieß es in den Schlagzeilen, Deutschland habe das Open Document Format zur Pflicht gemacht. Die Beschlüsse sind vorsichtiger als die Schlagzeilen. Hier steht, was sie sagen, mit Quellen.

## Was beschlossen wurde

Drei Beschlüsse des IT-Planungsrats, des Gremiums, in dem Bund und Länder die öffentliche IT steuern, bauen aufeinander auf.

1. **März 2025, [Beschluss 2025/06](https://www.it-planungsrat.de/beschluss/beschluss-2025-06).** Offene Formate wie ODF sollen stärker genutzt werden, damit ODF bis 2027 zum Standard für den Dokumentenaustausch wird. Der Beschluss nennt es außerdem veraltet, Dokumente zwischen den Ländern per Mail zu verschicken.
2. **November 2025, [Beschluss B-2025/44-IT](https://www.it-planungsrat.de/beschluss/b-2025-44-it).** Die Länderverwaltungen unterstützen ODF ab dem 1. Januar 2027 schrittweise. 2028 wird der Beschluss ausgewertet.
3. **März 2026, [Beschluss B-2026/03-IT](https://www.it-planungsrat.de/beschluss/b-2026-03-it).** Die Standards des Deutschland-Stacks werden als verbindliche Grundlage seiner Lösungen beschlossen. Das [Gesamtbild des Stacks](https://deutschland-stack.gov.de/gesamtbild/) führt unter den semantischen Technologien „ODF und PDF/UA als Dokumentenformate“. Ein anderes Dokumentenformat wird nicht genannt.

## Was nicht drinsteht

Das Wort „verbindlich“ bezieht sich auf Lösungen, die für den Deutschland-Stack gebaut werden. Für alles andere „streben“ Bund, Länder und Kommunen die Nutzung bei neuen Entwicklungen an. Es gibt kein Datum, an dem eine DOCX ungültig wird, und keine Regel für Unternehmen.

„Deutschland verbietet Microsoft-Formate“ ist also falsch. „Die deutsche Verwaltung hat ODF als ihr Dokumentenformat gewählt und ein Startdatum gesetzt“ ist richtig. Die Richtung ist klar, der Zwang ist gering. Angebote für alle Ebenen sollen bis 2028 bereitstehen.

## Was der Deutschland-Stack ist

Er ist der Plan des Bundes für eine gemeinsame digitale Infrastruktur: ein Plattformkern (Identität, Bezahlen, Datenaustausch, Postfach), wiederverwendbare Plattformen für KI, Daten und Abläufe sowie betriebene Dienste. Seine Regeln bevorzugen internationale Standards, Open Source und europäische Anbieter. Dokumentenformate sind ein kleiner Teil davon, aber der, den jede Person im Büro anfasst.

## Warum ODF und nicht DOCX

Beides sind ZIP-Archive voller XML. Der Unterschied liegt darin, wer die Spezifikation bestimmt und wie genau sich Programme daran halten.

**ODF** entsteht in einem offenen Ausschuss bei [OASIS](https://docs.oasis-open.org/office/OpenDocument/v1.4/OpenDocument-v1.4-part1-introduction.html), Version 1.4 wurde 2025 verabschiedet, Version 1.2 ist als [ISO/IEC 26300](https://en.wikipedia.org/wiki/OpenDocument_standardization) erschienen. Eine `.odt`, `.ods` oder `.odp` enthält:

- `content.xml`: den Text, die Tabellen oder Folien
- `styles.xml`: Schriften, Farben, Seitenlayouts
- `meta.xml`: Autorin oder Autor, Daten, Titel
- `META-INF/manifest.xml`: die Liste von allem im Archiv
- Bilder und andere Medien als gewöhnliche Dateien

Benenne eine Datei in `.zip` um, und du kannst sie mit einem Texteditor lesen. Mehrere unabhängige Programme schreiben dasselbe Format.

**OOXML** (DOCX, XLSX, PPTX) ist ebenfalls ein ISO-Standard, ISO/IEC 29500, aber in zwei Varianten. „Strict“ ist die saubere. „Transitional“ bewahrt das Verhalten alter Versionen von Microsoft Office, und das ist es, was Office [in der Praxis schreibt](https://en.wikipedia.org/wiki/Office_Open_XML). Eine Studie, die das Open Source Observatory der EU veröffentlicht hat, beschreibt, wie das [andere Umsetzungen behindert](https://interoperable-europe.ec.europa.eu/collection/open-source-observatory-osor/document/complex-singularity-versus-openness). Das Format ist auf dem Papier offen und im Gebrauch an ein Produkt gebunden.

Für einen Staat ist das eine praktische Frage: Lässt sich eine Datei von 2026 im Jahr 2056 noch öffnen, mit Software beliebiger Hersteller, ohne Lizenz? Bei ODF hängt die Antwort nicht von einem Unternehmen ab.

**PDF/UA** (ISO 14289) deckt den anderen Fall ab. Es ist ein PDF mit ausgezeichneter Struktur, der Screenreader folgen können. Nimm es, wenn ein Dokument fertig ist und überall gleich aussehen muss.

## Wer schon so arbeitet

Schleswig-Holstein hat ODF 2024 zum Standardformat gemacht und hatte Ende 2025 rund [80 Prozent seiner Arbeitsplätze auf LibreOffice](https://borncity.com/blog/?p=319090). Die übrigen hängen an Fachsoftware, die Microsoft Office voraussetzt. Das ist die eigentliche Arbeit eines Umstiegs: nicht die Dokumente, sondern Makros, Vorlagen und Programme, die ein bestimmtes Büropaket erwarten. Das Interoperabilitätsportal der EU hat eine [Zusammenfassung des deutschen Wegs](https://interoperable-europe.ec.europa.eu/node/732585).

## So steigst du um

1. **Setz den Standard.** Speichere neue Dokumente als ODF. Jedes aktuelle Büropaket kann das.
2. **Lass das Archiv in Ruhe.** Wandle alte Dateien um, wenn jemand sie braucht, nicht alle auf einmal.
3. **Prüf die schwierigen zuerst.** Vorlagen, Formulare, Tabellen mit Makros und Präsentationen mit besonderen Schriften zeigen, wo sich bei der Umwandlung etwas verschiebt.
4. **Bette Schriften ein oder nimm freie.** Die meisten Unterschiede im Layout zwischen Programmen sind fehlende Schriften.
5. **Verschick PDF/UA, wenn sich nichts mehr ändern soll.** ODF ist für Arbeit, die noch läuft.

## Wo The Office steht

The Office baut von der ersten Datei an auf ODF. Slider bearbeitet eine echte ODP, kein internes Format, das am Ende exportiert wird. Was du herunterlädst, ist die Datei selbst, lesbar in LibreOffice und jedem anderen Programm, das dem Standard folgt.
