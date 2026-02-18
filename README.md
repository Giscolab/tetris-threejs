# Tetris 3D Metallic — WebGL Engine

## Introduction

**Tetris 3D Metallic** est une interprétation WebGL de Tetris orientée rendu temps réel :

- Les tétriminos sont traités comme des objets métalliques dynamiques (éclairage spéculaire, fresnel, biseau shader).
- Le fond est un shader procédural organique (nébuleux, violet/orange), volontairement contrasté avec la matière plus froide des blocs.
- Le résultat visuel vise un équilibre entre **lisibilité gameplay** et **signature artistique post-processée**.

Le projet est implémenté en JavaScript module natif (ESM) autour de Three.js, avec une boucle de jeu unifiée dans `TetrisGame` et un pipeline d’effets écran pour accentuer le relief et les contours.

---

## Fonctionnalités clés

- **Gameplay Tetris complet** : spawn, collision, fusion, suppression de lignes, scoring, montée de niveau, game over, reset.
- **Grille logique 10×20 + grille de meshes 3D** : séparation claire entre état logique (`grid`) et représentation visuelle (`meshGrid`).
- **Ghost piece** : projection du point de chute via simulation de descente jusqu’à collision.
- **Système Hold** : stockage/échange de la pièce courante avec verrouillage `canHold` (1 hold par pièce active).
- **Aperçu Next/Hold en 3D** : rendu des 4 blocs hors plateau via meshes dédiés.
- **Particules physiques** : éclats tétraédriques métalliques à la suppression de ligne (vitesse aléatoire, gravité, décroissance).
- **HUD réactif** : score / niveau / lignes mis à jour et flash visuel lors des gains majeurs.

---

## Détails techniques

### 1) Architecture du cœur de jeu (`TetrisGame`)

La classe `TetrisGame` orchestre à la fois :

- la scène Three.js (caméra, renderer, lumières, post-processing),
- l’état gameplay (grille, pièces, score, niveau, pause/game over),
- les interactions clavier,
- la synchro HUD + animations.

Le cycle principal est géré par `animate(time)` :

1. calcul du `deltaTime`,
2. update particules,
3. update uniforms temporels (`iTime` et `time` shader blocs),
4. simulation gameplay (gravité par intervalle dépendant du niveau),
5. update ghost + rendu grille,
6. rendu final via `EffectComposer`.

### 2) Grille 3D et logique de collision

- **Grille logique** : tableau `[x][y]` de taille `GRID_WIDTH × GRID_HEIGHT`.
- **Collision** : `checkCollision(dx, dy, piece)` vérifie limites + occupation.
- **Merge** : `mergePiece()` copie la pièce active dans la grille logique puis enchaîne sur `checkLines()`.
- **Line clear** :
  - détection complète des lignes pleines,
  - conversion en `Set` pour lookup O(1),
  - compactage de la grille dans une nouvelle matrice,
  - calcul score via table `POINTS`,
  - progression de niveau avec réduction du `dropInterval` (borné par `minDropInterval`).

### 3) Système de particules (`ParticleSystem`)

Le moteur de particules est conçu pour l’overhead minimal côté GPU :

- **Géométrie partagée** : `THREE.TetrahedronGeometry` unique pour tous les éclats.
- **Cache matériaux** : `Map<color, MeshStandardMaterial>` pour éviter des allocations répétées.
- **Émission** : `emit(position, color, count)` clone uniquement le mesh (géométrie + matériau partagés).
- **Update physique** :
  - intégration position par vélocité,
  - gravité verticale,
  - réduction de vie et d’échelle,
  - rotation continue,
  - retrait propre des meshes expirés.
- **Lifecycle GPU** : `destroy()` dispose le cache matériaux + géométrie partagée.

### 4) Shaders GLSL personnalisés

#### Blocs métalliques (`ShaderMaterial`)

Chaque couleur de tétrimino reçoit un `ShaderMaterial` dédié, construit une seule fois puis réutilisé (`materialsByColor`).

Le fragment shader combine :

- **palette temporelle** (modulation douce via `time`),
- **diffuse + spéculaire** (N·L, N·H),
- **bevel mask UV** (accent des arêtes perçues),
- **fresnel/rim glow** pour détacher les silhouettes,
- **gamma correction** en sortie.

L’uniform `time` est mis à jour à chaque frame pour animer subtilement les reflets métalliques.

#### Fond procédural (`ShaderMaterial`)

Un grand plan de fond reçoit un shader procédural piloté par `iTime` et `iResolution` :

- accumulation itérative de couches colorées,
- modulation sinusoïdale,
- compression tonale (`tanh`) pour garder de la matière sans brûler l’image.

### 5) Post-processing et rendu final

Le rendu s’appuie sur `EffectComposer` avec une construction en passes :

1. **`RenderPass(scene, camera)`** : rendu de base de la scène.
2. **`UnrealBloomPass`** : dépendance chargée dans le projet pour injection d’un bloom HDR dans la chaîne d’effets.
3. **`ShaderPass` custom EdgeGlow** : Sobel sur la luminance (`gx`, `gy`) puis ajout d’un halo coloré (`glowTint`) sur les contours.

Le shader EdgeGlow est déjà implémenté et branché dans la composer ; la résolution est maintenue à jour lors des resize pour conserver la stabilité des gradients d’arêtes.

### 6) Optimisations déjà présentes

- Réutilisation des matériaux shader par couleur (évite les recompilations inutiles).
- Particules avec géométrie partagée + cache matériaux.
- Gestion explicite du cycle de vie (`destroy`) : annulation RAF, retrait listeners, dispose ressources.
- Limitation du pixel ratio (`Math.min(devicePixelRatio, 2)`) pour contenir le coût GPU.

---

## Installation et exécution

### Prérequis

- Un navigateur moderne supportant WebGL2 et ES modules.
- Pas de build step obligatoire.

### Lancement local (sans bundler)

Le projet charge Three.js et les modules d’effets via CDN (`esm.sh`).

1. Cloner le dépôt.
2. Servir le dossier en HTTP local (éviter `file://` pour les modules ES).

Exemple :

```bash
python3 -m http.server 8080
```

Puis ouvrir : `http://localhost:8080`.

---

## Contrôles (mapping `handleInput`)

- `←` : déplacement gauche
- `→` : déplacement droite
- `↓` : soft drop (+ score unitaire par cellule)
- `↑` : rotation (avec tentative de wall-kick horizontal)
- `Espace` : hard drop (+ score par cellule parcourue)
- `C` : hold / swap pièce
- `P` : pause / reprise
- `Espace` (après game over) : reset partie

---

## Stack technique

- **Three.js ESM**
- **EffectComposer**
- **RenderPass**
- **UnrealBloomPass** (dépendance prête pour bloom HDR)
- **ShaderPass personnalisé** (détection de contours type Sobel)
- **GLSL custom shaders** (blocs métalliques + background procédural)

---

## Perspectives d’évolution

- Activation explicite d’un `UnrealBloomPass` paramétrable en runtime.
- Découpage de `TetrisGame` en sous-modules (`GameState`, `Renderer3D`, `InputController`, `HudController`).
- Ajout de tests unitaires sur la logique pure (collision, rotation, scoring, progression).
- Instrumentation performance (frame-time, coût shader, draw calls).
