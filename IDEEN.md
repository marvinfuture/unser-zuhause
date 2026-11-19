# Ideensammlung – Unser Zuhause

Stand: 19. November 2026

Diese Datei sammelt die gewünschten Änderungen an der Webapp. Der Status jedes Eintrags hält fest, ob eine Umsetzung freigegeben wurde. Änderungen an der App erfolgen ausschließlich auf ausdrückliche Anweisung. Neue Ideen werden hier ergänzt.

Am 19. November wurden die funktionalen Ideen I-05 bis I-12 zur Umsetzung freigegeben. Für I-10 hat Marvin getrennte persönliche Punkte für Karla und Marvin gewählt. Das iPhone ist laut Marvin bereits mit der App auf dem anderen Windows-PC verbunden.

**Optik ausdrücklich zurückstellen:** I-13 steht ganz hinten. Änderungen an der Optik beginnen erst nach der ausdrücklichen Anweisung des Nutzers: „Wir kümmern uns jetzt um die Optik.“

## I-01 – Direkter Einstieg ohne Kennwort

**Status:** Am 17. November 2026 freigegeben; am 18. November 2026 umgesetzt.

- Beim Öffnen der App direkt die Auswahl **Karla / Marvin** anzeigen.
- Keine Kennwortabfrage für den App-Zugang.
- Die zugehörigen Kennwort- und Anmeldefunktionen entfernen; der ursprüngliche Wunsch lautet: „alles, was mit Kennwort zu tun hat“.

**Umfang dieser Umsetzung:** Der App-Zugang wird kennwortfrei. Das separate Sicherungskennwort für verschlüsselte Backups und das Windows-Kontokennwort für den optionalen Autostart bleiben unverändert. Die Profilwahl, Zuordnung der Einträge und vorhandene Haushaltsdaten bleiben erhalten.

## I-02 – Aufgaben verketten

**Status:** Am 17. November 2026 freigegeben; am 18. November 2026 umgesetzt.

- Aufgaben können voneinander abhängig sein.
- Eine Folgeaufgabe wird erst freigegeben, wenn ihre Vorgängeraufgabe erledigt ist.
- Dadurch lässt sich die notwendige Reihenfolge der Renovierungsarbeiten abbilden.

**Umsetzung:** Eine Aufgabe kann mehrere Vorgänger innerhalb desselben Projekts haben. Vorheriges Planen und Zuweisen bleibt möglich; Arbeitsbeginn und Erledigen sind erst erlaubt, wenn alle Vorgänger erledigt sind.

## I-03 – Renovierungen als Projekte planen

**Status:** Am 17. November 2026 freigegeben; am 18. November 2026 umgesetzt.

- Renovierungen als zusammenhängende Projekte planen und organisieren.
- Aufbau und Organisation sollen sich an **Microsoft Project beziehungsweise Microsoft Planner** orientieren.

**Umsetzung:** Projektaufgaben erhalten die Phasen Planung, Vorbereitung, Renovierung und Abschluss. Liste, Board und Zeitachse zeigen denselben Datenbestand. Termine werden zunächst manuell geplant. Eine vollständige Nachbildung von Microsoft Project ist nicht Teil dieses Ausbaus.

## I-04 – Vorher-Nachher-Fotos mit überlagertem Slider

**Status:** Am 17. November 2026 freigegeben; am 18. November 2026 umgesetzt. Bedienung am echten iPhone noch zu prüfen.

- Vorher- und Nachher-Foto liegen in derselben Vergleichsfläche übereinander.
- Ein verschiebbarer Regler legt jeweils mehr vom Vorher- oder Nachher-Bild frei.
- Durch Hin- und Herziehen wird die Veränderung direkt an derselben Bildposition sichtbar.

**Umsetzung:** Der vorhandene überlagerte Vergleich bleibt erhalten. Ergänzt wurden direkte Schaltflächen für „Nur Vorher“, „Vergleichen“ und „Nur Nachher“. Der native Schieberegler unterstützt Maus, Touch und Tastatur; Ausschnitt und Zoom bleiben einstellbar. Ein Test auf einem echten iPhone ist noch offen.

## Erste Bewertung und Vorschlag für den nächsten Schritt

Die folgende erste Bewertung ist historisch und wurde vor der Freigabe festgehalten. Anschließend hat der Nutzer alle vier Ideen zur Umsetzung freigegeben. Maßgeblich sind jetzt die oben dokumentierten Umsetzungen: Das Sicherungskennwort bleibt bestehen, und die Zeitachse ist enthalten.

| Idee | Einschätzung nach Prüfung des vorhandenen Codes |
| --- | --- |
| I-01 – Ohne Kennwort | Technisch machbar und bequemer. Jedes Gerät, das die App im freigegebenen Heimnetz erreichen kann, könnte danach die gemeinsamen Inhalte sehen und verändern. Die Namensauswahl dient nur der Zuordnung. Das separate Sicherungskennwort bleibt eine offene Entscheidung. |
| I-02 – Aufgaben verketten | Sinnvoller nächster Ausbau mit mittlerem Aufwand. Aufgaben, Zuständigkeiten, Termine und Fortschritt bestehen bereits; echte Abhängigkeiten fehlen. Der derzeitige Status „Blockiert“ ist nur eine manuelle Markierung. |
| I-03 – Projektplanung | Sinnvoll, aber noch zu breit für einen einzelnen Umsetzungsschritt. Als Richtung bieten sich Projektphasen, Aufgabenliste, Board und später eine Zeitachse an. Aufgabenabhängigkeiten sind dafür eine passende Grundlage. |
| I-04 – Foto-Slider | Das gewünschte Grundprinzip ist bereits in `src/App.tsx` in `CompareSlider` umgesetzt: überlagerte Bilder mit verschiebbarer Trennlinie sowie einstellbarer Bildposition und Zoom. Als nächster Schritt wäre die Bedienung mit echten Bildpaaren auf dem iPhone zu prüfen; diese Bewertung umfasst keinen neuen Gerätetest. |

Microsoft beschreibt Aufgabenlisten, Boards und Zeitachsen sowie Abhängigkeiten als unterschiedliche Planungsfunktionen. Diese dienen als Orientierung für die eigene App: [Planner-Ansichten](https://support.microsoft.com/de-de/planner/create-a-plan-in-microsoft-planner), [erweiterte Planungsfunktionen](https://support.microsoft.com/de-de/planner/teams/advanced-capabilities-with-premium-plans-in-planner).

### Festgelegter Umfang für I-02 und I-03

Verhalten der freigegebenen Umsetzung:

- Aufgaben können mehrere Vorgänger innerhalb desselben Projekts haben. Alle Vorgänger müssen erledigt sein.
- Aufgaben dürfen schon vorher geplant, priorisiert und Karla oder Marvin zugewiesen werden.
- Arbeitsbeginn und Erledigen bleiben gesperrt, solange ein Vorgänger offen ist. Die Aufgabe zeigt „Wartet auf: …“.
- Nach Abschluss aller Vorgänger ist die Aufgabe startbereit. Sie wird nicht automatisch begonnen oder erledigt.
- Ein Filter „Startbereit“ zeigt, welche Arbeiten als Nächstes möglich sind.
- Eine manuelle Blockierung, etwa wegen fehlenden Materials, bleibt unabhängig von den Vorgängern bestehen.
- Aufgaben dürfen weder auf sich selbst noch über eine Kette wieder auf sich selbst warten.
- Ein erledigter Vorgänger darf nicht unbemerkt wieder geöffnet oder entfernt werden, wenn bereits laufende oder erledigte Folgeaufgaben davon abhängen. Betroffene Aufgaben müssen angezeigt und die Abhängigkeiten bewusst geklärt werden.
- Termine bleiben in diesem Ausbau manuell geplant. Die Zeitachse stellt sie dar; eine automatische Terminverschiebung ist nicht enthalten.

Beispiel: **Tapete entfernen → Wand ausbessern → Trocknung prüfen → Streichen**.

**Zuweisung:** Wartende Aufgaben dürfen bereits Karla oder Marvin zugewiesen werden. Gesperrt sind Arbeitsbeginn und Erledigen.

## Funktionale Erweiterungen und zurückgestellte Optik

Die Nummern dienen als Referenz und legen keine Umsetzungsreihenfolge fest. Einzige festgelegte Reihenfolge: Die optischen Wünsche kommen zuletzt. Die doppelt genannten Wünsche zu Müllabfuhr, Serien und Benachrichtigungen sind unten zusammengefasst.

## I-05 – Kalender mit individuellen Terminserien

**Status:** Umgesetzt. Im Kalender sind Einzeltermine und Serien mit frei gewähltem Wochenabstand und optionalem Enddatum möglich. Einzelne Termine können verschoben, ausgelassen, abgehakt und wieder geöffnet werden.

- Einen Kalender für Termine wie die Müllabfuhr beziehungsweise das Herausstellen der Mülltonne anbieten.
- Kalendereinträge als Serie anlegen können.
- Das Wiederholungsintervall je Serie individuell festlegen, beispielsweise alle zwei oder alle vier Wochen.
- Erinnerungen an diese Termine gehören zu I-06.


## I-06 – Einstellbare Push-Erinnerungen aufs Handy

**Status:** Umgesetzt. Jedes Gerät kann Push freiwillig für ein Profil aktivieren. Termin und Serie bestimmen Empfänger, Vorlauf und Uhrzeit. Voreinstellung ist der Vortag um 18 Uhr in der Zeitzone Europe/Berlin.

- Für Kalendereinträge beziehungsweise deren einzelne Serientermine eine Push-Benachrichtigung aufs Handy erhalten.
- Die Nachricht soll einen verständlichen Text und möglichst ein passendes Symbol enthalten.
- Einstellbar machen, ob und wann eine Nachricht kommt.
- Gewünschter Standard: Erinnerung einen Tag vor dem Termin.
- Wunsch prüfen: Eine Benachrichtigung soll möglichst eingeblendet bleiben, bis die zugehörige Tätigkeit abgehakt wurde.

**iPhone:** Dauer und Darstellung der Systemmeldung steuert iOS. Im Kalender bleibt eine fällige Erinnerung bis zum Abhaken oder Auslassen sichtbar. Die Testnachricht in der neu aktualisierten Home-Bildschirm-App dient der Prüfung auf dem eigenen iPhone.

## I-07 – Einkaufsliste und Erinnerungen für Haushaltsbedarf

**Status:** Umgesetzt. Haushaltsbedarf ist eine eigene Einkaufskategorie. Eine wiederkehrende Nachkauferinnerung lässt sich bei Bedarf mit einem Klick in die gemeinsame Einkaufsliste übernehmen.

- Auch regelmäßig benötigte Haushaltsartikel berücksichtigen, beispielsweise Seife, Toilettenpapier und Zewa/Küchenpapier.
- Über passende Erinnerungen zum Nachkaufen nachdenken.


## I-08 – Kleine Alltagserledigungen zum Abhaken

**Status:** Umgesetzt. Die gemeinsame Alltagsliste bietet Schnellerfassung und direktes Abhaken für Aufgaben ohne Projekt.

- Eine einfache To-do-Liste für kleine Erledigungen nutzen, beispielsweise „Glaser anrufen“.
- Einträge unkompliziert abhaken können.
- Solche Erledigungen sollen auch ohne umfangreiche Renovierungsplanung nutzbar sein.


## I-09 – Renovierungen in kleine Schritte aufteilen

**Status:** Umgesetzt. In der Projektplanung lassen sich kleine Schritte direkt erfassen. Die Planung nennt den nächsten startbereiten Schritt im gewählten Phasenfilter. Jeder Schritt ist eine reguläre Aufgabe mit Verlauf, Abhängigkeiten und gleichem Anteil am Projektfortschritt.

- Renovierungsvorhaben als übersichtliche Liste kleiner, einzeln abhakbarer Schritte planen.
- Den nächsten konkreten Arbeitsschritt leicht erkennen können.
- Bezug zur vorhandenen Projektplanung und zu den Aufgabenketten aus I-02/I-03 berücksichtigen.


## I-10 – Gamification mit Punkten und möglichen Belohnungen

**Status:** Umgesetzt. Die Funktion wird auf Wunsch eingeschaltet. Karla und Marvin haben getrennte Guthaben. Für jede erstmals gewertete Aufgabe erhält das abhakende Profil einen Punkt. Belohnungen und Preise legt ihr gemeinsam fest, einlösen kann jedes Profil nur sein eigenes Guthaben.

- Beim Abhaken erledigter Arbeiten möglicherweise Punkte erhalten.
- Gemeinsam festlegen, wofür diese Punkte gut sind.
- Genannte Möglichkeiten: Die App verwendet Punkte für eigene Fortschritte oder Belohnungen; alternativ lassen sich Punkte gegen selbst festgelegte Belohnungen „eintauschen“.

Beim Wiederöffnen bleibt der erste Punkt erhalten. Ein erneuter Abschluss derselben Aufgabe erzeugt keinen weiteren Punkt. Ein Pausieren erhält beide Guthaben.

## I-11 – Fortschrittsbalken für jedes Projekt

**Status:** Vorhanden und für die neuen Projektschritte mitgeprüft. Jede erledigte, nicht archivierte Projektaufgabe zählt einmal.

- Für jedes Projekt einen gut sichtbaren Fortschrittsbalken anzeigen.
- Beim Abhaken einer zugehörigen Aufgabe füllt sich der Balken entsprechend weiter.
- Mit I-09 abstimmen, falls zusätzlich Unteraufgaben oder Checklisten eingeführt werden.

Projektkarten und Projektseite zeigen den Fortschritt. Ohne Aufgaben erscheint „Noch keine Aufgaben“.

## I-12 – Nachvollziehbare Bearbeitungshistorie pro Aufgabe

**Status:** Umgesetzt. Im Aufgabenformular steht ein einsehbarer Verlauf mit Urheber, Änderungszeit sowie alten und neuen Werten. Er umfasst auch projektfreie Aufgaben und Änderungen über direkte Häkchen.

- Bei jeder Aufgabe nachvollziehen können, wer sie erstellt hat.
- Zeigen, wer später etwas geändert hat und was genau geändert wurde.
- Änderungen als Verlauf direkt zur jeweiligen Aufgabe einsehen können.
- Die Zuordnung erfolgt wie bisher über das ausgewählte Profil Karla oder Marvin.

Bei älteren Aufgaben bleiben Ersteller und Erstellungszeit erhalten. Die detaillierte Aufzeichnung beginnt mit der Installation des Updates.

## I-13 – Optische Wünsche: rund, pastellig und gemütlich

**Status:** Gesammelt; ausdrücklich ganz nach hinten gestellt und für die Umsetzung gesperrt.

- Abgerundete Kanten bei Feldern und anderen Bedienelementen.
- Pastellfarben.
- Eine gemütliche, „cosy“ wirkende Gestaltung.

**Verbindliche Reihenfolge und Freigabe:** Diese Wünsche werden noch nicht umgesetzt, auch nicht nebenbei bei anderen Erweiterungen. Erst beginnen, wenn der Nutzer ausdrücklich sagt: „Wir kümmern uns jetzt um die Optik.“
