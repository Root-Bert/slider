# Plan: Slider als Desktop-App (macOS, Linux, später Windows)

Stand 2026-11-04, noch nicht begonnen. Ziel: Slider öffnet `.odp`-Dateien wie Keynote – die Datei
auf der Platte ist die Wahrheit, Bearbeiten und Rendern laufen lokal, nur Integrationen (KI,
Sprache zu Text, Bilder, Fotos) gehen ins Netz. Zusammenarbeit beginnt erst, wenn man teilt: dann
wandert die Datei auf einen Slider-Server.

## Grundsatz: eine App, zwei Hüllen

- **Browser** bleibt wie heute: Server ist die Wahrheit, alles funktioniert „genauso“.
- **Desktop** = dieselbe Web-App in Electron + lokaler Slider-Server (API als eine Datei,
  `bun build --compile`, PGlite, Dateien auf der Platte, LibreOffice als Prozess).
- Kein Fork: Desktop-Funktionen (Datei öffnen/speichern, im Finder zeigen, LibreOffice laden)
  kommen über eine kleine Brücke (`window.sliderDesktop`, Preload) und werden per Feature-Check
  angeboten. Ohne Brücke sieht man sie nicht; im Browser heißt „Datei öffnen“ weiter Hochladen.
- Die Web-App spricht in beiden Fällen mit „ihrem“ Server über dieselben Routen – lokal eben
  `localhost` mit einem Zufallstoken statt Cookie-Login.

## Entscheidungen

| Frage            | Entscheidung                                                                                                                                                                                                  | Warum                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hülle            | **Electron**                                                                                                                                                                                                  | ein Chromium überall: live-parity und e2e laufen schon in Chromium; Tauri hieße WebKitGTK unter Linux (langsam, Lücken bei MediaRecorder/Canvas) und drei Engines testen |
| LibreOffice      | **beim ersten Start per Button nachladen** (wie Xcode-Simulatoren), offizielles signiertes Paket der Document Foundation, Prüfsumme geprüft, **feste getestete Version**, in den App-Datenordner (kein Admin) | Parität Bearbeiten = Prüfen hängt vom Textsatz der LO-Version ab; installiertes LO nur als Notlösung mit Hinweis                                                         |
| Schriften        | installierte Schriften des Systems + Sliders Google Fonts mitgeliefert                                                                                                                                        | LO und Chromium sehen dieselben Systemschriften                                                                                                                          |
| Verteilung macOS | direkt (Website/GitHub), Developer ID + Notarisierung, Electron-Updater                                                                                                                                       | App Store verbietet nachgeladenen Code (2.5.2), Sandbox verhindert externes LO                                                                                           |
| Verteilung Linux | AppImage (Download, Selbst-Update) + Flathub (Updates übers Software-Center); .deb/.rpm später                                                                                                                | erreicht alle Distros; System-LO wäre je Distro eine andere Version                                                                                                      |
| Speichern        | offen – Vorschlag: automatisch wie Keynote                                                                                                                                                                    |                                                                                                                                                                          |
| PPTX             | offen – Vorschlag: öffnet als Import, wird als ODP gespeichert                                                                                                                                                | jede PPTX-Speicherung verliert Genauigkeit                                                                                                                               |
| Kommentare lokal | offen – Vorschlag: in der ODP (`slider/comments.json` + Aufnahmen im ZIP)                                                                                                                                     | LibreOffice ignoriert es, Kommentare reisen mit der Datei                                                                                                                |

## Phasen

1. **Hülle + lokaler Server** (~2 Wochen): Electron startet die kompilierte API auf einem freien
   Port mit Token; LibreOffice-Prüfung und Download-Dialog; Schlüssel im Schlüsselbund
   (macOS Keychain / libsecret); signierte Builds für macOS und AppImage; Updater.
2. **Datei ist die Wahrheit** (~1–2 Wochen): Dateizuordnung `.odp` (Doppelklick, „Öffnen mit“);
   ein Deck im lokalen Server zeigt auf einen Pfad statt auf einen Blob; nach jedem Schritt atomar
   zurückschreiben (temp + rename, entprellt); Änderungen von außen erkennen (mtime/Hash) → neu
   laden oder bei eigenen ungespeicherten Änderungen fragen; zuletzt geöffnete Dateien.
3. **Kommentare in der Datei + Teilen** (~1–2 Wochen): Kommentare lesen/schreiben im ZIP;
   „Teilen“ lädt Datei samt Kommentaren per tus auf einen Server (Login dort), ab dann ist der
   Server die Wahrheit, die lokale Datei ein Verweis („Lokal speichern“ = Export); vorher Schriften
   prüfen: fehlende als Workspace-Schrift anbieten, Systemschriften mit Lizenzgrenze (SF, Helvetica
   Neue …) nur warnen + Ersatz vorschlagen.
4. **Flathub + Windows** (später): Flatpak-Manifest (LO dann im Paket, Flathub mag keinen
   nachgeladenen Code), Windows-Installer mit Signatur.

Grob 4–6 Wochen bis macOS + AppImage.

## Bewusst nicht drin

- Abgleich in beide Richtungen zwischen lokaler Datei und Server (Monate; heute ist der Server
  Autorität für Schritte).
- LibreOffice als WebAssembly im Browser (groß, langsam, Parität nicht haltbar).
- Mac App Store.

## Risiken

- LO-Download ~300 MB beim ersten Start; ohne Netz beim ersten Start kein Rendern.
- Notarisierung von Electron + kompiliertem Bun-Binary (Hardened Runtime, Entitlements für JIT).
- Lokaler Server ohne Login: nur `127.0.0.1`, Zufallstoken je Start, keine anderen Origins (CORS),
  damit keine Webseite im Browser ihn ansprechen kann.
