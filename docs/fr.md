# Worx Landroid

## Présentation

Cette intégration ajoute vos **tondeuses robots Worx Landroid** à Gladys Assistant, ainsi que
celles des marques sœurs du même cloud, **Kress** et **LandXcape**. Chaque tondeuse devient un
appareil : son état, sa batterie, le délai de pluie et les temps de tonte, avec des boutons pour
la démarrer, la mettre en pause et la renvoyer à sa base.

Elle lit les tondeuses depuis le cloud du constructeur, où l'application les enregistre : leur
état arrive en temps réel (MQTT), avec une relecture régulière en secours.

L'intégration est un projet communautaire, **non affilié à Worx ni à Positec**. Elle a été
**développée sans le matériel** : vos retours sont les bienvenus dans les issues du dépôt.

## Prérequis

- Gladys Assistant 5.1 ou plus récent.
- Une tondeuse déjà ajoutée dans l'application **Worx Landroid** (ou Kress, LandXcape), et
  l'e-mail et le mot de passe de ce compte.
- Un accès Internet depuis Gladys : l'intégration ne parle qu'au cloud du constructeur.

## Configuration

1. Dans Gladys, ouvrez **Intégrations**, trouvez **Worx Landroid** et installez-la (ou
   **Installer depuis GitHub** avec `https://github.com/guim31/gladys-landroid`).
2. Dans l'onglet **Configuration**, choisissez la **marque** de votre application, puis
   saisissez l'**e-mail** et le **mot de passe** du compte.
3. Choisissez la **langue des textes** : les noms des fonctionnalités (fixés à l'ajout de la
   tondeuse) et les textes d'état et d'erreur. Français par défaut.
4. Laissez **Partager la position GPS** désactivé, sauf si votre modèle a un GPS (module 4G,
   RTK) et que vous voulez sa position dans Gladys.
5. Enregistrez. Le bouton **Vérifier la connexion** liste les tondeuses trouvées.
6. Ouvrez l'onglet **Découverte** et ajoutez vos tondeuses.

Les jetons sont gardés dans le volume de l'intégration : un redémarrage ne se reconnecte pas
avec le mot de passe.

## L'appareil tondeuse

| Fonctionnalité             | Type               | Détail                                                     |
| -------------------------- | ------------------ | ---------------------------------------------------------- |
| État                       | texte              | En tonte, retour à la base, en charge, à la base, erreur…  |
| Erreur                     | texte              | La panne en cours, ou « Aucune erreur »                    |
| En tonte                   | oui / non          | La tondeuse est sortie travailler                          |
| Batterie                   | %                  |                                                            |
| En charge                  | oui / non          |                                                            |
| Température de la batterie | °C                 |                                                            |
| Pluie détectée             | oui / non          | Le capteur de pluie est mouillé                            |
| Délai de pluie restant     | minutes            | Attente avant de retondre après la pluie                   |
| Délai après la pluie       | minutes, réglable  | Attente après la pluie, de 0 à 12 heures par pas de 30 min |
| Zone en cours              | nombre             | Zone tondue (modèles multizones)                           |
| Tonte aujourd'hui          | minutes            | Comptée depuis le début de la journée locale               |
| Temps de lame total        | heures             | Compteur de vie                                            |
| Temps de tonte total       | heures             | Compteur de vie                                            |
| Signal Wi-Fi               | %                  | -100 dBm ou moins = 0 %, -50 dBm ou plus = 100 %           |
| Position GPS               | texte              | Seulement si activée et fournie par le modèle              |
| Démarrer la tonte          | bouton             |                                                            |
| Pause                      | bouton             |                                                            |
| Retour à la base           | bouton             |                                                            |
| Tonte de bordure           | bouton             | Seulement sur les modèles qui l'ont                        |
| Verrou                     | activé / désactivé | Le verrou antivol (code PIN)                               |
| Planning                   | activé / désactivé | Active ou coupe le planning de tonte de l'application      |

Une fonctionnalité n'apparaît que si la tondeuse la fournit : un ancien modèle sans capteur de
pluie n'a pas les fonctionnalités de pluie. Démarrer, pause et retour sont des boutons, pas des
interrupteurs : un assistant vocal ne peut jamais lancer les lames par erreur.

## Widget

Le widget **Tondeuse robot** affiche l'état d'une tondeuse (avec la panne ou le délai de pluie
s'il y en a), sa batterie et le temps de tonte du jour, et les boutons **Démarrer**, **Pause**
et **Base** (plus **Bordure** sur les modèles qui l'ont). Choisissez la tondeuse dans les
réglages du widget.

## Déclencheurs de scène

- **Erreur de la tondeuse** : la tondeuse signale une nouvelle panne. Filtre par tondeuse et
  par type de panne (bloquée, soulevée ou retournée, hors du périmètre, lame, batterie ou
  charge, base de charge, capot ouvert, autre). Informations transmises : nom de la tondeuse,
  texte de l'erreur, type, code d'erreur. La pluie n'est pas une panne : utilisez la
  fonctionnalité **Pluie détectée**.
- **Tonte terminée** : la tondeuse est rentrée à sa base après avoir travaillé (fin de
  planning, pluie ou à la demande). Informations transmises : nom de la tondeuse, durée de la
  session en minutes, batterie, rentrée à cause de la pluie.

## Action de scène

- **Tondre une fois** : une session de tonte ponctuelle hors planning, de 10 à 480 minutes,
  avec ou sans la bordure d'abord. Seulement sur les modèles qui ont une tonte ponctuelle.

## Exemples de scènes

- **Prévenez-moi si la tondeuse est coincée** : déclencheur **Erreur de la tondeuse**, types
  _bloquée_ et _soulevée_ → envoyer un message « {{nom de la tondeuse}} : {{erreur}} ».
- **Tondre après l'arrosage** : quand la scène d'arrosage se termine, action **Tondre une
  fois**, 60 minutes, bordure d'abord.
- **Libérer la pelouse pour une fête** : au début du mode « Fête au jardin », appuyer sur
  **Retour à la base** et couper le **Planning** ; le réactiver à la fin.

## Dépannage

- **« Le compte a refusé l'e-mail ou le mot de passe »** : vérifiez-les dans l'application,
  puis enregistrez à nouveau la configuration. L'intégration ne réessaie pas seule un mot de
  passe refusé.
- **« Le cloud demande de ralentir »** : le cloud a répondu « trop de requêtes ». Tout est
  suspendu (une heure, puis plus longtemps) et reprend seul. Ne redémarrez pas l'intégration en
  boucle : ce serait pire.
- **L'application et l'intégration ne marchent plus toutes les deux** : Worx peut bloquer un
  compte jusqu'à 24 heures. Le remède documenté par la communauté : sur le site de Worx,
  dissociez la tondeuse du compte, puis ajoutez-la à nouveau dans l'application.
- **Pastille orange sur le badge de l'appareil** : la liaison temps réel est coupée ; la
  tondeuse est relue toutes les 30 minutes jusqu'à son retour.
- **Une commande échoue avec « Liaison temps réel coupée »** : les commandes passent par la
  liaison temps réel ; attendez son retour.
- Plus de détails : réglez la variable d'environnement `LOG_LEVEL` de l'intégration sur
  `debug`.

## Limites

- **Cloud uniquement** : les tondeuses n'ont pas d'API locale. Sans Internet, Gladys garde les
  dernières valeurs.
- **Quotas, pour éviter les blocages temporaires du constructeur** (aucun chiffre officiel
  n'existe ; ce sont les valeurs prudentes des clients communautaires) : 50 commandes au plus
  par tondeuse et par jour, une commande toutes les 1,1 s, 96 requêtes au cloud par jour,
  5 connexions par mot de passe par jour. Le cloud est relu toutes les heures quand la liaison
  temps réel fonctionne, toutes les 30 minutes sinon ; la liaison temps réel se reconnecte
  après 1 minute, puis attend un peu plus à chaque fois, jusqu'à 30 minutes.
- **Tonte aujourd'hui** part de 0 le premier jour : ce que la tondeuse a tondu avant que
  l'intégration la voie est inconnu.
- Plannings, zones et hauteur de coupe ne se modifient pas depuis Gladys ; les mises à jour du
  micrologiciel et les réinitialisations restent volontairement à l'application.
- Les événements **Tonte terminée** et **Erreur de la tondeuse** ont besoin de la liaison temps
  réel : quand elle est coupée, une session courte peut passer inaperçue.
- Développée sans le matériel : les retours des propriétaires de Vision et de RTK sont
  particulièrement attendus.
