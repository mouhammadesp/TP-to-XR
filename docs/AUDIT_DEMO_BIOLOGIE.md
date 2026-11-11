# Audit — Démo « Génie biologique » (objet : matériel de laboratoire)

Date : 10 novembre 2026 · Périmètre : refonte sur demande (« faire comme le TP moteur et l'électrique »),
audit des objets 3D téléchargés, audit du code et des outils, plan de réalisation.

---

## 1. Objectif

Ajouter au menu une 3ᵉ démonstration interactive **« Démo génie biologique — Matériel de laboratoire »**,
construite sur le même modèle que les deux démos actuelles (moteur automobile, instruments de mesure) :
objets 3D réels posés sur l'établi, découverte au laser, puis banque de questions variées (tirage de 5 à 7 questions par séance).

## 2. État des lieux

### 2.1 Le gabarit à suivre (démos existantes)

Les deux démos montées à la main t'ont analysées ensemble le même pipeline, en quatre morceaux :

1. **Modèles convertis** : `backend/assets/models/converted/<slug>.glb` + un descripteur `.json`
   (dimensions réelles, attribution CC, URL source).
   Outils : `tools/instruments/build_instruments_glb.py` et `tools/engine/build_engine_glb.py`
   (Blender en ligne de commande : orientation, échelle réelle, préviews orthographiques).
2. **Banque de questions backend** : `backend/src/services/quizBank.ts` (`target(id, [clé, question], …)`),
   tirage semé par `drawQuiz` (`backend/src/services/quiz.ts`).
3. **Définition de la démo backend** : `backend/src/services/demoTps.ts` — objets
   (`model: "converted"`, `url`, `attribution`, `clickable: true`), étapes, règles type `state`
   (`explored`, `found_<id>`, `solved_<id>`), ajout dans `DEMOS`.
4. **Comportement frontend** : `frontend-vr/src/sim/instrumentQuiz.ts` (kind `instrument_quiz`),
   branché dans `sim/behaviors.ts` ; enum des kinds dans `utils/manifest.ts` et `sim/conditions.ts`.

### 2.2 Ce qui existe déjà côté « biologie » (travail du 19 oct., jamais terminé côté démo)

| Élément | État | Emplacement |
|---|---|---|
| Kakemono Biologie | ✅ prête | `frontend-vr/public/textures/kakemono/Biologie.jpeg` |
| Domaine `biological` pipeline PDF | ✅ fonctionnel (e2e validé) | `backend/src/routes/pipeline.ts`, `tools/e2e/e2e-domain.mjs` |
| TP générés biologie (germination) | ✅ 2 fichiers | `backend/data/tps/tp_20261019_xt2rap.json`, `tp_20261019_drsv6l.json` |
| Banc de laboratoire | ✅ CC-BY | `backend/assets/models/1ac2a62c…` (lab bench) |
| Démo biologie interactive | ❌ aucune trace | — |
| Banque de questions biologie | ❌ aucune | — |

L'audit scientifique (`docs/AUDIT_TECHNIQUE_ET_SCIENTIFIQUE.md` §6.4, §6.6) classe la biologie
interactive « hors périmètre » ; cette démo comble donc un écart assumé (on reste nébuleux : démonstration
d'observation, pas de simulation de fluides/concentrations).

## 3. Audit des objets 3D téléchargés

Dossier `~/Downloads/objects bio` + `~/Downloads/biosafety-cabinet-a46204.glb`. Inspection réelle
(en-têtes GLB, contenu des zip) effectuée le 10 nov.

| Objet | Format | Triangles | Textures | Dimensions relevées | Verdict |
|---|---|---|---|---|---|
| `centrifuge.glb` | GLB direct | 8 122 | 15 im. | 0,23 × 0,39 × 0,32 m | ✅ **Utilisable tel quel** — échelle plausible (centrifugeuse de paillasse). Extensions KHR transmission/specular/ior : supporter par Babylon, mais coût GPU à mesurer sur Quest ; simplification possible via `gltf-transform`. |
| `micropipette.glb` | GLB direct | 17 988 | 9 im. | 0,24 × 0,30 × 0,14 m | ✅ **Utilisable** — ⚠️ 0,30 m est trop grand pour une micropipette réelle (~0,19 m) : re-calibrer `size_m ≈ 0,19`. |
| `biosafety-cabinet-a46204.glb` | GLB | **498** | **0** | 1,5 × 2,2 × 1,2 m | ⚠️ **Décision à prendre** : maquette brute sans textures, qualité très inférieure aux autres démos ; nom non conforme à un uid Sketchfab → source inconnue. À remplacer/retexturer ou retirer. |
| `binocular-microscope.zip` | zip Sketchfab « original » | — | — | — | ✅ **Récupérable sans Blender** : contient `source/Unity2Skfb.zip` = `Unity2Skfb.gltf` + `.bin` + 3 textures → conversion GLB par script Python simple (incorporation des buffers/textures). |
| `petridish-and-loop.zip` | zip Sketchfab | — | 1 (Alpha.png) | — | ❌ **Bloqué** : source = `loop petri.rar` → aucun unrar/7-zip installé ; aucune mesh exploitable. Il faut une extraction RAR ou un téléchargement du modèle en format standard (glTF) depuis Sketchfab. |
| `test-tube-rack.zip` | zip Sketchfab | — | 2 | — | ⚠️ FBX convertible (Blender requis), mais les 2 « textures » sont des aperçus Adobe Stock **avec filigrane** (`360_F_…`) : inutilisables → prévoir matériaux unis. |

**Manques dans le set téléchargé** : rien pour dépasser 2 objets pleinement prêts + 1 conversation.
Pour un format équivalent à l'électrique (5 objets cliquables), il manquera au minimum 2 objets
proprement convertis : boîte de Pétri + anse (rar), rack de tubes (FBX + retex), PSM (qualité).

## 4. Audit des outils disponibles sur cette machine

| Outil | État | Conséquence |
|---|---|---|
| Blender (pipeline `convertis/`) | ❌ **absent** | Le chemin officiel des démos (FBX/blend → GLB à l'échelle réelle avec préviews) est bloqué. Alternative : `brew install --cask blender` ou script ad hoc sans Blender pour les GLB déjà propres. |
| unrar / 7-zip | ❌ absents | Le rar du petri dish est inexploitable en l'état. |
| glTF\u2192GLB sans Blender | ✅ réalisable | Microscope : script Python (lecteur glTF + bin + incrustation d'images en GLB). |

## 5. Conformité licences (règle du dépôt)

Tous les assets des démos actuelles portent une **attribution CC complète** (titre, auteur, licence
CC-BY 4.0, `source_url`) + sidecar `.json`. Les 6 téléchargements biologiques n'ont **aucune
métadonnée** : sans les pages d'origine (URLs Sketchfab ou autre), il est **impossible** de remplir
les attributions correctement — règle du projet non respectée si on intègre sans cela.

## 6. Écarts à l' « instrument_quiz » et travail restant

1. `frontend-vr/src/sim/instrumentQuiz.ts` **n'est pas générique** : la liste des 5 instruments
   (id, nom, rôle, exemple, indices) est codée en dur dans le fichier. Deux voies :
   - **A (recommandée)** — généraliser : la table est fournie par le manifeste (noms + rôles + indices
     par objet, définis côté backend dans `demoTps.ts`). Aucun clone, réutilisable par d'autres domaines.
   - B — cloner en `bioQuiz.ts` + kind `bio_quiz` (enum manifest + `behaviors.ts`), moitié moins de
     refactor mais un 3ᵉ fichier dupliqué.
2. Backend : décrire la démo dans `demoTps.ts` (mêmes champs que INSTRUMENTS), écrire
   `BIOLOGY_QUESTION_BANK` dans `quizBank.ts` (≈ 3-4 formulations par objet : identification, fonction,
   mise en situation), tirage semé via `getDemo(id, quizSeed)` existant — rien à inventer.
3. Assets : convertir/calibrer les GLB retenus dans `backend/assets/models/converted/bio_*.glb`
   (+ sidecars), orientation « face vers le visiteur » (+Z), base y = 0.
4. Menu : `listDemos()` suffira — l'entrée suivra `in_menu` + `menu_label`
   « Démo génie biologique — Matériel de laboratoire ». Cohérence de nommage du plan existante.
5. Tests : compléter `backend/tests/quiz.test.ts` (banque + tirage semé) et `tools/e2e/e2e-demos.mjs`
   (23/23 avant → ajouter le scénario bio : chargement, découverte, une réponse correcte),
   e2e domaine déjà couvert par `e2e-domain.mjs` pour le PDF.
6. Casque : lumières « biological » déjà prévues (blanc neutre, lumière claire) dans `prompts.ts` — rien à faire.

Estimation une fois les blocages levés (§7) : **une demi-journée de travail** (assets 2-3 h,
backend + frontend 2 h, tests 1 h).

## 7. Risques résumés

| Risque | Sévérité | Réponse |
|---|---|---|
| Licences/attributions inconnues | **Bloquant** | Fournir les URLs de téléchargement (Sketchfab) — ou je recherche les pages pour vérifier la licence. |
| Rar + 7z + Blender absents | Bloquant partielle | `brew install` ou téléchargement glTF du petri dish ; Blender requis si on retient le rack FBX/PSM. |
| PSM sans texture, très bas poly | Qualité | À remplacer par un modèle Sketchfab texturé, ou à reporter. |
| Transparence/ior (centrifugeuse, micropipette) sur Quest | Perf | Mesure FPS e2e ; prune des extensions si besoin. |
| 5 objets « cliquables » insuffisants (2 sûrs seulement) | Contenu | Décider (§8). |

## 8. Décisions à prendre avant d'implémenter (l'utilisateur)

1. **URLs d'origine** des 6 modèles (Sketchfab idéalement) pour les attributions CC — obligatoire.
2. **Liste des objets au menu** (max 5, comme l'électrique) : microscope ✅, centrifugeuse ✅,
   micropipette ✅ + 2 questions à trancher (boîte de Pétri/anse si débloqué, rack, PSM difficile).
3. **Installs autorisées** (`brew install --cask blender`, `brew install sevenzip`) ?
4. **PSM** (`biosafety-cabinet`) : remplacer / garder / retirer ?
5. Banque de questions : niveau visé (IUT Génie Biologique ? BTS ? licence ?) pour écrire les questions FR.

---

## 9. Bilan de réalisation (10-11 nov. 2026)

Décisions retenues (§8) : **sans installation** d'outils (Blender, unrar/7zip restent absents),
set **« ce set-ci »** (microscope, centrifugeuse, micropipette, PSM), niveau **IUT / BTS Génie
biologique**, attributions **à confirmer** en attendant les URLs Sketchfab de l'enseignant.

### 9.1 Livré

| Élément | Contenu |
|---|---|
| **Assets** | 4 GLB dans `backend/assets/models/converted/` : `bio_microscope.glb` (conversion Python sans Blender, 6 044 tris, 1,3 Mo), `bio_centrifugeuse.glb` (8 122 tris), `bio_micropipette.glb` (17 988 tris, re-calibrée à 0,19 m), `bio_psm.glb` (498 tris, non texturé) + sidecars `.json` (attribution « à confirmer »). Sources copiées dans `tools/biology/sources/`. |
| **Convertisseur** | `tools/biology/convert_bio_microscope.py` — repack GLB pur Python du glTF Unity2Skfb imbriqué dans le zip Sketchfab « original » (buffers + 3 textures incorporées), sans Blender. |
| **Backend** | `BIOLOGY_QUESTION_BANK` (13 formulations IUT/BTS sur 4 cibles `b_*`) dans `quizBank.ts` ; définition `BIOLOGY` dans `demoTps.ts` (4 objets cliquables, `role`/`example`/`hints` par objet, positions calées, rotations face visiteur : microscope −90°, centrifugeuse +90°) ; `SceneAsset` étendu (`role`, `example`, `hints`) dans `tpStore.ts` ; `buildDemo` propage ces champs ; route `/api/demo/:domain` sert le plan semé pour les démos à quiz. |
| **Frontend** | `instrumentQuiz.ts` **généralisé** : participants = tous les assets du manifeste (`sim.ids()`), infos rôle/exemple/indices venant du manifeste (table électrique legacy = repli), objectif de découverte `min(5, banc)`, textes FR de comptage dynamiques, chemin legacy générique ; `Simulation.ids()` ; extension zod du manifeste. |
| **Menu** | `GET /api/demo` → 3 démos : moteur, instruments, **« Démo génie biologique — Matériel de laboratoire »** (kakemono Biologie déjà branché). |
| **Tests** | Backend **39/39** (menu 3 démos + banque bio + tirage semé) ; frontend **63/63** (nouveau test « biology demo » : 4 objets pilotés par le manifeste, découverte en 4 dwells, quiz complet) ; build dist 28,5 Mo OK. |
| **E2E** | `tools/e2e/e2e-bio.mjs` (Chrome headless macOS) — **2 passages au vert d'affilée** : menu, chargement des 4 objets convertis, découverte par dwell avec pivot de caméra vers le PSM, quiz complet (erreur volontaire puis bonne réponse à chaque question), fin de TP, 0 erreur console, vue PSM. Captures : `docs/screenshots/67-demo-biologie-banc.png`, `68-demo-biologie-quiz.png`, `69-demo-biologie-psm.png`. |

### 9.2 Apprentissage technique (headless Chrome + SwiftShader)

Sous SwiftShader le rendu tombe à **~1 frame toutes les 2-5 s** sous charge : après un pivot de
caméra (`setTarget`), `screenOf` sert des **matrices périmées** jusqu'à la frame suivante.
`e2e-bio.mjs` rend l'e2e déterministe par deux garde-fous :
1. `screenOfFresh` — attend deux lectures consécutives identiques **et** dans le canvas
   (un pivot éloigne l'objet visé : sa projection périmée sort du canvas, la détection est sans
   ambiguïté) ;
2. `lookAtAsset` — vise le **centre** de l'objet (`position.y + target_size_m / 2`) puis met à jour
   la matrice en cache par `scene.setTransformMatrix(camera.getViewMatrix(), camera.getProjectionMatrix())`
   : `screenOf` et le picking deviennent immédiatement cohérents, **sans** rendu synchrone
   (un `scene.render()` manuel double la boucle de rendu et fait planter l'onglet).

Le dwell PSM exige aussi un pivot de caméra : le PSM (coin arrière-gauche, `(-2.3, 0, -1.55)`) est
occlus par le mur gauche depuis la caméra établi — comportement d'élève reproduit par l'e2e.

### 9.3 Écarts restants

| Écart | Détail | Action |
|---|---|---|
| **Attributions CC à confirmer** | Les 4 sidecars `bio_*.json` et les attributions du manifeste portent « à confirmer » (auteur, licence, `source_url` vides). Règle CC-BY du dépôt non satisfaite tant que l'enseignant ne fournit pas les URLs des pages de téléchargement. | Bloquant avant **diffusion** seulement ; la démo locale est fonctionnelle. |
| **PSM bas-poly, 0 texture** | 498 tris, aucun material image — qualité nettement sous les 3 autres objets (et sous les démos moteur/électrique). | Remplacer par un modèle Sketchfab texturé (ou retexturer) ; en l'état il reste une maquette cliquable correcte pour l'identification. |
| **Pétri/anse et rack exclus** | Faute d'outils (rar et FBX non exploitables sans unrar/7zip/Blender — décision « sans installation »). | Si l'utilisateur installe les outils ou fournit des glTF, compléter le banc (5 objets comme l'électrique). |
| **Extensions KHR transmission/specular/ior** | Présentes sur centrifugeuse et micropipette (verreries). Supportées par Babylon ; coût GPU à surveiller sur Quest 2/3 (mesure FPS e2e ≈ 1-2 en headless SwiftShader, **non représentatif du casque**). | Prune éventuelle via `gltf-transform` si un ralentissement casque est constaté. |

### 9.4 Test dans le casque

`http://localhost:3000/vr/?tp=tp_demo_biology` (serveur backend démarré, `npm run dev` dans `backend/`).
Les positions et rotations ont été validées en captures e2e : les 4 objets font face au visiteur,
le PSM n'occulte pas le panneau mural (carte d'intro à `z≈-2.2`).
