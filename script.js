const THREE_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.161.0/three.module.min.js';
const THREE_CDN_SHA384 = 'sha384-NKwB8sp2fZuqIEwge6UnAPbF+IlD950MxlARvyNhNXc/eMvBtfOKg8MASoHligwZ';

async function importModuleWithIntegrity(url, expectedIntegrity) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`Unable to download module (${response.status} ${response.statusText})`);
  }

  const source = await response.text();
  const hashBuffer = await crypto.subtle.digest('SHA-384', new TextEncoder().encode(source));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashBase64 = btoa(String.fromCharCode(...hashArray));
  const actualIntegrity = `sha384-${hashBase64}`;

  if (actualIntegrity !== expectedIntegrity) {
    throw new Error(`Integrity mismatch for ${url}`);
  }

  const moduleBlob = new Blob([source], { type: 'text/javascript' });
  const moduleUrl = URL.createObjectURL(moduleBlob);

  try {
    return await import(moduleUrl);
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
}

(async function loadThreeJS() {
  try {
    const THREE_MODULE = await importModuleWithIntegrity(THREE_CDN_URL, THREE_CDN_SHA384);
    window.THREE = THREE_MODULE;
    initGame();
  } catch (error) {
    console.error("Failed to load Three.js module:", error);
    const errorBox = document.createElement('div');
    errorBox.style.color = '#c0392b';
    errorBox.style.textAlign = 'center';
    errorBox.style.padding = '50px';
    errorBox.style.fontFamily = 'sans-serif';
    errorBox.textContent = 'Erreur: Impossible de charger Three.js.';

    document.body.innerHTML = '';
    document.body.appendChild(errorBox);
  }
})();

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
  environment: {
    terrainSize: 58,
    terrainResolution: 72,
    crystalCount: 36,
    starCount: 1200,
    terrainBaseY: -5,
    crystalColors: [0xff4d8f, 0x40f2b0, 0x58c7ff, 0xffba3b]
  },
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
    this.backgroundTerrain = null;
    this.backgroundCrystals = [];
    this.backgroundStars = null;
    this.postScene = null;
    this.postCamera = null;
    this.raymarchMaterial = null;
    this.gridTexture = null;
    this.gridTextureData = new Uint8Array(GRID_WIDTH * GRID_HEIGHT * 4);
    this.rafId = null;

    this.boundResizeHandler = () => this.onResize();
    this.boundKeydownHandler = (e) => this.handleInput(e);

    this.init();
  }

  // ─── INIT ────────────────────────────────────────────────────────────────

  init() {
    // Scène
    this.scene = new THREE.Scene();
    this.createProceduralBackground();

    // Brouillard très léger, presque inexistant pour la clarté
    this.scene.fog = new THREE.FogExp2(0x1a1a20, 0.008);

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
    this.initRaymarchRenderer();
    this.particles = new ParticleSystem(this.scene);

    this.initGhostMeshes();
    this.initNextPieceMeshes();
    this.initHoldPieceMeshes();
    this.initMeshGridScene();

    window.addEventListener('resize', this.boundResizeHandler);
    window.addEventListener('keydown', this.boundKeydownHandler);

    this.nextPiece = this.getRandomPiece();
    this.spawnPiece();
    this.updateGridTexture();
  }

  initRaymarchRenderer() {
    this.postScene = new THREE.Scene();
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.gridTexture = new THREE.DataTexture(
      this.gridTextureData,
      GRID_WIDTH,
      GRID_HEIGHT,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    this.gridTexture.magFilter = THREE.NearestFilter;
    this.gridTexture.minFilter = THREE.NearestFilter;
    this.gridTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.gridTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.gridTexture.needsUpdate = true;

    this.raymarchMaterial = new THREE.ShaderMaterial({
      uniforms: {
        iTime: { value: 0 },
        iResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        uGrid: { value: this.gridTexture }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform float iTime;
        uniform vec2 iResolution;
        uniform sampler2D uGrid;
        varying vec2 vUv;

        #define MAX_STEPS 110
        #define MAX_DIST 90.0
        #define SURF_DIST 0.0015

        float sdBox(vec3 p, vec3 b) {
          vec3 q = abs(p) - b;
          return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
        }

        float cellFilled(vec2 cell) {
          if (cell.x < 0.0 || cell.x >= 10.0 || cell.y < 0.0 || cell.y >= 20.0) return 0.0;
          vec2 uv = (cell + vec2(0.5)) / vec2(10.0, 20.0);
          return step(0.05, texture2D(uGrid, uv).a);
        }

        vec3 cellColor(vec2 cell) {
          vec2 uv = (cell + vec2(0.5)) / vec2(10.0, 20.0);
          return texture2D(uGrid, uv).rgb;
        }

        float mapScene(vec3 p, out vec3 albedo, out float emissive) {
          float board = sdBox(p - vec3(4.5, 9.5, -0.45), vec3(5.6, 10.6, 0.22));
          float floorD = p.y + 2.0;
          float d = min(board, floorD);
          albedo = vec3(0.08, 0.10, 0.15);
          emissive = 0.0;

          vec2 cell = floor(p.xy + vec2(0.5));
          if (cellFilled(cell) > 0.5) {
            vec3 center = vec3(cell.x, cell.y, 0.0);
            float blockD = sdBox(p - center, vec3(0.47));
            if (blockD < d) {
              d = blockD;
              vec3 c = cellColor(cell);
              albedo = mix(c, vec3(0.55, 0.85, 1.0), 0.22);
              emissive = 0.55;
            }
          }

          return d;
        }

        float rayMarch(vec3 ro, vec3 rd, out vec3 albedo, out float emissive) {
          float dist = 0.0;
          for (int i = 0; i < MAX_STEPS; i++) {
            vec3 p = ro + rd * dist;
            vec3 stepAlbedo;
            float stepEmissive;
            float ds = mapScene(p, stepAlbedo, stepEmissive);
            dist += ds;
            if (dist > MAX_DIST || abs(ds) < SURF_DIST) {
              albedo = stepAlbedo;
              emissive = stepEmissive;
              break;
            }
          }
          return dist;
        }

        vec3 getNormal(vec3 p) {
          vec2 e = vec2(0.002, 0.0);
          vec3 a; float ea;
          float d = mapScene(p, a, ea);
          vec3 n = d - vec3(
            mapScene(p - e.xyy, a, ea),
            mapScene(p - e.yxy, a, ea),
            mapScene(p - e.yyx, a, ea)
          );
          return normalize(n);
        }

        float softShadow(vec3 ro, vec3 rd, float mint, float maxt) {
          float res = 1.0;
          float t = mint;
          for (int i = 0; i < 34; i++) {
            vec3 p = ro + rd * t;
            vec3 al; float em;
            float h = mapScene(p, al, em);
            res = min(res, 14.0 * h / t);
            t += clamp(h, 0.01, 0.15);
            if (h < 0.001 || t > maxt) break;
          }
          return clamp(res, 0.0, 1.0);
        }

        void main() {
          vec2 fragCoord = vUv * iResolution;
          vec2 uv = (fragCoord - 0.5 * iResolution) / iResolution.y;

          vec3 ro = vec3(4.5 + sin(iTime * 0.2) * 0.2, 10.0, -17.0);
          vec3 rd = normalize(vec3(uv.x, uv.y - 0.06, 1.22));

          vec3 col = vec3(0.03, 0.04, 0.08);
          vec3 albedo = vec3(0.0);
          float emissive = 0.0;
          float d = rayMarch(ro, rd, albedo, emissive);

          if (d < MAX_DIST) {
            vec3 p = ro + rd * d;
            vec3 n = getNormal(p);
            vec3 lightPos = vec3(9.0, 22.0, -8.0);
            vec3 l = normalize(lightPos - p);
            vec3 v = normalize(ro - p);
            vec3 h = normalize(l + v);

            float diff = max(dot(n, l), 0.0);
            float spec = pow(max(dot(n, h), 0.0), 90.0);
            float rim = pow(1.0 - max(dot(n, v), 0.0), 2.6);
            float sh = softShadow(p + n * 0.02, l, 0.02, 40.0);

            col = albedo * (0.14 + diff * sh * 1.25) + spec * 0.95 + rim * 0.35;
            col += albedo * emissive * 0.7;

            float fog = 1.0 - exp(-0.012 * d * d);
            col = mix(col, vec3(0.03, 0.04, 0.08), fog);
          }

          col = col / (1.0 + col);
          col = pow(col, vec3(0.92));
          gl_FragColor = vec4(col, 0.98);
        }
      `,
      transparent: true,
      depthWrite: false
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.raymarchMaterial);
    this.postScene.add(quad);
  }

  updateGridTexture() {
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        let value = this.grid[x][y];

        if (!value && this.currentPiece) {
          for (let i = 0; i < this.currentPiece.coords.length; i++) {
            const [bx, by] = this.currentPiece.coords[i];
            if (this.currentPiece.x + bx === x && this.currentPiece.y + by === y) {
              value = this.currentPiece.color;
              break;
            }
          }
        }

        const idx = (y * GRID_WIDTH + x) * 4;
        if (value) {
          this.gridTextureData[idx] = (value >> 16) & 255;
          this.gridTextureData[idx + 1] = (value >> 8) & 255;
          this.gridTextureData[idx + 2] = value & 255;
          this.gridTextureData[idx + 3] = 255;
        } else {
          this.gridTextureData[idx] = 0;
          this.gridTextureData[idx + 1] = 0;
          this.gridTextureData[idx + 2] = 0;
          this.gridTextureData[idx + 3] = 0;
        }
      }
    }

    if (this.gridTexture) {
      this.gridTexture.needsUpdate = true;
    }
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

  createProceduralBackground() {
    const geo = new THREE.PlaneGeometry(120, 120);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        color1: { value: new THREE.Color(0x070912) },
        color2: { value: new THREE.Color(0x181d2a) },
        uTime: { value: 0 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 color1;
        uniform vec3 color2;
        uniform float uTime;
        varying vec2 vUv;

        void main() {
          float dist = distance(vUv, vec2(0.5, 0.45));
          float pulse = sin(uTime * 0.35) * 0.03;
          float vignette = smoothstep(0.1, 0.9, dist + pulse);
          float topGlow = smoothstep(0.65, 0.2, vUv.y) * 0.08;
          vec3 color = mix(color2, color1, vignette) + vec3(0.03, 0.04, 0.09) * topGlow;
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      depthWrite: false
    });

    const bg = new THREE.Mesh(geo, mat);
    bg.position.set(GRID_WIDTH / 2 - 0.5, GRID_HEIGHT / 2 - 0.5, -34);
    this.scene.add(bg);
    this.bgMaterial = mat;

    this.createEnvironmentTerrain();
    this.createEnvironmentCrystals();
    this.createEnvironmentStars();
  }

  getTerrainHeight(x, z) {
    return Math.sin(x * 0.28) * Math.cos(z * 0.25) * 1.9
      + Math.sin((x + z) * 0.18) * 1.1
      + Math.cos(z * 0.4) * 0.8;
  }

  createEnvironmentTerrain() {
    const width = CONFIG.environment.terrainSize;
    const depth = CONFIG.environment.terrainSize;
    const segments = CONFIG.environment.terrainResolution;
    const geometry = new THREE.PlaneGeometry(width, depth, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes.position;
    const colors = [];
    for (let i = 0; i < positions.count; i++) {
      const ix = i * 3;
      const x = positions.array[ix];
      const z = positions.array[ix + 2];
      const y = this.getTerrainHeight(x, z);
      positions.array[ix + 1] = y;

      const heightMix = THREE.MathUtils.clamp((y + 4) / 8, 0, 1);
      const terrainColor = new THREE.Color().setRGB(
        0.06 + heightMix * 0.13,
        0.08 + heightMix * 0.12,
        0.14 + heightMix * 0.17
      );
      colors.push(terrainColor.r, terrainColor.g, terrainColor.b);
    }

    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshPhongMaterial({
      vertexColors: true,
      shininess: 20,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide
    });

    this.backgroundTerrain = new THREE.Mesh(geometry, material);
    this.backgroundTerrain.position.set(GRID_WIDTH / 2 - 0.5, CONFIG.environment.terrainBaseY, -28);
    this.scene.add(this.backgroundTerrain);
  }

  createEnvironmentCrystals() {
    const centerX = GRID_WIDTH / 2 - 0.5;
    const group = new THREE.Group();

    for (let i = 0; i < CONFIG.environment.crystalCount; i++) {
      const isCone = Math.random() > 0.45;
      const geometry = isCone
        ? new THREE.ConeGeometry(0.2 + Math.random() * 0.25, 1 + Math.random() * 1.4, 5)
        : new THREE.CylinderGeometry(0.16, 0.28, 1.2 + Math.random() * 1.6, 6);

      const color = CONFIG.environment.crystalColors[
        Math.floor(Math.random() * CONFIG.environment.crystalColors.length)
      ];
      const material = new THREE.MeshPhongMaterial({
        color,
        emissive: 0x111111,
        shininess: 70,
        transparent: true,
        opacity: 0.82
      });

      const crystal = new THREE.Mesh(geometry, material);
      const angle = Math.random() * Math.PI * 2;
      const radius = 9 + Math.random() * 18;
      const localX = Math.cos(angle) * radius;
      const localZ = Math.sin(angle) * radius;
      const terrainY = this.getTerrainHeight(localX, localZ);

      crystal.position.set(
        centerX + localX,
        CONFIG.environment.terrainBaseY + terrainY + 1.4,
        -28 + localZ
      );
      crystal.rotation.x = (Math.random() - 0.5) * 0.25;
      crystal.rotation.z = (Math.random() - 0.5) * 0.25;
      crystal.rotation.y = Math.random() * Math.PI;
      crystal.userData = {
        speed: 0.35 + Math.random() * 0.4,
        phase: Math.random() * Math.PI * 2
      };

      this.backgroundCrystals.push(crystal);
      group.add(crystal);
    }

    this.scene.add(group);
  }

  createEnvironmentStars() {
    const count = CONFIG.environment.starCount;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const centerX = GRID_WIDTH / 2 - 0.5;

    for (let i = 0; i < count; i++) {
      const radius = 35 + Math.random() * 40;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      const x = radius * Math.sin(phi) * Math.cos(theta);
      const y = radius * Math.sin(phi) * Math.sin(theta);
      const z = radius * Math.cos(phi);

      positions[i * 3] = centerX + x;
      positions[i * 3 + 1] = y + 8;
      positions[i * 3 + 2] = -25 + z;

      const color = new THREE.Color().setHSL(0.56 + Math.random() * 0.2, 0.75, 0.6 + Math.random() * 0.25);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.12,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.backgroundStars = new THREE.Points(geometry, material);
    this.scene.add(this.backgroundStars);
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

    for (let x = 0; x < GRID_WIDTH; x++) {
      meshes[x] = [];
      for (let y = 0; y < GRID_HEIGHT; y++) {
        // Matériau par défaut : Gris acier brillant
        const mat = new THREE.MeshStandardMaterial({ 
            color: 0x888899,   
            roughness: 0.25,   
            metalness: 0.9     
        });
        const mesh = new THREE.Mesh(geo, mat);
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
          mesh.material.color.setHex(val);
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
          mesh.material.color.setHex(p.color);
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
      this.bgMaterial.uniforms.uTime.value = time / 1000;
    }
    if (this.raymarchMaterial) {
      this.raymarchMaterial.uniforms.iTime.value = time / 1000;
      this.raymarchMaterial.uniforms.iResolution.value.set(window.innerWidth, window.innerHeight);
    }
    if (this.backgroundStars) {
      this.backgroundStars.rotation.y += 0.00035;
    }
    if (this.backgroundCrystals.length > 0) {
      const elapsed = time / 1000;
      this.backgroundCrystals.forEach((crystal) => {
        const scale = 1 + Math.sin(elapsed * crystal.userData.speed + crystal.userData.phase) * 0.05;
        crystal.scale.setScalar(scale);
        crystal.rotation.y += 0.0025;
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
      this.updateGridTexture();
    }

    this.renderer.render(this.scene, this.camera);
    if (this.postScene && this.postCamera) {
      this.renderer.clearDepth();
      this.renderer.render(this.postScene, this.postCamera);
    }
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
    if (this.raymarchMaterial) {
      this.raymarchMaterial.uniforms.iResolution.value.set(window.innerWidth, window.innerHeight);
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
