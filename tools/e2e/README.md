# Tests de bout en bout (Chrome headless)

Les deux scripts pilotent la vue étudiant dans Google Chrome headless (rendu logiciel SwiftShader),
via le protocole DevTools. Ils n'ont aucune dépendance npm.

Pré-requis : backend lancé (`cd backend && npm run dev`), frontend construit
(`cd frontend-vr && npm run build`), Google Chrome installé. Si Chrome n'est pas à l'emplacement
par défaut, définir la variable d'environnement `CHROME`.

| Script | Ce qu'il vérifie | Commande |
|---|---|---|
| `e2e-demos.mjs` | Les **23 contrôles de référence** des deux démos (circuit, courroie) : non-régression | `node tools/e2e/e2e-demos.mjs http://localhost:3000 <dossier-captures>` |
| `e2e-engine.mjs` | **Démo moteur automobile** (scan Audi TFSI) : découverte au survol, 5 questions par vrais survols / clics souris sur les zones, mauvaises réponses + indices progressifs, bilan, suivi (21 contrôles) | `node tools/e2e/e2e-engine.mjs http://localhost:3000 <dossier-captures>` |
| `e2e-p1.mjs` | **Palier P1** : nouveau PDF → pipeline automatique (vraie IA + Sketchfab) → règles générées → manipulations dans la salle → validation par le moteur → rapport (25 contrôles) | `node tools/e2e/e2e-p1.mjs http://localhost:3000 docs/screenshots docs/tp-exemples/TP_aimant_boussole.pdf other` |

`e2e-p1.mjs` exige `TOGETHER_API_KEY` dans `backend/.env`, et `SKETCHFAB_API_KEY` pour de vrais
modèles 3D (sans cette clé, les objets sont des boîtes provisoires, mais les interactions
fonctionnent). Le script ne connaît pas le TP : il lit les règles du manifeste généré et joue chaque
action attendue.

- **Poser / approcher** : l'objet est relâché par `Simulation.debugRelease()`, le même code que
  lorsqu'on lâche un objet (accrochage, puis règles).
- **Inspecter** : vrais événements souris (appui, maintien 2,3 s, relâchement).

Le geste réel au casque (manettes / mains sur Pico 4 Ultra) n'est **pas** couvert par ces scripts.
