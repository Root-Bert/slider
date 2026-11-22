---
title: 'The Office oder LibreOffice: gleiches Dateiformat, andere Vorstellung von Arbeit'
description: 'Beide schreiben Open-Document-Dateien. LibreOffice ist ein Programm für eine Person an einer Datei. The Office ist für Teams und eine KI gebaut, die im Browser an derselben Datei arbeiten.'
date: 2026-11-17
tag: Comparison
accent: blue
cover: { kind: versus, self: The Office, other: LibreOffice }
readingTime: 4 Min. Lesezeit
shortAnswer:
  text: LibreOffice ist das vollständigste freie Büropaket für den Desktop und der Maßstab für Open-Document-Dateien. The Office nutzt dasselbe Format und LibreOffice selbst als Motor, legt die Datei aber auf einen Server, damit ein Team und eine KI zusammen daran arbeiten.
  facts:
    - Dasselbe offene Dateiformat, keine Umwandlung zwischen beiden
    - Kommentare, Live-Cursor und Versionen sind eingebaut, nicht nachgerüstet
    - Die KI bearbeitet die echte Datei und zeigt jede Änderung
faq:
  - q: Kann ich eine Datei aus The Office in LibreOffice öffnen?
    a: Ja. Slider arbeitet auf einer echten ODP-Datei. Lade sie herunter und öffne sie in LibreOffice Impress oder jedem anderen Programm, das Open Document liest.
  - q: Ist The Office schon vollständig verfügbar?
    a: Nein. Slider, die App für Präsentationen, und Cloud, die App für Dateien, sind verfügbar. Writer und Solver sind in Arbeit.
  - q: Ist The Office Open Source?
    a: Slider steht unter der European Union Public Licence 1.2 und läuft auch auf dem eigenen Server.
related:
  - open-document-and-the-deutschland-stack
  - slider-vs-powerpoint-comments
---

LibreOffice und The Office sind keine Gegner. Slider zeichnet jede Folie mit einem LibreOffice, das auf dem Server läuft. Der Unterschied liegt nicht in der Datei, sondern darin, wo sie liegt und wer gleichzeitig an ihr arbeiten kann.

## Was beide teilen

Beide schreiben das [Open Document Format](https://docs.oasis-open.org/office/OpenDocument/v1.4/OpenDocument-v1.4-part1-introduction.html) (ODF): `.odt` für Text, `.ods` für Tabellen, `.odp` für Folien. ODF ist ein Standard von OASIS, seit Ende 2025 in Version 1.4, und Version 1.2 ist zugleich [ISO/IEC 26300](https://en.wikipedia.org/wiki/OpenDocument_standardization). Eine Datei aus dem einen öffnet sich im anderen ohne Umwandlung. Dafür ist ein offenes Format da: Das Dokument überlebt das Programm.

## Der Vergleich

|                      | LibreOffice                                | The Office                                     |
| -------------------- | ------------------------------------------ | ---------------------------------------------- |
| Wo es läuft          | Installiert auf jedem Rechner              | Im Browser, gehostet oder auf deinem Server    |
| Dateiformat          | ODF                                        | ODF                                            |
| Mehrere gleichzeitig | Nein, eine Person pro Datei                | <span class="ok">✓</span> live, von Grund auf  |
| Kommentare           | In der Datei gespeichert                   | An der genauen Stelle, sofort für alle         |
| Versionen            | Dateien, die du speicherst und verschickst | Automatisch, Änderungen markiert               |
| KI                   | Keine, mit Absicht                         | <span class="ok">✓</span> bearbeitet die Datei |
| Ohne Netz            | <span class="ok">✓</span> immer            | Nein                                           |
| Funktionsumfang      | Sehr tief, Jahrzehnte Arbeit               | Schmaler: Text, Kästen, Feedback, KI           |
| Lizenz               | MPL 2.0                                    | EUPL 1.2 (Slider)                              |

## Zusammenarbeit

LibreOffice ist ein Programm für den Desktop. Ein Dokument wird von einer Person geöffnet, bearbeitet, gespeichert und weitergeschickt. Gleichzeitiges Bearbeiten durch mehrere gibt es im Desktop-Paket nicht. Calc kann eine Tabelle freigeben, aber die Änderungen werden beim Speichern zusammengeführt, nicht beim Tippen. Gleichzeitiges Bearbeiten gibt es nur in Server-Produkten auf demselben Code, etwa [Collabora Online](https://en.wikipedia.org/wiki/Collabora_Online); die Document Foundation bietet keine eigene Online-Version an.

The Office fängt am anderen Ende an. Die Datei liegt auf einem Server. Alle öffnen dieselbe, sehen die Cursor der anderen, kommentieren die genaue Stelle, und niemand verschickt eine Kopie. Das ist keine Funktion obendrauf, sondern die Art, wie gespeichert wird. Feedbackrunden erzeugen keine `final_v3_wirklich.odp` mehr.

## KI

LibreOffice sagt nein, und zwar deutlich. Die Ankündigung von [Version 26.8](https://blog.documentfoundation.org/blog/2026/08/26/libreoffice-26-8/) im August 2026 hält fest, dass keine KI enthalten ist. Die Begründung trägt: Software, die ein Dokument nie irgendwohin schickt, lässt sich leicht prüfen. Collabora ging den anderen Weg und hat KI als Option eingebaut, die [ab Werk aus](https://itsfoss.com/news/libreoffice-26-8-release/) ist.

In The Office ist die KI eine Kollegin mit denselben Rechten wie ein Mensch. In Slider beauftragst du sie in einem Kommentar. Sie liest den Thread, ändert die echten Folien, markiert jede Änderung, und ein Klick nimmt sie zurück. Sie liefert kein Bild einer Folie und keine neue Datei in einem fremden Format. Sie bearbeitet die ODP.

Der Preis gehört dazu: Eine KI braucht ein Modell, und ein Modell braucht deine Inhalte. Wenn das für ein Dokument nicht erlaubt ist, hat LibreOffice für dieses Dokument recht.

## Wann welches

Nimm LibreOffice, wenn du allein arbeitest, ohne Netz, oder die tiefen Funktionen brauchst: Serienbriefe, Makros, Pivot-Tabellen, eine Datenbank, lange Dokumente mit aufwendigem Satz. Nichts Freies kommt da heran.

Nimm The Office, wenn die Arbeit die eines Teams ist: mehrere an einer Präsentation, Feedback von außen, eine KI, die umsetzt, was beschlossen wurde. Heute heißt das Slider. Writer und Solver folgen.

Weil beide ODF sprechen, ist das keine Entscheidung fürs Leben. Fang eine Präsentation in Slider an, mach ein Detail in Impress fertig, lade sie wieder hoch.
