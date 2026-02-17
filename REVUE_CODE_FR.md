# Revue de code — Tetris Three.js

## Qualité du code

1. **Responsabilités trop concentrées dans `TetrisGame`** (classe monolithique).
   - La classe gère à la fois rendu 3D, logique métier Tetris, entrées clavier, UI DOM et effets visuels. Cela rend la maintenance difficile et augmente le risque de régressions croisées. (`script.js`)
   - **Refactor suggéré**: découper en modules `GameState`, `Renderer3D`, `InputController`, `HudController`.

2. **Littéraux magiques dispersés**.
   - Des constantes visuelles/physiques sont codées en dur à plusieurs endroits (`0.35`, `0.012`, `17`, `3`, `100`, etc.), rendant l’équilibrage compliqué. (`script.js`)
   - **Refactor suggéré**: centraliser ces valeurs dans un objet `CONFIG` versionné.

3. **Incohérence de mise à jour HUD**.
   - Le score est modifié pendant `ArrowDown`/hard drop, mais l’affichage score n’est rafraîchi que lors des suppressions de lignes. Cela crée un décalage entre état interne et UI. (`script.js`)
   - **Refactor suggéré**: méthode dédiée `updateHud()` appelée après toute mutation score/level/lines.

## Détection de bugs / cas limites

1. **Bug de gestion mémoire WebGL dans les particules**.
   - `ParticleSystem` partage **une** géométrie (`this.geometry`) entre toutes les particules, puis `update()` exécute `p.mesh.geometry.dispose()` pour chaque particule expirée. Cela peut invalider la géométrie encore utilisée par d’autres meshes. (`script.js`)
   - **Correctif**: ne disposer la géométrie partagée qu’une seule fois dans une méthode de teardown globale, et ne disposer ici que le matériau.

2. **Hold sans validation de collision après swap**.
   - Quand `heldPiece` existe, la pièce récupérée est replacée au spawn sans vérifier collision immédiate. On peut entrer dans un état incohérent si la zone d’apparition est occupée. (`script.js`)
   - **Correctif**: appeler `checkCollision(0, 0, this.currentPiece)` après repositionnement et déclencher `gameOver()` si collision.

3. **Animation frame non annulée**.
   - `animate()` recrée un `requestAnimationFrame` en boucle sans conserver l’ID pour annulation. En cas de redémarrage/reconstruction du jeu, risque de boucles multiples. (`script.js`)
   - **Correctif**: stocker `this.rafId` et annuler dans un `destroy()`.

## Analyse sécurité

1. **Chaîne d’approvisionnement front-end (CDN)**.
   - Import dynamique de Three.js depuis CDN externe sans verrouillage d’intégrité (SRI impossible tel quel via `import()` URL). (`script.js`)
   - **Risque**: compromission CDN/MITM.
   - **Mitigation**: embarquer version vendored de Three.js dans le repo/build ou pinner via pipeline de build signé.

2. **Surface XSS faible dans ce code**.
   - Aucune interpolation utilisateur dans `innerHTML`; seule chaîne statique en cas d’échec de chargement. (`script.js`)
   - **Bonne pratique**: préférer `textContent` + nœuds DOM même pour messages statiques.

## Performance

1. **Complexité O(H²) évitable lors du clear de lignes**.
   - `linesToClear.includes(y)` est appelé dans une boucle sur `y`; avec tableau, cela rajoute un coût évitable. (`script.js`)
   - **Optimisation**: convertir `linesToClear` en `Set` pour lookup O(1).

2. **Mises à jour matériaux à chaque frame**.
   - `roughness`/`metalness` réaffectés fréquemment dans `updateGraphics()`, même sans changement de cellule. (`script.js`)
   - **Optimisation**: ne mettre à jour que lors des transitions d’état ou utiliser deux matériaux préconfigurés (figé/courant).

3. **Allocations fréquentes pour particules**.
   - Création d’un matériau par particule dans `emit()`. (`script.js`)
   - **Optimisation**: pool d’objets/instancing ou réutilisation de matériaux par couleur.

## Bonnes pratiques & tests recommandés

1. **Ajout de tests unitaires logique pure**.
   - Couvrir `checkCollision`, `rotatePiece`, `checkLines`, scoring/level progression.

2. **Tests de non-régression gameplay**.
   - Cas hold + collision spawn, hard drop sur plateau quasi rempli, reset après game over.

3. **Gestion cycle de vie**.
   - Ajouter `destroy()` pour retirer les event listeners (`resize`, `keydown`) et disposer les ressources Three.js.

## Priorités de correction (ordre recommandé)

1. Corriger le bug `dispose()` de géométrie partagée (critique stabilité).
2. Synchroniser systématiquement HUD/score (bug UX visible).
3. Ajouter validation collision après hold swap (cohérence gameplay).
4. Ajouter `destroy()` + annulation RAF + cleanup listeners (fiabilité long terme).
5. Optimisations performance (`Set`, matériaux/pool).
