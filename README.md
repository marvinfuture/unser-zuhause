# Unser Zuhause

Private Renovierungsapp für Karla und Marvin. Die Anwendung läuft auf dem Windows-PC und verwendet einen gemeinsamen Haushaltszugang. Nach der Anmeldung wählt jeder sein Profil. Alle Daten bleiben im eingerichteten Datenordner.

Die Funktionen der ersten Version umfassen Räume, Projekte, Aufgaben, Einkaufslisten, Hausmängel, Fotos, Vorher-Nachher-Vergleiche und Projektverlauf. Der beschlossene Umfang und die Abnahmekriterien stehen in [PLANUNG.md](PLANUNG.md).

## Auf diesem PC starten

PowerShell im Ordner `C:\wxbapp` öffnen. Die portable Node-Laufzeit und die Paketabhängigkeiten werden bei der Umsetzung vorbereitet. Für eine frische Installation oder einen Umzug:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install.ps1
```

Die App starten:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start.ps1 -OpenBrowser
```

Die erste lokale Adresse ist **http://localhost:3210**. Dort beim ersten Aufruf das gemeinsame Haushaltskennwort festlegen. Es gibt kein mitgeliefertes Standardkennwort. Anschließend Karla oder Marvin auswählen.

Der lokale Start allein macht die App noch nicht im WLAN erreichbar. Für Handyzugriff und PWA-Installation wird die HTTPS-Einrichtung benötigt.

Beenden:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Stop.ps1
```

Die Skripte verwalten nur ihre eigenen Prozesse. Ein separat gestarteter Entwicklungs- oder Testserver auf Port 3210 muss in seinem ursprünglichen Terminal beendet werden.

## Auf dem Handy verwenden

Die vollständige Anleitung steht in [docs/BETRIEB.md](docs/BETRIEB.md). Die Schritte sind:

1. Haushaltskennwort lokal auf dem PC festlegen.
2. Dem PC im Router eine feste Heimnetz-IP zuweisen.
3. HTTPS für diese IP oder einen lokalen Namen einrichten; Firewall auf das konkrete Heimnetz begrenzen.
4. Das öffentliche lokale Stammzertifikat auf euren Geräten installieren und als vertrauenswürdig einrichten.
5. App über die endgültige HTTPS-Adresse öffnen und zum Homescreen hinzufügen.

Der PC muss eingeschaltet und wach sein. Bei reinem Heimnetzbetrieb ist die App unterwegs nicht erreichbar. Die Einkaufsliste kann vorher über die Druckansicht als PDF gespeichert werden.

## Daten und Sicherung

Standard-Datenordner: `.runtime\data`. Er enthält `home.sqlite`, geschützte Mediendateien und nach HTTPS-Einrichtung das lokale Zertifikatsmaterial. `.runtime`, `.tools` und echte Haushaltsdaten sind vom Git-Repository ausgeschlossen.

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
