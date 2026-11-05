# TP-to-xR — Audit technique, scientifique et perspectives d'évolution

| | |
|---|---|
| **Date** | 19 octobre 2026 |
| **Périmètre** | `backend/` (pipeline IA, assets, placement, analytics), `frontend-vr/` (WebXR, simulation, interactions, tests), `docs/`, données enregistrées dans `backend/data/` |
| **Méthode** | Lecture du code, exécution des tests unitaires (`frontend-vr`, `npm test` : **38/38 passent**), analyse des manifestes générés (`backend/data/tps/`), des modèles en cache (`backend/assets/models/`) et des sessions enregistrées (`backend/data/analytics/`) |
| **Non couvert** | Aucun test réalisé dans le casque pour cet audit. `docs/RECHERCHE-LITTERAIRE-PLAN.pdf` n'a pas pu être lu (pas d'outil de rendu PDF sur ce poste) : le positionnement scientifique ci-dessous n'est donc pas confronté à ce plan. |

> **Conventions.** « **Testé** » = couvert par un test automatisé qui passe. « **Observé casque** » = attesté par
> une session réelle enregistrée sur Pico 4 Ultra. « **Non validé** » = le code existe, mais rien ne prouve
> que cela fonctionne sur le matériel cible.

---

## Résumé

TP-to-xR repose aujourd'hui sur **deux produits distincts présentés comme un seul** :

1. **Deux TP de démonstration écrits à la main** (courroie trapézoïdale, circuit à LED). Ils sont interactifs,
   avec validation automatique des étapes, quelques fautes de sécurité détectées et un modèle électrique simple.
   Toute la « physique » et toute la logique sont **codées en dur** pour ces deux TP
   (identifiants d'objets en dur dans [behaviors.ts](../frontend-vr/src/sim/behaviors.ts)).
2. **Un pipeline automatique PDF → scène** (LLM + Sketchfab + placement). Il produit une **pièce meublée
   avec la liste des étapes à lire**. Il ne génère **ni interaction, ni comportement, ni règle de validation,
   ni évaluation réelle**. Dans les TP générés, une étape est « faite » quand l'étudiant appuie sur « Suivant ».

L'écart entre ces deux produits est le cœur du problème scientifique du projet, et aussi sa principale
faiblesse actuelle. Les données montrent en plus que :

- la sélection automatique de modèles 3D est **peu fiable** : « Jelly Bean Kidneys » pour des graines de
  haricot, « Classic wine bottle with label » pour des étiquettes, « Arc Lamp – Victorian Street Lamp » pour
  une ampoule 6 V E10, « Water droplet » pour de l'eau. Deux exécutions du même TP donnent aussi des modèles
  différents ;
- les **erreurs les plus formatrices** des domaines visés (court-circuit, ampèremètre en parallèle, polarité,
  calibre, désalignement, sur-tension de courroie, couple de serrage) **ne peuvent pas être commises** ;
- la validation dans le casque est **embryonnaire** : 7 sessions Pico 4 Ultra enregistrées, une seule menée
  jusqu'au bout (démo électrique, 210 s), FPS moyen de 34 à 71 pour une cible de 72 à 90, hand tracking jamais
  actif. Le rapport de validation Quest 3 ([QUEST3_VALIDATION_REPORT.md](QUEST3_VALIDATION_REPORT.md)) est vide ;
- le projet **n'est pas sous contrôle de version** (pas de dépôt git) et le **backend n'a aucun test automatisé**.

L'ingénierie de base est soignée : validation zod aux frontières, placement résolu côté serveur, cache
atomique, gestion des licences CC, grab VR testé, analytics structurées. La base est saine. En revanche, le
discours « document de TP → expérience immersive évaluée » n'est pas encore démontré.

---

## 1. État réel du projet

### 1.1 Inventaire fonctionnel

| Fonctionnalité | État | Preuve | Remarques |
|---|---|---|---|
| Atelier 3D fixe (salle, établi, étagères, panneaux) généré côté serveur et sérialisé en `.babylon` | ✅ Fonctionnel | Captures `docs/screenshots/`, sessions | Une seule salle (`workshop_v3`), 14 emplacements au maximum |
| Matériaux PBR procéduraux de la salle (albedo/normal/ORM raccordables), sonde de réflexion, ombres | ✅ Fonctionnel | Tests (textures), captures | Coût GPU non mesuré proprement sur Pico |
| Extraction de texte PDF | ✅ Fonctionnel | Code ; erreur 422 si pas de couche texte | **Pas d'OCR, pas d'images ni de schémas**, texte tronqué à 40 000 caractères |
| Analyse du TP par LLM (Llama 3.3 70B, Together AI) → JSON validé par zod, 1 relance corrective | ✅ Fonctionnel | 4 manifestes générés | **Aucun jeu d'évaluation** ; objectifs et questions du TP non extraits (absents du schéma) |
| Requêtes Sketchfab par LLM, recherche, filtre de licence (CC0/CC-BY), filtre de taille | ✅ Fonctionnel | 16 modèles en cache | Filtre de pertinence = mots communs nom/tags, insuffisant (voir §3) |
| Téléchargement et cache des modèles (GLB/glTF, anti zip-slip, écriture atomique) | ✅ Fonctionnel | `backend/assets/models/` | Pas de validation géométrique ni d'optimisation |
| Placement : LLM puis résolveur déterministe (capacité, chevauchement, bornes) | ✅ Fonctionnel | Code robuste | **Non testé automatiquement** ; tailles décidées par le LLM |
| Conversion STL → GLB à l'échelle réelle (mm → m, Z-up → Y-up) | ✅ Fonctionnel | 2 pièces Thingiverse converties | Matériau unique, normales plates, pas de PBR |
| Lecteur WebXR (Babylon.js 7.54) : grab proche/distant, locomotion, snap-turn, collisions avec le mobilier | 🟡 Partiel | Tests `xrgrab`, `locomotion` ; observé casque (grabs enregistrés) | Pas de physique, pas de haptique, pas de son, objets toujours redressés au relâcher |
| Navigation par pincement pouce + majeur | ❓ Non validé | Code + seuils | Hand tracking **jamais actif** dans les 7 sessions Pico |
| TP interactifs (démos) : cibles d'accrochage, règles par étape, validation auto, fautes de sécurité | 🟡 Partiel | Tests `sim`, `student` ; 1 démo électrique terminée dans le casque | **Spécifique à 2 TP**, non généralisable en l'état |
| Modèle électrique (loi d'Ohm, LED à tension de seuil fixe, LED grillées sans résistance) | 🟡 Simulé | Tests `circuit` | Topologie figée, pas de câblage libre (voir §2) |
| Transmission par courroie (consignation, montage, tension, serrage, rapport de vitesse) | 🟠 Approximatif | Code | Tension et couple « réglés » en approchant la clé 0,8 s |
| Analytics : temps par étape, saisies, saisies d'un mauvais objet, fautes, aides, FPS, upload périodique | ✅ Fonctionnel | Tests `student`, ~130 fichiers de session | « Précision » = heuristique sur les noms (voir §2.9) |
| Rapport de fin pour l'étudiant | 🟠 Minimal | « TP terminé ✓ — résultats enregistrés » | Pas de rapport lisible, pas de feedback argumenté |
| Recommencer une manipulation ou une étape | ❌ Absent | — | Seul « recommencer l'upload » existe (`btn-retry`) |
| Génération automatique d'interactions et de règles | ❌ Absent | — | C'est pourtant la promesse centrale |
| Bibliothèque d'équipements validés (dimensions, ports, comportements) | ❌ Absent | — | 15 modèles procéduraux « builtin » sans métadonnées réutilisables |
| Tableau de bord enseignant, édition et validation humaine du TP généré | ❌ Absent | — | Seulement `GET /api/analytics/:tpId` (JSON) |
| Persistance robuste (base de données), authentification, multi-utilisateur | ❌ Absent | — | Fichiers JSON, jobs en mémoire |

### 1.2 Ce que prouvent les tests

Les **38 tests** du frontend couvrent bien la logique pure : machine d'états du menu, client du pipeline,
conditions de validation, accrochage, loi d'Ohm du circuit de démo, suivi des étapes, identité, mathématiques
du grab VR et de la locomotion.

Ils **ne couvrent pas** :

- le backend (aucun script `test` dans `backend/package.json`) : `resolvePlacement`, `relevance()`,
  `extractJSON`, le convertisseur STL, les schémas zod ;
- la qualité de sortie du LLM (aucun corpus de référence) ;
- le rendu, la performance et l'ergonomie, qui ne se vérifient que dans le casque ;
- l'intégration de bout en bout. Environ 120 sessions de 3 à 9 s, à 2-10 FPS sur Windows, ressemblent à des
  tests automatisés de bout en bout en rendu logiciel, mais leur script n'est pas versionné dans le projet.

### 1.3 Ce que montre le casque (Pico 4 Ultra, 7 sessions)

| Session | Durée | FPS moy. / min | Résultat |
|---|---|---|---|
| Démo électrique | 210 s | 64 / 29 | **4/4 étapes validées**, mesure faite : seul parcours complet |
| Démo électrique ×3 | 27–1110 s | 34–64 / 0–22 | Étapes passées sans validation (`step_skipped`), ou aucune action |
| Démo mécanique ×2 | 34–270 s | 52–71 / 0–28 | Étape 1 jamais validée |
| TP généré (mesure de tension) | 677 s | 60 / 0 | 13 saisies, 2 changements d'étape |

Conclusions prudentes, sur un échantillon minuscule et sans protocole :

- **La performance n'atteint pas la cible.** Le Pico 4 Ultra affiche à 72 ou 90 Hz. Une moyenne de 34 à 64 FPS
  et des minimums à 0 (blocages au chargement) provoquent de l'inconfort.
- **La démo mécanique n'a jamais été terminée dans le casque.** On ne sait pas si c'est un problème
  d'ergonomie (sectionneur cliquable, maintien de 1,5 s pour l'inspection) ou simplement un test interrompu.
- **Le hand tracking n'a jamais été utilisé** : la navigation par pincement du majeur reste non validée.
- La documentation vise le **Quest 3**, alors que les seules données réelles viennent du **Pico 4 Ultra**.

### 1.4 Limites techniques transverses

- **Pas de contrôle de version** : risque majeur pour une thèse (perte, absence de traçabilité des
  résultats, impossibilité de citer une version précise).
- **Logique de simulation non déclarative** : `CircuitBehavior` et `BeltDriveBehavior` lisent des
  identifiants d'objets fixes (`e_interrupteur`, `m_poulie_m`…). Un troisième TP impose du code nouveau.
- **Pas de moteur physique** : le relâcher se fait par un rayon vers le bas, sans collisions entre objets,
  sans empilement ni basculement.
- **Une seule salle, 14 emplacements**, au maximum 12 objets par TP.
- **Données personnelles** : le nom saisi par l'étudiant est stocké en clair dans les fichiers de session.
  Avant toute étude, il faut un consentement éclairé et une déclaration conforme au droit applicable, par
  exemple auprès de la CDP si l'étude se déroule au Sénégal.
- **Clés d'API** dans `backend/.env` : exclu par `.gitignore`, mais à ne jamais copier dans une archive
  partagée.

---

## 2. Réalisme des TP

### 2.1 Dimensions et proportions

| Source | Méthode | Fiabilité |
|---|---|---|
| Modèles procéduraux (démos) | Construits en mètres à la main | Bonne. Résistances et LED **agrandies ×1,6** volontairement : choix ergonomique défendable, mais à documenter comme écart au réel |
| STL convertis | Unités du fichier (mm supposés) | Bonne si l'unité est connue |
| Sketchfab (TP générés) | Plus grande dimension du modèle **forcée** à `target_size_m`, **valeur estimée par le LLM** | **Faible** |

Exemples tirés des manifestes générés :

- Pile 9 V : `target_size_m = 0.1`, alors que la taille réelle est d'environ 0,048 m (**×2**).
- Ampoule 6 V E10 : 0,1 m, contre 0,025 à 0,035 m en réalité (**×3 à ×4**), et le modèle retenu est un
  réverbère victorien.
- La même pince crocodile reçoit 0,1 m puis 0,2 m selon l'exécution.

La normalisation par la plus grande dimension conserve les proportions internes du modèle. En revanche,
l'**orientation** (objet couché ou debout) et l'**origine** ne sont pas normalisées, et rien ne vérifie la taille.

### 2.2 Modèles et textures 3D

- **Salle** : soignée (PBR procédural, UV en projection boîte à l'échelle réelle, sonde de réflexion).
- **Démos** : géométrie de primitives (boîtes, cylindres, tubes) avec matériaux PBR unis, sans texture.
  Ils sont lisibles et légers, mais d'aspect « maquette ». Pour une démonstration, c'est acceptable.
- **Sketchfab** : qualité hétérogène et non contrôlée. Le nombre de faces va de 20 à 78 000 et le poids de
  0,01 à 5,5 Mo. Les matériaux arrivent tels quels. Il n'y a **ni LOD, ni compression (Draco/Meshopt, KTX2),
  ni vérification de l'unité, de l'origine ou de l'orientation**.

### 2.3 Matériaux PBR

Le pipeline PBR de la salle est correct (convention ORM glTF, cartes normales dérivées d'un champ de
hauteur). Les objets des démos utilisent `usePhysicalLightFalloff = false`, cohérent avec la salle. Il n'existe
pas de **bibliothèque de matériaux techniques** (acier usiné, aluminium anodisé, ABS, cuivre, FR4 de PCB,
caoutchouc) qui permettrait de reconnaître un équipement par son matériau.

### 2.4 Comportements physiques

| Comportement | Implémentation | Écart au réel |
|---|---|---|
| Courant dans le circuit | I = (E − V_f) / R_total, LED à V_f fixe | Correct au premier ordre. LED idéales identiques : le partage de courant entre 2 LED en parallèle est supposé parfait |
| LED grillées | Seuil arbitraire : courant > 5 × 20 mA par LED | Qualitativement juste |
| Mesure au multimètre | Valeur affichée selon la **proximité** de l'appareil | **Faux sur le principe** : un ampèremètre doit être inséré en série ; ici, il suffit de le poser près de la plaque |
| Montage de la courroie | Relâchée à moins de 35 cm des poulies, la courroie est « montée » | Pas de vrillage, pas de passage dans la gorge |
| Tension de la courroie | Clé maintenue 0,8 s près du tendeur, puis message « flèche ≈ 15 mm ✓ » | **Aucune grandeur simulée** : le message affirme une mesure qui n'existe pas |
| Serrage à 25 N·m | Clé maintenue 0,8 s près des boulons | Idem : pas de couple, pas de sous-serrage ni de sur-serrage possible |
| Alignement des poulies | **Niveau à bulle** posé sur une zone | **Scientifiquement incorrect** : un niveau mesure l'horizontalité, pas la coplanarité des poulies (on utilise une règle, un fil ou un laser d'alignement) |
| Rapport de vitesse | 1450 × 50/70 ≈ 1036 tr/min | Correct (glissement ignoré) ; vitesse visuelle volontairement ralentie |
| Gravité, collisions | Rayon vers le bas au relâcher | Pas de chute réaliste, pas de collisions entre objets |

### 2.5 Interactions entre équipements, connexions et assemblages

Il n'existe **aucun modèle de connexion**. Un « assemblage » se résume à un objet accroché à une cible
prédéfinie, dans un rayon de 5 à 18 cm. Conséquences :

- les « 3 résistances en série » sont **un seul objet**, et les « 2 LED en parallèle » aussi : l'étudiant ne
  câble ni la série ni le parallèle ;
- les « fils de liaison » sont un seul objet posé sur une zone ;
- il n'y a ni ports, ni bornes, ni netlist, ni contraintes d'assemblage (ordre, orientation, jeu).

### 2.6 Cohérence scientifique des résultats

Les résultats affichés sont **cohérents en interne** : le message de fin donne 23,5 mA et le calcul aussi.
Ils sont pourtant **prédéterminés** : la seule valeur qui varie est le courant, présent ou absent. Le système
ne contrôle pas non plus la justesse scientifique du document source. Deux exemples :

- le TP d'exemple ([tp-mesure-tension.html](tp-exemples/tp-mesure-tension.html)) affirme qu'une ampoule 6 V
  alimentée par une pile 9 V « s'allume faiblement ». C'est **physiquement discutable** : on s'attend plutôt
  à une surtension de l'ampoule, sauf si la résistance interne de la pile est élevée. Le pipeline reprend
  cette affirmation sans la signaler ;
- le circuit de démo met deux LED en parallèle derrière une seule résistance commune. En pratique, c'est
  **déconseillé** (emballement du courant dans la LED de plus faible V_f). Un TP de référence ne devrait pas
  l'enseigner sans commentaire.

### 2.7 Erreurs que l'étudiant peut réellement commettre

| Erreur réaliste | Possible ? | Détectée ? |
|---|---|---|
| Mettre sous tension pendant le câblage | ✅ | ✅ faute de sécurité |
| Oublier la résistance de limitation | ✅ (retirer l'objet) | ✅ LED grillées |
| Court-circuit de la batterie | ❌ | — (alors que c'est le premier panneau de sécurité) |
| LED montée à l'envers | ❌ | — (pourtant dans la consigne de l'étape 3) |
| Ampèremètre en parallèle, mauvais calibre, cordon dans la mauvaise borne | ❌ | — |
| Intervenir sans consigner / remettre sous tension pendant l'intervention | ✅ | ✅ |
| Toucher une transmission en rotation | ✅ | ✅ |
| Courroie vrillée, poulies désalignées, tension incorrecte | ❌ | — |
| Serrage insuffisant ou excessif | ❌ | — |
| Ne pas porter les gants | ❌ | — (consigne affichée à l'étape 5, mais aucune condition ne la vérifie) |
| Saisir un objet qui n'appartient pas à l'étape | ✅ | ✅ « mauvais objet » (heuristique) |
| Passer une étape sans la réaliser | ✅ | ✅ `skipped` |

**Bilan :** environ 5 erreurs détectées sur une douzaine d'erreurs pertinentes. Les erreurs de **méthode
de mesure** et d'**assemblage**, qui font tout l'intérêt d'un TP, sont absentes.

### 2.8 Situations où le TP « fonctionne visuellement » sans représenter la réalité

1. **Tous les TP générés** : la pièce est meublée et les étapes défilent, mais l'étudiant n'agit sur rien.
   « Fait » signifie « a cliqué sur Suivant ».
2. **Mesure de courant par proximité** : le bon chiffre s'affiche sans montage en série.
3. **Tension et couple** : les messages « ≈ 15 mm ✓ » et « 25 N·m ✓ » apparaissent sans aucune grandeur
   simulée.
4. **Alignement au niveau à bulle** : la coche verte valide une méthode inadaptée.
5. **Objets mal identifiés** : une bouteille de vin pour des « étiquettes », un réverbère pour une ampoule.
   L'étiquette affichée au survol donne l'illusion que l'objet est le bon.
6. **Accrochage magnétique** : un objet lâché à 15 cm de sa cible s'aligne parfaitement, ce qui masque
   l'imprécision du geste.

### 2.9 Détection et évaluation des erreurs

- **TP de démo** : validation par conditions (`placed`, `held`, `near`, `state`), fautes et dégâts
  journalisés par étape. C'est un bon squelette, à rendre générique.
- **TP générés** : la seule mesure est la « précision ». Un objet est considéré comme lié à une étape si un
  de ses mots de 4 lettres ou plus apparaît dans le texte de l'étape. Cela mesure la cohérence entre le
  geste et le texte, pas la compétence. Cette mesure n'a **aucune validité démontrée**.
- Aucun score n'est **comparé à une évaluation de référence**, par exemple la note d'un enseignant ou la
  performance au TP réel.

---

## 3. Qualité des assets 3D

### 3.1 Réponses aux questions

| Question | État actuel |
|---|---|
| **D'où viennent les modèles ?** | (a) 15 modèles procéduraux codés dans [builtin.ts](../frontend-vr/src/models/builtin.ts) ; (b) recherche Sketchfab en ligne, licences CC0/CC-BY, avec 16 modèles en cache ; (c) 2 STL Thingiverse (CC BY-SA) convertis |
| **Comment leurs dimensions sont-elles déterminées ?** | Procéduraux et STL : taille réelle. Sketchfab : plus grande dimension forcée à une valeur **devinée par le LLM** |
| **Comment sont-ils validés ?** | Licence, téléchargeable, ≤ 100 000 faces, ≤ 15 Mo, au moins un mot commun entre requête et nom/tags. **Aucune validation sémantique, dimensionnelle ni visuelle** |
| **Matériaux, textures, niveaux de détail ?** | Ceux du fichier source, sans contrôle. Pas de LOD, pas de compression de textures |
| **Points de connexion et comportements ?** | Seulement pour les démos, en coordonnées absolues dans [demoTps.ts](../backend/src/services/demoTps.ts), couplés à la géométrie procédurale par un « contrat » écrit en commentaire |
| **Comment éviter un objet incorrect ?** | Aujourd'hui, on ne l'évite pas : le filtre par mots laisse passer « Jelly Bean Kidneys » pour « bean » |

### 3.2 Pourquoi la recherche ouverte ne peut pas suffire

Un équipement de TP n'est pas seulement une forme. Il a une **identité précise** (« multimètre numérique avec
borne 10 A »), des **dimensions réelles**, des **ports** (bornes, arbres, alésages), des **états** (calibre,
position d'interrupteur) et un **comportement**. Aucune banque généraliste ne fournit ces métadonnées. La
pertinence d'une recherche par mots-clés plafonne vite, et deux exécutions ne donnent pas le même résultat.

### 3.3 Stratégie recommandée : une bibliothèque d'équipements validés

**Principe :** passer d'une *recherche de modèles* à un **catalogue d'équipements**. Chaque entrée est un
« jumeau pédagogique » validé une fois, puis réutilisé dans de nombreux TP.

**Fiche équipement (exemple de schéma, à versionner) :**

```yaml
id: multimeter_dmm_basic          # identifiant stable
category: electrical/measurement
names: { fr: [multimètre, multimètre numérique, contrôleur], en: [multimeter, DMM] }
dimensions_mm: { w: 90, h: 190, d: 45 }     # mesurées sur une référence réelle
mesh: { lod0: dmm_lod0.glb, lod1: dmm_lod1.glb, triangles: [12000, 3000] }
material_check: passed            # inspection visuelle signée
license: { spdx: CC-BY-4.0, author: ..., source: ... }
ports:                            # repères locaux nommés
  - { id: COM,  kind: banana_socket, pos: [..], dir: [..] }
  - { id: VOhm, kind: banana_socket, pos: [..] }
  - { id: A10,  kind: banana_socket, pos: [..] }
states:
  selector: [OFF, V_DC_20, V_DC_200, A_DC_10, OHM_200, CONTINUITY]
behavior: dmm                     # composant générique (voir §4)
validated_by: <enseignant>, <date>
```

**Sources ouvertes à privilégier :**

| Besoin | Sources | Remarques |
|---|---|---|
| Pièces mécaniques normalisées (vis, roulements, poulies, profilés) | **FreeCAD** + atelier *Fasteners*, **BOLTS**, **CadQuery** / **build123d** (génération paramétrique en Python) | Dimensions exactes par construction ; export STEP → glTF |
| Composants électroniques | **Bibliothèques 3D KiCad** (`kicad-packages3D`, licence avec exception de réutilisation, à vérifier par fichier) | Dimensions normalisées et repères des broches connus : très bon pour les breadboards |
| Objets génériques | **Poly Haven** (CC0), **ambientCG** (matériaux CC0), Sketchfab CC0/CC-BY | Seulement après revue humaine |
| Optimisation et validation | **glTF-Transform** (dédoublonnage, Meshopt/Draco, KTX2 via `toktx`), **Khronos glTF-Validator**, **Blender** en ligne de commande pour le rendu de vignettes | Tous scriptables dans un pipeline d'ingestion |
| Équipements spécifiques (banc moteur, oscilloscope) | Modélisation paramétrique (CadQuery) ou photogrammétrie (**Meshroom**, **COLMAP**) des équipements réels du laboratoire | La photogrammétrie demande ensuite un nettoyage manuel |

**Pipeline d'ingestion (semi-automatique) :**

1. Une source candidate est proposée (Sketchfab, KiCad, CadQuery).
2. Normalisation automatique : unités, axe Y vers le haut, origine à la base, orientation canonique.
3. Validation automatique : glTF-Validator, budget de triangles, nombre de textures, **comparaison des
   dimensions à la fiche** (tolérance de ±10 %).
4. Génération des LOD et compression.
5. Rendu de vignettes sous 4 angles.
6. **Revue humaine** : identité, aspect, positionnement des ports, avec un outil d'édition simple dans le
   viewer.
7. Publication dans le catalogue avec numéro de version.

**Sélection dans un TP :** l'IA ne cherche plus sur Internet. Elle **associe** chaque matériel du document à
une entrée du catalogue, par synonymes, plongements de texte et catégorie, avec un **score de confiance**. En
dessous d'un seuil, elle propose 3 candidats à l'enseignant. Si rien ne convient, l'objet reste une boîte
étiquetée et une **demande d'ajout au catalogue** est créée. Sketchfab devient un fournisseur de candidats
pour le catalogue, jamais une source directe pour la scène.

**Objectif réaliste :** 40 à 60 équipements validés couvrent la plupart des TP d'initiation en électricité
(DC) et en mécanique (assemblage, transmission), à raison de 1 à 4 h par équipement une fois l'outillage en
place.

---

## 4. Automatisation par l'IA

### 4.1 Capacités par maillon

| Maillon | Aujourd'hui | Fiabilité estimée | Automatisable de façon fiable ? |
|---|---|---|---|
| **Analyse du document** | Texte brut → titre, domaine, matériel, étapes, consignes de sécurité | Bonne sur des documents simples et bien structurés (non mesurée) | **Oui pour l'extraction textuelle**, avec relecture. **Non** pour les schémas, figures et tableaux de mesures (non lus). Objectifs et questions **perdus** (absents du schéma). Le prompt autorise l'ajout de consignes « évidentes » et l'estimation des durées : c'est un risque d'invention |
| **Identification du matériel** | Liste de noms | Moyenne. Confusions sur les consommables (eau, coton) et les objets génériques | **Partiellement**. Il manque les caractéristiques (« pile 9 V », calibres, valeurs de composants) sous forme structurée |
| **Sélection des assets** | Recherche Sketchfab + mots communs | **Faible** (environ la moitié des choix inadaptés dans les TP générés) et non déterministe | **Oui, si l'on associe au catalogue validé** (§3.3) avec un seuil de confiance ; **non** en recherche ouverte |
| **Génération des étapes** | Recopie des étapes du document | Bonne pour l'affichage | Oui pour l'affichage. **Non** pour leur traduction en actions vérifiables |
| **Génération des interactions** | **Inexistante** | — | Pas de manière fiable aujourd'hui. Plausible si l'IA remplit un **langage de description de TP contraint** (ports, états, préconditions, effets) au lieu d'écrire du code |
| **Vérification de cohérence** | Schémas zod (forme) + résolveur de placement (géométrie) | Forme : bonne. Fond : **nulle** | **Oui en grande partie, et par des méthodes non-IA** : validation du TP par simulation (toutes les étapes sont-elles réalisables ? les erreurs déclarées sont-elles atteignables ?), contrôle des grandeurs (unités, ordres de grandeur, loi d'Ohm), contrôle dimensionnel des assets |
| **Évaluation des performances** | Temps, saisies, « précision » lexicale | Validité non démontrée | Les **métriques de procédure** (ordre, fautes, reprises) sont automatisables. Leur **interprétation pédagogique** (compétence acquise ?) exige une validation empirique contre un jugement d'expert |

### 4.2 Position recommandée

L'IA doit **produire un brouillon structuré et vérifiable**, pas une expérience finale. Concrètement :

```
PDF ──► (LLM) Spécification de TP v0 ──► (vérificateurs déterministes) rapport d'anomalies
          │                                      │
          └──► (enseignant) édition + validation ◄┘──► Spécification v1 (signée) ──► Scène exécutable
```

La **spécification intermédiaire** est l'élément clé. C'est un format déclaratif (JSON/YAML, validé par
schéma) qui décrit :

- les équipements, par référence au catalogue ;
- l'état initial ;
- pour chaque étape, les **actions attendues** (`connect(dmm.COM, battery.neg)`, `set(dmm.selector, V_DC_20)`) ;
- les **préconditions de sécurité** ;
- les **erreurs anticipées** et leurs conséquences simulées ;
- les **grandeurs attendues** et leurs tolérances.

Le moteur de simulation exécute ce format avec des **composants génériques** (`dmm`, `battery`,
`resistor`, `breadboard`, `pulley`, `fastener`…) au lieu de comportements écrits pour un TP précis.

**Ce qui exige encore une validation humaine :**

- l'association matériel ↔ équipement quand la confiance est faible ;
- la justesse scientifique du document et des valeurs attendues ;
- le choix des erreurs pédagogiquement pertinentes ;
- l'équivalence entre une action virtuelle et le geste réel.

---

## 5. Expérience pédagogique

### 5.1 Écarts par besoin

| Besoin | État | Amélioration nécessaire |
|---|---|---|
| **Comprendre les objectifs** | Titre et étapes seulement. Objectifs et questions du document non extraits | Extraire objectifs, prérequis et questions ; écran d'introduction (objectif, durée, consignes de sécurité) avant la première étape |
| **Manipuler naturellement** | Grab 1:1 correct. Objets toujours redressés, accrochage large, pas d'haptique, pas de son | Manipulation **à deux mains** (cordon + pointe), accrochage **par ports** avec un rayon serré et visible, impulsion haptique au contact et à l'accrochage (WebXR `hapticActuators`), sons (clic, bip de continuité) |
| **Commettre des erreurs réalistes** | ~5 erreurs possibles | Câblage libre sur breadboard avec netlist, polarité, calibre, ampèremètre série/parallèle, fusible ; en mécanique : ordre d'assemblage, alignement mesuré, couple continu |
| **Feedback immédiat** | Toasts et coches vertes | Feedback **explicatif** (« le courant a traversé l'ampèremètre sans charge : en réalité, le fusible 10 A aurait fondu ») et **gradué** (indice → explication → démonstration) |
| **Recommencer** | Impossible (hors navigation arrière) | Bouton « Réinitialiser l'étape » (restaure l'état initial de l'étape) et « Recommencer le TP ». Demande des **instantanés d'état** dans le moteur |
| **Progresser à son rythme** | Navigation libre, passage sans validation possible | Mode **guidé** (marqueurs, indices) / **autonome** (sans marqueur) / **évaluation** (sans aide, sans passage d'étape) |
| **Rapport final** | Message « résultats enregistrés » | Rapport par étape (temps, fautes expliquées, aides, valeurs mesurées et attendues), lisible dans le casque et exportable (HTML/PDF) pour l'enseignant |

### 5.2 Priorités pour le Pico 4 Ultra

1. **Performance d'abord** : viser au moins 72 FPS stables, idéalement 90. Mesures : réduire la carte d'ombres
   à 512 ou utiliser des ombres pré-calculées pour le mobilier fixe, figer la sonde de réflexion (rendue
   une fois puis libérée), textures ≤ 512 px pour le mobilier lointain, KTX2/Basis pour les GLB, LOD,
   *freeze* des matériaux et des matrices statiques, budget d'environ 150 000 triangles et 100 *draw calls*.
   Supprimer les gels de chargement (minimums à 0 FPS) en préchargeant hors session immersive.
2. **Manettes avant les mains** : aucune session n'a utilisé le hand tracking. Pour des manipulations
   précises (pointes de touche, bornes), les manettes sont plus fiables. Le hand tracking reste une option
   à valider séparément.
3. **Lisibilité** : vérifier la taille des textes du panneau d'instructions et du multimètre à 1 m environ.
   Placer un panneau d'étape **qui suit le regard** en option.
4. **Haptique et son** : faible coût et effet fort sur la sensation de manipulation.
5. **Confort** : la locomotion continue provoque des nausées chez certains utilisateurs. Proposer la
   téléportation et un « poste fixe » (tout le TP se fait debout devant l'établi).
6. **Protocole de test propre au Pico** : adapter [QUEST3_VALIDATION_REPORT.md](QUEST3_VALIDATION_REPORT.md)
   au matériel réellement utilisé.

---

## 6. Potentiel scientifique et avenir du projet

### 6.1 Innovation potentielle

L'innovation potentielle n'est **ni** la scène VR **ni** l'appel à un LLM : la génération de scènes 3D par LLM
fait déjà l'objet de nombreux travaux. Elle porte sur la question suivante :

> **Peut-on transformer automatiquement un document de TP existant en une procédure *exécutable et
> évaluable*, où les actions de l'étudiant sont vérifiées contre un modèle du domaine, et les erreurs
> réalistes sont possibles et diagnostiquées ?**

Autrement dit : passer d'un *document* à une *spécification procédurale formelle* (actions, préconditions,
effets, erreurs), puis l'**ancrer** dans des équipements virtuels dotés d'un comportement. **L'originalité de
cette combinaison n'a pas été vérifiée.** Il faut une revue systématique couvrant au minimum :

- la génération de scènes et de mondes 3D par LLM (travaux de type *LayoutGPT*, *Holodeck*) ;
- les laboratoires virtuels commerciaux et académiques (Labster, PraxiLabs, PhET, Go-Lab, LabsLand pour
  les laboratoires distants) ;
- les outils auteurs de formation immersive (Uptale, Immersive Factory pour la sécurité industrielle) ;
- la littérature sur l'extraction de procédures (*procedural knowledge extraction*, planification de type
  PDDL appliquée aux protocoles de laboratoire) ;
- les travaux sur la fidélité en simulation pédagogique.

### 6.2 Différenciation possible face aux plateformes existantes

Les laboratoires virtuels commerciaux proposent surtout des **scénarios conçus à la main** et fermés. Un
positionnement différenciant crédible pour TP-to-xR :

1. **Partir des TP existants de l'établissement**, et non d'un catalogue imposé : c'est l'argument
   d'adoption.
2. **Une spécification ouverte et vérifiable** que l'enseignant peut lire, corriger et versionner.
3. **Un modèle d'erreurs explicite**, fondé sur une taxonomie (par exemple ratés, oublis et fautes de
   raisonnement, au sens de Reason), au lieu d'un simple « bon ou mauvais objet ».
4. **Matériel abordable et autonome** (casque autonome, WebXR, sans installation), pertinent pour des
   établissements à équipement limité. C'est un argument fort si le contexte est celui d'une université
   africaine.
5. **Ouverture** : catalogue d'équipements et format de spécification publiés sous licence libre.

### 6.3 Problèmes de recherche justifiant des travaux approfondis

| # | Problème | Pourquoi c'est un vrai problème scientifique | Évaluation possible |
|---|---|---|---|
| R1 | **Représentation intermédiaire des TP** : quel formalisme décrit une procédure de laboratoire (états, actions, préconditions, erreurs) de façon assez expressive et assez simple pour être générée par un LLM et validée par un enseignant ? | Compromis expressivité / générabilité / lisibilité | Couverture d'un corpus de TP réels ; temps de correction par l'enseignant |
| R2 | **Extraction document → spécification** : précision de l'extraction, y compris des schémas électriques (vision), avec vérification automatique | Les informations clés d'un TP d'électricité se trouvent dans le schéma, pas dans le texte | Corpus annoté de 30 à 50 TP ; rappel et précision par type d'élément |
| R3 | **Ancrage matériel ↔ équipement virtuel** avec une confiance calibrée | Identification d'entités dans un catalogue spécialisé, avec abstention | Exactitude top-1 et top-3, calibration, taux d'abstention |
| R4 | **Vérification automatique** : une spécification générée est-elle réalisable, sûre et cohérente avec la physique ? | Validation formelle et par simulation de contenu généré | Taux de défauts détectés sur des spécifications altérées volontairement |
| R5 | **Validité de l'évaluation** : les traces VR (ordre, fautes, hésitations) prédisent-elles la performance au TP réel ? | Validité de construit et validité prédictive | Corrélation avec une grille d'expert sur un TP réel ; étude pré/post-test |
| R6 | **Fidélité utile** : quels niveaux de fidélité (visuelle, fonctionnelle, gestuelle) influent réellement sur l'apprentissage et le transfert ? | Arbitrage coût / bénéfice central pour un développeur aux ressources limitées | Plan expérimental à 2 ou 3 conditions |

Pour une thèse, **R1 + R2/R4 + R5** forment un ensemble cohérent : un format, une génération vérifiée, une
évaluation validée.

### 6.4 Évolution vers une plateforme multi-domaines

- **Noyau commun** : format de spécification, moteur d'états/actions/conditions, catalogue, journalisation,
  rapports.
- **Modules de domaine** (greffons) avec leur propre solveur :
  - **Électricité** : graphe de connexions → netlist → solveur MNA (analyse nodale modifiée) en
    TypeScript pour le continu. Pour aller plus loin, **ngspice** compilé en WebAssembly (à évaluer).
  - **Mécanique** : graphe d'assemblage (liaisons, ordre, couples), cinématique simple. Un moteur
    physique (**Havok**, intégré à Babylon et gratuit, ou **Rapier** en WASM) seulement là où c'est utile
    (chute, contact).
  - **Chimie / biologie** : modèles d'états discrets (volumes, concentrations, contamination), sans
    simulation de fluides.
- **Règle d'or** : un domaine n'est déclaré « pris en charge » que s'il dispose d'au moins 3 TP réels
  convertis, validés par un enseignant et testés dans le casque. Aujourd'hui, **chimie et biologie ne sont
  pas pris en charge** : le pipeline produit une pièce meublée, pas un TP.

### 6.5 Principaux risques techniques

| Risque | Probabilité | Impact | Atténuation |
|---|---|---|---|
| Dispersion : trop de domaines, trop de fonctions pour un seul développeur | Élevée | Élevé | Périmètre resserré (§6.6) |
| Performance insuffisante sur Pico (WebXR + PBR + assets non maîtrisés) | Élevée | Élevé | Budget de rendu, catalogue optimisé, mesures systématiques |
| Dépendance à des services externes (Together AI, Sketchfab) : coût, disponibilité, changements d'API ou de licences | Moyenne | Moyen | Abstraction du fournisseur LLM, modèle ouvert local en option, catalogue hors ligne |
| Non-reproductibilité des résultats générés (LLM non déterministe) | Élevée | Élevé pour la thèse | Spécifications versionnées et figées, journal des prompts et sorties, température 0 |
| Validité pédagogique non démontrée | Élevée | Critique | Études empiriques planifiées tôt |
| Perte de code ou de données (pas de dépôt git, pas de sauvegarde) | Moyenne | Critique | Git + dépôt distant privé immédiatement |
| Données personnelles des étudiants | Moyenne | Élevé | Pseudonymisation, consentement, déclaration à l'autorité compétente |
| Évolution du support WebXR des navigateurs de casques | Faible à moyenne | Moyen | Babylon reste portable ; tests réguliers sur le matériel |

### 6.6 Périmètre réaliste pour un développeur principal

Sur 12 à 18 mois, avec des ressources limitées :

- **2 domaines** : électricité en courant continu (mesures, circuits simples) et assemblage mécanique.
- **6 à 10 TP réels** de l'établissement, convertis par le pipeline assisté et **validés par des
  enseignants**.
- **Un catalogue de 40 à 60 équipements** validés.
- **Un casque cible** : Pico 4 Ultra. Quest 3 en compatibilité, sans optimisation dédiée.
- **Une étude empirique** avec un groupe d'étudiants réel sur 1 ou 2 TP.
- **Hors périmètre** : chimie et biologie interactives, multi-utilisateur, génération de modèles 3D par IA,
  application native.

---

## 7. Feuille de route priorisée

Coûts en **semaines de travail pour une personne** (sem.), estimations à ±50 %.

### 7.1 Court terme (0–3 mois) : rendre les TP existants honnêtes et réalistes

| # | Priorité | Intérêt pédagogique | Difficulté | Dépendances | Coût | Critères de réussite |
|---|---|---|---|---|---|---|
| C0 | **Git + dépôt distant, tests backend** (placement, pertinence, STL, schémas) | Indirect (fiabilité) | Faible | — | 1 sem. | Historique versionné ; tests backend dans `npm test` ; tests bloquants avant chaque démonstration |
| C1 | **Corriger les inexactitudes scientifiques des démos** : alignement à la règle ou au laser, LED avec une résistance chacune (ou commentaire explicite), contrôle des gants, retrait des messages qui affirment une mesure non simulée | Élevé (ne pas enseigner faux) | Faible | Avis d'un enseignant de chaque domaine | 1 sem. | Relecture signée par 1 enseignant par domaine ; zéro message affirmant une grandeur non calculée |
| C2 | **Performance Pico 4 Ultra** : budget de rendu, profilage, préchargement | Élevé (confort) | Moyenne | Casque | 2–3 sem. | ≥ 72 FPS moyens, minimum ≥ 60 hors chargement, sur les 2 démos, 3 sessions de 10 min |
| C3 | **Protocole et rapport de validation Pico** (remplace le rapport Quest 3 vide) | Moyen | Faible | C2 | 1 sem. | Rapport rempli, 5 testeurs, démos terminées dans le casque ; taux de réussite et difficultés relevés |
| C4 | **Réinitialiser l'étape / recommencer le TP** | Élevé | Moyenne (instantanés d'état) | — | 1–2 sem. | Test automatisé : état après réinitialisation identique à l'état initial de l'étape |
| C5 | **Rapport de fin lisible** (dans le casque + export HTML pour l'enseignant) | Élevé | Faible | — | 1 sem. | Rapport généré pour chaque session terminée ; validé par un enseignant |
| C6 | **Haptique + sons** | Moyen | Faible | — | 0,5 sem. | Retour haptique sur grab, accrochage et faute ; test casque |
| C7 | **Requalifier les TP générés** comme « aperçu non interactif » dans l'interface et les communications | Élevé (honnêteté) | Faible | — | 0,5 sem. | Libellé visible ; aucune note ni « validation » affichée pour ces TP |

### 7.2 Moyen terme (3–9 mois) : fiabiliser la génération et l'évaluation

| # | Priorité | Intérêt pédagogique | Difficulté | Dépendances | Coût | Critères de réussite |
|---|---|---|---|---|---|---|
| M1 | **Format de spécification de TP** (schéma versionné) + moteur générique d'états/actions/conditions ; réécrire les 2 démos dans ce format, **sans code spécifique** | Élevé (passage à l'échelle) | Élevée | C1 | 5–7 sem. | Les 2 démos tournent depuis leur seule spécification ; un 3ᵉ TP est créé sans toucher au code du moteur |
| M2 | **Module électrique à ports + netlist + solveur MNA** (courant continu) : câblage libre sur breadboard, polarité, calibres, série/parallèle, court-circuit, fusible | Très élevé | Élevée | M1 | 5–6 sem. | Le TP « mesure de tension et continuité » est réalisable de bout en bout ; 8 erreurs typiques reproductibles et diagnostiquées ; solveur testé contre des calculs de référence |
| M3 | **Catalogue d'équipements + pipeline d'ingestion** (glTF-Transform, glTF-Validator, contrôle dimensionnel, vignettes, revue) ; 30 premiers équipements | Élevé (réalisme) | Moyenne | — | 4–6 sem. (puis 1–4 h par équipement) | 30 équipements validés ; tous avec dimensions mesurées à ±10 % ; budget de triangles respecté |
| M4 | **Génération document → spécification** avec association au catalogue, score de confiance, vérificateurs déterministes, **éditeur de validation pour l'enseignant** | Élevé | Élevée | M1, M3 | 6–8 sem. | Sur un corpus de 20 TP annotés : rappel du matériel ≥ 90 %, association top-1 ≥ 80 % (avec abstention), temps de correction enseignant < 30 min par TP |
| M5 | **Corpus d'évaluation** : 30 à 50 TP réels annotés à la main (matériel, étapes, actions, erreurs) | Indispensable à la recherche | Moyenne (surtout du temps) | Accès aux TP de l'établissement | 3–4 sem., en continu | Corpus versionné, double annotation sur 20 % avec accord inter-annotateurs mesuré |
| M6 | **Module mécanique d'assemblage** (graphe de liaisons, ordre, couple continu, mesure d'alignement) | Élevé | Élevée | M1 | 4–5 sem. | Démo courroie réécrite ; sur-tension, sous-tension et désalignement possibles et diagnostiqués |
| M7 | **Lecture des schémas** (modèle vision-langage) pour les TP d'électricité | Élevé | Élevée, risque fort | M2, M5 | 3–5 sem. (exploratoire) | Netlist extraite correcte sur ≥ 70 % des schémas simples du corpus ; sinon abandon documenté |

### 7.3 Long terme (9–24 mois) : plateforme extensible et validée scientifiquement

| # | Priorité | Intérêt pédagogique | Difficulté | Dépendances | Coût | Critères de réussite |
|---|---|---|---|---|---|---|
| L1 | **Étude empirique** : TP virtuel en préparation au TP réel, comparé à un groupe témoin (préparation sur document) ; mesures pré/post, grille d'expert au TP réel, charge cognitive, présence, cybermalaise | Critique (validité) | Élevée (méthodologie, éthique) | C2–C5, M2 | 8–12 sem. (préparation + passation + analyse) | Protocole approuvé, effectif suffisant (analyse de puissance), résultats publiables qu'ils soient positifs ou non |
| L2 | **Validation du modèle d'erreurs et des métriques** (corrélation des traces VR avec le jugement d'expert) | Élevé | Élevée | L1 | inclus dans L1 + 3 sem. | Corrélation rapportée avec intervalle de confiance |
| L3 | **Tableau de bord enseignant** (sessions, erreurs fréquentes, export) | Élevé | Moyenne | C5, M1 | 3–4 sem. | Utilisé par ≥ 2 enseignants lors d'une séance réelle |
| L4 | **Ouverture** : publication du format de spécification et du catalogue sous licence libre, documentation contributeur | Moyen (adoption, citations) | Moyenne | M1, M3 | 2–3 sem. | Un TP créé par une personne extérieure au projet |
| L5 | **3ᵉ domaine** (seulement si L1 est concluant) | Variable | Élevée | M1 | 6–10 sem. | 3 TP validés selon la règle du §6.4 |
| L6 | Persistance (base de données), comptes, déploiement HTTPS en salle | Moyen | Moyenne | — | 2–3 sem. | Une séance de TP avec 10 casques sans intervention technique |

**Chemin critique :** C0 → C1/C2 → M1 → M2 → L1. Le reste peut glisser sans compromettre la thèse.

---

## 8. Conclusion : les cinq décisions à prendre maintenant

Si j'étais responsable technique et scientifique de TP-to-xR :

### 1. Repositionner la promesse : « création assistée et vérifiée », et non « conversion automatique »

Le pipeline actuel ne produit pas de TP interactif. Il faut le dire dans l'interface et dans les écrits. La
contribution défendable est **un brouillon généré par l'IA, vérifié automatiquement et validé par
l'enseignant**, avec une mesure du gain de temps et de la qualité. C'est plus modeste, mais démontrable,
et scientifiquement plus intéressant.

### 2. Faire de la spécification déclarative de TP le centre de l'architecture

Tout le reste en découle : génération par l'IA, vérification, édition par l'enseignant, exécution générique,
évaluation, reproductibilité. Tant que les comportements sont codés pour un TP précis, chaque nouveau TP
coûte du développement et l'automatisation reste impossible. **C'est la priorité n° 1 du moyen terme**, et
probablement la contribution principale de la thèse (R1).

### 3. Remplacer la recherche ouverte de modèles 3D par un catalogue d'équipements validés

Les données le montrent : la recherche Sketchfab par mots-clés choisit souvent un objet faux, à une taille
fausse, sans ports ni comportement. Un catalogue de 40 à 60 équipements, construit à partir de sources
ouvertes (KiCad, FreeCAD/CadQuery, Poly Haven) et validés un par un, apporte plus de réalisme que n'importe
quelle amélioration du prompt.

### 4. Aller en profondeur sur un domaine : l'électricité à courant continu avec câblage libre

C'est le domaine où le coût est le plus faible (solveur MNA simple, composants normalisés), l'intérêt
pédagogique le plus fort (erreurs de mesure fréquentes et formatrices) et la validation la plus nette
(grandeurs calculables). Il faut **renoncer pour l'instant** à présenter la chimie et la biologie comme
prises en charge, et garder la mécanique comme second domaine, plus limité.

### 5. Valider sur le matériel réel et auprès d'étudiants réels, tôt et régulièrement

Il faut atteindre 72 à 90 FPS stables sur Pico 4 Ultra, remplir un protocole de test propre au casque
utilisé, puis préparer **dès maintenant** l'étude empirique : protocole, éthique, consentement, groupe
témoin. Sans cette étude, la plateforme reste une démonstration technique. Avec elle, elle produit un
résultat scientifique, même si ce résultat est négatif.

**À faire dès cette semaine, préalable à tout le reste : mettre le projet sous git avec un dépôt distant
sauvegardé.**

---

*Ce rapport s'appuie sur l'état du code et des données au 19 octobre 2026. Les effectifs de sessions sont
trop faibles pour toute conclusion statistique. Les estimations d'effort sont indicatives. Les références aux
plateformes et travaux existants servent de pistes pour la revue de littérature : elles ne constituent pas
une analyse de l'état de l'art.*
