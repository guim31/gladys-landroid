# Worx Landroid

## Überblick

Diese Integration bringt deine **Worx-Landroid-Mähroboter** in Gladys Assistant, dazu die
Mähroboter der Schwestermarken derselben Cloud, **Kress** und **LandXcape**. Jeder Mähroboter
wird ein Gerät: Status, Batterie, Regenverzögerung und Mähzeiten, mit Schaltflächen zum
Starten, Pausieren und Zurückschicken zur Ladestation.

Die Integration liest die Mähroboter aus der Hersteller-Cloud, in der die App sie speichert: ihr Status
kommt in Echtzeit (MQTT), mit einer regelmäßigen Abfrage als Rückfallebene.

Die Integration ist ein Community-Projekt und **nicht mit Worx oder Positec verbunden**. Entwickelt
wurde sie **ohne die Hardware**: Rückmeldungen in den Issues des Repositorys sind
willkommen.

## Voraussetzungen

- Gladys Assistant 5.1 oder neuer.
- Ein Mähroboter, der schon in der App **Worx Landroid** (oder Kress, LandXcape) hinzugefügt
  ist, und E-Mail und Passwort dieses Kontos.
- Internetzugang für Gladys: Die Integration spricht nur mit der Hersteller-Cloud.

## Konfiguration

1. Öffne in Gladys **Integrationen**, suche **Worx Landroid** und installiere sie (oder
   **Von GitHub installieren** mit `https://github.com/guim31/gladys-landroid`).
2. Wähle im Tab **Konfiguration** die **Marke** deiner App und gib **E-Mail** und **Passwort**
   des Kontos ein.
3. Wähle die **Sprache der Texte**: die Namen der Funktionen (beim Hinzufügen des Mähroboters
   festgelegt) und die Status- und Fehlertexte. Standardmäßig Französisch.
4. Lass **GPS-Position teilen** ausgeschaltet, außer dein Modell hat GPS (4G-Modul, RTK) und du
   willst seine Position in Gladys.
5. Speichere. Die Schaltfläche **Verbindung prüfen** listet die gefundenen Mähroboter auf.
6. Öffne den Tab **Entdecken** und füge deine Mähroboter hinzu.

Die Tokens bleiben im Volume der Integration: Ein Neustart meldet sich nicht neu an.

## Das Gerät Mähroboter

| Funktion                      | Typ                  | Detail                                                         |
| ----------------------------- | -------------------- | -------------------------------------------------------------- |
| Status                        | Text                 | Mäht, fährt zur Ladestation, lädt, in der Ladestation, Fehler… |
| Fehler                        | Text                 | Der aktuelle Fehler oder „Kein Fehler“                         |
| Mäht                          | ja / nein            | Der Mähroboter ist unterwegs                                   |
| Batterie                      | %                    |                                                                |
| Lädt                          | ja / nein            |                                                                |
| Batterietemperatur            | °C                   |                                                                |
| Regen erkannt                 | ja / nein            | Der Regensensor ist nass                                       |
| Verbleibende Regenverzögerung | Minuten              | Wartezeit nach Regen, bevor er wieder mäht                     |
| Regenverzögerung              | Minuten, einstellbar | Wartezeit nach Regen, 0 bis 12 Stunden in 30-Minuten-Schritten |
| Aktuelle Zone                 | Zahl                 | Gemähte Zone (Modelle mit mehreren Zonen)                      |
| Mähzeit heute                 | Minuten              | Ab Beginn des lokalen Tages gezählt                            |
| Messerlaufzeit gesamt         | Stunden              | Lebensdauerzähler                                              |
| Mähzeit gesamt                | Stunden              | Lebensdauerzähler                                              |
| WLAN-Signal                   | %                    | -100 dBm oder weniger = 0 %, -50 dBm oder mehr = 100 %         |
| GPS-Position                  | Text                 | Nur wenn aktiviert und vom Modell gemeldet                     |
| Mähen starten                 | Schaltfläche         |                                                                |
| Pause                         | Schaltfläche         |                                                                |
| Zurück zur Ladestation        | Schaltfläche         |                                                                |
| Kantenschnitt                 | Schaltfläche         | Nur bei Modellen, die ihn haben                                |
| Sperre                        | an / aus             | Die Diebstahlsperre (PIN)                                      |
| Zeitplan                      | an / aus             | Schaltet den Mähzeitplan der App ein oder aus                  |

Eine Funktion erscheint nur, wenn der Mähroboter sie meldet: Ein älteres Modell ohne
Regensensor hat keine Regenfunktionen. Starten, Pause und Rückkehr sind Schaltflächen, keine
Schalter: Ein Sprachassistent kann die Messer nie versehentlich starten.

## Widget

Das Widget **Mähroboter** zeigt den Status eines Mähroboters (mit dem Fehler oder der
Regenverzögerung, wenn es eine gibt), seine Batterie und die heutige Mähzeit, dazu die
Schaltflächen **Starten**, **Pause** und **Station** (plus **Kante** bei Modellen, die sie
haben). Wähle den Mähroboter in den Widget-Einstellungen.

## Szenen-Auslöser

- **Fehler des Mähroboters**: Der Mähroboter meldet einen neuen Fehler. Filter nach
  Mähroboter und Art des Fehlers (festgefahren, angehoben oder umgekippt, außerhalb der
  Begrenzung, Messer, Batterie oder Laden, Ladestation, Abdeckung offen, Sonstiges).
  Weitergegebene Informationen: Name des Mähroboters, Fehlertext, Art, Fehlercode. Regen ist
  kein Fehler: Nutze die Funktion **Regen erkannt**.
- **Mähen beendet**: Der Mähroboter ist nach der Arbeit zurück in der Ladestation
  (Zeitplanende, Regen oder auf Wunsch). Weitergegebene Informationen: Name des Mähroboters,
  Dauer der Sitzung in Minuten, Batterie, wegen Regen zurück.

## Szenen-Aktion

- **Einmal mähen**: eine einmalige Mähsitzung außerhalb des Zeitplans, von 10 bis 480
  Minuten, mit oder ohne Kante zuerst. Nur bei Modellen mit einmaligem Zeitplan.

## Szenen-Beispiele

- **Sag mir, wenn der Mähroboter feststeckt**: Auslöser **Fehler des Mähroboters**, Arten
  _festgefahren_ und _angehoben_ → eine Nachricht „{{Name des Mähroboters}}: {{Fehler}}“
  senden.
- **Nach dem Bewässern mähen**: Wenn die Bewässerungsszene endet, Aktion **Einmal mähen**,
  60 Minuten, Kante zuerst.
- **Den Rasen für ein Fest freihalten**: Wenn der Modus „Gartenfest“ beginnt, **Zurück zur
  Ladestation** drücken und den **Zeitplan** ausschalten; am Ende wieder einschalten.

## Fehlerbehebung

- **„Das Konto hat E-Mail oder Passwort abgelehnt“**: Prüfe sie in der App und speichere die
  Konfiguration erneut. Die Integration versucht ein abgelehntes Passwort nicht von selbst
  noch einmal.
- **„Die Cloud bittet um weniger Anfragen“**: Die Cloud hat „zu viele Anfragen“ geantwortet.
  Alles pausiert (eine Stunde, dann länger) und läuft von selbst weiter. Starte die
  Integration nicht ständig neu: Das macht es schlimmer.
- **App und Integration funktionieren beide nicht mehr**: Worx kann ein Konto bis zu 24
  Stunden sperren. Die von der Community beschriebene Lösung: Trenne auf der Worx-Website den
  Mähroboter vom Konto und füge ihn in der App wieder hinzu.
- **Orangefarbener Punkt auf dem Geräte-Badge**: Die Echtzeitverbindung ist getrennt; der
  Mähroboter wird alle 30 Minuten abgefragt, bis sie zurück ist.
- **Ein Befehl scheitert mit „Echtzeitverbindung getrennt“**: Befehle brauchen die
  Echtzeitverbindung; warte, bis sie zurück ist.
- Mehr Details: Setze die Umgebungsvariable `LOG_LEVEL` der Integration auf `debug`.

## Grenzen

- **Nur Cloud**: Die Mähroboter haben keine lokale API. Ohne Internet behält Gladys die
  letzten Werte.
- **Kontingente, um die vorübergehenden Sperren des Herstellers zu vermeiden** (es gibt keine
  offizielle Zahl; das sind die vorsichtigen Werte der Community-Clients): höchstens 50 Befehle
  pro Mähroboter und Tag, ein Befehl alle 1,1 s, 96 Cloud-Anfragen pro Tag, 5 Anmeldungen mit
  Passwort pro Tag. Die Cloud wird stündlich abgefragt, solange die Echtzeitverbindung läuft,
  sonst alle 30 Minuten; die Echtzeitverbindung verbindet sich nach 1 Minute neu und wartet
  dann jedes Mal länger, bis zu 30 Minuten.
- **Mähzeit heute** beginnt am ersten Tag bei 0: Was der Mähroboter gemäht hat, bevor die
  Integration ihn sah, ist unbekannt.
- Zeitpläne, Zonen und Schnitthöhe werden nicht aus Gladys geändert; Firmware-Updates und
  Zurücksetzen bleiben bewusst der App vorbehalten.
- Die Ereignisse **Mähen beendet** und **Fehler des Mähroboters** brauchen die
  Echtzeitverbindung: Ist sie getrennt, kann eine kurze Sitzung unbemerkt bleiben.
- Ohne die Hardware entwickelt: Rückmeldungen von Besitzern eines Vision- oder RTK-Modells
  sind besonders willkommen.
