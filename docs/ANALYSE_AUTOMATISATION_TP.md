# TP-to-xR — Génération automatique de TP interactifs : état réel, faisabilité et architecture cible

| | |
|---|---|
| **Date** | 19 octobre 2026 |
| **Complète** | [AUDIT_TECHNIQUE_ET_SCIENTIFIQUE.md](AUDIT_TECHNIQUE_ET_SCIENTIFIQUE.md) |
| **Code analysé** | État du 19/10/2026, après ajout de `realSizes.ts`, du rapport de fin (`services/report.ts`), de `StepFeedback`, des sons et d'`InspectView` |
| **Objectif retenu** | Un enseignant dépose un PDF et obtient automatiquement un TP immersif avec équipements, étapes, interactions et évaluation. La validation humaine sert de **contrôle qualité**, pas de programmation |

## Correction préalable de l'audit

La décision n° 1 de l'audit (« création assistée plutôt que conversion automatique ») allait trop loin.
**Rien dans le code ne justifie d'abandonner l'automatisation comme objectif.** Le constat technique, lui,
reste exact : *aujourd'hui*, le pipeline ne produit pas d'interactions. La bonne formulation est donc :

> L'automatisation complète est l'objectif. Le projet doit rendre **mesurable** la part automatisée
> (taux de TP publiés sans correction, taux d'étapes transformées en actions vérifiables) et **vérifier
> automatiquement** ce qui est généré. L'humain n'intervient que sur ce que les vérificateurs signalent.

Un point de l'audit est aussi partiellement dépassé : les tailles ne sont plus purement devinées par l'IA.
[realSizes.ts](../backend/src/config/realSizes.ts) les corrige à partir du texte du TP, de normes (piles
IEC 60086, verrerie ISO) et de plages typiques. La pile 9 V passe ainsi à 48,5 mm.

---

## 1. Ce que fait réellement le pipeline aujourd'hui

### 1.1 Du dépôt du PDF au casque

| # | Étape | Fichier / fonction | Nature | Produit |
|---|---|---|---|---|
| 0 | Choix du domaine, envoi du PDF | `frontend-vr/src/ui/UploadUI.ts`, `services/PipelineClient.ts` | Interface | PDF brut + domaine choisi par l'enseignant |
| 1 | Extraction du texte | `backend/src/services/pdf.ts` → `extractPdfText()` | **Automatique, déterministe** | Texte brut. Les images, schémas et tableaux en image sont perdus |
| 2 | Analyse du TP | `pipeline.ts:138` → `togetherAi.ts` `parseTP()` (PROMPT #1, `config/prompts.ts:26`), validé par `TPParseSchema` (`schemas/tp.ts`) | **IA** (Llama 3.3 70B) | `title, domain, materials[{name,quantity,unit}], tools[], steps[{order, action (texte libre), duration_sec, key_points, safety}], safety_warnings` |
| 3 | Liste des objets | `pipeline.ts:246` `buildItems()`, `:269` `firstStepMentioning()` | **Automatique** | Au plus 12 objets uniques, chacun rattaché à la première étape qui cite son nom |
| 4 | Requêtes de recherche | `generateAssetSearchQueries()` (PROMPT #2, `prompts.ts:65`) | **IA** | 3 requêtes en anglais par objet |
| 5 | Recherche de modèles | `sketchfab.ts` `findModel()` + `relevance()` | **Bibliothèque externe** (Sketchfab, CC0/CC-BY) + filtre par mots | Un modèle par objet, ou rien |
| 6 | Téléchargement | `assetManager.ts` `ensureModel()` | **Automatique** | GLB/glTF en cache local |
| 7 | Placement | `calculatePlacement()` (PROMPT #3, `prompts.ts:96`) → `placement.ts` `resolvePlacement()` + `realSizes.ts` `resolveRealSize()` | **IA** (zone, décalage, taille) puis **déterministe** (capacités, chevauchements, taille réelle) | Position absolue, rotation, taille et source de la taille par objet ; 2 panneaux de sécurité |
| 8 | Manifeste | `pipeline.ts:296` `buildManifest()` → `tpStore.ts` `saveManifest()` | **Automatique** | `backend/data/tps/<id>.json`, **sans champ `simulation`** |
| 9 | Chargement de la scène | `TPScene.ts` `loadTemplate()`, `placeAssets()` | **Automatique** | Salle + modèles mis à la taille réelle, chacun avec une poignée de saisie |
| 10 | Session | `VRScene.ts` `startSession()` | **Automatique** | Panneau d'étapes, saisie, analytics, feedback |
| 11 | Rapport de fin | `services/report.ts` (part déterministe) + PROMPT_PEDAGOGICAL_FEEDBACK (`prompts.ts:194`, part IA facultative) | **Automatique + IA** | Rapport par étape. Pour un TP généré, les étapes sont « Terminée (non vérifiée) » |

### 1.2 Synthèse par catégorie

| Catégorie | Pour un TP généré depuis un PDF |
|---|---|
| **Généré automatiquement** | Structure du TP, liste d'objets, requêtes, placement, manifeste, scène, rapport. Tout le chemin PDF → casque est **entièrement automatique** |
| **Décidé par l'IA** | Domaine (si l'enseignant ne le fixe pas), matériel, découpage en étapes, consignes de sécurité, requêtes, zone et taille estimée de chaque objet, texte du feedback final |
| **Récupéré dans une bibliothèque** | Modèles Sketchfab uniquement. Les 18 modèles procéduraux de `models/builtin.ts` (`BUILDERS`, l. 417) **ne sont jamais utilisés par le pipeline** : `buildManifest()` ne produit que `source: "sketchfab"` ou `"placeholder"` (`pipeline.ts:310`) |
| **Interactif** | Saisir, déplacer et poser un objet (`InteractionHandler`, `xrGrab`) ; loupe (`InspectView`) ; navigation entre étapes ; conseil si l'objet saisi n'est pas cité dans la consigne (`VRScene.ts`, `onInteraction`) |
| **Simulé** | **Rien.** Aucun état d'équipement, aucune grandeur physique, aucune règle de validation |
| **Code écrit à la main** | Pour un TP généré : rien de spécifique, mais justement rien n'est simulé. Pour obtenir l'interactivité des démos, il faut écrire **à la main** une spécification (`demoTps.ts`), des modèles procéduraux (`builtin.ts`) **et** un comportement (`behaviors.ts`) |

Le pipeline transforme donc déjà automatiquement un PDF en **scène immersive manipulable**. Il ne la
transforme pas encore en **TP exécutable et évalué**. Toute la suite porte sur cet écart.

---

## 2. Pourquoi les TP générés ne sont pas interactifs au sens « TP »

### 2.1 Preuves dans le code

1. **Le manifeste généré n'a pas de simulation.** `buildManifest()` (`pipeline.ts:296-350`) ne remplit
   jamais le champ facultatif `simulation` (`tpStore.ts:80`). Aucun des 4 manifestes de `backend/data/tps/`
   ne le contient.
2. **Sans simulation, le moteur de validation n'est pas créé.** Dans `VRScene.ts`, `sim` reste `null`
   sauf si `manifest.simulation` existe (`if (manifest.simulation) { sim = new Simulation(...) }`). Il n'y a
   alors ni cible d'accrochage, ni règle, ni état, ni faute, ni validation automatique. `onObjectReleased`,
   `onGrabStart` et `onAssetClick` appellent `sim?.…`, ce qui ne fait rien.
3. **Une étape « faite » signifie « Suivant » appuyé.** `session.interactive = !!manifest.simulation`
   vaut `false`, et `TPSession.stepsDetail()` (`utils/analytics.ts`) marque alors l'étape `done`, affichée
   « Terminée (non vérifiée) » dans le rapport (`report.ts`, `STATUS_LABEL`).
4. **La seule évaluation est lexicale.** `linkAssetsToSteps()` (`utils/manifest.ts:158`) relie un objet à
   une étape si un mot de 4 lettres ou plus de son nom apparaît dans le texte. La « précision » mesure si
   l'étudiant saisit un objet cité, pas s'il réalise l'action.
5. **Une étape générée est du texte libre.** `StepSchema.action` est une `string`
   (« poser la pointe rouge sur la borne + »). Rien ne la traduit en action vérifiable.

### 2.2 Pourquoi les interactions des démos ne se transfèrent pas à un nouveau PDF

Les démos reposent sur **trois couches écrites à la main**. Seule la première est générique :

| Couche | Fichier | Générique ? | Ce qui bloque la réutilisation |
|---|---|---|---|
| **Moteur de conditions** : `placed`, `held`, `near`, `state` ; accrochage ; validation d'une étape quand toutes ses conditions sont vraies | `sim/conditions.ts`, `sim/Simulation.ts` | ✅ **Oui**, piloté par les données | Rien, sauf le choix du comportement (ci-dessous) |
| **Spécification** : cibles et règles | `backend/src/services/demoTps.ts` | ❌ | Les cibles ont des **coordonnées absolues calculées à la main** à partir de la géométrie procédurale, par exemple `x: BENCH_ORIGIN.x - 0.25, y: SHAFT_Y - 0.05` pour l'arbre moteur. Le lien avec les modèles n'existe que dans un commentaire (« Geometry contract ») |
| **Comportements** : physique, états, fautes | `sim/behaviors.ts` | ❌ | `Simulation.ts:59` : `spec.kind === "circuit" ? new CircuitBehavior(this) : new BeltDriveBehavior(this)`. Seuls deux types existent (`conditions.ts:28`, `manifest.ts:81`). Les comportements testent des **identifiants en dur** : `asset_id !== "e_interrupteur"` (l. 66), `isPlaced("e_plaque", "poste")` (l. 80), `distanceTo("e_multimetre", "point_mesure")` (l. 97), `"m_sectionneur"` (l. 179), `distanceTo("m_cle", target)` (l. 224) |
| **Modèles** | `models/builtin.ts` | 🟡 Réutilisables, mais sans métadonnées (ports, états, catégorie) et invisibles pour le pipeline | Le pipeline ne sait pas qu'ils existent |

**En résumé :** l'IA ne peut pas reproduire ces interactions, parce qu'elles ne sont **décrites nulle
part sous forme de données qu'elle pourrait produire**. Elles existent sous forme de code TypeScript lié à
des identifiants et à des coordonnées précis. Pour un PDF de mesure de tension, il faudrait un
`MeasurementBehavior` connaissant `"pile_9v"` et `"multimetre"`, que personne n'a écrit.

---

## 3. La transformation entièrement automatique est-elle possible ?

| Niveau | Contenu | Faisabilité |
|---|---|---|
| **A. Réalisable avec l'existant, peu de développement** | Générer automatiquement une `simulation` limitée aux conditions génériques `placed` / `held` / `near` pour les étapes de type « poser X sur Y », « prendre et inspecter X », « approcher X de Y ». Le moteur `conditions.ts` le permet déjà. Il manque la génération des cibles (aujourd'hui calculées à la main) et des règles par l'IA, plus un compilateur déterministe | **Oui**, à court terme. Limite : on valide des **déplacements**, pas des grandeurs physiques |
| **B. Exige de nouvelles fonctionnalités, faisable** | Équipements avec **ports, commandes et états** (bornes, sélecteur de calibre, interrupteur, arbre, boulon) ; **bibliothèque de primitives d'interaction** génériques (`connecter`, `régler`, `mesurer`, `serrer`, `verser`, `activer`) ; **solveurs de domaine** génériques (circuit continu par netlist, graphe d'assemblage) ; l'IA produit une **représentation intermédiaire** que le système compile et **vérifie en la rejouant** | **Oui**, à moyen terme. C'est la contribution technique principale du projet |
| **C. Difficile à garantir scientifiquement** | (1) Justesse de l'extraction quand l'information est dans un schéma ou une figure ; (2) choix des **erreurs pédagogiquement pertinentes** (le document décrit le bon déroulé, rarement les erreurs) ; (3) équivalence entre le geste virtuel et le geste réel ; (4) validité de l'évaluation produite ; (5) phénomènes continus ou complexes (chimie réactionnelle, vivant, fluides) | **Ce n'est pas impossible, mais on ne peut pas le *garantir***. On peut le **mesurer** (taux d'erreur, accord avec les enseignants) et le **réduire** (vérificateurs, abstention). C'est le terrain de la recherche |

**Réponse nuancée :** une génération entièrement automatique de TP interactifs est **techniquement
atteignable pour une classe de TP bien définie** (§7.3), à condition que l'IA ne *programme* pas les
interactions mais **choisisse et paramètre des composants déjà validés**. Une garantie de justesse à 100 %
sans aucun regard humain n'est atteignable pour aucune classe de TP. Une **publication automatique quand
tous les contrôles passent, avec relecture seulement de ce qui est signalé**, est en revanche un objectif
réaliste et évaluable.

---

## 4. Architecture pour automatiser sans coder chaque TP

### 4.1 Le principe existe déjà dans le projet

Le placement fonctionne déjà selon le bon schéma : **l'IA propose** (PROMPT #3), **un résolveur
déterministe garantit** (`resolvePlacement()` : capacités, chevauchements, bornes), et les tailles sont
ensuite corrigées par des règles (`realSizes.ts`). Il faut **appliquer exactement ce schéma aux
interactions** :

> L'IA ne génère pas de code. Elle sélectionne des **équipements du catalogue** et compose des
> **primitives d'interaction** que ces équipements déclarent supporter. Un compilateur déterministe en
> tire cibles, règles et comportements. Un vérificateur rejoue le TP en simulation avant publication.

### 4.2 Vue d'ensemble

```
PDF ─► [1] Extraction (texte + images/schémas)
        │
        ▼
     [2] IA : analyse ─► TP-IR (représentation intermédiaire, JSON validé par schéma)
        │                  équipements = références au catalogue (+ confiance)
        │                  étapes = suites d'ACTIONS typées (primitives)
        │                  attendus = grandeurs + tolérances ; sécurité = préconditions
        │                  erreurs = choisies dans les modes de défaillance du catalogue
        ▼
     [3] Ancrage catalogue ─► chaque matériel → équipement validé (ports, états, comportements, modèle 3D)
        │                     sinon : candidat Sketchfab/STL → objet « passif » signalé
        ▼
     [4] Compilateur déterministe TP-IR ─► SimulationSpec étendue
        │   cibles calculées depuis les PORTS des équipements (plus de coordonnées à la main)
        │   règles = conditions générées depuis les primitives
        │   comportements = composants génériques (circuit, assemblage, instrument…)
        ▼
     [5] Vérificateurs automatiques
        │   a. schéma + références (toute action cite un port ou un état existant)
        │   b. REJEU : un agent simulé exécute les actions attendues → chaque étape se valide-t-elle ?
        │   c. physique : les valeurs simulées concordent-elles avec celles du document ?
        │   d. erreurs : chaque erreur déclarée est-elle atteignable et détectée ?
        │   e. couverture : part des étapes traduites en actions vérifiables
        ▼
     [6] Décision : tout est vert et la confiance est haute ─► PUBLICATION AUTOMATIQUE
                    sinon ─► file de contrôle qualité (l'enseignant voit les seuls points signalés)
        ▼
     [7] Exécution dans le casque (moteur actuel étendu) ─► traces ─► rapport
```

### 4.3 Les quatre briques réutilisables à construire

**(1) Catalogue d'équipements à capacités.** Chaque fiche déclare ce que l'équipement *permet* : ports,
commandes, états, grandeurs mesurables, modes de défaillance. L'IA ne peut utiliser que ce qui est déclaré.

```yaml
id: multimeter_basic
names: { fr: [multimètre, contrôleur, voltmètre, ohmmètre], en: [multimeter, DMM] }
model: builtin:multimeter          # ou GLB validé
size_mm: [90, 190, 45]
ports:  [COM, V_OHM, A10, probe_red, probe_black]
controls: { selector: [OFF, V_DC_20, V_DC_200, OHM_200, CONTINUITY, A_DC_10] }
measures: { V_DC: {between: [V_OHM, COM]}, R: {between: [V_OHM, COM], requires: unpowered}, I_DC: {in_series_via: [A10, COM]} }
failure_modes: [wrong_range, probes_swapped, ammeter_in_parallel, continuity_on_live_circuit]
behavior: instrument.dmm
```

**(2) Bibliothèque de primitives d'interaction.** Un ensemble fini et générique, chacune compilée en
conditions du moteur existant ou en nouvelles conditions :

| Primitive | Exemple | Compilée en |
|---|---|---|
| `place(eq, on)` | breadboard sur le poste | `placed` (existe) |
| `inspect(eq, s)` | inspecter la poulie | `held` (existe) |
| `connect(portA, portB)` | cordon rouge sur V/Ω | **nouveau** `connected` + arête de netlist ou de graphe d'assemblage |
| `set(control, value)` | sélecteur sur 20 V⎓ | **nouveau** `state_is` |
| `toggle(eq, state)` | interrupteur ON | `state` (à généraliser) |
| `measure(instr, quantity, between, expect±tol)` | mesurer U pile ≈ 9 V | **nouveau** `measured` (le solveur fournit la valeur) |
| `fasten(fastener, tool, torque±tol)` | boulons M8 à 25 N·m | **nouveau** `fastened` |
| `lockout(isolator)` / `wear(ppe)` | consigner, porter les gants | `state` + précondition de sécurité |
| `observe(phenomenon)` | l'ampoule s'allume | `state` émis par le solveur |

**(3) Composants de comportement génériques**, qui remplacent `CircuitBehavior` et `BeltDriveBehavior` :

- `circuit.dc` : construit la **netlist depuis les connexions réelles** de la scène, puis la résout
  (analyse nodale modifiée). LED, résistance, pile, ampoule, interrupteur, fusible et multimètre sont des
  modèles de composants. Un court-circuit, une polarité inversée ou un ampèremètre en parallèle
  **émergent** du calcul ; aucun TP n'a besoin de les coder.
- `assembly` : graphe de liaisons (arbre ↔ alésage, boulon ↔ taraudage), ordre, couple, alignement.
- `instrument.*` : affichage d'une grandeur fournie par un solveur selon le calibre.
- `safety` : préconditions (consigné, EPI portés, hors tension) vérifiées à chaque action.

**(4) TP-IR + compilateur + vérificateur.** Le TP-IR est le seul artefact produit par l'IA. Il se lit, se
diffuse, se versionne et se rejoue. Le compilateur et le vérificateur sont déterministes et testables.

### 4.4 Le contrôle qualité humain, sans programmation

L'enseignant n'écrit jamais de code ni de coordonnées. Il voit seulement :

- les associations matériel ↔ équipement en dessous du seuil de confiance (3 candidats avec vignettes) ;
- les étapes non traduites en actions (« l'IA n'a pas trouvé de primitive pour : *expliquer pourquoi…* »,
  qui devient une question de réflexion) ;
- les écarts entre la valeur simulée et la valeur du document (« document : 9–9,6 V ; simulation : 9,4 V ✓ »
  ou ✗) ;
- les erreurs proposées par l'IA, à cocher ou décocher.

Un TP dont tous les contrôles passent est **publié sans intervention**. Le taux de publication automatique
devient une **mesure de résultat de la thèse**.

---

## 5. Ce qu'il faut changer dans l'architecture actuelle

### 5.1 Composants réutilisables tels quels ou presque

| Composant | Fichier(s) | Rôle dans la cible |
|---|---|---|
| Client LLM avec JSON validé et relance corrective | `togetherAi.ts` `completeJSON()` | Reste le mécanisme de génération du TP-IR |
| Schémas zod lâches sur la forme, stricts sur le fond | `schemas/tp.ts` | À étendre au TP-IR |
| Résolveur de placement + tailles réelles | `placement.ts`, `realSizes.ts` | Inchangés ; la taille viendra en priorité du catalogue |
| Cache d'assets, Sketchfab, convertisseur STL | `assetManager.ts`, `sketchfab.ts`, `stlConverter.ts` | **Sources de candidats** pour enrichir le catalogue |
| Salle, chargement, poignées, grab VR, locomotion | `workshop.ts`, `TPScene.ts`, `InteractionHandler.ts`, `xrGrab.ts` | Inchangés |
| **Moteur de conditions + Simulation** | `conditions.ts`, `Simulation.ts` | **Cœur réutilisé** : on ajoute des types de condition et un registre de comportements |
| Rejeu de test | `Simulation.debugRelease()` | Point de départ du **vérificateur par rejeu** |
| Modèles procéduraux | `builtin.ts` (18 modèles) | **Premières entrées du catalogue**, une fois enrichies de ports et d'états |
| Analytics, rapport, feedback | `analytics.ts`, `report.ts`, `StepFeedback.ts` | Inchangés ; ils deviennent pertinents dès que les étapes sont « validées » |

### 5.2 Limites du pipeline à lever

| Limite | Où | Conséquence |
|---|---|---|
| Étape = texte libre | `StepSchema.action` | Rien à compiler en actions |
| Matériel sans caractéristiques | `MaterialSchema` (`name, quantity, unit`) | Pas de valeurs (150 Ω, 9 V, M8), pas de calibres |
| Objectifs, questions, valeurs attendues non extraits | `TPParseSchema` | Pas d'attendus à vérifier ; questions perdues |
| Pas de lecture d'images | `pdf.ts` | Schémas électriques perdus |
| Recherche ouverte au lieu d'un catalogue | `pipeline.ts` étapes 4–5 | Objets faux, sans ports ni comportement |
| Modèles procéduraux invisibles pour le pipeline | `buildManifest()` : `source` ∈ {sketchfab, placeholder} | Les seuls modèles « intelligents » ne sont jamais choisis |
| Types de simulation fermés | `kind: "circuit" \| "belt_drive"` (`conditions.ts:28`, `tpStore.ts:106`, `manifest.ts:81`) ; `Simulation.ts:59` | Aucun nouveau comportement possible sans code |
| Cibles en coordonnées absolues | `demoTps.ts` | Impossible à générer de façon fiable ; elles doivent dériver des ports |
| Comportements liés à des identifiants | `behaviors.ts` l. 66, 80–84, 97, 179, 203, 224 | Non réutilisables |
| Une seule salle, 12 objets au maximum | `workshopLayout.ts`, `MAX_ASSETS` | Suffisant pour commencer |

### 5.3 Développements indispensables, dans l'ordre

| # | Développement | Débloque | Effort indicatif |
|---|---|---|---|
| D1 | **Niveau A** : génération automatique d'une `simulation` à base de `placed` / `held` / `near`, avec cibles dérivées des zones de la salle et des objets (pas de coordonnées à la main) | Premiers TP générés **auto-validés** | 2–3 sem. |
| D2 | **Catalogue v0** : fiche de capacités pour les 18 modèles `builtin` + ports + états ; le pipeline associe le matériel au catalogue **avant** Sketchfab | Équipements « intelligents » dans les TP générés | 3–4 sem. |
| D3 | **Registre de comportements** (remplace `Simulation.ts:59`) et cibles relatives aux ports ; réécriture des 2 démos dans ce format, **sans identifiant en dur** | Preuve que la démo manuelle se reproduit à partir de données | 4–5 sem. |
| D4 | **Schéma TP-IR + PROMPT #4** (« compilateur d'actions ») contraint au catalogue (énumérations injectées dans le prompt et vérifiées par zod) ; extraction des caractéristiques, valeurs attendues, objectifs et questions | L'IA produit des actions, pas du texte | 4–6 sem. |
| D5 | **Solveur `circuit.dc`** (netlist depuis les connexions, analyse nodale modifiée) + primitives `connect`, `set`, `measure` | Tous les TP de mesures en continu | 5–6 sem. |
| D6 | **Vérificateur par rejeu** + contrôle des valeurs + score de confiance → publication automatique ou file de contrôle qualité | Automatisation **fiable et mesurable** | 3–4 sem. |
| D7 | **Corpus d'évaluation** (20 à 50 TP réels annotés) + métriques d'automatisation | Résultats de thèse | 3–4 sem., en continu |
| D8 | `assembly` (graphe de liaisons, couple, alignement) | TP de mécanique | 4–5 sem. |
| D9 | Lecture des schémas par un modèle vision-langage → netlist | TP d'électricité dont l'essentiel est dans le schéma | 3–5 sem., exploratoire |

Chemin critique pour une première démonstration « PDF → TP interactif auto-validé » : **D1 → D2 → D3 → D4**,
soit environ 3 à 4 mois pour un développeur.

---

## 6. Démonstration comparative

**TP généré** : `tp_20261014_d8uwde`, « Mesure de tension et test de continuité », produit depuis
[TP_mesure_tension.pdf](tp-exemples/TP_mesure_tension.pdf) (multimètre, pile 9 V, ampoule 6 V E10, cordons
crocodiles ; 5 étapes).
**Démos** : `tp_demo_electrical` (circuit à LED) et `tp_demo_mechanical` (courroie).

| Fonctionnalité | TP généré (PDF) | Démo électrique | Démo mécanique |
|---|---|---|---|
| Produit sans intervention humaine depuis un document | ✅ | ❌ (écrit à la main) | ❌ (écrit à la main) |
| Titre, étapes, consignes de sécurité | ✅ (IA) | ✅ (manuel) | ✅ (manuel) |
| Équipements identifiés | ✅ 4/4 nommés | ✅ | ✅ |
| Modèles 3D corrects | 🟡 multimètre et pile corrects ; ampoule = « Victorian Street Lamp » ou ampoule générique selon l'exécution ; cordons = boîte provisoire | ✅ procéduraux | ✅ procéduraux |
| Taille réelle | 🟡 corrigée par `realSizes.ts` pour la pile et l'ampoule | ✅ (composants ×1,6, assumé) | ✅ |
| Saisir / déplacer / poser / loupe | ✅ | ✅ | ✅ |
| Cibles d'accrochage et repères verts | ❌ | ✅ 6 cibles | ✅ 6 cibles |
| États d'équipement (interrupteur, sélecteur, sectionneur) | ❌ (sélecteur de calibre pourtant central dans ce TP) | 🟡 interrupteur seulement | ✅ sectionneur + cadenas |
| Connexions (cordons sur bornes, pointes sur la pile) | ❌ | ❌ (pose d'un bloc « fils ») | ❌ |
| Grandeur physique calculée | ❌ | ✅ courant, tension de la batterie | 🟡 rapport de vitesse seulement |
| Affichage d'instrument | ❌ (l'écran du multimètre Sketchfab est figé) | ✅ écran LCD dynamique | — |
| Validation automatique des étapes | ❌ (« Suivant » = terminé) | ✅ 4 étapes | ✅ 5 étapes |
| Erreurs possibles et détectées | ❌ | 🟡 2 (mise sous tension pendant le câblage, absence de résistance) | 🟡 3 (pas de consignation, remise sous tension, contact en rotation) |
| Feedback « Action incorrecte » | ❌ (seulement le conseil « la consigne mentionne… ») | ✅ | ✅ |
| Statut des étapes dans le rapport | « Terminée (non vérifiée) » | « Validée » / « Non validée (passée) » | idem |
| Évaluation | Précision lexicale (objet cité ou non) | Étapes validées + fautes | idem |
| Code spécifique au TP | 0 ligne | ~110 lignes de spécification + ~150 de comportement + modèles | ~100 + ~180 + modèles |

**À quoi ressemblerait ce même TP dans l'architecture cible.** C'est la sortie attendue de l'IA, avec zéro
ligne de code spécifique :

```yaml
equipment:
  - { ref: multimeter_basic, as: dmm, confidence: 0.97 }
  - { ref: battery_9v_6lr61, as: pile, confidence: 0.99 }
  - { ref: bulb_6v_e10_holder, as: ampoule, confidence: 0.81 }
  - { ref: lead_crocodile, as: cordon, count: 2, confidence: 0.92 }
steps:
  - n: 1   # « Préparer le multimètre »
    actions:
      - connect: [dmm.probe_black, dmm.COM]
      - connect: [dmm.probe_red, dmm.V_OHM]
      - set: [dmm.selector, V_DC_20]
  - n: 2   # « Mesurer la tension de la pile »
    actions:
      - connect: [dmm.probe_red, pile.pos]
      - connect: [dmm.probe_black, pile.neg]
      - measure: { instrument: dmm, quantity: V_DC, expect: [9.0, 9.6], unit: V }
  - n: 3   # « Tester la continuité de l'ampoule »
    preconditions: [ { unpowered: ampoule } ]
    actions:
      - set: [dmm.selector, CONTINUITY]
      - connect: [dmm.probe_red, ampoule.center]
      - connect: [dmm.probe_black, ampoule.base]
      - observe: dmm.beep
  - n: 4   # « Allumer l'ampoule »
    actions:
      - connect: [cordon#1, pile.pos, ampoule.center]
      - connect: [cordon#2, pile.neg, ampoule.base]
      - observe: ampoule.lit
    question: "Expliquer la luminosité observée."
  - n: 5   # « Ranger le poste »
    actions: [ { disconnect: all }, { set: [dmm.selector, OFF] } ]
errors_enabled: [dmm.wrong_range, dmm.continuity_on_live_circuit, pile.short_circuit]
```

Le vérificateur aurait ici signalé automatiquement, sans intervention humaine, que la simulation d'une
ampoule 6 V sur une pile 9 V donne une surtension, alors que le document attend « s'allume faiblement ».
C'est exactement le type de contrôle qualité utile à l'enseignant.

---

## 7. Avis sur la faisabilité

### 7.1 Peut-on conserver la transformation automatique comme objectif doctoral ?

**Oui.** C'est même un objectif scientifiquement plus riche que la création manuelle, à trois
conditions :

1. **Délimiter une classe de TP** pour laquelle l'automatisation est revendiquée (§7.3), au lieu de tous
   les domaines.
2. **Mesurer l'automatisation** sur un corpus de TP réels qui n'ont pas servi à concevoir le système :
   part des étapes transformées en actions vérifiables, taux de publication sans correction, précision de
   l'association au catalogue, défauts détectés par les vérificateurs ou manqués.
3. **Démontrer la validité pédagogique** sur au moins un TP généré automatiquement, utilisé par de vrais
   étudiants.

Une formulation de thèse défendable : *« Génération automatique et vérifiée de travaux pratiques immersifs
exécutables à partir de documents pédagogiques existants »*.

### 7.2 Peut-on générer des interactions sans programmer chaque TP ?

**Oui, si l'on programme des *capacités* et non des *TP*.** Le coût de développement porte sur une
bibliothèque d'équipements, de primitives et de solveurs par domaine ; il est amorti sur tous les TP de ce
domaine. Le code actuel en apporte la preuve dans les deux sens :

- le moteur de conditions est déjà générique et piloté par les données ;
- le placement suit déjà le schéma « l'IA propose, le déterministe garantit » ;
- inversement, les deux démos montrent ce qu'il ne faut pas faire : des comportements liés à des
  identifiants.

Ce qui reste programmé à la main : chaque **nouveau type d'équipement** (une fois, pour tous les TP) et
chaque **nouveau domaine physique** (un solveur).

### 7.3 TP à automatiser en priorité

| Classe | Pourquoi c'est automatisable | Exemples |
|---|---|---|
| **Mesures électriques en continu** | Composants normalisés, physique simple et calculable (analyse nodale), erreurs qui émergent du solveur, attendus numériques vérifiables | Mesure de tension et de courant, loi d'Ohm, continuité, diviseur de tension, association de résistances, LED et résistance de limitation |
| **Procédures de sécurité** | Suites d'états discrets et de préconditions | Consignation, port des EPI, mise hors tension avant intervention |
| **Montage / démontage à pièces normalisées** | Graphe de liaisons, ordre, outil adapté, couple | Poulies et courroie, roulement, assemblage boulonné, remplacement d'un composant |
| **Prise en main d'instruments** | Commandes et états finis | Calibres du multimètre, réglage d'une alimentation, lecture au pied à coulisse |
| **Partie procédurale des TP d'autres domaines** | Placer, étiqueter, verser un volume discret | Mise en place de la germination (gobelets, coton, graines, arrosage, étiquetage) |

### 7.4 TP beaucoup plus complexes

| Classe | Difficulté principale |
|---|---|
| TP dont l'essentiel est dans un **schéma** ou une figure | Lecture d'image fiable (vision) ; erreurs silencieuses |
| **Courant alternatif, oscilloscope**, électronique analogique | Solveur temporel, réglages nombreux (base de temps, déclenchement) |
| **Chimie réactionnelle** (cinétique, couleurs, titrage, dangers) | Modèle de phénomène par réaction ; la sécurité réelle est difficile à représenter |
| **Biologie et vivant** (germination sur plusieurs jours, microscopie, culture) | Échelle de temps (accélération nécessaire), variabilité biologique, observation plutôt que manipulation |
| **Gestes techniques fins** (soudure, pipetage, usinage, tour) | La compétence est motrice ; la fidélité gestuelle d'une manette est insuffisante |
| **TP ouverts ou d'investigation** (l'étudiant conçoit son protocole) | Pas de déroulé unique à vérifier ; il faut évaluer le raisonnement |
| **Mécanique des fluides, thermique, résistance des matériaux** | Simulation numérique lourde, peu compatible avec un casque autonome |

Pour ces classes, l'automatisation reste possible **pour la partie procédurale**, avec un phénomène simplifié
ou précalculé et un signalement explicite de ce qui n'est pas simulé.

### 7.5 Architecture recommandée, par paliers

| Palier | Contenu | Ce qu'il prouve | Critère de réussite |
|---|---|---|---|
| **P1 — Interactivité générique** (D1) | Le pipeline génère une `simulation` avec `placed` / `held` / `near` | Un PDF devient un TP **auto-validé** sans code | Sur 10 TP du corpus, ≥ 60 % des étapes de manipulation reçoivent au moins une condition vérifiable ; 0 ligne de code par TP |
| **P2 — Équipements à capacités** (D2, D3) | Catalogue v0 issu des 18 modèles `builtin` ; registre de comportements ; démos réécrites en données | La démo manuelle est **reproductible en données** | Les 2 démos tournent sans identifiant en dur dans le code ; un 3ᵉ TP n'exige aucun code |
| **P3 — Génération d'actions** (D4, D5) | TP-IR, PROMPT #4, solveur `circuit.dc`, primitives `connect` / `set` / `measure` | Un PDF de mesure électrique devient un TP **à erreurs émergentes** | Le TP « mesure de tension » est généré, jouable et validé ; ≥ 6 erreurs réalistes détectées ; association au catalogue top-1 ≥ 80 % |
| **P4 — Automatisation vérifiée** (D6, D7) | Rejeu, contrôle des valeurs, confiance, publication automatique ou file de contrôle | L'automatisation est **fiable et mesurée** | Sur ≥ 20 TP réels jamais vus : taux de publication automatique, défauts signalés et manqués, temps de contrôle enseignant < 15 min/TP |
| **P5 — Extension** (D8, D9) | Assemblage mécanique, lecture des schémas, puis un domaine non physique en procédural | Généralité de l'architecture | 3 TP validés par domaine ajouté |

**Recommandation finale :** garder la génération automatique comme objectif principal et l'annoncer avec
son **périmètre** (classes du §7.3) et ses **métriques** (§7.1). Le premier jalon concret est **P1**. Il
s'appuie presque entièrement sur du code existant (`conditions.ts`, `Simulation.ts`, `placement.ts`) et
transforme dès maintenant les TP générés de « scènes manipulables » en « TP auto-validés ». C'est le
meilleur argument à court terme face au constat de l'audit.
