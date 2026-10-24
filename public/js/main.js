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

// ================= 超载尾焰特效 =================
const flameGeo = new THREE.ConeGeometry(0.4, 2, 8);
flameGeo.rotateX(Math.PI / 2);
const flameMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending });
const flameL = new THREE.Mesh(flameGeo, flameMat);
const flameR = new THREE.Mesh(flameGeo, flameMat);
flameL.position.set(0.5, 0.5, -2.2);
flameR.position.set(-0.5, 0.5, -2.2);
flameL.visible = false; flameR.visible = false;
vehicle.group.add(flameL); vehicle.group.add(flameR);

// ================= 幽灵车 & 烟雾粒子 =================
let ghostCar = null;
let ghostData = [];
let ghostFrame = 0;
const ghostMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.3, wireframe: true });

const smokeSprites = [];
const smokeCanvas = document.createElement('canvas');
smokeCanvas.width = 64; smokeCanvas.height = 64;
const sCtx = smokeCanvas.getContext('2d');
const sGrad = sCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
sGrad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
sGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
sCtx.fillStyle = sGrad; sCtx.fillRect(0, 0, 64, 64);
const smokeTexture = new THREE.CanvasTexture(smokeCanvas);

for (let i = 0; i < 150; i++) {
    const mat = new THREE.SpriteMaterial({ map: smokeTexture, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(2, 2, 1);
    scene.add(sprite);
    smokeSprites.push({ sprite, life: 0, velocity: new THREE.Vector3() });
}

// ================= 胎痕 =================
const skidMarks = [];
const skidGeo = new THREE.PlaneGeometry(0.35, 1.2);
const skidMat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.7, depthWrite: false });
for (let i = 0; i < 400; i++) {
    const mark = new THREE.Mesh(skidGeo, skidMat);
    mark.visible = false;
    scene.add(mark);
    skidMarks.push(mark);
}
let skidIndex = 0;

let soundEnabled = false;
let audioCtx = null, osc = null, gainNode = null;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        osc = audioCtx.createOscillator(); gainNode = audioCtx.createGain();
        osc.type = 'sawtooth'; osc.frequency.value = 100; gainNode.gain.value = 0;
        osc.connect(gainNode); gainNode.connect(audioCtx.destination); osc.start();
    }
}

const arLineGroup = new THREE.Group();
scene.add(arLineGroup);
for (let i = 0; i < 100; i++) {
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 3), mat);
    plane.visible = false; arLineGroup.add(plane);
}

const aiCars = [];
const aiCarMat = new THREE.MeshStandardMaterial({ color: 0x223344, metalness: 0.8, roughness: 0.2 });
for (let i = 0; i < 3; i++) {
    const aiCar = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2, 1.5, 4), aiCarMat);
    body.position.y = 0.75; aiCar.add(body); scene.add(aiCar);
    aiCars.push({ mesh: aiCar, t: Math.random() });
}

let currentMode = 'manual';
let isNight = false, isRaining = false, hazardOn = false, isOnepedal = false, showRacingLine = false, showGhost = true;
let currentEnv = 'day';
let driftScore = 0;

const hudFp = document.getElementById('hud-fp');
const fpSpeedVal = document.getElementById('fp-speed-val');
const fpModeVal = document.getElementById('fp-mode-val');
const fpBatteryVal = document.getElementById('fp-battery-val');
const slipstreamHint = document.getElementById('slipstream-hint');
const launchHint = document.getElementById('launch-hint');
const driftHint = document.getElementById('drift-hint');
const driftScoreEl = document.getElementById('drift-score');
const speedLines = document.getElementById('speed-lines');
const overdriveHint = document.getElementById('overdrive-hint');
const hudSpeed = document.getElementById('hud-speed');
const hudGear = document.getElementById('hud-gear');
const hudMode = document.getElementById('hud-mode');
const steerIndicator = document.getElementById('steer-indicator');
const btnLCC = document.getElementById('btn-lcc');
const btnNCA = document.getElementById('btn-nca');
const btnPark = document.getElementById('btn-park');
const btnStunt = document.getElementById('btn-stunt');
const btnRacingLine = document.getElementById('btn-racingline');
const btnGhost = document.getElementById('btn-ghost');
const btnSound = document.getElementById('btn-sound');
const btnWeather = document.getElementById('btn-weather');
const btnDayNight = document.getElementById('btn-daynight');
const btnHazard = document.getElementById('btn-hazard');
const btnOnepedal = document.getElementById('btn-onepedal');
const speedSlider = document.getElementById('speed-slider');
const speedVal = document.getElementById('speed-val');
const sysLog = document.getElementById('sys-log');
const valBattery = document.getElementById('val-battery');
const valPower = document.getElementById('val-power');
const s1El = document.getElementById('s1-time');
const s2El = document.getElementById('s2-time');
const s3El = document.getElementById('s3-time');

const limitSlider = document.getElementById('limit-slider');
const limitVal = document.getElementById('limit-val');
const steerSensSlider = document.getElementById('steer-sens-slider');
const steerSensVal = document.getElementById('steer-sens-val');

const driving = new DrivingController(vehicle.group, vehicle, env, {
    onModeChange: (mode) => { currentMode = mode; updateModeUI(mode); },
    onParkingComplete: () => { btnPark.textContent = '自动泊车'; btnPark.classList.remove('active'); logMsg("泊车完成"); },
    onAEB: () => { hudMode.textContent = 'AEB 刹车'; hudMode.style.color = '#ff2222'; fpModeVal.textContent = 'AEB BRAKE'; fpModeVal.style.color = '#ff2222'; },
    onAEBReset: () => { updateModeUI(currentMode); },
    onLaunchReady: () => { launchHint.style.display = 'block'; logMsg("弹射模式已激活"); },
    onLaunch: () => { launchHint.style.display = 'none'; logMsg("⚡ 弹射起步！"); bloomPass.strength = 2.5; },
    onLaunchCancel: () => { launchHint.style.display = 'none'; logMsg("弹射已取消"); },
    onLog: (msg) => logMsg(msg)
});

btnStunt.addEventListener('click', () => {
    if (driving.mode !== 'manual') driving.stopAutopilot();
    driving.startStunt();
    document.querySelectorAll('[data-view]').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-view="orbit"]').classList.add('active');
    rig.setMode('orbit');
});

btnSound.addEventListener('click', () => {
    initAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    soundEnabled = !soundEnabled;
    btnSound.classList.toggle('active', soundEnabled);
    logMsg(soundEnabled ? "电机声浪已开启" : "声浪已静音");
    if (!soundEnabled) gainNode.gain.value = 0;
});

btnGhost.addEventListener('click', () => { showGhost = !showGhost; btnGhost.classList.toggle('active', showGhost); if (ghostCar) ghostCar.visible = showGhost; });
limitSlider.addEventListener('input', (e) => { driving.manualMaxSpeed = parseInt(e.target.value) / 3.6; limitVal.textContent = e.target.value; });
steerSensSlider.addEventListener('input', (e) => { driving.maxSteer = parseFloat(e.target.value); steerSensVal.textContent = e.target.value <= 0.4 ? '平缓' : (e.target.value >= 0.7 ? '灵敏' : '正常'); });

const rig = new CameraRig(camera, renderer.domElement, vehicle.group);
rig.controls.target.set(0, 0.9, 0);

function logMsg(text) {
    const div = document.createElement('div');
    div.className = 'log-line'; div.textContent = `> ${text}`;
    sysLog.appendChild(div);
    if (sysLog.children.length > 4) sysLog.removeChild(sysLog.firstChild);
}

document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('[data-view]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active'); rig.setMode(btn.dataset.view);
        hudFp.style.display = (btn.dataset.view === 'driver') ? 'flex' : 'none';
    });
});

document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active'); driving.setDriveMode(btn.dataset.mode);
        document.getElementById('val-mode').textContent = btn.textContent;
    });
});

btnLCC.addEventListener('click', () => { currentMode === 'lcc' ? driving.stopAutopilot() : driving.startAutopilot('lcc'); });
btnNCA.addEventListener('click', () => { currentMode === 'nca' ? driving.stopAutopilot() : driving.startAutopilot('nca'); });
btnPark.addEventListener('click', () => { if (currentMode !== 'manual') driving.stopAutopilot(); driving.startParking(); });
speedSlider.addEventListener('input', (e) => { driving.autopilotTargetSpeed = parseInt(e.target.value) / 3.6; speedVal.textContent = e.target.value; });

btnRacingLine.addEventListener('click', () => { showRacingLine = !showRacingLine; btnRacingLine.classList.toggle('active', showRacingLine); });
btnOnepedal.addEventListener('click', () => { isOnepedal = !isOnepedal; driving.onepedal = isOnepedal; btnOnepedal.classList.toggle('active', isOnepedal); });

btnDayNight.addEventListener('click', () => {
    if (currentEnv === 'day') {
        currentEnv = 'dusk'; btnDayNight.textContent = '切换黑夜';
        scene.background.setHex(0x3a2015); scene.fog.color.setHex(0x3a2015);
        sun.color.setHex(0xff7733); sun.position.set(-50, 20, 50); sun.intensity = 1.5; hemiLight.intensity = 0.4;
    } else if (currentEnv === 'dusk') {
        currentEnv = 'night'; btnDayNight.textContent = '切换白天';
        scene.background.setHex(0x050810); scene.fog.color.setHex(0x050810);
        sun.intensity = 0.1; hemiLight.intensity = 0.1;
    } else {
        currentEnv = 'day'; btnDayNight.textContent = '切换黄昏';
        scene.background.setHex(0x87a5c4); scene.fog.color.setHex(0x87a5c4);
        sun.color.setHex(0xfff5e6); sun.position.set(100, 100, 50); sun.intensity = 3.0; hemiLight.intensity = 1.0;
    }
});

btnWeather.addEventListener('click', () => {
    isRaining = !isRaining; btnWeather.textContent = isRaining ? '关闭雨天' : '开启雨天';
    env.rain.visible = isRaining;
    if (isRaining) { env.trackMat.roughness = 0.2; } else { env.trackMat.roughness = 0.9; }
});
btnHazard.addEventListener('click', () => { hazardOn = !hazardOn; btnHazard.classList.toggle('active', hazardOn); });

function drawScreen(speed, gear) {
    const ctx = vehicle.screenCtx;
    const w = 512, h = 256;
    ctx.fillStyle = '#0a1018'; ctx.fillRect(0, 0, w, h);
    ctx.beginPath(); ctx.moveTo(260, 20); ctx.lineTo(260, h - 20); ctx.strokeStyle = 'rgba(100, 200, 255, 0.3)'; ctx.lineWidth = 2; ctx.stroke();

    if (currentMode === 'parking') {
        ctx.fillStyle = '#112233'; ctx.fillRect(10, 10, 240, 236);
        ctx.strokeStyle = '#00f0ff'; ctx.strokeRect(20, 20, 220, 216);
        ctx.font = '24px monospace'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText('全景影像', 130, 140);
    } else {
        ctx.textAlign = 'right'; ctx.font = 'bold 90px monospace'; ctx.fillStyle = '#00f0ff'; ctx.fillText(speed, 220, 150);
        ctx.textAlign = 'left'; ctx.font = '24px monospace'; ctx.fillStyle = '#6b87ad'; ctx.fillText('km/h', 230, 150);
        ctx.font = 'bold 56px monospace'; ctx.fillStyle = '#ffffff'; ctx.fillText(gear, 30, 100);

        ctx.fillStyle = '#333'; ctx.fillRect(30, 220, 200, 10);
        ctx.fillStyle = driving.isOverdrive ? '#ff0055' : '#00f0ff';
        ctx.fillRect(30, 220, 200 * (driving.overdriveEnergy / 100), 10);
        ctx.font = '12px monospace'; ctx.fillStyle = '#fff';
        ctx.textAlign = 'left'; ctx.fillText('OVERDRIVE', 30, 215);
    }

    const cx = 386, cy = 128, radius = 100;
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0, 40, 80, 0.4)'; ctx.fill();
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.2)'; ctx.lineWidth = 2;
    for (let r = 33; r <= 100; r += 33) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }

    const scanAngle = performance.now() * 0.003;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, radius, scanAngle, scanAngle + 0.8); ctx.closePath();
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, 'rgba(0, 240, 255, 0)'); grad.addColorStop(1, 'rgba(0, 240, 255, 0.6)'); ctx.fillStyle = grad; ctx.fill();

    ctx.beginPath(); ctx.moveTo(cx, cy - 14); ctx.lineTo(cx - 10, cy + 12); ctx.lineTo(cx + 10, cy + 12); ctx.closePath(); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.strokeStyle = '#00f0ff'; ctx.lineWidth = 2; ctx.stroke();
    vehicle.screenTexture.needsUpdate = true;
}

let lapStartTime = 0;
let sector1 = 0, sector2 = 0, sector3 = 0;
let lastT = 0;
let lapCount = 0;
let bestLap = Infinity;

const clock = new THREE.Clock();
let timeSec = 0;

function animate() {
    const dt = Math.min(clock.getDelta(), 0.05);
    timeSec += dt;

    driving.update(dt);

    // 特技模式下摄像机环绕运镜
    if (driving.isStunting) {
        rig.controls.enabled = false;
        const radius = 16;
        const camAngle = driving.stuntAngle - Math.PI / 2;
        camera.position.x += (driving.stuntCenter.x + Math.cos(camAngle) * radius - camera.position.x) * dt * 4;
        camera.position.z += (driving.stuntCenter.z + Math.sin(camAngle) * radius - camera.position.z) * dt * 4;
        camera.position.y += (12 - camera.position.y) * dt * 4;
        camera.lookAt(driving.stuntCenter.x, 1, driving.stuntCenter.z);
    } else {
        rig.controls.enabled = true;
        rig.update(dt);
    }

    const currentSpeed = Math.round(driving.getSpeedKmh());

    // 超载声浪
    if (soundEnabled && osc) {
        let targetFreq = 100 + currentSpeed * 5;
        if (driving.isOverdrive) targetFreq += 300;
        osc.frequency.setTargetAtTime(targetFreq, audioCtx.currentTime, 0.1);
        const targetGain = driving.keys.w ? 0.15 : (driving.keys.s ? 0.05 : 0.02);
        gainNode.gain.setTargetAtTime(targetGain, audioCtx.currentTime, 0.1);
    }

    // 超载视觉特效 (加入空值判断，防止报错)
    if (driving.isOverdrive) {
        flameL.visible = true; flameR.visible = true;
        flameL.scale.set(1 + Math.random() * 0.2, 1 + Math.random() * 0.2, 1 + Math.random() * 0.5);
        flameR.scale.set(1 + Math.random() * 0.2, 1 + Math.random() * 0.2, 1 + Math.random() * 0.5);
        if (overdriveHint) overdriveHint.style.opacity = 1;
        if (speedLines) speedLines.classList.add('active');
        bloomPass.strength = 3.0;
        camera.fov += (85 - camera.fov) * dt * 10;
    } else {
        flameL.visible = false; flameR.visible = false;
        if (overdriveHint) overdriveHint.style.opacity = 0;
        if (speedLines) speedLines.classList.remove('active');
        bloomPass.strength += (1.0 - bloomPass.strength) * dt * 5;
        let targetFov = 45 + Math.max(0, (currentSpeed - 60) * 0.15);
        camera.fov += (targetFov - camera.fov) * dt * 5;
    }
    camera.updateProjectionMatrix();

    // 漂移判定（特技时强制漂移）
    const isDrifting = driving.isStunting || ((Math.abs(driving.driftAngle) > 0.15 || driving.keys.handbrake) && currentSpeed > 5);

    if (isDrifting) {
        if (!driving.isStunting) {
            const points = Math.floor((driving.driftAngle + 0.1) * 100 * dt);
            driftScore += points;
            driftScoreEl.textContent = driftScore;
        }
        driftHint.style.opacity = 1;

        // 拉烟（特技时翻倍）
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

        // 画胎痕（特技时每一帧画）
        const skipFrame = driving.isStunting ? 1 : 2;
        if (Math.floor(timeSec * 60) % skipFrame === 0) {
            ['RL', 'RR'].forEach(wName => {
                const wheel = vehicle.wheels[wName].group;
                const worldPos = new THREE.Vector3(); wheel.getWorldPosition(worldPos);
                const mark = skidMarks[skidIndex];
                mark.position.copy(worldPos); mark.position.y = 0.04;
                mark.rotation.set(-Math.PI / 2, 0, 0);
                mark.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), vehicle.group.rotation.y);
                mark.visible = true;
                skidIndex = (skidIndex + 1) % skidMarks.length;
            });
        }
    } else {
        driftHint.style.opacity = 0;
        driftScore = Math.max(0, driftScore - 20 * dt);
        driftScoreEl.textContent = Math.floor(driftScore);
    }

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

    // 幽灵车与圈速
    const t = driving.autopilotT;
    if (!driving.isStunting && (driving.mode === 'autopilot' || currentSpeed > 5)) {
        if (lapStartTime === 0) {
            lapStartTime = performance.now();
            if (!driving.isRecording) { driving.ghostData = []; driving.isRecording = true; }
        }

        if (driving.isRecording) {
            driving.ghostData.push({ x: driving.position.x, z: driving.position.z, yaw: driving.yaw });
        }

        if (lastT > 0.9 && t < 0.1) {
            const lapTime = performance.now() - lapStartTime;
            if (lapTime < bestLap) {
                bestLap = lapTime;
                if (!ghostCar) {
                    ghostCar = new THREE.Mesh(new THREE.BoxGeometry(2, 1.5, 4), ghostMat);
                    scene.add(ghostCar);
                }
                ghostCar.visible = showGhost;
                ghostFrame = 0;
                logMsg("🏁 创造新纪录！幽灵车已生成");
            }
            lapCount++;
            lapStartTime = performance.now();
            sector1 = sector2 = sector3 = 0;
            driving.ghostData = [];
        }

        if (ghostCar && ghostCar.visible && driving.ghostData.length > 0) {
            ghostFrame += dt * 60;
            const idx = Math.floor(ghostFrame);
            if (idx < driving.ghostData.length) {
                ghostCar.position.set(driving.ghostData[idx].x, 0.75, driving.ghostData[idx].z);
                ghostCar.rotation.y = driving.ghostData[idx].yaw;
            }
        }

        if (lastT < 0.33 && t >= 0.33) sector1 = performance.now() - lapStartTime;
        if (lastT < 0.66 && t >= 0.66) sector2 = performance.now() - lapStartTime - sector1;
        if (t > 0.66) sector3 = performance.now() - lapStartTime - sector1 - sector2;

        lastT = t;

        document.getElementById('lap-count').textContent = lapCount;
        document.getElementById('lap-current').textContent = (performance.now() - lapStartTime).toFixed(0);
        if (bestLap !== Infinity) document.getElementById('lap-best').textContent = bestLap.toFixed(0);
        s1El.textContent = sector1 > 0 ? sector1.toFixed(0) : '--';
        s2El.textContent = sector2 > 0 ? sector2.toFixed(0) : '--';
        s3El.textContent = sector3 > 0 ? sector3.toFixed(0) : '--';
    }

    hudSpeed.textContent = currentSpeed;
    hudGear.textContent = driving.gear;
    fpSpeedVal.textContent = currentSpeed;
    fpBatteryVal.textContent = Math.round(driving.battery * 6.3);
    steerIndicator.style.transform = `translateX(${(driving.steer / driving.maxSteer) * 40}px)`;
    valBattery.textContent = Math.round(driving.battery) + '%';
    valPower.textContent = driving.powerConsumption.toFixed(1) + ' kWh/100km';

    const shouldHeadlightOn = isNight || isRaining || currentEnv === 'dusk';
    vehicle.headlight.intensity = shouldHeadlightOn ? 15 : 0;
    vehicle.lightWhite.emissiveIntensity = shouldHeadlightOn ? 3.0 : 0.1;
    vehicle.lightRed.emissiveIntensity = (driving.keys.s || driving.keys.handbrake || (isOnepedal && !driving.keys.w && currentSpeed > 0)) ? 5.0 : (shouldHeadlightOn ? 2.0 : 0.1);

    const blinkerPhase = Math.floor((timeSec * 3) % 4);
    const isLeft = driving.keys.a || hazardOn;
    const isRight = driving.keys.d || hazardOn;
    for (let i = 0; i < 3; i++) {
        let activeL = false, activeR = false;
        if (blinkerPhase === i) { activeL = isLeft; activeR = isRight; }
        if (blinkerPhase === 3) { activeL = false; activeR = false; }
        vehicle.blinkerMatsL[i].emissiveIntensity = activeL ? 5 : 0;
        vehicle.blinkerMatsR[i].emissiveIntensity = activeR ? 5 : 0;
    }

    if (isRaining) {
        const positions = env.rain.geometry.attributes.position.array;
        for (let i = 1; i < positions.length; i += 3) {
            positions[i] -= 50 * dt; if (positions[i] < 0) positions[i] = 50;
        }
        env.rain.geometry.attributes.position.needsUpdate = true;
        vehicle.wiper.rotation.z = Math.sin(timeSec * 8) * 1.2;
    } else { vehicle.wiper.rotation.z = 0; }

    drawScreen(currentSpeed, driving.gear);
    composer.render();
    requestAnimationFrame(animate);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});

rig.setMode('orbit'); updateModeUI('manual'); animate();

function updateModeUI(mode) {
    btnLCC.classList.remove('active'); btnNCA.classList.remove('active'); btnPark.classList.remove('active');
    hudFp.style.display = rig.mode === 'driver' ? 'flex' : 'none';

    if (mode === 'lcc') { hudMode.textContent = 'LCC 巡航'; hudMode.style.color = '#00f0ff'; fpModeVal.textContent = 'LCC'; btnLCC.classList.add('active'); }
    else if (mode === 'nca') { hudMode.textContent = 'NCA 领航'; hudMode.style.color = '#8be9c1'; fpModeVal.textContent = 'NCA'; btnNCA.classList.add('active'); }
    else if (mode === 'parking') { hudMode.textContent = '泊车中'; hudMode.style.color = '#ffb86b'; fpModeVal.textContent = 'PARKING'; btnPark.classList.add('active'); }
    else { hudMode.textContent = '手动驾驶'; hudMode.style.color = '#b89cff'; fpModeVal.textContent = 'READY'; fpModeVal.style.color = '#8be9c1'; }
}