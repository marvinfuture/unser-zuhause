# Unser Zuhause

Renovierungsapp für Karla und Marvin im Heimnetz. Die Anwendung läuft auf dem Windows-PC. Beim ersten Öffnen wählt ihr direkt euer Profil; die App merkt sich die Auswahl auf dem jeweiligen Gerät. Über „Profil wechseln“ oder „Zur Profilauswahl“ lässt sich die Auswahl ändern. Alle Daten bleiben im eingerichteten Datenordner.

Die App hat kein Zugangskennwort. Wer das erlaubte Heimnetz und die App-Adresse erreicht, kann Inhalte lesen und ändern. Die Namen kennzeichnen Einträge und sind keine Zugangskontrolle.

Die Funktionen umfassen Räume, Projekte, Aufgaben, Einkaufslisten, Hausmängel, Fotos, Vorher-Nachher-Vergleiche und Projektverlauf. Im Projektplan könnt ihr zwischen Liste, Board und Zeitachse wechseln und Aufgaben den Phasen Planung, Vorbereitung, Renovierung oder Abschluss zuordnen. Aufgabenketten legen fest, welche Arbeiten vor einer anderen Aufgabe erledigt sein müssen; Termine bleiben manuell geplant.

Der Fotovergleich legt Vorher- und Nachher-Bild übereinander. Mit dem Schieberegler vergleicht ihr denselben Bildbereich; Ausschnitt und Zoom lassen sich anpassen. Der vereinbarte Umfang steht in [PLANUNG.md](PLANUNG.md).

Die vollständige Schritt-für-Schritt-Anleitung für Programme, Installation, iPhone-Zugriff, Autostart, Sicherung und Updates findest du in [howto.md](howto.md).

## Auf diesem PC starten

PowerShell im Ordner `C:\wxbapp` öffnen. Die portable Node-Laufzeit und die Paketabhängigkeiten werden bei der Umsetzung vorbereitet. Für eine frische Installation oder einen Umzug:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install.ps1
```

Die App starten:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start.ps1 -OpenBrowser
```

Die erste lokale Adresse ist **http://localhost:3210**. Dort Karla oder Marvin auswählen. Auf einem bereits verwendeten Gerät bleibt das gemerkte Profil normalerweise erhalten.

Der lokale Start allein macht die App noch nicht im WLAN erreichbar. Für Handyzugriff und PWA-Installation wird die HTTPS-Einrichtung benötigt.

Beenden:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Stop.ps1
```

Die Skripte verwalten nur ihre eigenen Prozesse. Ein separat gestarteter Entwicklungs- oder Testserver auf Port 3210 muss in seinem ursprünglichen Terminal beendet werden.

## Auf dem Handy verwenden

Die vollständige Anleitung steht in [howto.md](howto.md), ergänzende technische Details in [docs/BETRIEB.md](docs/BETRIEB.md). Die Schritte sind:

1. Dem PC im Router eine feste Heimnetz-IP zuweisen.
2. HTTPS für diese IP oder einen lokalen Namen einrichten; Firewall auf das konkrete Heimnetz begrenzen.
3. Das öffentliche lokale Stammzertifikat auf euren Geräten installieren und als vertrauenswürdig einrichten.
4. App über die endgültige HTTPS-Adresse öffnen, Karla oder Marvin auswählen und die App zum Homescreen hinzufügen.

Der PC muss eingeschaltet und wach sein. Bei reinem Heimnetzbetrieb ist die App unterwegs nicht erreichbar. Die Einkaufsliste kann vorher über die Druckansicht als PDF gespeichert werden.

## Daten und Sicherung

Standard-Datenordner: `.runtime\data`. Er enthält `home.sqlite`, Mediendateien und nach HTTPS-Einrichtung das lokale Zertifikatsmaterial. `.runtime`, `.tools` und echte Haushaltsdaten sind vom Git-Repository ausgeschlossen.

Die Sicherung verschlüsselt Datenbank und zugehörige Mediendateien. Unveränderte Dateien werden im Archiv nicht erneut gespeichert. Ein Restore ist ausschließlich in einen leeren Zielordner möglich. Vorhandene Haushaltsdaten werden nicht überschrieben.

Ein reales unabhängiges Sicherungsziel muss eingerichtet und getestet werden. Ein weiterer Ordner auf derselben SSD schützt nicht vor SSD-Ausfall. Das vorhandene FRITZ!NAS-Laufwerk N: wurde mit etwa 3,1 GB freiem Platz festgestellt; es wird angesichts des vorgesehenen Medienbudgets nicht automatisch als Backupziel verwendet.

## Entwickeln und prüfen

```powershell
$env:PATH = 'C:\wxbapp\.tools\node-v26.13.1-win-x64;' + $env:PATH
npm test
npm run check
npm run build
```

Die Tests verwenden getrennte temporäre Daten. Der Server wird mit `npm start` gestartet; `npm run dev` startet den Server im Beobachtungsmodus. Die React-Oberfläche muss gebaut werden oder separat mit `npx vite` laufen. Ein Vite-Entwicklungsserver ist nicht für den Dauerbetrieb vorgesehen.

## Noch am realen Aufbau abzunehmen

Die erfolgreiche Codeprüfung ersetzt keine Tests auf euren tatsächlichen Handys. Zertifikatsvertrauen, iPhone- und Pixel-Kameraauswahl, PWA-Installation, Gastnetz-Sperre, Neustart ohne Windows-Anmeldung sowie die Wiederherstellung von einem unabhängigen Sicherungsmedium müssen am realen Aufbau geprüft werden. Administrator-Schritte sind als Skripte vorbereitet und werden nicht still durch eine UAC-Abfrage gestartet.
