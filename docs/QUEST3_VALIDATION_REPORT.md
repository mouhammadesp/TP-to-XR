# Rapport de validation Quest 3 — TP-to-xR

> **STATUT : À REMPLIR. Ce test n'a pas encore été réalisé.**
> Ce document est le protocole de test et la grille de résultats. Les valeurs sont relevées
> **pendant** la session avec le casque. Les métriques chiffrées viennent de
> `tools\quest.ps1 -Report` (données enregistrées par l'application).

| | |
|---|---|
| **Date** | ____ |
| **Testeur** | ____ |
| **Casque** | Meta Quest 3, version système : ____ , Quest Browser version : ____ |
| **PC / serveur** | ____ |
| **Durée totale** | ____ min |
| **Éclairage de la salle** | ____ (le hand tracking dépend de la lumière) |

---

## 0. Préparation (PC)

```powershell
cd backend ; npm run dev                    # terminal 1 (redémarrer après chaque mise à jour du code)
cd frontend-vr ; npm run build              # si le code de l'app a changé
powershell -ExecutionPolicy Bypass -File tools\quest.ps1   # adb, redirection du port, vérification du serveur
```

- [ ] `tools\quest.ps1` affiche `[OK]` pour le casque, la redirection et le serveur (2 TPs de démo)
- [ ] Chrome sur le PC : `chrome://inspect/#devices` → « Quest Browser » → **inspect**
      (console du casque ; il n'y a pas de F12 dans le casque)
- [ ] Batterie du casque ≥ 30 % (affichée par le script)

Dans le casque, ouvrir **Quest Browser** → `http://localhost:3000/vr/?student=quest_test`

---

## 1. Menu (mode 2D, avant la VR)

| Contrôle | Attendu | Résultat |
|---|---|---|
| L'accueil s'affiche, avec l'atelier qui tourne en fond | oui | ⬜ |
| Boutons Démarrer / TPs déjà générés / Démo mécanique / Démo électrique cliquables au rayon | oui | ⬜ |
| Console (chrome://inspect) sans erreur rouge | oui | ⬜ |
| Temps de chargement de l'accueil | < 10 s | ____ s |

Capture (bouton Meta + gâchette) → `08_quest_menu`

## 2. Chargement de la démo mécanique

Cliquer **Démo mécanique**.

| Contrôle | Attendu | Résultat |
|---|---|---|
| 8 objets posés (établi + étagères), aucun ne flotte | oui | ⬜ |
| Panneau d'instructions « Étape 1/5 » lisible | oui | ⬜ |
| Textures visibles (bois, béton, acier) | oui | ⬜ |
| Statut dans le HUD : « 0/8 modèles 3D · textures ___ ms » | noter | ____ ms |

Captures → `09_quest_scene_overview`, `10_quest_scene_close`

## 3. Entrée en VR

Appuyer sur le **bouton casque** (en bas à droite de la page).

| Contrôle | Attendu | Résultat |
|---|---|---|
| Passage en immersif, sans écran noir de plus d'une seconde | oui | ⬜ |
| Debout devant l'établi, panneau d'instructions en face | oui | ⬜ |
| Avec les manettes : rayons visibles, téléportation au sol (stick) | oui | ⬜ |
| Console : pas d'erreur WebXR | oui | ⬜ |

Capture → `11_quest_webxr_entry`

## 4. Hand tracking

Poser les manettes et lever les mains.
Si les mains n'apparaissent pas : dans les paramètres du casque, rubrique de suivi des mouvements,
activer le **suivi des mains** (l'intitulé exact dépend de la version du système).

> Les mains virtuelles affichées par Babylon sont téléchargées depuis `assets.babylonjs.com` :
> **une connexion Internet est nécessaire**. Sans Internet, le suivi fonctionne mais les mains
> ne s'affichent pas.

| Contrôle (note de 1 à 5, subjective) | Main droite | Main gauche |
|---|---|---|
| Mains visibles, doigts suivis | ⬜ | ⬜ |
| Stabilité (pas de tremblement) | __/5 | __/5 |
| Latence perçue | __/5 | __/5 |
| Perte du suivi (mains hors champ, croisées) | __ fois | __ fois |

> WebXR ne fournit **aucun indice de confiance** pour le suivi des mains : ces critères sont
> évalués par le testeur.

Captures → `12_quest_hand_detection_right`, `13_quest_hand_detection_left`

## 5. Saisie des objets (pincement pouce + index)

Pour chacun des 3 objets (**courroie**, **boulons M8** sur l'étagère gauche, **clé plate 13**) :
viser, pincer, déplacer, relâcher.

| Objet | S'illumine au survol | Suit la main | Retombe sur une surface au relâcher | Re-saisie possible |
|---|---|---|---|---|
| Courroie trapézoïdale | ⬜ | ⬜ | ⬜ | ⬜ |
| Boulons M8 | ⬜ | ⬜ | ⬜ | ⬜ |
| Clé plate 13 | ⬜ | ⬜ | ⬜ | ⬜ |

Fluidité du déplacement : __/5 · Pose au relâcher : __/5
Captures → `15_quest_grab_object`, `16_quest_object_moved`

## 6. Navigation par geste (pincement pouce + **majeur**)

**Protocole de mesure du taux de reconnaissance** (à respecter pour que le calcul soit valable) :
1. Revenir à l'étape 1 (bouton ◀).
2. Main **droite** : faire **exactement 10** pincements pouce + majeur, espacés d'environ 1 s.
   Noter le nombre de changements d'étape vus : ____ / 10.
3. Main **gauche** : **exactement 10** pincements. Noter : ____ / 10.
4. Noter les changements d'étape **sans** pincement volontaire (faux positifs) : ____

| Contrôle | Attendu | Résultat |
|---|---|---|
| Droite = étape suivante, gauche = étape précédente | oui | ⬜ |
| À l'étape 5, un pincement droit reste à 5/5 ; à l'étape 1, un pincement gauche reste à 1/5 | oui | ⬜ |
| 5 pincements rapides : pas de double déclenchement (anti-rebond de 600 ms) | oui | ⬜ |

Taux de reconnaissance = `pinch_middle:right / 10` et `pinch_middle:left / 10`, lus dans
`tools\quest.ps1 -Report`. Le compte de l'application est comparé au compte du testeur.

> Seuils actuels : déclenchement sous 1,8 cm, relâchement au-delà de 3,5 cm
> (`frontend-vr/src/utils/gestures.ts`). À ajuster si le taux est inférieur à 90 % ou s'il y a
> des faux positifs.

Captures → `17_quest_step_2_of_5`, `18_quest_step_navigation`

## 7. Performance

Le FPS est affiché sur le **petit écran posé sur l'établi** (au fond à droite), et enregistré
chaque seconde (moyenne et minimum).

| Situation (30 s chacune) | FPS lu sur l'écran | Saccades visibles |
|---|---|---|
| Immobile, regard sur l'établi | ____ | ⬜ |
| Rotation de la tête | ____ | ⬜ |
| Marche / téléportation autour de l'établi | ____ | ⬜ |
| Pendant la saisie d'un objet | ____ | ⬜ |

Verdict : ✅ ≥ 72 · 🟡 60–72 · ❌ < 60

Si < 60 : noter la température (`adb shell dumpsys battery | findstr temperature`). Les leviers
d'optimisation sont listés dans `frontend-vr/README.md` (taille des textures, carte d'ombres,
sonde de réflexion).

Captures → `19_quest_fps_baseline_static`, `20_quest_fps_baseline_moving`

## 8. Fin de session et enregistrement

| Contrôle | Attendu | Résultat |
|---|---|---|
| Aller jusqu'à 5/5 puis « Terminer ✓ » → « résultats enregistrés » | oui | ⬜ |
| Fermer l'onglet, rouvrir `/vr/?tp=tp_demo_mechanical` → nouvelle session (chrono à 0) | oui | ⬜ |
| `tools\quest.ps1 -Report` affiche les 2 sessions séparément | oui | ⬜ |

> Si le **serveur** est arrêté pendant la session, les données envoyées depuis le dernier envoi
> sont perdues (envoi toutes les 30 s, et à la fermeture de la page si le serveur répond).

---

## Métriques (copier la sortie de `tools\quest.ps1 -Report`)

```
(coller ici)
```

| Métrique | Valeur |
|---|---|
| FPS moyen / minimum | ____ / ____ |
| Taux de reconnaissance du pincement majeur, droite / gauche | ____ % / ____ % |
| Faux positifs | ____ |
| Durée de session | ____ s |
| Nombre d'interactions | ____ |

## Captures

Récupérer les captures avec `tools\quest.ps1 -Screenshots` (copiées dans `docs\screenshots\quest\`),
puis les renommer selon les noms indiqués ci-dessus.

## Verdict

- ⬜ ✅ VERT : WebXR OK, mains suivies, reconnaissance ≥ 95 %, FPS ≥ 72, aucun crash en 15 min
- ⬜ 🟡 JAUNE : FPS 60–72, reconnaissance 80–95 %, défauts mineurs
- ⬜ ❌ ROUGE : erreur WebXR, mains non suivies, FPS < 60, crash

## Problèmes rencontrés

1. ____

## Recommandations

- ____
