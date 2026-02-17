import * as THREE from 'three';


// --- 2. CONSTANTS & CONFIGURATION ---
const GRID_WIDTH  = 10;
const GRID_HEIGHT = 20;
const BLOCK_SIZE  = 1;
const BLOCK_GAP   = 0.05;

// Palette métallique désaturée — acier, laiton, cuivre, titane
const SHAPES = {
  I: { coords: [[-1,0], [0,0], [1,0], [2,0]], color: 0x8ab0c8 }, // acier bleu
  O: { coords: [[0,0], [1,0], [0,1], [1,1]],  color: 0xc8b87a }, // laiton
  T: { coords: [[0,0], [1,0], [2,0], [1,1]],  color: 0x9c8fb5 }, // titane violet
  S: { coords: [[1,0], [2,0], [0,1], [1,1]],  color: 0x7aad8a }, // bronze vert
  Z: { coords: [[0,0], [1,0], [1,1], [2,1]],  color: 0xc07a7a }, // cuivre oxydé
  J: { coords: [[0,0], [0,1], [1,1], [2,1]],  color: 0x7a8fad }, // fer bleu
  L: { coords: [[2,0], [0,1], [1,1], [2,1]],  color: 0xb89a70 }  // bronze chaud
};

const POINTS = [0, 100, 300, 500, 800];

const CONFIG = {
  particles: {
    tetrahedronRadius: 0.09,
    tetrahedronDetail: 0,
    velocityRangeXY: 0.35,
    velocityRangeZ: 0.15,
    gravity: 0.012,
    decayRate: 1.8,
    scaleDecay: 0.97,
    rotationX: 0.04,
    rotationY: 0.03,
    defaultCount: 8,
    clearLineCount: 4
  },
  preview: {
    x: -3,
    nextY: 17,
    holdY: 3
  },
  gameplay: {
    minDropInterval: 100,
    levelDropStep: 75,
    levelLinesStep: 10,
    softDropScore: 1,
    hardDropScore: 2
  },
  effects: {
    lineClearFlashIntensity: 100,
    lineClearFlashDurationMs: 100,
    hudScoreFlashDurationMs: 450
  }
};

// --- 3. PARTICLE SYSTEM CLASS ---
class ParticleSystem {
  constructor(scene) {
    this.scene    = scene;
    this.particles = [];
    this.materialCache = new Map();
    this.geometry = new THREE.TetrahedronGeometry(
      CONFIG.particles.tetrahedronRadius,
      CONFIG.particles.tetrahedronDetail
    );
  }

  getMaterial(color) {
    if (!this.materialCache.has(color)) {
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.4,
        metalness: 0.85,
        transparent: true,
        opacity: 1
      });
      this.materialCache.set(color, material);
    }

    return this.materialCache.get(color);
  }

  emit(position, color, count = CONFIG.particles.defaultCount) {
    for (let i = 0; i < count; i++) {
      const material = this.getMaterial(color);
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.position.copy(position);
      mesh.rotation.set(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2
      );

      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * CONFIG.particles.velocityRangeXY,
        (Math.random() - 0.5) * CONFIG.particles.velocityRangeXY,
        (Math.random() - 0.5) * CONFIG.particles.velocityRangeZ
      );

      this.particles.push({ mesh, vel, life: 1.0 });
      this.scene.add(mesh);
    }
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.mesh.position.add(p.vel);
      p.vel.y         -= CONFIG.particles.gravity;
      p.life          -= dt * CONFIG.particles.decayRate;
      p.mesh.scale.multiplyScalar(CONFIG.particles.scaleDecay);
      p.mesh.rotation.x += CONFIG.particles.rotationX;
      p.mesh.rotation.y += CONFIG.particles.rotationY;

      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        this.particles.splice(i, 1);
      }
    }
  }

  clear() {
    this.particles.forEach(p => {
      this.scene.remove(p.mesh);
    });
    this.particles = [];
  }

  destroy() {
    this.clear();
    this.materialCache.forEach(material => material.dispose());
    this.materialCache.clear();
    this.geometry.dispose();
  }
}

// --- 4. MAIN GAME CLASS ---
class TetrisGame {
  constructor() {
    this.scene    = null;
    this.camera   = null;
    this.renderer = null;

    this.grid     = this.createEmptyGrid();
    this.meshGrid = this.createMeshGrid();

    this.currentPiece = null;
    this.nextPiece    = null;
    this.heldPiece    = null;
    this.canHold      = true;

    this.score        = 0;
    this.level        = 1;
    this.linesCleared = 0;

    this.dropInterval = 1000;
    this.dropCounter  = 0;
    this.lastTime     = 0;

    this.isPaused   = false;
    this.isGameOver = false;

    this.particles      = null;
    this.ghostMeshes    = [];
    this.nextPieceMeshes = [];
    this.holdPieceMeshes = [];
    this.bgMaterial = null;
    this.randomTexture = null;
    this.materialsByColor = null;
    this.tempBlockMaterial = null;
    this.rafId = null;

    this.boundResizeHandler = () => this.onResize();
    this.boundKeydownHandler = (e) => this.handleInput(e);

    this.init();
  }

  // ─── INIT ────────────────────────────────────────────────────────────────

  init() {
    // Scène
    this.scene = new THREE.Scene();
    this.createBackgroundShader();
    this.randomTexture = this.createRandomTexture();
    this.initMaterials();

    // Caméra
    const aspect = window.innerWidth / window.innerHeight;
    this.camera  = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
    this.camera.position.set(4.5, 10, 25);
    this.camera.lookAt(4.5, 10, 0);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace  = THREE.SRGBColorSpace;
    this.renderer.toneMapping       = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2; // Légère augmentation d'exposition

    const container = document.getElementById('canvas-container');
    if (container) container.appendChild(this.renderer.domElement);
    else           document.body.appendChild(this.renderer.domElement);

    this.addLights();
    this.createBorder();
    this.particles = new ParticleSystem(this.scene);

    this.initGhostMeshes();
    this.initNextPieceMeshes();
    this.initHoldPieceMeshes();
    this.initMeshGridScene();

    window.addEventListener('resize', this.boundResizeHandler);
    window.addEventListener('keydown', this.boundKeydownHandler);

    this.nextPiece = this.getRandomPiece();
    this.spawnPiece();
  }

  createRandomTexture() {
    const size = 256;
    const data = new Uint8Array(size * size * 4);

    for (let i = 0; i < size * size; i++) {
      const val = Math.floor(Math.random() * 256);
      data[i * 4] = val;
      data[i * 4 + 1] = val;
      data[i * 4 + 2] = val;
      data[i * 4 + 3] = 255;
    }

    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.needsUpdate = true;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  initMaterials() {
    this.materialsByColor = {};
    const veinSpeed = 0.5;
    const veinColor = new THREE.Color(0xff0000);
    const veinBrightness = 1.0;
    const veinResolution = new THREE.Vector2(1.0, 1.0);

    const fragmentShader = `
      precision highp float;
      precision highp int;

      uniform float time;
      uniform float veinSpeed;
      uniform vec3 veinColor;
      uniform float veinBrightness;
      uniform vec3 baseColor;
      uniform vec2 veinResolution;
      uniform sampler2D randomTexture;

      varying vec2 vUv;

      vec3 saturate(vec3 i) {
        return clamp(i, 0.0, 1.0);
      }

      float saturate(float i) {
        return clamp(i, 0.0, 1.0);
      }

      float expCurve(float x, float lv) {
        return sign(0.5 - x) * (exp(-abs(x - 0.5) * lv) - 1.0) * 0.5 + 0.5;
      }

      vec4 noise(vec2 uv, vec2 mul, vec2 off, float iter, float lacu) {
        vec4 sum = vec4(0.0);
        for (float i = 0.0; i < 99.0; i += 1.0) {
          vec2 uv0 = (uv * mul + off) * 0.01 * exp(i * lacu) + time * veinSpeed * i * 0.01;
          vec2 uv1 = ((uv + vec2(1.0, 0.0)) * mul + off) * 0.01 * exp(i * lacu) + time * veinSpeed * i * 0.01;
          vec4 tex0 = texture2D(randomTexture, uv0);
          vec4 tex1 = texture2D(randomTexture, uv1);
          vec4 tex = mix(tex1, tex0, expCurve(uv.x, 10.0));
          sum += tex / pow(2.0, i + 1.0);
          if (iter < i) {
            break;
          }
        }
        return sum;
      }

      void main() {
        vec2 uv = mod(vUv.xy / veinResolution, 1.0);
        uv = mod(uv + vec2(0.5, 0.0), 1.0);

        vec3 col1 = vec3(0.0);
        float line = 0.0;

        for (float i = 0.0; i < 8.5; i += 1.0) {
          vec2 mul = vec2(exp(i * 0.3));
          vec2 off = vec2(i * 423.1);

          float lineL = 1.0 - abs(noise(uv, mul * vec2(2.0, 1.5), off, 2.0, 0.4).x - 0.5) * 2.0;
          float lineS = 1.0 - abs(noise(uv, mul * vec2(14.0), off + 10.0, 6.0, 0.7).x - 0.5) * 2.0;

          float lineT = expCurve(pow(lineL, 200.0), 7.0);
          lineT += pow(lineL, 12.0) * expCurve(pow(lineS, 40.0), 10.0);
          lineT = saturate(lineT);
          lineT *= expCurve(noise(uv, mul * 7.0, off + 20.0, 6.0, 1.0).x * 0.88, 20.0);

          line += lineT * exp(-i * 0.1);
        }

        line = saturate(line);

        col1 = vec3(0.5) * baseColor;

        col1 = mix(
          col1,
          baseColor * 0.8,
          expCurve(noise(uv, vec2(4.0), vec2(40.0), 5.0, 0.7).x * 0.7, 14.0)
        );

        col1 = mix(
          col1,
          baseColor * 0.8,
          expCurve(noise(uv, vec2(4.0), vec2(50.0), 5.0, 0.7).x * 0.7, 5.0) * 0.7
        );

        col1 = mix(col1, veinColor * veinBrightness, line);
        gl_FragColor = vec4(col1, 1.0);
      }
    `;

    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const colors = new Set(Object.values(SHAPES).map((shape) => shape.color));
    colors.forEach((colorHex) => {
      const baseColor = new THREE.Color(colorHex);
      this.materialsByColor[colorHex] = new THREE.ShaderMaterial({
        uniforms: {
          time: { value: 0 },
          veinSpeed: { value: veinSpeed },
          veinColor: { value: veinColor },
          veinBrightness: { value: veinBrightness },
          baseColor: { value: baseColor },
          veinResolution: { value: veinResolution },
          randomTexture: { value: this.randomTexture }
        },
        vertexShader,
        fragmentShader
      });
    });
  }

  addLights() {
    // 1. Hemisphere Light : Simule la lumière du ciel ET du sol
    // Intensité montée à 2.0 pour inonder la scène de lumière blanche
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x888888, 2.0);
    this.scene.add(hemiLight);
    
    // 2. Ambient Light : Une base de lumière absolue sans direction (pas d'ombres noires)
    const ambLight = new THREE.AmbientLight(0xffffff, 1.5); 
    this.scene.add(ambLight);
    
    // 3. Directional Light : Le "projecteur" principal pour les reflets métalliques
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(10, 20, 15); // Décalé pour créer des reflets anguleux
    this.scene.add(dirLight);

    // 4. PointLight : Suit la pièce pour un éclairage dynamique
    this.playerLight = new THREE.PointLight(0xffffff, 30, 40);
    this.scene.add(this.playerLight);
  }

  createBackgroundShader() {
    const geometry = new THREE.PlaneGeometry(120, 120);
    const uniforms = {
      iTime: { value: 0 },
      iResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }
    };

    const fragmentShader = `
      precision highp float;
      precision highp int;

      uniform float iTime;
      uniform vec2 iResolution;

      #define N(a) abs(dot( sin( iTime + .1*path.z + .3*path/a) , vec3(a+a)) )

      float sin_adj(float a, float speed, float height_factor, float displacement) {
          float r = sin(a * speed);
          r *= height_factor;
          r += displacement;
          return r;
      }

      float tri(float a) {
          return mix(mod(a,1.),-mod(a,1.)+1.,step(.5,mod(a,1.)));
      }

      float tri_adj(float a, float speed, float height_factor, float displacement) {
          float r = tri(a * speed);
          r *= height_factor;
          r += displacement;
          return r;
      }

      vec3 color_day(float s) { return vec3(4.,2.,1.)/s; }

      vec3 color_rainbowish(float i, float s) {
          vec3 c = vec3(3.,1.,5.);
          c += (1. + cos(tri_adj(iTime, .04, .5, .1)*i + vec3(2.,1.,0.)))/s;
          return c;
      }

      vec3 color_night(float i, float s) {
          vec3 c = vec3(3.,1.,5.);
          c += (1. + cos(.2*i + vec3(2.,1.,0.)))/s;
          return c;
      }

      void mainImage(out vec4 o, vec2 uv) {
          float base_iterations = 100.;
          float iterations = 50.;
          float adjust_str = iterations/2./(base_iterations/iterations);

          o = vec4(0.);

          uv = ( (uv+uv) - iResolution.xy ) / iResolution.y;

          if (abs(uv.y) > .8) {
             o = vec4(0.);
             return;
          }

          vec3 path = vec3(0.);

          for(float i = 0., s = 0.; i < iterations; i += 1.) {
              float adjust = i/adjust_str;
              vec3 added_path = vec3(uv * s, s);
              added_path *= adjust;
              path += added_path;

              s = .1 + .2 * abs( 6.-abs(path.y) - N(.08) - N(.2) - N(.6) );

              vec3 added_color = mix(color_night(i, s), color_day(s), sin(iTime*.1+60.)*.5+.5);
              added_color *= adjust;
              o.rgb += added_color;
          }

          float lenUV = length(uv);
          if (lenUV < 0.001) lenUV = 0.001;

          o = tanh(o*o/2e6/lenUV);
      }

      void main() {
          mainImage(gl_FragColor, gl_FragCoord.xy);
      }
    `;

    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(GRID_WIDTH / 2 - 0.5, GRID_HEIGHT / 2 - 0.5, -34);
    this.scene.add(mesh);
    this.bgMaterial = material;
  }

  // ─── GRID ────────────────────────────────────────────────────────────────

  createEmptyGrid() {
    return Array.from({ length: GRID_WIDTH }, () => Array(GRID_HEIGHT).fill(0));
  }

  createMeshGrid() {
    const meshes = [];
    const geo    = new THREE.BoxGeometry(
      BLOCK_SIZE - BLOCK_GAP,
      BLOCK_SIZE - BLOCK_GAP,
      BLOCK_SIZE - BLOCK_GAP
    );
    this.tempBlockMaterial = new THREE.MeshStandardMaterial({ color: 0x888899 });

    for (let x = 0; x < GRID_WIDTH; x++) {
      meshes[x] = [];
      for (let y = 0; y < GRID_HEIGHT; y++) {
        const mesh = new THREE.Mesh(geo, this.tempBlockMaterial);
        mesh.position.set(x, y, 0);
        mesh.visible = false;
        meshes[x][y] = mesh;
      }
    }
    return meshes;
  }

  initMeshGridScene() {
    for (let x = 0; x < GRID_WIDTH; x++) {
      for (let y = 0; y < GRID_HEIGHT; y++) {
        this.scene.add(this.meshGrid[x][y]);
      }
    }
  }

  // ─── BORDER ──────────────────────────────────────────────────────────────

  createBorder() {
    // Cadre
    const borderGeo = new THREE.BoxGeometry(GRID_WIDTH + 0.2, GRID_HEIGHT + 0.2, 0.5);
    const edges     = new THREE.EdgesGeometry(borderGeo);
    const line      = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x555566 }) // Cadre visible mais discret
    );
    line.position.set(GRID_WIDTH / 2 - 0.5, GRID_HEIGHT / 2 - 0.5, -0.5);
    this.scene.add(line);

    // Fond du plateau : GRIS CLAIR METAL
    // C'est la clé pour ne plus avoir l'impression de jouer dans le noir.
    const backGeo = new THREE.PlaneGeometry(GRID_WIDTH, GRID_HEIGHT);
    const backMat = new THREE.MeshStandardMaterial({
      color:     0x3a3a42, // Gris métal brossé clair
      metalness: 0.6,
      roughness: 0.4,
    });
    const background = new THREE.Mesh(backGeo, backMat);
    background.position.set(GRID_WIDTH / 2 - 0.5, GRID_HEIGHT / 2 - 0.5, -0.6);
    this.scene.add(background);
  }

  // ─── GHOST / NEXT / HOLD MESHES ──────────────────────────────────────────

  initGhostMeshes() {
    const geo = new THREE.BoxGeometry(
      BLOCK_SIZE - BLOCK_GAP,
      BLOCK_SIZE - BLOCK_GAP,
      BLOCK_SIZE - BLOCK_GAP
    );
    const mat = new THREE.MeshBasicMaterial({
      color:       0x000000, // Noir pour contraster avec le fond gris
      transparent: true,
      opacity:     0.15,
      wireframe:   true
    });

    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(geo, mat.clone());
      mesh.visible = false;
      this.scene.add(mesh);
      this.ghostMeshes.push(mesh);
    }
  }

  initNextPieceMeshes() {
    const geo = new THREE.BoxGeometry(
      BLOCK_SIZE - BLOCK_GAP,
      BLOCK_SIZE - BLOCK_GAP,
      BLOCK_SIZE - BLOCK_GAP
    );
    for (let i = 0; i < 4; i++) {
      const mat  = new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.95 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.nextPieceMeshes.push(mesh);
    }
  }

  initHoldPieceMeshes() {
    const geo = new THREE.BoxGeometry(
      BLOCK_SIZE - BLOCK_GAP,
      BLOCK_SIZE - BLOCK_GAP,
      BLOCK_SIZE - BLOCK_GAP
    );
    for (let i = 0; i < 4; i++) {
      const mat  = new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.95 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.holdPieceMeshes.push(mesh);
    }
  }

  // ─── PIECE LOGIC ─────────────────────────────────────────────────────────

  getRandomPiece() {
    const keys    = Object.keys(SHAPES);
    const randKey = keys[Math.floor(Math.random() * keys.length)];
    return {
      type:   randKey,
      coords: SHAPES[randKey].coords.map(c => [...c]),
      color:  SHAPES[randKey].color
    };
  }

  spawnPiece() {
    this.currentPiece = this.nextPiece || this.getRandomPiece();
    this.nextPiece    = this.getRandomPiece();
    this.canHold      = true;

    this.currentPiece.x = Math.floor(GRID_WIDTH / 2) - 1;
    this.currentPiece.y = GRID_HEIGHT - 2;
    if (this.currentPiece.type === 'I') this.currentPiece.x--;

    if (this.checkCollision(0, 0, this.currentPiece)) {
      this.gameOver();
    }

    this.updateNextPieceVisuals();
  }

  gameOver() {
    this.isGameOver = true;
    const msg = document.getElementById('game-over-msg');
    if (msg) msg.style.display = 'flex';
  }

  resetGame() {
    this.grid         = this.createEmptyGrid();
    this.score        = 0;
    this.level        = 1;
    this.linesCleared = 0;
    this.dropInterval = 1000;
    this.isGameOver   = false;
    this.isPaused     = false;
    this.heldPiece    = null;

    const msgEl   = document.getElementById('game-over-msg');
    const pauseEl = document.getElementById('pause-msg');

    this.updateHud();
    if (msgEl)   msgEl.style.display   = 'none';
    if (pauseEl) pauseEl.style.display = 'none';

    for (let x = 0; x < GRID_WIDTH; x++) {
      for (let y = 0; y < GRID_HEIGHT; y++) {
        this.meshGrid[x][y].visible = false;
      }
    }

    this.particles.clear();

    this.nextPiece = this.getRandomPiece();
    this.spawnPiece();
  }

  checkCollision(dx, dy, piece) {
    const p = piece || this.currentPiece;
    for (let block of p.coords) {
      const newX = p.x + block[0] + dx;
      const newY = p.y + block[1] + dy;
      if (newX < 0 || newX >= GRID_WIDTH || newY < 0 || newY >= GRID_HEIGHT) return true;
      if (this.grid[newX][newY]) return true;
    }
    return false;
  }

  mergePiece() {
    for (let block of this.currentPiece.coords) {
      const x = this.currentPiece.x + block[0];
      const y = this.currentPiece.y + block[1];
      if (y >= 0 && y < GRID_HEIGHT && x >= 0 && x < GRID_WIDTH) {
        this.grid[x][y] = this.currentPiece.color;
      }
    }
    this.checkLines();
    this.spawnPiece();
  }

  checkLines() {
    const linesToClear = [];

    for (let y = 0; y < GRID_HEIGHT; y++) {
      let full = true;
      for (let x = 0; x < GRID_WIDTH; x++) {
        if (!this.grid[x][y]) { full = false; break; }
      }
      if (full) linesToClear.push(y);
    }

    const lines = linesToClear.length;

    const linesToClearSet = new Set(linesToClear);

    if (lines > 0) {
      linesToClear.forEach(y => {
        for (let x = 0; x < GRID_WIDTH; x++) {
          const pos = new THREE.Vector3(x, y, 0);
          this.particles.emit(pos, this.grid[x][y] || 0x8090a0, CONFIG.particles.clearLineCount);
        }
      });

      let newGrid      = this.createEmptyGrid();
      let currentWriteY = 0;
      for (let y = 0; y < GRID_HEIGHT; y++) {
        if (!linesToClearSet.has(y)) {
          for (let x = 0; x < GRID_WIDTH; x++) {
            newGrid[x][currentWriteY] = this.grid[x][y];
          }
          currentWriteY++;
        }
      }
      this.grid = newGrid;

      this.score        += (POINTS[lines] || 0) * this.level;
      this.linesCleared += lines;

      const newLevel = Math.floor(this.linesCleared / CONFIG.gameplay.levelLinesStep) + 1;
      if (newLevel > this.level) {
        this.level        = newLevel;
        this.dropInterval = Math.max(
          CONFIG.gameplay.minDropInterval,
          1000 - (this.level - 1) * CONFIG.gameplay.levelDropStep
        );
      }

      this.updateHud({ flashScore: true });

      // Flash blanc neutre
      const base = this.playerLight.intensity;
      this.playerLight.intensity = CONFIG.effects.lineClearFlashIntensity;
      setTimeout(() => { this.playerLight.intensity = base; }, CONFIG.effects.lineClearFlashDurationMs);
    }
  }

  rotatePiece() {
    const newCoords    = this.currentPiece.coords.map(c => [-c[1], c[0]]);
    const backupCoords = this.currentPiece.coords;
    this.currentPiece.coords = newCoords;

    const kicks = [0, -1, 1, -2, 2];
    let valid   = false;
    for (let kick of kicks) {
      if (!this.checkCollision(kick, 0)) {
        this.currentPiece.x += kick;
        valid = true;
        break;
      }
    }
    if (!valid) this.currentPiece.coords = backupCoords;
  }

  holdPiece() {
    if (!this.canHold) return;
    this.canHold = false;
    const currentType = this.currentPiece.type;

    if (this.heldPiece) {
      const temp   = this.heldPiece;
      this.heldPiece = {
        type:   currentType,
        coords: SHAPES[currentType].coords.map(c => [...c]),
        color:  SHAPES[currentType].color
      };
      this.currentPiece   = temp;
      this.currentPiece.x = Math.floor(GRID_WIDTH / 2) - 1;
      this.currentPiece.y = GRID_HEIGHT - 2;
      if (this.currentPiece.type === 'I') this.currentPiece.x--;
      if (this.checkCollision(0, 0, this.currentPiece)) {
        this.gameOver();
      }
    } else {
      this.heldPiece = {
        type:   currentType,
        coords: SHAPES[currentType].coords.map(c => [...c]),
        color:  SHAPES[currentType].color
      };
      this.spawnPiece();
    }

    this.updateHoldPieceVisuals();
  }

  // ─── VISUALS ─────────────────────────────────────────────────────────────

  updateGhostPosition() {
    let dropDist = 0;
    while (!this.checkCollision(0, -(dropDist + 1))) dropDist++;

    const p = this.currentPiece;
    for (let i = 0; i < 4; i++) {
      const block = p.coords[i];
      const mesh  = this.ghostMeshes[i];
      mesh.position.set(p.x + block[0], (p.y + block[1]) - dropDist, -0.1);
      mesh.visible = true;
    }
  }

  updateNextPieceVisuals() {
    if (!this.nextPiece) return;
    const baseX = CONFIG.preview.x;
    const baseY = CONFIG.preview.nextY;

    for (let i = 0; i < 4; i++) {
      const block = this.nextPiece.coords[i];
      const mesh  = this.nextPieceMeshes[i];
      mesh.position.set(baseX + block[0], baseY + block[1], 0);
      mesh.material.color.setHex(this.nextPiece.color);
      mesh.visible = true;
    }
  }

  updateHoldPieceVisuals() {
    this.holdPieceMeshes.forEach(m => m.visible = false);
    if (!this.heldPiece) return;

    const baseX = CONFIG.preview.x;
    const baseY = CONFIG.preview.holdY;

    for (let i = 0; i < 4; i++) {
      const block = this.heldPiece.coords[i];
      const mesh  = this.holdPieceMeshes[i];
      mesh.position.set(baseX + block[0], baseY + block[1], 0);
      mesh.material.color.setHex(this.heldPiece.color);
      mesh.visible = true;
    }
  }

  updateGraphics() {
    // --- Blocs figés ---
    for (let x = 0; x < GRID_WIDTH; x++) {
      for (let y = 0; y < GRID_HEIGHT; y++) {
        const mesh = this.meshGrid[x][y];
        const val  = this.grid[x][y];

        if (val) {
          mesh.visible = true;
          mesh.material = this.materialsByColor[val];
        } else {
          mesh.visible = false;
        }
      }
    }

    // --- Pièce courante ---
    const p = this.currentPiece;
    if (p) {
      for (let block of p.coords) {
        const x = p.x + block[0];
        const y = p.y + block[1];

        if (y >= 0 && y < GRID_HEIGHT && x >= 0 && x < GRID_WIDTH) {
          const mesh = this.meshGrid[x][y];
          mesh.visible = true;
          mesh.material = this.materialsByColor[p.color];
        }
      }
    }
  }

  // ─── LOOP ────────────────────────────────────────────────────────────────

  animate(time) {
    this.rafId = requestAnimationFrame((t) => this.animate(t));

    const deltaTime = time - this.lastTime;
    this.lastTime   = time;

    this.particles.update(deltaTime / 1000);
    if (this.bgMaterial) {
      this.bgMaterial.uniforms.iTime.value = time / 1000;
    }

    if (this.materialsByColor) {
      Object.values(this.materialsByColor).forEach((mat) => {
        if (mat.uniforms.time) {
          mat.uniforms.time.value = time / 1000;
        }
      });
    }

    if (!this.isPaused && !this.isGameOver) {
      this.dropCounter += deltaTime;
      if (this.dropCounter > this.dropInterval) {
        if (!this.checkCollision(0, -1)) {
          this.currentPiece.y--;
        } else {
          this.mergePiece();
        }
        this.dropCounter = 0;
      }

      if (this.currentPiece) {
        this.playerLight.position.set(
          this.currentPiece.x + 0.5,
          this.currentPiece.y + 0.5,
          2.0 // Plus proche pour bien éclairer
        );
      }

      this.updateGhostPosition();
      this.updateGraphics();
    }

    this.renderer.render(this.scene, this.camera);
  }

  handleInput(e) {
    if (this.isGameOver) {
      if (e.key === ' ') { e.preventDefault(); this.resetGame(); }
      return;
    }

    if (e.key === 'p' || e.key === 'P') {
      this.isPaused = !this.isPaused;
      const pauseEl = document.getElementById('pause-msg');
      if (pauseEl) pauseEl.style.display = this.isPaused ? 'flex' : 'none';
      return;
    }

    if (this.isPaused) return;

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        if (!this.checkCollision(-1, 0)) this.currentPiece.x--;
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (!this.checkCollision(1, 0)) this.currentPiece.x++;
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (!this.checkCollision(0, -1)) {
          this.currentPiece.y--;
          this.score += CONFIG.gameplay.softDropScore;
          this.updateHud();
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.rotatePiece();
        break;
      case ' ':
        e.preventDefault();
        while (!this.checkCollision(0, -1)) {
          this.currentPiece.y--;
          this.score += CONFIG.gameplay.hardDropScore;
        }
        this.updateHud();
        this.mergePiece();
        this.dropCounter = 0;
        break;
      case 'c':
      case 'C':
        e.preventDefault();
        this.holdPiece();
        break;
    }
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    if (this.bgMaterial) {
      this.bgMaterial.uniforms.iResolution.value.set(window.innerWidth, window.innerHeight);
    }
  }

  updateHud({ flashScore = false } = {}) {
    const scoreEl = document.getElementById('val-score');
    const levelEl = document.getElementById('val-level');
    const linesEl = document.getElementById('val-lines');

    if (scoreEl) {
      scoreEl.innerText = this.score;
      if (flashScore) {
        scoreEl.classList.add('value-update-flash');
        setTimeout(() => scoreEl.classList.remove('value-update-flash'), CONFIG.effects.hudScoreFlashDurationMs);
      }
    }
    if (levelEl) levelEl.innerText = this.level;
    if (linesEl) linesEl.innerText = this.linesCleared;
  }

  destroy() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    window.removeEventListener('resize', this.boundResizeHandler);
    window.removeEventListener('keydown', this.boundKeydownHandler);

    if (this.particles) {
      this.particles.destroy();
    }

    if (this.materialsByColor) {
      Object.values(this.materialsByColor).forEach((material) => material.dispose());
      this.materialsByColor = null;
    }

    if (this.randomTexture) {
      this.randomTexture.dispose();
      this.randomTexture = null;
    }

    if (this.tempBlockMaterial) {
      this.tempBlockMaterial.dispose();
      this.tempBlockMaterial = null;
    }
  }
}

// --- 5. ENTRY POINT ---
function initGame() {
  const game       = new TetrisGame();
  const startModal = document.getElementById('start-modal');
  const playButton = document.getElementById('play-button');

  if (playButton && startModal) {
    playButton.addEventListener('click', () => {
      startModal.style.opacity    = '0';
      startModal.style.transition = 'opacity 0.5s ease';
      setTimeout(() => {
        startModal.style.display = 'none';
        game.animate(0);
      }, 500);
    });
  } else {
    console.warn("Modal or Play button not found, starting game directly.");
    game.animate(0);
  }
}


initGame();
