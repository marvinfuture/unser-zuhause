# Unser Zuhause

Plan für eine private Renovierungsapp für Karla und Marvin

Stand: 17. November 2026. Grundlage: `info.txt`, die freigegebene Grundversion und die spätere Anweisung, die App ohne Kennwort direkt mit der Auswahl Karla/Marvin zu öffnen.

Die App soll euch zeigen, was ihr als Nächstes am Haus machen möchtet, welche Arbeit ansteht, wer sie übernimmt und was dafür eingekauft werden muss. Fotos und ein Vorher-Nachher-Vergleich halten fest, was ihr gemeinsam geschafft habt. Die erste Version soll diese Abläufe zuverlässig abdecken.

Dieser Plan beschreibt die vereinbarte Richtung der bestehenden App. Am 17. November 2026 wurden alle vier Erweiterungen in `IDEEN.md` freigegeben: kennwortfreier Einstieg, Aufgabenabhängigkeiten, Projektplanung mit Phasen/Board/Zeitachse und der überlagerte Fotovergleich.

## 1. Festgelegte Richtung

| Thema | Festlegung |
| --- | --- |
| Name | Unser Zuhause, zunächst als Arbeitstitel |
| Nutzer | Karla und Marvin, gemeinsame Daten für ein Haus |
| Hosting | Vorhandener Windows-11-PC |
| Erreichbarkeit | Ausschließlich im eigenen Heimnetz; Smartphone-Nutzung im heimischen WLAN |
| Bedienung am PC | Auch der Hosting-PC und berechtigte Geräte im verkabelten Heimnetz können die App nutzen |
| Einstieg | Ohne App-Kennwort direkt Karla oder Marvin auswählen |
| Erste Version | Räume, Projekte, Aufgaben, Prioritäten, Einkauf, Mängel, Fotos, Vergleich, Dashboard und ein einfacher Verlauf |
| Gestaltung | Warm, ruhig und gemütlich; für Erwachsene, mit gut lesbaren Texten und wenigen verspielten Details |
| Geräte | Pixel 9, iPhone 13, iPad und Windows 11 |
| Später | Videos, Zeitraffer, Budgetauswertung, XP, Abzeichen und weitere Komfortfunktionen |

Die neuen Festlegungen ersetzen die offenen Hosting-Varianten und die ursprünglich vorgeschlagene Kennwortanmeldung. Es gibt zwei frei wählbare Personenprofile innerhalb des gemeinsamen Haushalts.

**Freigegebener Einstieg:** Beim ersten Öffnen auf einem Gerät Karla oder Marvin wählen. Eine automatisch angelegte Gerätesitzung merkt sich die Auswahl bis zu 30 Tage. Das Profil bleibt sichtbar und lässt sich wechseln oder auf die Profilauswahl zurücksetzen. Wer die App im freigegebenen Heimnetz erreicht, kann die gemeinsamen Inhalte nutzen. Die Profilwahl ist keine Zugangssperre. Sicherungsverschlüsselung und Windows-Autostart behalten ihre getrennten Kennwörter.

Die Profilwahl ist eine freiwillige Zuordnung innerhalb eures Haushalts. Wer Zugang hat, kann auch den anderen Namen auswählen. Ein Namensschild ist deshalb kein Nachweis, welche Person tatsächlich am Gerät saß. Für euren Wunsch nach einfacher gemeinsamer Nutzung ist dieses Modell passend.

## 2. Produktstruktur

| Baustein | Bedeutung | Beispiel |
| --- | --- | --- |
| Raum oder Bereich | Dauerhafter Ort im Haus oder außen | Wohnzimmer, Keller, Garten, Fassade |
| Renovierungsprojekt | Ein bestimmtes Vorhaben mit Anfang und Abschluss | Wohnzimmer streichen |
| Aufgabe | Eine konkrete Arbeit | Wand abkleben |
| Einkaufsposition | Benötigtes Material oder Werkzeug | 2 Rollen Malerkrepp |
| Hausmangel | Ein Befund, der auch ohne Projekt erfasst werden kann | Undichte Silikonfuge im Bad |
| Foto | Bild mit Zuordnung und Beschreibung | Wohnzimmer vor dem Streichen |
| Vergleich | Ausgewähltes Vorher- und Nachher-Bildpaar | Gleiche Wand vor und nach der Arbeit |
| Verlauf | Notizen und ausgewählte Änderungen | Farbton entschieden, Aufgabe erledigt |

Ein Raum kann mehrere Projekte enthalten. So bleibt die Geschichte vom ersten Streichen erhalten, wenn später neue Bodenbeläge geplant werden. Ein Mangel braucht kein vorgeschaltetes Projekt. Aufgaben und Einkaufspositionen dürfen auch allgemein zum Haus gehören.

## 3. Anforderungen an die erste Version

Muss bedeutet: ohne diese Funktion ist die erste Version nicht abnahmefähig. Soll und Kann gehören zum späteren Ausbau und werden durch das erste Go nicht automatisch mitbestellt.

| ID | Muss-Anforderung | Ergebnis für euch |
| --- | --- | --- |
| F01 | Kennwortfreier Einstieg und zwei feste Profile | Direkt Karla oder Marvin auswählen; keine Einrichtung eines App-Kennworts |
| F02 | Personenkennzeichnung | Ersteller, letzte Bearbeitung und gegebenenfalls Erlediger bleiben nachvollziehbar |
| F03 | Dashboard | Laufende Projekte, nächste Vorhaben, anstehende Aufgaben, Einkauf und wichtige Mängel auf einen Blick |
| F04 | Räume und Bereiche | Anlegen, bearbeiten und archivieren; Projekte und Mängel einem Ort zuordnen |
| F05 | Projekte | Titel, Ziel, Ort, Status, Priorität und optionaler Wunschzeitraum |
| F06 | Nächste Renovierungen planen | Gemeinsame Reihenfolge geplanter Vorhaben manuell festlegen |
| F07 | Aufgaben | Beschreibung, Zuständigkeit, Priorität, Status, Phase, Vorgänger, optionaler Start und Fälligkeit |
| F08 | Einkaufslisten | Material oder Werkzeug, Menge, Einheit, optionaler Einzelpreis und Status gekauft |
| F09 | Mängelliste | Beschreibung, Ort, Fotos, Priorität, Zuständigkeit und Bearbeitungsstand |
| F10 | Fotos und Galerien | Aufnahme beziehungsweise Dateiauswahl, Upload, Vorschau und geschützte Anzeige |
| F11 | Vorher-Nachher-Slider | Bildpaar wählen und mit Finger, Maus oder Tastatur vergleichen |
| F12 | Einfacher Projektverlauf | Kurze Notizen und ausgewählte Ereignisse in zeitlicher Reihenfolge |
| F13 | Mobile PWA | Übersichtliche Nutzung und Installation auf den vorgesehenen Geräten |
| F14 | Gemeinsamer Datenstand | Änderungen auf dem zweiten Gerät sehen; Konflikte werden angezeigt |
| F15 | Sicherung und Betrieb | Dauerhafte Speicherung, Start nach Neustart, erkennbare Fehler und geprüfte Wiederherstellung |
| F16 | Aufgabenabhängigkeiten | Eine Aufgabe wird erst nach Abschluss aller Vorgänger startbereit; Planen und Zuweisen bleiben vorher möglich |
| F17 | Projektplanung | Gemeinsamer Aufgabenbestand als Phasenliste, Board und Zeitachse; Termine bleiben manuell geplant |

**Soll für spätere Versionen:** Globale Suche, Aufgabenvorlagen, wiederkehrende Hausarbeiten, Kommentare, komfortabler Kalender, Kostensummen nach Projekt, kurze Videos und vorhandene Zeitrafferdateien.

**Kann für spätere Versionen:** Budgetplanung mit Soll-Ist-Vergleich, Push-Erinnerungen, vollständige Offlinebearbeitung, gemeinsame XP und Abzeichen, illustriertes Haus und automatisch erzeugte Rückblickvideos. Keine Wettbewerbsrangliste zwischen euch und keine Bestrafung für Pausen.

Zum ersten Umfang gehören weder öffentliche Freigaben noch Handwerkerkonten, Fernzugriff, automatische Videoverarbeitung, KI-Auswertungen oder eine vollständige Haushaltsbuchführung.

## 4. Regeln für eindeutige Daten

### Personen und Zuständigkeit

- Jeder neue Eintrag erhält automatisch das aktuell ausgewählte Profil als Ersteller. Dieses Feld wird bei späterer Bearbeitung nicht überschrieben.
- Aufgaben und Mängel können Karla, Marvin, beiden oder noch niemandem zugeteilt sein.
- Die Person, die eine Aufgabe erledigt oder einen Einkauf abhakt, wird zusätzlich festgehalten. Sie muss nicht mit dem Ersteller oder dem ursprünglich Zuständigen übereinstimmen.
- Beispiel: Karla erstellt „Decke streichen“, Marvin ist zuständig, Karla markiert die gemeinsame Arbeit als erledigt. Alle drei Angaben bleiben unterscheidbar.
- Die Profilwahl gilt pro Gerätesitzung. Ein Wechsel auf dem iPad ändert nicht das ausgewählte Profil auf Marvins Handy. Ein Profilwechsel darf offene Formulare auch in anderen Tabs derselben Sitzung nicht unbemerkt einem anderen Namen zuordnen. Beim Speichern wird die erwartete Profilversion geprüft; nach einem Wechsel müssen die Eingaben bewusst dem aktuellen Profil zugeordnet werden.
- Beide Profile dürfen die gemeinsamen Inhalte bearbeiten. Es gibt im Alltag keine künstliche Rollenverteilung in Administrator und Zuschauer.

### Status und Prioritäten

Projekte: **Idee → geplant → in Arbeit → abgeschlossen**, zusätzlich **pausiert**. Ein abgeschlossenes Projekt kann wieder geöffnet werden.

Aufgaben: **offen, in Arbeit, blockiert, erledigt**. Mängel: **offen, in Bearbeitung, behoben**. Einkäufe: **offen, gekauft**.

Prioritäten: **dringend, hoch, normal, später**. Priorität und Termin sind unabhängig: Eine wichtige Aufgabe muss kein Datum haben; eine verspätete Aufgabe wird nicht automatisch auf dringend gesetzt.

In „Als Nächstes“ legt ihr die Reihenfolge geplanter Projekte selbst fest. Standardansicht ist diese gespeicherte Reihenfolge; eine alternative Sortierung nach Priorität oder Wunschtermin verändert sie nicht. Auf dem Handy gibt es neben Verschieben auch „Nach oben“ und „Nach unten“.

### Termine und Fortschritt

- Für den Start reichen Tagesdaten ohne Uhrzeiten: optionaler Beginn, Fälligkeit und bei Projekten ein Wunschzeitraum. Darstellung deutsch; fachliche Tagesgrenzen in Europe/Berlin.
- Eine Aufgabe ist überfällig, wenn ihr Fälligkeitstag vor heute liegt und sie noch nicht erledigt oder archiviert ist. Start nach Fälligkeit wird als Eingabefehler angezeigt.
- Projektfortschritt: erledigte aktive Aufgaben geteilt durch alle aktiven Aufgaben. Eine von vier ergibt 25 Prozent. Blockierte Aufgaben zählen als offen mit.
- Ohne Aufgaben steht „Noch keine Aufgaben geplant“. Ein leeres Projekt erhält keine künstlichen 100 Prozent.
- Neue Aufgaben können den Prozentwert senken. Ein Projekt wird bewusst abgeschlossen; bei offenen Aufgaben erscheint ein Hinweis.
- Es gibt keinen pauschalen Fertigstellungsgrad für das ganze Haus. Stattdessen zeigt die Übersicht konkrete Zahlen und die Fortschritte einzelner Projekte.

### Einkauf, Mängel und Archiv

- Einkaufspositionen haben eine positive Menge und eine Einheit, etwa Stück, Rolle, Liter oder Quadratmeter. Material und Werkzeug sind unterscheidbar.
- Ein Einzelpreis pro angegebener Einheit in Euro ist freiwillig: Bei zwei Rollen wird der Preis je Rolle eingetragen. Unbekannt bleibt leer und wird nicht als kostenlos interpretiert. Geldbeträge werden intern in Cent geführt.
- Positionen lassen sich einem Projekt zuordnen und projektübergreifend anzeigen. Gleichnamige Materialien werden nicht automatisch zusammengeführt: Einheit, Qualität oder Farbton können verschieden sein.
- Ein Mangel kann mit einem Projekt verbunden werden. Beim Erstellen einer Aufgabe daraus bleibt die Herkunft verlinkt; der Mangel wird dadurch noch nicht als behoben markiert.
- Projekte und Räume werden bevorzugt archiviert. Archivierte Daten bleiben aufrufbar. Ein Raum mit Inhalten wird nicht mitsamt allen Fotos durch einen einzigen unbemerkten Klick gelöscht.
- Entfernte Fotos landen zunächst für 30 Tage im Papierkorb. Endgültiges Entfernen berücksichtigt laufende Sicherungen und bestehende Vergleichspaare; kein Vergleich darf still auf eine fehlende Datei zeigen.

### Zusammenarbeit und fehlende Verbindung

Die App lädt beim Öffnen und bei Rückkehr in den Vordergrund aktuelle Daten. Solange sie sichtbar ist, prüft sie vorgeschlagen alle 10 Sekunden auf Änderungen. Ziel: Eine gespeicherte Änderung erscheint bei funktionierender Verbindung spätestens nach 15 Sekunden auf dem zweiten geöffneten Gerät.

Bearbeitungen enthalten eine Datensatzversion. Speichern zwei Geräte denselben alten Stand, wird der zweite Speicherversuch als Konflikt angezeigt. Eigene Eingaben bleiben zum Vergleichen erhalten; fremde Änderungen werden nicht still überschrieben. Wiederholte Übertragungen desselben Anlegevorgangs dürfen keine Duplikate erzeugen.

Die erste Version benötigt eine Verbindung zum Heimserver für private Inhalte und Änderungen. Bei Ausfall erscheint „Keine Verbindung zu eurem Zuhause-PC“. Nicht bestätigte Eingaben bleiben im geöffneten Formular und werden nicht als gespeichert dargestellt. Dauerhafte Offlineentwürfe und automatische Offline-Synchronisation sind nicht enthalten.

**Folge der WLAN-Entscheidung:** Die Einkaufsliste ist im Baumarkt nicht live erreichbar. Für die erste Version reicht vor der Abfahrt die Druckansicht beziehungsweise das Speichern als PDF über den Browser. Abhaken und Synchronisieren erfolgen wieder zu Hause. Ein vollständiger Offline-Einkaufsmodus wäre ein separates Ausbaupaket.

## 5. Die wichtigsten Abläufe

| Ablauf | Geplanter Weg |
| --- | --- |
| Einstieg | Karla oder Marvin wählen → Übersicht öffnen; auf bekannten Geräten direkt zum ausgewählten Profil |
| Nächstes Projekt | Raum wählen → Projekt benennen → Wunschzeitraum und Priorität setzen → in „Als Nächstes“ einordnen |
| Arbeit verteilen | Aufgabe im Projekt anlegen → Karla, Marvin, beide oder offen wählen → Priorität und bei Bedarf Termin setzen |
| Einkaufen | Benötigte Materialien im Projekt ergänzen → gemeinsame Einkaufsliste öffnen → bei Bedarf ausdrucken → gekaufte Positionen abhaken |
| Mangel erfassen | „Neu“ → Mangel → Ort und Beschreibung → Foto → Priorität; Projektzuordnung kann später folgen |
| Vorher und Nachher | Projekt öffnen → Bilder hochladen → als Vorher, Zwischenstand oder Nachher markieren → Bildpaar und Ausschnitt wählen → Slider benutzen |
| Abschluss | Offene Arbeiten prüfen → Projekt bewusst abschließen → Abschlussnotiz ergänzen → Bilder und Verlauf bleiben erhalten |

## 6. Gestaltung und Bildschirmplanung

Die Oberfläche soll sich wie ein gemeinsames Zuhause-Buch mit klaren Arbeitslisten anfühlen. Warme Flächen und kleine Details geben ihr Charakter; echte Raumfotos stehen im Vordergrund.

| Gestaltungselement | Vorgesehene Richtung |
| --- | --- |
| Hintergrund | Warmes Creme, etwa `#F6F2E9` |
| Karten | Helles Elfenbein, etwa `#FFFCF6` |
| Hauptaktionen | Dunkles Salbeigrün, etwa `#456557` |
| Akzent | Gedämpftes Terrakotta, etwa `#A65C45` |
| Text | Dunkles Braungrün, etwa `#28372F` |
| Personen | Karla mit Pflaumenton, Marvin mit Petrol; immer mit ausgeschriebenem Namen |
| Schrift | Ruhige Serifenschrift für ausgewählte Überschriften, klare Systemschrift für Listen und Bedienung; Schriften lokal eingebunden |
| Formen | Mäßig abgerundete Karten, zurückhaltende Schatten und großzügige Abstände |

Die Farben sind ein Entwurf. Kontraste werden an den konkreten Kombinationen geprüft. Priorität und Status erhalten immer Text und bei Bedarf ein Symbol. Bewegung bleibt dezent und berücksichtigt die Systemeinstellung für reduzierte Animationen.

**Mobile Hauptnavigation:** Übersicht · Projekte · Aufgaben · Einkauf · Haus. Unter Haus liegen Räume und Mängel. Das sichtbare Personenprofil öffnet Profilwechsel und Einstellungen. Desktop: feste Seitenleiste, mehr Platz für Listen und Fotovergleiche.

| Ansicht | Inhalt und wichtigste Aktion |
| --- | --- |
| Einstieg | Gemeinsamer Zugang, danach zwei große Kacheln für Karla und Marvin |
| Übersicht | „Als Nächstes“, Aufgaben für heute/diese Woche, laufende Projekte, offene Einkaufspositionen und dringende Mängel |
| Projekte | Karten mit Raum, Titelbild, Status, Priorität und Fortschritt; Filter geplant/laufend/abgeschlossen |
| Projekt | Kopf mit Titel und Raum; Register Übersicht, Aufgaben, Einkauf, Fotos und Verlauf |
| Aufgaben | Filter Alle/Mein Profil/Gemeinsam sowie Status, Termin, Projekt und Priorität; direktes Abhaken |
| Einkauf | Offene Positionen, optional nach Projekt gruppiert; Menge und Einheit gut lesbar; gekaufte Positionen eingeklappt |
| Haus | Räume/Bereiche und separate Mängelliste; ein Mangel lässt sich mit wenigen Angaben erfassen |
| Fotovergleich | Zwei beschriftete Bilder im gemeinsamen Rahmen, Schieber, Vollbildansicht und Wahl eines anderen Bildpaares |
| Einstellungen | Profilwechsel, zur Profilauswahl zurückkehren, Speicher und Sicherungsstatus |

Das Dashboard priorisiert Handlungen: Was wollen wir als Nächstes angehen? Was steht diese Woche an? Was fehlt dafür? Es bekommt keine dekorativen Diagramme ohne Entscheidungsnutzen.

Primäre Touch-Flächen: mindestens 44 × 44 CSS-Pixel. Klare Tastaturfokusse, beschriftete Formularfelder und verständliche Fehlermeldungen. Leere Ansichten enthalten jeweils einen sinnvollen Einstieg, etwa „Erstes Projekt anlegen“.

Ein klickbarer Prototyp der Hauptabläufe entsteht nach dem Go als erster sichtbarer Gestaltungsschritt. Er ist ausdrücklich von der späteren funktionierenden App zu unterscheiden.

## 7. Technische Empfehlung

**Vorgeschlagen:** React und TypeScript mit Vite für die Oberfläche, ein schlanker Node.js-Server mit TypeScript für die Anwendung, SQLite für strukturierte Daten und ein eigener Ordner für Fotos. Caddy übernimmt HTTPS im Heimnetz. Die Anwendung läuft nativ unter Windows.

| Entscheidung | Begründung und Alternative |
| --- | --- |
| React mit TypeScript | Geeignet für Filter, Formulare, Galerien und den Vergleichsschieber; wiederverwendbare Komponenten. Reines HTML/JavaScript wäre bei so vielen gemeinsamen Zuständen aufwendiger konsistent zu halten. |
| Vite als Bauwerkzeug | Erzeugt die auslieferbare Oberfläche. Der Entwicklungsserver wird nicht für den Dauerbetrieb eingesetzt. |
| Node.js mit einem kleinen HTTP-Framework | Eine Sprache für Oberfläche und Server; ein Anwendungsprozess für API und Auslieferung. Konkrete Bibliotheken werden nach Windows-Kompatibilität und Wartungsstand ausgewählt. |
| SQLite | Für zwei Personen und kurze Schreibvorgänge passend; kein separater Datenbankdienst. PostgreSQL wäre möglich, erhöht hier aber Betriebs- und Sicherungsaufwand. |
| Native Windows-Ausführung | Kein zusätzlicher Docker-/WSL-Unterbau auf dem Gaming-PC. Docker bleibt eine mögliche spätere Verpackung bei einem Hosting-Wechsel. |
| Caddy für lokales HTTPS | Automatische Erneuerung interner Zertifikate; zusätzlicher kleiner Dienst. Erfordert einmaliges Vertrauen der Zertifikatsstelle auf den Endgeräten. |
| PHP als Alternative | Technisch ebenso möglich und bei klassischem Webhosting interessant. Für den festgelegten Windows-Betrieb bietet Node die einheitlichere Entwicklungsumgebung. |

Verwendet wird eine zum Umsetzungsbeginn unterstützte Node-LTS-Version mit geprüften Windows-Abhängigkeiten. Der offizielle Plan führt Node 26 seit dem 28. Oktober 2026 als Active LTS; die konkrete Patchversion und native Pakete werden vor Installation erneut geprüft. [Node-Releaseplan](https://github.com/nodejs/Release)

Architekturentscheidungen werden im Projekt dokumentiert. Es gibt zunächst weder Microservices noch Redis, einen separaten Jobserver oder einen Cloud-Speicher. Normale API-Anfragen und sparsame Aktualisierungsabfragen reichen für zwei Personen voraussichtlich aus; das wird mit dem fertigen Grundgerüst gemessen.

### Vergleich der Hosting-Optionen aus der Info-Datei

| Option | Kosten und Verfügbarkeit | Wartung, Daten und Migration | Bewertung |
| --- | --- | --- | --- |
| Windows-PC | Keine neue Hardware nötig; zusätzliche Stromkosten möglich. Erreichbar nur solange PC und Netzwerk laufen. | Lokale Datenkontrolle; Updates, Autostart und Backup selbst betreiben. Genug Leistung nach Hardwareangabe, tatsächliche Last noch messen. | Gewählte Lösung; für die erste Version sinnvoll. |
| Vorhandenes netcup-Webhosting | Bestehender Vertrag; unabhängig vom eingeschalteten PC. Vertragsgrenzen ungeprüft. | PHP ist dokumentiert; dauerhafte Node-Prozesse, private Speicherbereiche und Ressourcen des konkreten Altvertrags müssen geprüft werden. Daten beim Anbieter. | Alternative bei späterem Architekturwechsel, aktuell nicht benötigt. |
| VPS | Laufende Zusatzkosten und zusätzlicher Serverbetrieb. Kann unabhängig vom Heim-PC erreichbar sein. | Eigene Verantwortung für Systemupdates, Zugänge, Backups und öffentlich erreichbare Dienste. Node-App gut übertragbar. | Für reinen Heimzugriff aktuell kein Vorteil, der den Zusatzaufwand rechtfertigt. |
| PC plus separates Backupmedium | Vorhandenen Speicher verwenden, wenn tatsächlich verfügbar. | Trennt Arbeitsdaten und Sicherung; FRITZ!NAS ist erst nach Prüfung ein geeignetes Ziel. | Empfohlene Ergänzung zum PC. |

Die netcup-Dokumentation beschreibt unter anderem PHP, geplante Aufgaben und Zertifikatsverwaltung; daraus folgt keine Zusage für euren konkreten Tarif. [netcup Webhosting-Verwaltung](https://www.netcup.com/en/helpcenter/documentation/web-hosting/interface)

Für die Grundversion sind keine kostenpflichtigen Dienste und keine neue Hosting-Hardware eingeplant. Die in der Info-Datei genannte Obergrenze für zusätzliche Hardware bleibt 100 Euro. Ob ein unabhängiges Backup ohne Anschaffung möglich ist, hängt vom tatsächlich vorhandenen Speichermedium ab. Laufende Stromkosten des PCs sind davon getrennt.

### Lokales HTTPS und Geräteinstallation

Für die vorgesehene PWA-Installation wird HTTPS eingeplant. Die Ausnahme für `localhost` hilft einem Handy beim Zugriff auf einen anderen PC nicht. [MDN zur PWA-Installation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)

Zieladresse: beispielsweise `https://zuhause.home.arpa`. Der PC erhält eine feste DHCP-Zuordnung. Ein lokaler DNS-Eintrag verweist auf diesen PC. Ob die vorhandene Routerkonfiguration dies direkt unterstützt, wird im ersten Technikschritt geprüft; alternativ kann eine feste LAN-IP als Adresse dienen.

UniFi dokumentiert lokale DNS-Einträge und DHCP-Reservierungen. Die Namensauflösung setzt voraus, dass die Geräte den Gateway als DNS-Server benutzen. Abweichende Einstellungen wie privates DNS werden deshalb in der Geräteprobe berücksichtigt. Die endgültige Adresse wird vor der PWA-Installation festgelegt: Hostname und IP-Adresse sind für den Browser unterschiedliche Ursprünge. [UniFi DNS und lokale Hostnamen](https://help.ui.com/hc/en-us/articles/15179064940439-UniFi-DNS-Records-and-Local-Hostnames)

Caddy stellt das lokale Zertifikat aus. Sein öffentliches Stammzertifikat wird auf Pixel, iPhone, iPad und den verwendeten Windows-Geräten als vertrauenswürdig eingerichtet. Der private Schlüssel verbleibt geschützt auf dem Server. Interne Namen und IP-Adressen werden von Caddy unterstützt; andere Geräte vertrauen der lokalen Zertifikatsstelle nicht automatisch. [Caddy Automatic HTTPS](https://caddyserver.com/docs/automatic-https)

Auf iPhone und iPad genügt das manuelle Installieren des Zertifikatsprofils allein nicht: Das Vertrauen für TLS muss zusätzlich aktiviert werden. Diese Schritte gehören zur Geräteanleitung. [Apple zum manuellen Zertifikatsvertrauen](https://support.apple.com/en-ie/102390)

Eine Zertifikatswarnung lediglich zu überspringen ist kein erfolgreicher Abschluss. Zertifikat, Name, PWA-Installation und erneuter Aufruf nach einem Geräteneustart werden auf den echten Geräten getestet. Falls lokales Zertifikatsvertrauen auf einem Zielgerät praktisch scheitert, ist die Alternative eine vorhandene Domain mit DNS-basierter Zertifikatsprüfung und weiterhin nur lokaler Erreichbarkeit; das würde vor einem Wechsel gesondert abgestimmt.

Der App-Server lauscht nur lokal hinter Caddy. Nur der HTTPS-Eingang wird für das ausgewählte private Heimnetz freigegeben. Windows-Firewall und Routerzugriff werden für IPv4 und IPv6 geprüft. Kein Tailscale, kein öffentlicher Tunnel und keine Portweiterleitung sind vorgesehen.

## 8. Datenmodell und Schnittstellen

| Datengruppe | Wesentliche Inhalte |
| --- | --- |
| Haushalt | Einstellungen, Sicherungs- und Speichergrenzen; kein App-Kennworthash |
| Profile | Feste IDs für Karla und Marvin, Anzeigename, Farbe |
| Sitzungen | Zufällige Sitzungskennung, Ablauf, ausgewähltes Profil; separat pro Gerät |
| Räume | Name, Bereich, Beschreibung, Archivstatus |
| Projekte | Raumbezug, Titel, Ziel, Status, Priorität, Planreihenfolge, Wunschdaten, Abschluss |
| Aufgaben | Optional Projekt/Raum, Titel, Beschreibung, Status, Priorität, Termine, Zuständigkeiten, Phase und Vorgänger-IDs |
| Einkauf | Optional Projekt, Kategorie, Bezeichnung, Menge, Einheit, Einzelpreis in Cent pro Einheit, gekauft und Käuferprofil |
| Mängel | Ort, Beschreibung, Priorität, Status, Zuständigkeit, optional Projektverknüpfung |
| Medien | Eigentlicher Speicherpfad intern, Dateityp, Größe, Prüfsumme, Orientierung, Aufnahme-/Uploadzeit, Zuordnung |
| Vergleiche | Projekt, Vorher- und Nachher-Medien-ID, Beschriftung, Ausschnitt und Ausrichtung |
| Verlauf | Projektbezug, Notiz oder Ereignistyp, ausgewähltes Profil, Zeitpunkt |
| Sicherungsläufe | Start, Abschluss, Ziel, Erfolg/Fehler, Manifest und Prüfstatus |

Bearbeitbare fachliche Datensätze erhalten IDs, Erstellerprofil, letzte Bearbeitung, Zeitstempel und eine Versionsnummer. Zuständigkeit „beide“ wird als Beziehung zu beiden Profilen gespeichert. Datenbankbeziehungen und Transaktionen verhindern verwaiste Verknüpfungen; Medien liegen nicht als große Binärdaten in SQLite.

Vorgesehene API-Bereiche: Gerätesitzung, Profile, Räume, Projekte, Aufgaben, Einkauf, Mängel, Medien, Vergleiche, Verlauf und Betriebsstatus. Daten und Vorschaubilder benötigen eine gültige, automatisch angelegte Gerätesitzung. Diese ist keine Kennwortanmeldung; der Zugriff ist innerhalb des freigegebenen Heimnetzes offen. Die Profilwahl wird serverseitig auf die beiden erlaubten Profile begrenzt; ein Schreibformular bestimmt seinen Autor nicht selbst.

Getrennte Speicherbereiche: Quellcode und gebaute Anwendung, Datenbank, Originalbilder, Vorschauen, temporäre Uploads und Protokolle. Der Datenpfad wird konfigurierbar, etwa unter `C:\ProgramData\UnserZuhause`. SQLite liegt lokal auf dem PC, nicht in einer Netzfreigabe oder einem automatisch synchronisierten Cloud-Ordner. Ein NAS ist ein Sicherungsziel.

Schemaänderungen erfolgen durch nummerierte Migrationen mit Sicherung vor dem Update. Versionsinformationen und Exportformate werden so dokumentiert, dass später App, Datenbank und Bilder auf andere Hardware umziehen können.

### Erweiterte Projektplanung

Aufgaben erhalten die Phasen **Planung**, **Vorbereitung**, **Renovierung** und **Abschluss**. Bereits vorhandene Aufgaben werden ohne Inhaltsverlust der Vorbereitung zugeordnet und erhalten zunächst keine Vorgänger. Liste, Board und Zeitachse verwenden dieselben Datensätze. Die Zeitachse stellt Start- und Fälligkeitsdaten dar; undatierte Aufgaben bleiben sichtbar. Automatische Terminverschiebungen, Arbeitszeitkalender und Ressourcenoptimierung sind nicht Teil dieser Erweiterung.

Eine Aufgabe darf mehrere Vorgänger innerhalb desselben Projekts haben. Alle müssen erledigt sein, bevor die Aufgabe auf „In Arbeit“ oder „Erledigt“ gesetzt werden kann. Zuweisung, Priorität und Termine lassen sich bereits vorher festlegen. Offene Voraussetzungen werden als „Wartet auf …“ angezeigt; ein Filter zeigt startbereite Aufgaben. Eine manuelle Blockierung etwa wegen fehlenden Materials bleibt zusätzlich bestehen.

Der Server prüft diese Regeln auch bei direkten API-Aufrufen. Selbstbezüge, doppelte Verknüpfungen, Kreise und Verbindungen zwischen unterschiedlichen Projekten sind unzulässig. Ein referenzierter Vorgänger darf nicht durch Archivierung oder Projektwechsel verschwinden. Ein erledigter Vorgänger darf nicht wieder geöffnet werden, solange darauf beruhende Folgeaufgaben laufen oder erledigt sind. Solche Konflikte müssen ausdrücklich geklärt werden; bestehende Arbeit wird nicht automatisch zurückgesetzt.

## 9. Fotos und Vergleich

Für die erste Version werden JPEG, PNG und WebP eingeplant. iPhone-Aufnahmen und Bibliotheksuploads werden früh mit echten Dateien geprüft. HEIC-Unterstützung wird nicht einfach vorausgesetzt: Die Windows-Standardpakete der vorgesehenen Bildbibliothek sharp enthalten HEIC nicht als reguläres Eingabeformat. [sharp Installation](https://sharp.pixelplumbing.com/install/)

Der frühe Techniktest entscheidet, ob ein zusätzlicher gepflegter Decoder für HEIC zuverlässig integrierbar ist. Ziel bleibt ein alltagstauglicher iPhone-Upload. Falls das nicht gelingt, muss eine praktikable JPEG-Variante ausdrücklich als Einschränkung dokumentiert und vor der Fotoabnahme akzeptiert werden. Unlesbare Dateien dürfen nicht als erfolgreicher Upload erscheinen.

Vorgeschlagene anfängliche Grenzen: 25 MB pro Bild, 60 Megapixel, höchstens 10 Dateien pro Auswahl und eine Bildverarbeitung gleichzeitig. Diese Grenzwerte werden nach den echten Testfotos angepasst. Die serverseitigen Grenzen gelten auch für direkt gesendete Uploads.

Die Verarbeitung prüft Dateiinhalte und Bildgröße, korrigiert EXIF-Ausrichtung und erzeugt kleine Vorschauen. Originale bleiben geschützt erhalten. Angezeigte Ableitungen enthalten keine GPS-Metadaten. Das Original kann solche Metadaten weiterhin enthalten; es ist deshalb ebenfalls nur über den geschützten Zugriff verfügbar.

Ein Upload wird erst sichtbar und als erfolgreich bestätigt, wenn die geprüfte Datei vollständig im endgültigen geschützten Speicher liegt und ihr Datenbankeintrag gespeichert ist. Ein Prozessabbruch darf keinen erfolgreichen Datensatz mit fehlendem Bild hinterlassen. Übrig gebliebene Dateien ohne gültige Zuordnung werden über einen kontrollierten Abgleich erkannt und bereinigt.

Vorher und Nachher werden ausdrücklich zugeordnet. Ein Projekt darf mehrere Vergleichspaare haben, etwa unterschiedliche Wände. Gemeinsamer Bildrahmen, speicherbarer Ausschnitt und korrekte Orientierung verhindern unnötige Sprünge. Automatische perspektivische Ausrichtung verschiedener Aufnahmewinkel ist nicht Teil der ersten Version.

Der Slider zeigt klare Beschriftungen und lässt sich auch mit Pfeiltasten bedienen. Die Bilddateien werden beim Verschieben nicht neu berechnet. Uploadfortschritt, Abbruch und verständliche Fehlermeldungen gehören zum Ablauf.

## 10. Schutz, Ressourcen und Betrieb

### Zugang und Datenschutz

- Kein App-Kennwort, keine Kennworteinrichtung und keine Kennwortänderung. Ein alter Anmeldehash und alte Sitzungen werden bei der Umstellung durch eine nummerierte Migration entfernt; die Haushaltsdaten bleiben erhalten.
- Serververwaltete Gerätesitzungen mit HttpOnly-, bei HTTPS Secure- und SameSite-Cookie; kein Sitzungstoken im Local Storage. Zurücksetzen einer Sitzung führt wieder zur Profilauswahl und betrifft nur das jeweilige Gerät.
- Host-/Origin-Prüfung, CSRF-Schutz und validierte Eingaben; parametrisierte Datenbankabfragen und sichere Textausgabe. Diese Maßnahmen verhindern keine bewusste Nutzung durch andere Geräte im erlaubten Heimnetz.
- Medien werden unter internen Dateinamen außerhalb frei zugänglicher Webordner gespeichert. Auch bekannte direkte Foto- und Thumbnail-Adressen brauchen eine gültige Sitzung.
- Dateiendung und vom Browser angegebener Dateityp genügen nicht als Uploadprüfung. HTML, SVG und ausführbare Dateien werden nicht als Fotos angenommen. Pfadmanipulation und übergroße Bilder werden abgefangen.
- Die PWA speichert zunächst nur ihre allgemeinen Oberflächendateien offline. Private API-Antworten und Fotos werden weder im Service Worker dauerhaft abgelegt noch über den normalen HTTP-Cache gespeichert (`Cache-Control: no-store`). Das Zurücksetzen auf die Profilauswahl entfernt die bisherige Ansicht; verspätete Antworten dürfen sie nicht wiederherstellen. Bei Zurücknavigation und Rückkehr in die App wird die Sitzung erneut geprüft.
- Keine externen Analysewerkzeuge, Werbedienste oder zur Laufzeit nachgeladenen Schriftarten. Protokolle enthalten keine Kennwörter, Sitzungsschlüssel oder vollständigen privaten Formularinhalte.
- Browserseitiger Schutz ersetzt keinen Schutz vor jemandem mit administrativem Windows-Zugriff. Dateiberechtigungen und vorhandene Laufwerksverschlüsselung werden bei der Einrichtung geprüft.

### Speicher und Leistung

Die Info-Datei nennt ungefähr 40 GB freien SSD-Speicher. Die aktuelle lesende Prüfung meldete auf C: rund 584,8 GB frei. Das ist keine Freigabe, diesen Speicher auszuschöpfen. Als konservativer Startwert werden 20 GB für Originalbilder und Vorschauen vorgesehen, mit Warnung ab 80 Prozent und Sperre neuer Uploads beim Limit oder bei weniger als 10 GB freiem Laufwerksplatz.

Die Werte sind konfigurierbare Planungswerte. Neue Uploads benötigen zusätzlich Reserven für temporäre Dateien und Bildverarbeitung. Verwaiste temporäre Uploads werden kontrolliert bereinigt. Bestehende Dateien werden bei knappem Platz nicht automatisch gelöscht.

Vorläufige Messziele: Die App samt HTTPS-Dienst soll im Leerlauf im Mittel unter einem Prozent der gesamten CPU-Kapazität bleiben und ohne laufende Bildverarbeitung möglichst weniger als 500 MB Arbeitsspeicher beanspruchen. Das sind Ziele, keine bereits gemessenen Zusagen. Ladezeiten und Speicher werden mit zwei Geräten und einem Datensatz aus etwa 1.000 Aufgaben und 500 Fotos geprüft; Bilder werden verkleinert und seitenweise geladen.

Es laufen keine Videokonvertierungen oder dauernden Bildanalysen im Hintergrund. Sicherungen werden zeitlich steuerbar. Strombedarf wird nicht aus CPU-Modell oder RAM geschätzt; bei Bedarf lässt er sich am realen PC messen.

### Windows-Betrieb und Updates

App und HTTPS-Dienst erhalten einen dokumentierten automatischen Start, kontrollierten Neustart nach Fehlern und begrenzte Protokolldateien. Die konkrete Windows-Diensteinrichtung wird im Technikschritt geprüft; sie muss ohne geöffnete Konsole und ohne interaktive Windows-Anmeldung funktionieren.

Der PC muss eingeschaltet und wach sein. Schlafmodus, ausgeschalteter Rechner oder Windows-Neustart machen die App vorübergehend unerreichbar. Die PWA-Installation ändert das nicht. Energiespareinstellungen werden nicht ungefragt dauerhaft umgestellt.

Updates: Sicherung erstellen und prüfen → Anwendung kurz anhalten → neue Version und erforderliche Migration einspielen → Funktionsprüfung → Betrieb fortsetzen. Ein Rückweg braucht gegebenenfalls die vorherige Anwendung und die dazu passende Datenbanksicherung. Nur alte Programmdateien über ein bereits verändertes Schema zu kopieren reicht nicht.

## 11. Datensicherung und Wiederherstellung

Das Sicherungsziel muss vor dem produktiven Einsatz tatsächlich vorhanden und geprüft sein. Die FRITZ!NAS-Funktion allein belegt noch keinen angeschlossenen, ausreichend großen Datenträger. Ein vorhandenes externes Laufwerk oder ein nutzbares NAS ist die bevorzugte Ergänzung. Eine Kopie auf derselben SSD schützt nicht vor deren Ausfall.

Vorgeschlagen sind tägliche versionierte, verschlüsselte Sicherungen mit 7 Tages-, 4 Wochen- und 3 Monatsständen, soweit das Ziel genügend Platz hat. Unveränderte Bilder sollen dabei nicht jeden Tag vollständig neu dupliziert werden. Ist der PC zum vorgesehenen Zeitpunkt aus, wird eine fällige Sicherung beim nächsten Start nachgeholt. Die App zeigt letzten Erfolg, Alter und Fehler sichtbar an.

Die Datenbank wird konsistent mit der SQLite Backup API oder einem gleichwertigen vorgesehenen Verfahren gesichert. Das unkoordinierte Kopieren einer geöffneten Datenbankdatei reicht nicht. [SQLite Backup API](https://www.sqlite.org/backup.html)

Zum Datenbankstand gehört ein Manifest der referenzierten Mediendateien mit Prüfsummen. Medien werden unveränderlich gespeichert; endgültiges Löschen wird während einer Sicherung ausgesetzt. Erst wenn Datenbank, zugehörige Dateien, Konfiguration und Prüfergebnisse zusammenpassen, gilt der Lauf als erfolgreich. Neue Dateien nach dem Snapshot gehören zum nächsten Sicherungsstand.

Auch benötigte Betriebseinstellungen und das lokale Zertifikatsmaterial brauchen eine geschützte Sicherung. Der private CA-Schlüssel wird niemals als öffentliche Download-Datei verteilt. Der Wiederherstellungsschlüssel für verschlüsselte Backups muss zusätzlich außerhalb des Hosting-PCs verfügbar sein.

Abnahme: Wiederherstellung in einen leeren Datenordner, Profilauswahl, Stichprobe von Räumen und Aufgaben, Öffnen von Originalen und Vorschauen sowie Test eines Vergleichspaars. Alte Sitzungen werden nach einer Wiederherstellung verworfen; ein aus einer älteren App-Version wiederhergestellter Anmeldehash wird beim Start migriert und entfernt. Dieser Test wird nach wesentlichen Änderungen des Sicherungsverfahrens und vorgeschlagen vierteljährlich wiederholt.

Ziel für möglichen Datenverlust: höchstens ein Tag bei täglich erfolgreich laufender Sicherung. Bei ausgeschaltetem PC, fehlendem Sicherungsmedium oder Fehlern gilt diese Zusage nicht; maßgeblich ist der angezeigte letzte erfolgreiche Stand. Eine weitere getrennt aufbewahrte Sicherung schützt zusätzlich gegen Schäden am ganzen Standort und bleibt eine Ausbauoption.

## 12. Umsetzung nach dem Go

Jedes Paket wird geprüft, bevor darauf aufgebaut wird. Ein Go zur Umsetzung umfasst diese Reihenfolge; für normale Entwicklungsschritte ist keine erneute grundsätzliche Freigabe nötig. Neue Kosten oder eine Änderung der beschlossenen Zugriffsart werden nicht still eingeführt.

| Paket | Arbeit | Abnahme vor dem nächsten abhängigen Schritt |
| --- | --- | --- |
| M1 Grundlagen und Machbarkeit | Git, Projektstruktur, dokumentierte Assistentenregeln, unterstützte Laufzeit, native Datenbank/Bildverarbeitung, HTTPS-Konzept und Geräteprobe | Windows-Abhängigkeiten laufen; lokaler HTTPS-Zugriff und PWA-Grundlage geprüft; iPhone-Formatpfad geklärt; konkrete offene Betriebsfragen protokolliert |
| M2 Oberfläche und Abläufe | Designsystem, Navigation, klickbarer Prototyp mit Beispieldaten | Hauptwege für Projekt, Aufgabe, Einkauf, Mangel und Fotovergleich sind auf Handybreite nachvollziehbar; Lade-, Leer- und Fehlerzustände geplant |
| M3 Zugang und Datenkern | Haushaltsschutz, Profile, Sitzungen, Migrationen, Räume und Projekte | Kein anonymer Datenzugriff; Profil bleibt pro Gerät getrennt; Daten überstehen einen Neustart |
| M4 Planung und Zusammenarbeit | Aufgaben, Prioritäten, Reihenfolge, Termine, Einkauf und Mängel | Zwei Geräte sehen Änderungen; Zuständigkeit und Autorschaft stimmen; Konflikttest erfolgreich |
| M5 Fotos und Verlauf | Sichere Uploads, Vorschauen, Galerie, Vergleiche und Notizen | Echte Zielgeräte laden Bilder hoch; private URLs geschützt; Slider mit Touch und Tastatur bedienbar |
| M6 Übersicht und PWA | Dashboard, Zusammenführung der Funktionen, installierbare Oberfläche, Verbindungszustände | Angezeigte Zahlen stimmen mit den Listen überein; alle Hauptabläufe auf Zielgeräten nutzbar |
| M7 Betrieb und Wiederherstellung | Autostart, Sicherung, Speichergrenzen, Update- und Wiederherstellungsanleitung | Start ohne Windows-Anmeldung; Fehlerneustart; Wiederherstellung in leeres Verzeichnis; reales unabhängiges Backupziel eingerichtet |
| M8 Alltagstest und Abschluss | Gemeinsames Beispielprojekt von der Idee bis zum Abschluss; Fehlerkorrekturen | Alle Muss-Anforderungen geprüft, bekannte Einschränkungen benannt und keine offenen Fehler mit Datenverlust oder ungeschütztem Zugriff |

Für reproduzierbare Tests werden eigene Testdaten verwendet. Echte Hausfotos und Zugangsdaten gehören nicht ins Git-Repository. Ein späteres `AGENTS.md` dokumentiert kleine Arbeitspakete, Prüfpflichten, Migrationen, den Schutz echter Daten und die Trennung von Test- und Produktivbetrieb.

## 13. Konkrete Gesamtabnahme

| Test | Erwartung |
| --- | --- |
| Frische App öffnen | Automatische Gerätesitzung, direkt Profilauswahl, keine Kennwortabfrage |
| Ohne Gerätesitzung Projekt-API und direkte Foto-URL öffnen | Kein Inhalt wird geliefert; eine Sitzung kann im freigegebenen Heimnetz ohne Kennwort angelegt werden |
| Karla am Handy, Marvin auf dem iPad auswählen | Beide Profilwahlen bleiben unabhängig sichtbar |
| Formular öffnen und Profil in einem zweiten Tab wechseln | Speichern wird nicht still dem anderen Profil zugeordnet; Eingaben bleiben erhalten |
| Karla erstellt Aufgabe für Marvin; Marvin bearbeitet sie | Ersteller bleibt Karla, letzte Bearbeitung Marvin, Zuständigkeit weiterhin nachvollziehbar |
| Zwei Projekte im selben Raum anlegen | Aufgaben, Vergleiche und Verlauf bleiben projektbezogen getrennt |
| Mangel ohne Projekt erfassen | Erstellen gelingt; spätere Projektverknüpfung erhält den ursprünglichen Befund |
| Priorität und geplante Reihenfolge ändern, neu laden | Werte bleiben erhalten und erscheinen auch auf dem zweiten Gerät |
| Vier Aufgaben anlegen, eine erledigen | Projekt zeigt 25 Prozent; ohne Aufgaben keine fiktiven 100 Prozent |
| Aufgabe mit zwei Vorgängern planen und zuweisen | Planung möglich; Start und Erledigen erst nach Abschluss beider Vorgänger |
| Abhängigkeiten im Kreis oder zwischen Projekten setzen | Server und Oberfläche weisen die ungültige Verknüpfung zurück |
| Erledigten Vorgänger einer bereits laufenden Folgeaufgabe wieder öffnen | Verständlicher Konflikt statt still ungültiger Aufgabenfolge |
| Zwischen Phasenliste, Board und Zeitachse wechseln | Dieselben Aufgaben, Zuständigkeiten und Termine; keine duplizierten Planungsdaten |
| Fälligkeit gestern, heute und ohne Datum prüfen | Nur gestern und noch offen erscheint überfällig; Tageswechsel Europe/Berlin funktioniert |
| Einkauf mit Menge, Einheit und unbekanntem Preis erfassen | Menge/Einheit bleiben erhalten; unbekannter Preis wird nicht zu null Euro |
| Aufgabe auf zwei Geräten gleichzeitig ändern | Zweiter veralteter Speichervorgang meldet einen Konflikt und behält die eigenen Eingaben |
| Anfrage zum Anlegen nach Verbindungsabbruch wiederholen | Kein doppelter Eintrag für denselben Anlegevorgang |
| Echte Kameraaufnahmen und Bibliotheksfotos von Pixel und iPhone hochladen | Upload erfolgreich, Orientierung und Darstellung korrekt; eine zuvor ausdrücklich vereinbarte Formateinschränkung wird separat dokumentiert |
| Falschen Dateityp, übergroße Datei und manipulierten Pfad senden | Upload sicher abgelehnt; keine ausführbare oder frei erreichbare Datei entsteht |
| Zwei unterschiedliche Bildformate vergleichen | Gewählter Rahmen/Ausschnitt bleibt gespeichert; Finger, Maus und Tastatur funktionieren |
| Zur Profilauswahl zurückkehren und zurück navigieren | Alte Ansichten erscheinen weder durch einen verspäteten Datenabruf noch aus einem PWA-Cache erneut |
| WLAN trennen oder Server stoppen | Verbindungsfehler sichtbar; keine erfolgreiche Speicherung vorgetäuscht |
| PWA auf Pixel, iPhone, iPad und Windows installieren | Startsymbol, Navigation und HTTPS ohne Zertifikatswarnung funktionieren |
| Zugriff aus Mobilfunk beziehungsweise gesperrtem Gastnetz versuchen | App nicht erreichbar; nur das vorgesehene Heimnetz ist freigegeben |
| Windows neu starten und App-Prozess gezielt beenden | Automatischer Start beziehungsweise Wiederanlauf funktioniert ohne offene Konsole |
| Sicherungsziel unerreichbar machen | Fehler und letzter erfolgreicher Stand werden angezeigt; kein falscher Erfolg |
| Sicherung vollständig wiederherstellen | Projekte, Profile, Bilder, Vergleichspaare und Einstellungen sind konsistent nutzbar |

Automatisiert geprüft werden insbesondere Berechtigungen, Geschäftregeln, API-Validierung, Konflikte, Migrationen und Sicherung/Wiederherstellung. Browserprüfungen decken die wichtigsten Wege ab. Echte Kamera-, Zertifikats- und Installationsabläufe werden zusätzlich auf den vorhandenen Geräten getestet; simulierte Mobilansichten ersetzen das nicht.

## 14. Risiken und noch zu prüfende Voraussetzungen

| Risiko oder Voraussetzung | Auswirkung | Vorgehen |
| --- | --- | --- |
| PC aus, schlafend oder im Neustart | Kein Zugriff auf Daten | Sichtbarer Verbindungszustand; Nutzungserwartung klären, Energiesparen bewusst einrichten |
| Lokale Zertifikate oder DNS nicht korrekt | PWA funktioniert am Handy nicht zuverlässig | Früher Test auf allen Geräteklassen; Vertrauen korrekt installieren und dokumentieren |
| Falsches Profil ausgewählt | Eintrag trägt den falschen Namen | Profil dauerhaft sichtbar, einfacher Wechsel; freiwillige Zuordnung transparent erklären |
| Anderes Gerät im freigegebenen Heimnetz | Kann den gesamten Haushalt ohne App-Kennwort nutzen | Heimnetz- und Gastnetztrennung bewusst einrichten; keine öffentliche Freigabe |
| HEIC nicht lesbar | Bestimmte iPhone-Fotos nicht direkt nutzbar | Formatprobe in M1, Decoder prüfen, Einschränkung vor Fotoabnahme klären |
| Gleichzeitige Änderungen | Überschreiben fremder Arbeit | Versionsprüfung und Konfliktanzeige |
| SSD voll oder Bild zu groß | Fehler beim Upload oder Datenverlust | Reserven, Quoten, serverseitige Grenzen und kontrollierte Bildverarbeitung |
| Backup nur auf derselben SSD | Keine Absicherung gegen Laufwerksausfall | Unabhängiges Ziel vor produktivem Einsatz nachweisen |
| Backup vorhanden, aber unbrauchbar | Fotos oder Daten nicht wiederherstellbar | Manifest, Prüfsummen und vollständige Probe-Wiederherstellung |
| Softwareupdate ändert Schema | Alte App funktioniert nicht mit neuen Daten | Versionierte Migration und getesteter Rückweg |
| Aufwand wächst durch Extras | Grundfunktionen werden nie stabil fertig | Erst F01–F15 abschließen; spätere Funktionen getrennt planen |

Für den Plan sind die drei Produktentscheidungen beantwortet. Vor der Einrichtung müssen noch die tatsächliche Router-/DNS-Konfiguration, ein vorhandenes unabhängiges Backupmedium und die auf euren Geräten installierten Betriebssystem-/Browserversionen geprüft werden. Zu Beginn lag im Arbeitsordner nur die Info-Datei; Git ist erreichbar, Node und npm wurden im aktuellen PATH nicht gefunden. Das beweist keine vollständige Softwareinventur, zeigt aber einen nötigen Einrichtungsschritt.

Die Hardwareangaben Ryzen 5 5600 und 32 GB RAM stammen aus der Info-Datei und wurden nicht separat vermessen. Leistung, Gerätekompatibilität und Wiederherstellung werden erst nach Umsetzung als bestanden bezeichnet.

**Freigegebener Umfang:** Grundversion auf dem Windows-PC, nur im Heimnetz, mit frei wählbaren Profilen Karla/Marvin; dazu kennwortfreier App-Zugang, Aufgabenabhängigkeiten, Phasenliste/Board/Zeitachse und überlagerter Fotovergleich. Videos, XP, Fernzugriff und kostenpflichtige Dienste bleiben außerhalb dieses Umfangs.
