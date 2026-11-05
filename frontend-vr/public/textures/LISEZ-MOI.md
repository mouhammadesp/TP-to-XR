# Textures de la salle (optionnelles)

Déposez ici les images générées (JPG ou PNG, carrées de préférence, 1024 × 1024 idéal).
Noms de fichiers EXACTS attendus :

| Fichier | Surface |
|---|---|
| `sol.jpg` | sol (résine époxy / vinyle) |
| `mur.jpg` | murs peints |
| `lames-bois.jpg` | mur d'accent en lames de bois acoustiques |
| `dalle-plafond.jpg` | dalle de faux plafond 60 × 60 cm |
| `rideau.jpg` | tissu des rideaux |
| `plan-de-travail.jpg` | plateau de l'établi |
| `vue-fenetre.jpg` | vue extérieure à travers les fenêtres (pas besoin d'être raccordable) |

Un fichier absent = texture générée par le code. Après ajout : `npm run build` dans `frontend-vr`,
puis recharger la page. Les images sont redimensionnées (≤ 1024 px), rendues raccordables si
besoin, et le relief / la rugosité sont calculés automatiquement.
