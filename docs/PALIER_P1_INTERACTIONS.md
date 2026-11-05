# Palier P1 — Interactions générées automatiquement depuis le PDF

| | |
|---|---|
| **Date** | 19 octobre 2026 |
| **Objectif** | Le pipeline PDF → VR génère lui-même des actions simples, leurs cibles et leurs règles de validation, exécutées par le moteur existant (`conditions.ts`), sans code propre au TP |
| **Contexte** | [ANALYSE_AUTOMATISATION_TP.md](ANALYSE_AUTOMATISATION_TP.md), §7.5 (palier P1) |
| **Hors périmètre** | Connexions, réglages, mesures, solveurs physiques (paliers P2–P3), catalogue d'équipements |

## 1. Résultat

**Critère principal atteint, en navigateur de bureau :** un nouveau PDF
([TP_aimant_boussole.pdf](tp-exemples/TP_aimant_boussole.pdf), jamais codé comme démo) a été déposé.
Le pipeline a généré le TP sans intervention, en 10 à 14 s :

| Étape du document | Règle générée | Couverture |
|---|---|---|
| 1. Poser la feuille blanche A4 sur la table, puis poser la boussole au centre de la feuille blanche | `placed` feuille → emplacement libre sur l'établi ; `placed` boussole → sur la feuille (cible ancrée) | complète |
| 2. Inspecter l'aimant droit et repérer ses pôles nord et sud | `held` aimant ≥ 2 s | partielle : « repérer ses pôles » non vérifié |
| 3. Approcher lentement le pôle nord de l'aimant droit de la boussole | `near` aimant → boussole (≤ 0,20 m) | complète |
| 4. Observer la déviation de l'aiguille… et noter son sens | aucune (observation d'un phénomène, prise de notes) | non vérifiable |
| 5. Mesurer avec la règle graduée la distance… | aucune (mesure) | non vérifiable |

Dans la salle, les manipulations attendues ont été effectuées. Le moteur a validé les étapes 1 à 3
(événements `step_validated`), et le rapport final indique 3 étapes validées et 2 non vérifiées.

**Second document** ([TP_mesure_tension.pdf](tp-exemples/TP_mesure_tension.pdf)) : l'IA a proposé
4 actions. Il s'agissait en fait de connexions déguisées en « poser » ou « approcher » (pointes sur
les bornes, « relier l'ampoule à la pile »). Le vérificateur les a toutes rejetées, avec leur motif.
Le TP reste **non interactif**, et chaque partie non vérifiée est listée. Aucune règle n'a été
inventée. C'est le comportement attendu tant que les connexions ne sont pas prises en charge (P3).

## 2. Fonctionnement

```
PDF → [parse] étapes recopiées mot pour mot
    → [interactions] PROMPT #5 propose des actions (poser / approcher / inspecter) avec une citation
                     validateInteractions() ne garde que ce que le texte justifie
    → [placement]    applyStartConstraints() : un objet à « poser sur l'établi » part d'une étagère
    → [manifest]     buildSimulation() : cibles, règles, couverture → manifest.simulation (kind "generic")
    → VR : Simulation (moteur existant) + GenericBehavior (aucune logique cachée)
```

| Action | Conditions dans le texte (toutes requises) | Règle | Paramètre (bibliothèque, pas le TP) |
|---|---|---|---|
| **poser** | citation présente dans l'étape ; verbe « poser / placer / installer / mettre… » ; objet du matériel cité ; support cité (établi / table / poste / paillasse, ou un autre objet du TP) | `placed` sur une cible : emplacement libre de l'établi, ou dessus de l'objet support (cible ancrée qui suit l'objet) | rayon de capture 8–25 cm ; départ ≥ 30 cm de la cible |
| **approcher** | verbe « approcher / rapprocher / amener » ; objet et cible cités | `near` : l'objet doit avoir bougé pendant l'étape (≥ 5 cm) et passer à moins de 15 cm du bord de la cible | 15 cm + demi-taille de la cible, au plus 50 cm |
| **inspecter** | verbe « inspecter / examiner / observer / regarder » ; **l'objet est le complément direct du verbe** (au plus 4 mots après) | `held` | 2 s en main |

**Ce qui empêche d'inventer :**

- citation introuvable dans l'étape ;
- objet absent du matériel ;
- support non précisé (« Poser le gobelet. ») ;
- ambiguïté entre deux objets (« la pile » quand il y en a deux) ;
- objet à poser à deux endroits dans la même étape ;
- observation d'un phénomène (« observer la déviation de l'aiguille ») ;
- objet non placé dans la salle.

Dans tous ces cas, l'action est rejetée, signalée à l'enseignant (`manifest.interactions.issues` et
avertissements du job) et listée comme « non vérifiée ».

**Ce qui empêche de surévaluer une étape :**

- chaque occurrence d'un verbe d'action de l'étape doit être couverte par une action retenue ou par
  une partie signalée. Sinon, elle est ajoutée aux parties non vérifiées, même si l'IA l'a oubliée ;
- une étape n'est « complète » que dans ce cas ;
- une partie « non prise en charge » proposée par l'IA n'est retenue que si c'est une citation (ses
  paraphrases sont ignorées).

**Côté étudiant :**

- une étape à règle ne se valide que lorsque toutes ses conditions sont vraies ;
- « Suivant » sans l'action enregistre l'étape comme `skipped` (« Non validée (passée) ») ;
- une étape sans règle affiche « Étape non vérifiable automatiquement » et finit en `done`
  (« Terminée (non vérifiée) »), jamais en `validated` ;
- le tableau d'instructions affiche aussi les parties non vérifiées d'une étape partielle. Le
  rapport (déterministe et IA) les reprend.

## 3. Fichiers modifiés

| Fichier | Changement |
|---|---|
| `backend/src/services/interactions.ts` (nouveau) | Bibliothèque d'actions, vérification textuelle, contraintes de départ, compilation des cibles et règles, couverture |
| `backend/src/config/prompts.ts` | PROMPT #5 (extracteur d'interactions) ; PROMPT #1 recopie désormais les consignes **mot pour mot** ; le PROMPT de feedback sait qu'une étape `done` d'un TP interactif n'est pas validée |
| `backend/src/schemas/tp.ts`, `services/togetherAi.ts` | Schéma et appel `extractInteractions()` (température 0) ; majuscule en début d'étape |
| `backend/src/services/pipeline.ts` | Étape `interactions` ; contraintes de départ avant le placement ; `buildManifest()` ajoute `simulation` et `interactions` ; `checked_steps` dans le résultat |
| `backend/src/services/tpStore.ts`, `placement.ts` | Types `generic`, cibles ancrées, couverture ; `nearestFreeSpot` exporté |
| `backend/src/services/report.ts`, `routes/analytics.ts` | Couverture par étape dans le rapport ; événement `near` accepté |
| `frontend-vr/src/sim/behaviors.ts`, `Simulation.ts`, `conditions.ts` | `createBehavior()` remplace le choix codé en dur ; `GenericBehavior` ; cibles ancrées ; détection générique de `near` ; `hasRule()` |
| `frontend-vr/src/scenes/VRScene.ts`, `ui/StepPanel.ts`, `utils/analytics.ts` | Pas de `skipped` sur une étape sans règle ; statut `done` pour les étapes non vérifiables ; notes « non vérifié » sur le tableau |
| `frontend-vr/src/utils/manifest.ts`, `services/PipelineClient.ts`, `src/report.ts`, `report.html` | Schéma, libellé de la nouvelle étape du pipeline, affichage de la couverture dans le rapport |

Les deux démos sont inchangées : `kind` vaut `circuit` ou `belt_drive`, sans cible ancrée ni règle
`near` générée.

## 4. Vérification

| Suite | Résultat |
|---|---|
| Backend `npm test` (nouveau script) | **21/21**, dont 14 nouveaux (`tests/interactions.test.ts`) : génération des règles, rejets (phénomène, citation inventée, objet inconnu, support absent, ambiguïté), document imprécis → aucune règle, filet de sécurité, formes verbales, pipeline complet avec IA simulée |
| Frontend `npm test` | **47/47**, dont 8 nouveaux (`tests/generated.test.ts`) : le **vrai** `Simulation` sur `NullEngine` — mauvais dépôt refusé, accrochage et validation, cible ancrée, inspection < 2 s refusée, approche sans mouvement refusée, « Suivant » sans règle ne valide rien |
| `tools/e2e/e2e-demos.mjs` (référence) | **23/23** avant et après |
| E2E rapport / feedback / navigation / échelle (scripts existants) | 18/18 · 16/16 · 6/6 · 17/17, avant et après |
| `tools/e2e/e2e-p1.mjs` (nouveau PDF, vraie IA) | **25/25** |
| `tsc --noEmit` backend et frontend | OK |

Captures : [62](screenshots/62-p1-repere-vert-etape-generee.png) repère vert de l'étape générée ·
[63](screenshots/63-p1-etape-generee-validee.png) étape validée ·
[64](screenshots/64-p1-etape-non-verifiable.png) étape non vérifiable ·
[65](screenshots/65-p1-fin-tp-genere.png) fin de TP ·
[66](screenshots/66-p1-rapport-tp-genere.png) rapport.
Manifeste généré : [p1-manifest.json](screenshots/p1-manifest.json).

**Reproduire :** voir [tools/e2e/README.md](../tools/e2e/README.md).

## 5. Limites constatées (honnêtement)

1. **Non testé dans le casque.** Le geste réel (manettes ou mains sur Pico 4 Ultra) n'a pas été essayé.
   Les dépôts E2E passent par le même code que le relâcher (`debugRelease` → accrochage → règles),
   mais pas par la saisie VR. Le surcoût par image est faible : quelques cibles ancrées et
   conditions `near` évaluées, au plus quelques disques de repère. Il n'a toutefois **pas été
   mesuré sur le Pico**.
2. **Assets inadaptés (palier P2).** Pour ce TP, Sketchfab a fourni une « Magnetic Rock » pour la
   boussole et une ramette de 500 feuilles pour la feuille A4. Les interactions fonctionnent
   quand même, mais le réalisme n'y est pas.
3. **Physique absente.** P1 vérifie des **gestes** (poser, approcher, tenir), pas des phénomènes :
   l'aiguille de la boussole ne dévie pas.
4. **Dépendance à la fidélité du texte.** Lors du premier essai, le prompt d'analyse résumait les
   consignes. « Au centre de la feuille blanche » était devenu « au centre », et l'action était
   correctement rejetée. Le prompt recopie désormais le texte, mais un LLM peut toujours
   s'écarter de cette consigne. Le vérificateur rejette alors les citations (pas d'invention),
   ce qui fait baisser la couverture.
5. **Rendement sur des TP de mesure ou de câblage** : proche de zéro tant que P3 n'existe pas
   (exemple du TP de mesure de tension : 0/5 étape vérifiable).
6. **Lexique français/anglais limité**, sans lemmatiseur. Une formulation inhabituelle (« déposez
   délicatement… » passe ; « l'objet doit reposer sur… » ne passe pas) est rejetée plutôt
   qu'acceptée à tort.
7. **Non-déterminisme.** Malgré une température de 0, deux exécutions peuvent différer, notamment
   dans les parties non vérifiées. Les métriques sur corpus restent à produire (D7).
