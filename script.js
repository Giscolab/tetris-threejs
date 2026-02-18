import * as THREE from "https://esm.sh/three";
import { EffectComposer } from "https://esm.sh/three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "https://esm.sh/three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "https://esm.sh/three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "https://esm.sh/three/examples/jsm/postprocessing/UnrealBloomPass.js";


// --- 2. CONSTANTS & CONFIGURATION ---
const GRID_WIDTH  = 10;
const GRID_HEIGHT = 20;
const BLOCK_SIZE  = 1;
const BLOCK_GAP   = 0.05;

// Palette métallique désaturée — acier, laiton, cuivre, titane
const SHAPES = {
  I: { coords: [[-1,0], [0,0], [1,0], [2,0]], color: 0xFFD700 }, // Or (Gold)
  O: { coords: [[0,0], [1,0], [0,1], [1,1]],  color: 0xFB641E }, // Cuivre (Copper)
  T: { coords: [[0,0], [1,0], [2,0], [1,1]],  color: 0xE0E0E0 }, // Argent (Silver)
  S: { coords: [[1,0], [2,0], [0,1], [1,1]],  color: 0x00FF7F }, // Émeraude (Emerald)
  Z: { coords: [[0,0], [1,0], [1,1], [2,1]],  color: 0x1E90FF }, // Acier Bleu (Steel)
  J: { coords: [[0,0], [0,1], [1,1], [2,1]],  color: 0xE5E4E2 }, // Platine
  L: { coords: [[2,0], [0,1], [1,1], [2,1]],  color: 0xCD7F32 }  // Bronze
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
    nextAnchor: new THREE.Vector3(GRID_WIDTH + 0.8, GRID_HEIGHT - 1.5, -0.2),
    nextScale: 0.8
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
    hudScoreFlashDurationMs: 450,
    hitStopDuration: 0.05,
    cameraShakeDamping: 10,
    cameraShakeFrequency: 34,
    pileBounceDamping: 8,
    pileBounceFrequency: 22,
    lateralFollow: 0.16,
    squashDuration: 0.13
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
    this.composer = null;

    this.grid     = this.createEmptyGrid();
    this.meshGrid = this.createMeshGrid();

    this.currentPiece = null;
    this.nextPiece    = null;

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
    this.bgMaterial = null;
    this.materialsByColor = null;
    this.animatedMaterials = [];
    this.tempBlockMaterial = null;
    this.rafId = null;

    this.cameraBasePosition = null;
    this.cameraLookAt = new THREE.Vector3(4.5, 10, 0);
    this.cameraShakePhase = 0;
    this.cameraShakeAmplitude = 0;
    this.cameraShakeOffset = new THREE.Vector3();

    this.pileBouncePhase = 0;
    this.pileBounceAmplitude = 0;
    this.chassisVibrationPhase = 0;
    this.chassisVibrationAmplitude = 0;
    this.chassisNeutralFrameY = 0;
    this.chassisNeutralBackY = 0;

    this.hitStopTimer = 0;
    this.pendingLock = null;
    this.currentPieceVisualX = 0;
    this.currentPieceSquashTimer = 0;
    this.currentPieceSquashIntensity = 0;
    this.currentPieceTilt = new THREE.Quaternion();
    this.tempEuler = new THREE.Euler();
    this.nextPreviewOffset = new THREE.Vector3();

    this.boundResizeHandler = () => this.onResize();
    this.boundKeydownHandler = (e) => this.handleInput(e);
    this.boundAnimate = (t) => this.animate(t);

    this.init();
  }

  // ─── INIT ────────────────────────────────────────────────────────────────

  init() {
    // Scène
    this.scene = new THREE.Scene();
    this.createBackgroundShader();
    this.initMaterials();

    // Caméra
    const aspect = window.innerWidth / window.innerHeight;
    this.camera  = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
    this.camera.position.set(4.5, 10, 25);
    this.camera.lookAt(4.5, 10, 0);
    this.cameraBasePosition = this.camera.position.clone();

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

    this.initPostProcessing();

    this.addLights();
    this.createBorder();
    this.particles = new ParticleSystem(this.scene);

    this.initGhostMeshes();
    this.initNextPieceMeshes();
    this.initMeshGridScene();

    window.addEventListener('resize', this.boundResizeHandler);
    window.addEventListener('keydown', this.boundKeydownHandler);

    this.nextPiece = this.getRandomPiece();
    this.spawnPiece();
  }

initMaterials() {
    this.materialsByColor = {};
    this.animatedMaterials = [];
    const sharedLightDirection = new THREE.Vector3(5.0, 10.0, 7.0).normalize();

    const vertexShader = `
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec3 vViewDir;
      varying vec2 vUv;

      void main() {
        vUv = uv;
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPosition.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - worldPosition.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `;

    const fragmentShader = `
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec3 vViewDir;
      varying vec2 vUv;
      uniform vec3 baseColor;
      uniform vec3 lightDir;
      uniform float time;

      vec3 palette(float t) {
        vec3 a = vec3(0.48, 0.45, 0.55);
        vec3 b = vec3(0.44, 0.40, 0.36);
        vec3 c = vec3(1.00, 1.00, 1.00);
        vec3 d = vec3(0.00, 0.10, 0.20);
        return a + b * cos(6.28318 * (c * t + d));
      }

      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(vViewDir);
        vec3 L = normalize(lightDir);
        vec3 H = normalize(L + V);

        vec2 bevelU = smoothstep(vec2(0.0), vec2(0.1), vUv);
        vec2 bevelV = smoothstep(vec2(0.0), vec2(0.1), vec2(1.0) - vUv);
        float bevelMask = bevelU.x * bevelU.y * bevelV.x * bevelV.y;
        bevelMask = clamp(bevelMask, 0.12, 1.0);

        float ndotl = max(dot(N, L), 0.0);
        float ndoth = max(dot(N, H), 0.0);
        float ndotv = max(dot(N, V), 0.0);

        vec3 paletteColor = palette(time * 0.08 + dot(baseColor, vec3(0.3333)));
        vec3 albedo = mix(baseColor, paletteColor, 0.4);

        vec3 ambient = albedo * 0.18;
        vec3 diffuse = albedo * ndotl * 0.75;

        float specPower = mix(18.0, 72.0, bevelMask);
        vec3 specular = vec3(pow(ndoth, specPower) * (0.45 + 0.55 * ndotl));

        float fresnel = pow(1.0 - ndotv, 4.0);
        vec3 rimGlow = mix(albedo, vec3(1.0), 0.4) * fresnel * 0.85;

        vec3 lit = ambient + diffuse + specular;
        vec3 result = (lit * bevelMask) + rimGlow;

        result = pow(result, vec3(1.0 / 2.2));
        gl_FragColor = vec4(result, 1.0);
      }
    `;

    Object.values(SHAPES).forEach((shape) => {
      const colorHex = shape.color;
      if (!this.materialsByColor[colorHex]) {
        this.materialsByColor[colorHex] = new THREE.ShaderMaterial({
          uniforms: {
            baseColor: { value: new THREE.Color(colorHex) },
            lightDir: { value: sharedLightDirection },
            time: { value: 0 }
          },
          vertexShader,
          fragmentShader
        });
        this.animatedMaterials.push(this.materialsByColor[colorHex]);
      }
    });
  }

  initPostProcessing() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.composer.setSize(window.innerWidth, window.innerHeight);

    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);


    const edgeGlowPass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        edgeStrength: { value: 0.8 },
        glowTint: { value: new THREE.Color(0xff6a33) }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 resolution;
        uniform float edgeStrength;
        uniform vec3 glowTint;
        varying vec2 vUv;

        float calculateLuma(vec3 c) {
          return dot(c, vec3(0.299, 0.587, 0.114));
        }

        void main() {
          vec2 texel = 1.0 / resolution;

          float tl = calculateLuma(texture2D(tDiffuse, vUv + texel * vec2(-1.0,  1.0)).rgb);
          float tc = calculateLuma(texture2D(tDiffuse, vUv + texel * vec2( 0.0,  1.0)).rgb);
          float tr = calculateLuma(texture2D(tDiffuse, vUv + texel * vec2( 1.0,  1.0)).rgb);
          float ml = calculateLuma(texture2D(tDiffuse, vUv + texel * vec2(-1.0,  0.0)).rgb);
          float mr = calculateLuma(texture2D(tDiffuse, vUv + texel * vec2( 1.0,  0.0)).rgb);
          float bl = calculateLuma(texture2D(tDiffuse, vUv + texel * vec2(-1.0, -1.0)).rgb);
          float bc = calculateLuma(texture2D(tDiffuse, vUv + texel * vec2( 0.0, -1.0)).rgb);
          float br = calculateLuma(texture2D(tDiffuse, vUv + texel * vec2( 1.0, -1.0)).rgb);

          float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
          float gy = -bl - 2.0 * bc - br + tl + 2.0 * tc + tr;
          float edge = clamp(length(vec2(gx, gy)) * edgeStrength, 0.0, 1.0);

          vec4 src = texture2D(tDiffuse, vUv);
          vec3 glow = glowTint * edge * 0.35;
          gl_FragColor = vec4(src.rgb + glow, src.a);
        }
      `
    });

    this.composer.addPass(edgeGlowPass);
  }
  addLights() {
   const dirLight = new THREE.DirectionalLight(0xffffff, 2.5);
    dirLight.position.set(5, 15, 10);
     this.scene.add(dirLight);

    const ambLight = new THREE.AmbientLight(0x404050, 0.6);
    this.scene.add(ambLight);

    const rimLight = new THREE.PointLight(0xffffff, 50, 100);
    rimLight.position.set(-10, 10, -5);
    this.scene.add(rimLight);


    this.playerLight = new THREE.PointLight(0xffaa44, 30, 40);
    this.scene.add(this.playerLight);
  }

  createBackgroundShader() {
    const geometry = new THREE.PlaneGeometry(120, 120);
    const uniforms = {
      iTime: { value: 0 },
      iResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }
    };

    const fragmentShader = `
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
      BLOCK_SIZE - BLOCK_GAP,
			2, 2, 2
    );

    for (let x = 0; x < GRID_WIDTH; x++) {
      meshes[x] = [];
      for (let y = 0; y < GRID_HEIGHT; y++) {
        const mat = new THREE.MeshBasicMaterial({ visible: false });
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

// ─── BORDER & CHASSIS STRUCTURE ──────────────────────────────────────────────

createBorder() {
    const group = new THREE.Group();

    // 1. L'ARMATURE FILAIRE (CADRE EXTERNE)
    // On utilise un Tube ou un LineSegments plus épais pour l'aspect "Exosquelette"
    const borderGeo = new THREE.BoxGeometry(GRID_WIDTH + 0.3, GRID_HEIGHT + 0.3, 0.8);
    const edges = new THREE.EdgesGeometry(borderGeo);
    
    // Matériau technique : Gris sidéral profond
    this.gridFrame = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ 
            color: 0x888899, 
            transparent: true, 
            opacity: 0.5 
        })
    );
    this.gridFrame.position.set(GRID_WIDTH / 2 - 0.5, GRID_HEIGHT / 2 - 0.5, -0.1);
    this.chassisNeutralFrameY = this.gridFrame.position.y;
    group.add(this.gridFrame);

    // 2. LE FOND PHYSIQUE (PLAQUE DE MÉTAL BROSSÉ)
    // On passe sur un MeshPhysicalMaterial pour des reflets de dingue
    const backGeo = new THREE.PlaneGeometry(GRID_WIDTH + 0.1, GRID_HEIGHT + 0.1);
    const backMat = new THREE.MeshPhysicalMaterial({
        color: 0x0a0a0c,         // Teinte titane sombre
        metalness: 0.9,          // Très métallique
        roughness: 0.4,          // Un peu de flou dans les reflets
        clearcoat: 1.0,          // Vernis protecteur (effet glossy technique)
        clearcoatRoughness: 0.1,
        transparent: true,
        opacity: 0.95
    });

    this.gridBack = new THREE.Mesh(backGeo, backMat);
    this.gridBack.position.set(GRID_WIDTH / 2 - 0.5, GRID_HEIGHT / 2 - 0.5, -0.45);
    this.chassisNeutralBackY = this.gridBack.position.y;
    group.add(this.gridBack);

    // 3. LA GRILLE DE MESURE (OVERLAY TECHNIQUE)
    // Des lignes horizontales ultra-fines pour la précision visuelle
    const gridHelper = new THREE.GridHelper(GRID_HEIGHT, GRID_HEIGHT, 0xffffff, 0x222222);
    gridHelper.rotation.x = Math.PI / 2;
    gridHelper.position.set(GRID_WIDTH / 2 - 0.5, GRID_HEIGHT / 2 - 0.5, -0.44);
    gridHelper.scale.set(GRID_WIDTH / GRID_HEIGHT, 1, 1);
    gridHelper.material.transparent = true;
    gridHelper.material.opacity = 0.05;
    group.add(gridHelper);

    this.scene.add(group);
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
    const fallbackMaterial = this.materialsByColor[SHAPES.I.color];
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(geo, fallbackMaterial);
      mesh.visible = false;
      this.scene.add(mesh);
      this.nextPieceMeshes.push(mesh);
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
    this.currentPiece.x = Math.floor(GRID_WIDTH / 2) - 1;
    this.currentPiece.y = GRID_HEIGHT - 2;
    if (this.currentPiece.type === 'I') this.currentPiece.x--;
    this.currentPieceVisualX = this.currentPiece.x;
    this.currentPieceSquashTimer = 0;
    this.currentPieceSquashIntensity = 0;

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

  triggerImpactFeedback({ dropDistance = 1, major = false } = {}) {
    const impactPower = Math.max(0.15, Math.min(1.5, dropDistance / GRID_HEIGHT));
    this.cameraShakeAmplitude += impactPower * (major ? 1.45 : 0.8);
    this.pileBounceAmplitude += impactPower * (major ? 0.32 : 0.18);
    this.chassisVibrationAmplitude += impactPower * (major ? 0.2 : 0.1);
    this.currentPieceSquashTimer = CONFIG.effects.squashDuration;
    this.currentPieceSquashIntensity = impactPower * (major ? 0.22 : 0.12);
    this.tempEuler.set(
      (Math.random() - 0.5) * impactPower * 0.08,
      (Math.random() - 0.5) * impactPower * 0.12,
      (Math.random() - 0.5) * impactPower * 0.04
    );
    this.currentPieceTilt.setFromEuler(this.tempEuler);
    if (major) {
      this.hitStopTimer = Math.max(this.hitStopTimer, CONFIG.effects.hitStopDuration);
    }
  }

  queuePieceLock({ dropDistance = 1, major = false } = {}) {
    if (this.pendingLock) return;
    this.triggerImpactFeedback({ dropDistance, major });
    this.pendingLock = { dropDistance, major };
  }

  updatePhysicalFeedback(deltaSeconds) {
    const damping = Math.exp(-CONFIG.effects.cameraShakeDamping * deltaSeconds);
    this.cameraShakeAmplitude *= damping;
    this.cameraShakePhase += deltaSeconds * CONFIG.effects.cameraShakeFrequency;
    const shakeY = Math.sin(this.cameraShakePhase) * this.cameraShakeAmplitude;
    const shakeX = Math.cos(this.cameraShakePhase * 0.8) * this.cameraShakeAmplitude * 0.35;
    this.cameraShakeOffset.set(shakeX, shakeY, 0);

    this.camera.position.copy(this.cameraBasePosition).add(this.cameraShakeOffset);
    this.camera.lookAt(this.cameraLookAt.x, this.cameraLookAt.y + shakeY * 0.25, this.cameraLookAt.z);

    const pileDamping = Math.exp(-CONFIG.effects.pileBounceDamping * deltaSeconds);
    this.pileBounceAmplitude *= pileDamping;
    this.pileBouncePhase += deltaSeconds * CONFIG.effects.pileBounceFrequency;

    const chassisDamping = Math.exp(-12 * deltaSeconds);
    this.chassisVibrationAmplitude *= chassisDamping;
    this.chassisVibrationPhase += deltaSeconds * 52;
    const chassisOffsetY = Math.sin(this.chassisVibrationPhase) * this.chassisVibrationAmplitude;
    if (this.gridFrame) this.gridFrame.position.y = this.chassisNeutralFrameY + chassisOffsetY;
    if (this.gridBack) this.gridBack.position.y = this.chassisNeutralBackY + chassisOffsetY * 0.7;

    if (this.currentPiece) {
      const follow = 1 - Math.exp(-deltaSeconds / CONFIG.effects.lateralFollow);
      this.currentPieceVisualX = THREE.MathUtils.lerp(this.currentPieceVisualX, this.currentPiece.x, follow);
    }

    this.currentPieceSquashTimer = Math.max(0, this.currentPieceSquashTimer - deltaSeconds);
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
    const anchor = CONFIG.preview.nextAnchor;
    this.nextPreviewOffset.set(-1.1, -0.8, 0);

    for (let i = 0; i < 4; i++) {
      const block = this.nextPiece.coords[i];
      const mesh  = this.nextPieceMeshes[i];
      mesh.position.set(
        anchor.x + this.nextPreviewOffset.x + block[0] * CONFIG.preview.nextScale,
        anchor.y + this.nextPreviewOffset.y + block[1] * CONFIG.preview.nextScale,
        anchor.z
      );
      mesh.scale.setScalar(CONFIG.preview.nextScale);
      mesh.material = this.materialsByColor[this.nextPiece.color];
      mesh.visible = true;
    }
  }

  updateGraphics() {
    const pileYOffset = Math.sin(this.pileBouncePhase) * this.pileBounceAmplitude;
    const squashProgress = this.currentPieceSquashTimer > 0
      ? this.currentPieceSquashTimer / CONFIG.effects.squashDuration
      : 0;
    const squashPulse = Math.sin((1 - squashProgress) * Math.PI);
    const yScale = 1 - this.currentPieceSquashIntensity * squashPulse;
    const xScale = 1 + this.currentPieceSquashIntensity * 0.6 * squashPulse;

    // --- Blocs figés ---
    for (let x = 0; x < GRID_WIDTH; x++) {
      for (let y = 0; y < GRID_HEIGHT; y++) {
        const mesh = this.meshGrid[x][y];
        const val  = this.grid[x][y];

        if (val) {
          mesh.visible = true;
          mesh.material = this.materialsByColor[val];
          mesh.position.set(x, y + pileYOffset, 0);
          mesh.scale.set(1, 1, 1);
          mesh.quaternion.identity();
        } else {
          mesh.visible = false;
          mesh.position.set(x, y, 0);
          mesh.scale.set(1, 1, 1);
          mesh.quaternion.identity();
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
          mesh.position.set(this.currentPieceVisualX + block[0], y, 0);
          mesh.scale.set(xScale, yScale, 1);
          mesh.quaternion.copy(this.currentPieceTilt);
        }
      }
    }
  }

  // ─── LOOP ────────────────────────────────────────────────────────────────

  animate(time) {
    this.rafId = requestAnimationFrame(this.boundAnimate);

    const deltaTime = time - this.lastTime;
    this.lastTime   = time;

    const deltaSeconds = deltaTime / 1000;

    if (this.hitStopTimer > 0) {
      this.hitStopTimer = Math.max(0, this.hitStopTimer - deltaSeconds);
      if (this.composer) {
        this.composer.render();
      } else {
        this.renderer.render(this.scene, this.camera);
      }
      return;
    }

    this.particles.update(deltaSeconds);
    this.updatePhysicalFeedback(deltaSeconds);
    if (this.bgMaterial) {
      this.bgMaterial.uniforms.iTime.value = time / 1000;
    }

    for (let i = 0; i < this.animatedMaterials.length; i++) {
      this.animatedMaterials[i].uniforms.time.value = time * 0.001;
    }

    if (!this.isPaused && !this.isGameOver) {
      if (this.pendingLock) {
        this.pendingLock = null;
        this.mergePiece();
        this.dropCounter = 0;
      }

      this.dropCounter += deltaTime;
      if (this.hitStopTimer <= 0 && !this.pendingLock && this.dropCounter > this.dropInterval) {
        if (!this.checkCollision(0, -1)) {
          this.currentPiece.y--;
        } else {
          this.queuePieceLock({ dropDistance: 1, major: false });
        }
        this.dropCounter = 0;
      }

      if (this.currentPiece) {
        this.playerLight.position.set(
          this.currentPieceVisualX + 0.5,
          this.currentPiece.y + 0.5,
          2.0
        );
        this.playerLight.intensity = 18;
        this.playerLight.distance = 26;
      }

      this.updateGhostPosition();
      this.updateGraphics();
    }

    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
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
        if (!this.pendingLock && this.hitStopTimer <= 0 && !this.checkCollision(-1, 0)) this.currentPiece.x--;
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (!this.pendingLock && this.hitStopTimer <= 0 && !this.checkCollision(1, 0)) this.currentPiece.x++;
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (!this.pendingLock && this.hitStopTimer <= 0 && !this.checkCollision(0, -1)) {
          this.currentPiece.y--;
          this.score += CONFIG.gameplay.softDropScore;
          this.updateHud();
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!this.pendingLock && this.hitStopTimer <= 0) this.rotatePiece();
        break;
      case ' ':
        e.preventDefault();
        let hardDropDistance = 0;
        while (!this.checkCollision(0, -1)) {
          this.currentPiece.y--;
          hardDropDistance++;
          this.score += CONFIG.gameplay.hardDropScore;
        }
        this.updateHud();
        this.queuePieceLock({ dropDistance: hardDropDistance, major: true });
        this.dropCounter = 0;
        break;
    }
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    if (this.composer) {
      this.composer.setSize(window.innerWidth, window.innerHeight);
      this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      const edgePass = this.composer.passes.find((pass) => pass.uniforms && pass.uniforms.resolution);
      if (edgePass) edgePass.uniforms.resolution.value.set(window.innerWidth, window.innerHeight);
    }
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

    if (this.tempBlockMaterial) {
      this.tempBlockMaterial.dispose();
      this.tempBlockMaterial = null;
    }

    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
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
