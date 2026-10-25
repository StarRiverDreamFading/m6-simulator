import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { createVehicle } from './vehicle.js';
import { buildEnvironment } from './environment.js';
import { DrivingController } from './driving.js';
import { CameraRig } from './cameras.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87a5c4);
scene.fog = new THREE.Fog(0x87a5c4, 100, 250);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(70, 30, 70);

// 后视镜渲染配置
const mirrorWidth = 300; const mirrorHeight = 150;
const mirrorTarget = new THREE.WebGLRenderTarget(mirrorWidth, mirrorHeight);
const mirrorMesh = document.getElementById('rear-view-mirror');
mirrorMesh.style.width = mirrorWidth + 'px'; mirrorMesh.style.height = mirrorHeight + 'px';
// 创建一个用于显示的 Canvas 供 CSS 背景使用
const mirrorCanvas = document.createElement('canvas');
mirrorCanvas.width = mirrorWidth; mirrorCanvas.height = mirrorHeight;
const mirrorCtx = mirrorCanvas.getContext('2d');

const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.2, 0.4, 0.85);
bloomPass.threshold = 0.8; bloomPass.strength = 1.0; bloomPass.radius = 0.5;
const composer = new EffectComposer(renderer);
composer.addPass(renderScene); composer.addPass(bloomPass);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const sun = new THREE.DirectionalLight(0xfff5e6, 3.0);
sun.position.set(100, 100, 50); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 300;
sun.shadow.camera.left = -150; sun.shadow.camera.right = 150;
sun.shadow.camera.top = 150; sun.shadow.camera.bottom = -150;
sun.shadow.bias = -0.0005; scene.add(sun);
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0); scene.add(hemiLight);

const env = buildEnvironment();
scene.add(env.group);
const vehicle = createVehicle();
scene.add(vehicle.group);

// ================= 尾焰 =================
const flameGeo = new THREE.ConeGeometry(0.4, 2, 8); flameGeo.rotateX(Math.PI / 2);
const flameMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending });
const flameL = new THREE.Mesh(flameGeo, flameMat); const flameR = new THREE.Mesh(flameGeo, flameMat);
flameL.position.set(0.5, 0.5, -2.2); flameR.position.set(-0.5, 0.5, -2.2);
flameL.visible = false; flameR.visible = false; vehicle.group.add(flameL, flameR);

// ================= 白烟与胎痕 =================
const smokeSprites = [];
const smokeCanvas = document.createElement('canvas'); smokeCanvas.width = 64; smokeCanvas.height = 64;
const sCtx = smokeCanvas.getContext('2d'); const sGrad = sCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
sGrad.addColorStop(0, 'rgba(255, 255, 255, 0.9)'); sGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
sCtx.fillStyle = sGrad; sCtx.fillRect(0, 0, 64, 64);
const smokeTexture = new THREE.CanvasTexture(smokeCanvas);
for (let i = 0; i < 150; i++) {
    const mat = new THREE.SpriteMaterial({ map: smokeTexture, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
    const sprite = new THREE.Sprite(mat); sprite.scale.set(2, 2, 1); scene.add(sprite);
    smokeSprites.push({ sprite, life: 0, velocity: new THREE.Vector3() });
}

const skidMarks = [];
const skidGeo = new THREE.PlaneGeometry(0.35, 1.2);
const skidMat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.7, depthWrite: false });
for (let i = 0; i < 300; i++) {
    const mark = new THREE.Mesh(skidGeo, skidMat); mark.visible = false;
    scene.add(mark); skidMarks.push(mark);
}
let skidIndex = 0;

// 声浪
let soundEnabled = false; let audioCtx = null, osc = null, gainNode = null;
function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        osc = audioCtx.createOscillator(); gainNode = audioCtx.createGain();
        osc.type = 'sawtooth'; osc.frequency.value = 100; gainNode.gain.value = 0;
        osc.connect(gainNode); gainNode.connect(audioCtx.destination); osc.start();
    }
}

let currentMode = 'manual'; let driftScore = 0;
const hudSpeed = document.getElementById('hud-speed'); const hudGear = document.getElementById('hud-gear');
const sysLog = document.getElementById('sys-log'); const driftHint = document.getElementById('drift-hint');
const driftScoreEl = document.getElementById('drift-score'); const overdriveHint = document.getElementById('overdrive-hint');
const speedLines = document.getElementById('speed-lines');

const driving = new DrivingController(vehicle.group, vehicle, env, {
    onModeChange: (mode) => { currentMode = mode; updateModeUI(mode); },
    onLog: (msg) => logMsg(msg),
    onBoostPad: () => { logMsg("🚀 加速带触发！"); bloomPass.strength = 3.0; camera.fov = 90; },
    onLaunchReady: () => { document.getElementById('launch-hint').style.display = 'block'; },
    onLaunch: () => { document.getElementById('launch-hint').style.display = 'none'; logMsg("⚡ 弹射起步！"); bloomPass.strength = 2.5; },
    onLaunchCancel: () => { document.getElementById('launch-hint').style.display = 'none'; }
});

const rig = new CameraRig(camera, renderer.domElement, vehicle.group);
rig.controls.target.set(0, 0.9, 0);

function logMsg(text) {
    const div = document.createElement('div'); div.className = 'log-line'; div.textContent = `> ${text}`;
    sysLog.appendChild(div); if (sysLog.children.length > 4) sysLog.removeChild(sysLog.firstChild);
}

document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('[data-view]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active'); rig.setMode(btn.dataset.view);
    });
});

const btnStunt = document.getElementById('btn-stunt');
btnStunt.addEventListener('click', () => {
    if (driving.mode !== 'manual') driving.stopAutopilot();
    driving.startStunt();
    document.querySelector('[data-view="orbit"]').click();
});

function updateModeUI(mode) { /* 简单略过 */ }

const clock = new THREE.Clock();
function animate() {
    const dt = Math.min(clock.getDelta(), 0.05);
    driving.update(dt); rig.update(dt);

    const currentSpeed = Math.round(driving.getSpeedKmh());

    // 渲染后视镜画面
    if (rig.mode === 'driver') {
        renderer.setRenderTarget(mirrorTarget);
        renderer.render(scene, rig.rearCam);
        renderer.setRenderTarget(null);

        // 绘制到 DOM 背景
        mirrorCtx.drawImage(renderer.domElement, 0, renderer.domElement.height - mirrorHeight, mirrorWidth, mirrorHeight, 0, 0, mirrorWidth, mirrorHeight);
        mirrorMesh.style.backgroundImage = `url(${mirrorCanvas.toDataURL()})`;
        mirrorMesh.style.backgroundSize = 'cover';
    }

    // ===== 漂移特效判定 =====
    const isDrifting = driving.isStunting || ((Math.abs(driving.driftAngle) > 0.15 || driving.keys.handbrake) && currentSpeed > 5);

    if (isDrifting) {
        if (!driving.isStunting) {
            const points = Math.floor((driving.driftAngle + 0.1) * 100 * dt);
            driftScore += points;
            driftScoreEl.textContent = driftScore;
        }
        driftHint.style.opacity = 1;

        // 生成白烟
        let spawned = 0;
        smokeSprites.forEach(s => {
            if (s.life <= 0 && spawned < (driving.isStunting ? 6 : 3)) {
                const wPos = new THREE.Vector3();
                const targetWheel = Math.random() > 0.5 ? vehicle.wheels.RL.group : vehicle.wheels.RR.group;
                targetWheel.getWorldPosition(wPos);
                s.sprite.position.set(wPos.x + (Math.random() - 0.5) * 0.5, 0.2, wPos.z + (Math.random() - 0.5) * 0.5);
                s.velocity.set((Math.random() - 0.5) * 3, Math.random() * 2 + 0.5, (Math.random() - 0.5) * 3);
                s.life = 1.5; s.sprite.visible = true; s.sprite.material.opacity = 0.8; s.sprite.scale.set(2, 2, 1);
                spawned++;
            }
        });

        // 生成胎痕
        const skipFrame = driving.isStunting ? 1 : 2;
        if (Math.floor(performance.now() * 0.06) % skipFrame === 0) {
            ['RL', 'RR'].forEach(wName => {
                const wheel = vehicle.wheels[wName].group;
                const worldPos = new THREE.Vector3(); wheel.getWorldPosition(worldPos);
                const mark = skidMarks[skidIndex];
                mark.position.copy(worldPos); mark.position.y = 0.04;
                mark.rotation.set(-Math.PI / 2, 0, 0);
                mark.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), vehicle.group.rotation.y);
                mark.visible = true; skidIndex = (skidIndex + 1) % skidMarks.length;
            });
        }
    } else {
        driftHint.style.opacity = 0;
        driftScore = Math.max(0, driftScore - 20 * dt);
        driftScoreEl.textContent = Math.floor(driftScore);
    }

    // 更新白烟轨迹
    smokeSprites.forEach(s => {
        if (s.life > 0) {
            s.life -= dt * 1.5;
            s.sprite.position.add(s.velocity.clone().multiplyScalar(dt));
            s.velocity.x *= (1 + dt * 2); s.velocity.z *= (1 + dt * 2); s.velocity.y += dt * 1.0;
            s.sprite.material.opacity = Math.max(0, s.life * 0.8);
            s.sprite.scale.setScalar(2 + (1 - s.life) * 3);
            if (s.life <= 0) s.sprite.visible = false;
        }
    });

    // 超载 & 尾焰 & 摄像机视野
    if (driving.isOverdrive) {
        flameL.visible = true; flameR.visible = true; bloomPass.strength = 3.0;
        speedLines.classList.add('active'); overdriveHint.style.opacity = 1;
        camera.fov += (85 - camera.fov) * dt * 10;
    } else {
        flameL.visible = false; flameR.visible = false;
        speedLines.classList.remove('active'); overdriveHint.style.opacity = 0;
        bloomPass.strength += (1.0 - bloomPass.strength) * dt * 5;
        camera.fov += ((45 + Math.max(0, (currentSpeed - 60) * 0.15)) - camera.fov) * dt * 5;
    }
    camera.updateProjectionMatrix();

    hudSpeed.textContent = currentSpeed; hudGear.textContent = driving.gear;

    composer.render();
    requestAnimationFrame(animate);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});

rig.setMode('orbit'); animate();