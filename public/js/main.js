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

const mirrorCanvas = document.getElementById('mirror-canvas');
const mirrorRenderer = new THREE.WebGLRenderer({ canvas: mirrorCanvas, antialias: true });
mirrorRenderer.setSize(300, 150);
mirrorRenderer.setPixelRatio(1);
mirrorRenderer.toneMapping = THREE.ACESFilmicToneMapping;

const rearViewMirror = document.getElementById('rear-view-mirror');
const diaWarning = document.getElementById('dia-warning');
const bsdWarning = document.getElementById('bsd-warning');

// 获取所有关键 UI DOM
const chargingUI = document.getElementById('charging-ui');
const btnUnplug = document.getElementById('btn-unplug');

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

const aiCars = [];
const aiCarMat = new THREE.MeshStandardMaterial({ color: 0x4a5d75, metalness: 0.5, roughness: 0.4 });
for (let i = 0; i < 3; i++) {
    const aiCar = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 3.8), aiCarMat);
    body.position.y = 0.6; aiCar.add(body); scene.add(aiCar);
    aiCars.push({ mesh: aiCar, t: Math.random(), speed: 15, lateralOffset: 0 });
}

const flameGeo = new THREE.ConeGeometry(0.4, 2, 8); flameGeo.rotateX(Math.PI / 2);
const flameMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending });
const flameL = new THREE.Mesh(flameGeo, flameMat); const flameR = new THREE.Mesh(flameGeo, flameMat);
flameL.position.set(0.5, 0.5, -2.2); flameR.position.set(-0.5, 0.5, -2.2);
flameL.visible = false; flameR.visible = false; vehicle.group.add(flameL, flameR);

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
for (let i = 0; i < 300; i++) { const mark = new THREE.Mesh(skidGeo, skidMat); mark.visible = false; scene.add(mark); skidMarks.push(mark); }
let skidIndex = 0;

let soundEnabled = false; let audioCtx = null, osc = null, gainNode = null, filter = null;
function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        osc = audioCtx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 100;
        filter = audioCtx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 800;
        gainNode = audioCtx.createGain(); gainNode.gain.value = 0;
        osc.connect(filter); filter.connect(gainNode); gainNode.connect(audioCtx.destination); osc.start();
    }
}

let currentMode = 'manual'; let driftScore = 0;
const hudSpeed = document.getElementById('hud-speed'); const hudGear = document.getElementById('hud-gear');
const sysLog = document.getElementById('sys-log'); const driftHint = document.getElementById('drift-hint');
const driftScoreEl = document.getElementById('drift-score'); const overdriveHint = document.getElementById('overdrive-hint');
const speedLines = document.getElementById('speed-lines'); const hudMode = document.getElementById('hud-mode');
const valBattery = document.getElementById('val-battery'); const valPower = document.getElementById('val-power');
const valTpmsF = document.getElementById('val-tpms-f'); const valTpmsR = document.getElementById('val-tpms-r');
const holoSpeed = document.getElementById('holo-speed'); const holoG = document.getElementById('holo-g');
const valBestLap = document.getElementById('val-best-lap');

const savedBestLap = localStorage.getItem('m6_best_lap');
if (savedBestLap && valBestLap) valBestLap.textContent = savedBestLap;

const driving = new DrivingController(vehicle.group, vehicle, env, {
    onModeChange: (mode) => { currentMode = mode; updateModeUI(mode); },
    onLog: (msg) => logMsg(msg),
    onBoostPad: () => { logMsg("🚀 加速带触发！"); bloomPass.strength = 3.0; camera.fov = 90; },
    onLaunchReady: () => { const el = document.getElementById('launch-hint'); if (el) el.style.display = 'block'; },
    onLaunch: () => { const el = document.getElementById('launch-hint'); if (el) el.style.display = 'none'; logMsg("⚡ 弹射起步！"); bloomPass.strength = 2.5; },
    onLaunchCancel: () => { const el = document.getElementById('launch-hint'); if (el) el.style.display = 'none'; },
    onParkingComplete: () => { logMsg("泊车完成，已驻车"); if (btnPark) btnPark.textContent = '自动泊车'; },
    onParkingFail: () => { logMsg("无空车位"); },
    onAEBTriggered: () => {
        logMsg("🚨 AEB 自动紧急制动介入！");
        if (bsdWarning) {
            bsdWarning.textContent = "🚨 AEB 紧急制动";
            bsdWarning.style.display = 'block';
            setTimeout(() => { bsdWarning.style.display = 'none'; bsdWarning.textContent = "⚠️ 盲区有车，请勿变道"; }, 1000);
        }
    },
    onDIAStart: () => {
        if (diaWarning) diaWarning.style.display = 'block';
        logMsg("⚠️ 警报：驾驶员失能！系统接管中...");
        if (btnDia) { btnDia.textContent = '恢复驾驶员接管'; btnDia.style.color = '#00f0ff'; btnDia.style.borderColor = '#00f0ff'; }
        hazardOn = true; if (btnHazard) btnHazard.classList.add('active');
    },
    onDIARecover: () => {
        if (diaWarning) diaWarning.style.display = 'none';
        logMsg("✅ 驾驶员已接管车辆");
        if (btnDia) { btnDia.textContent = '🚨 模拟驾驶员失能'; btnDia.style.color = '#ff2222'; btnDia.style.borderColor = '#ff2222'; }
        hazardOn = false; if (btnHazard) btnHazard.classList.remove('active');
    },
    onHazardOn: () => {
        hazardOn = true; if (btnHazard) btnHazard.classList.add('active');
    }
});

btnUnplug?.addEventListener('click', () => {
    driving.stopCharging();
    logMsg("🔌 充电枪已拔出，车辆恢复动力");
    if (chargingUI) chargingUI.style.display = 'none';
});

const rig = new CameraRig(camera, renderer.domElement, vehicle.group);
rig.controls.target.set(0, 0.9, 0);

function logMsg(text) {
    if (!sysLog) return;
    const div = document.createElement('div'); div.className = 'log-line'; div.textContent = `> ${text}`;
    sysLog.appendChild(div); if (sysLog.children.length > 4) sysLog.removeChild(sysLog.firstChild);
}

const btnLCC = document.getElementById('btn-lcc'), btnNCA = document.getElementById('btn-nca');
const btnACC = document.getElementById('btn-acc'), btnRCA = document.getElementById('btn-rca');
const btnStunt = document.getElementById('btn-stunt'), btnPark = document.getElementById('btn-park');
const btnP2P = document.getElementById('btn-p2p'), btnDia = document.getElementById('btn-dia');
const btnRacingLine = document.getElementById('btn-racingline');
const btnSound = document.getElementById('btn-sound'), btnOnepedal = document.getElementById('btn-onepedal');
const btnHazard = document.getElementById('btn-hazard'), btnDayNight = document.getElementById('btn-daynight');
const btnWeather = document.getElementById('btn-weather');
const btnALC = document.getElementById('btn-alc'), btnTJA = document.getElementById('btn-tja');
const btnAEB = document.getElementById('btn-aeb'), btnBSD = document.getElementById('btn-bsd');

btnLCC?.addEventListener('click', () => { currentMode === 'lcc' ? driving.stopAutopilot() : driving.startAutopilot('lcc'); });
btnNCA?.addEventListener('click', () => { currentMode === 'nca' ? driving.stopAutopilot() : driving.startAutopilot('nca'); });
btnACC?.addEventListener('click', () => { currentMode === 'acc' ? driving.stopAutopilot() : driving.startAutopilot('acc'); });
btnRCA?.addEventListener('click', () => { currentMode === 'rca' ? driving.stopAutopilot() : driving.startAutopilot('rca'); });

btnALC?.addEventListener('click', () => { driving.useALC = !driving.useALC; btnALC.classList.toggle('active', driving.useALC); });
btnTJA?.addEventListener('click', () => { driving.useTJA = !driving.useTJA; btnTJA.classList.toggle('active', driving.useTJA); });
btnAEB?.addEventListener('click', () => { driving.useAEB = !driving.useAEB; btnAEB.classList.toggle('active', driving.useAEB); });
btnBSD?.addEventListener('click', () => { driving.useBSD = !driving.useBSD; btnBSD.classList.toggle('active', driving.useBSD); });

btnStunt?.addEventListener('click', () => {
    if (driving.mode !== 'manual') driving.stopAutopilot();
    driving.startStunt();
    document.querySelector('[data-view="orbit"]')?.click();
});

btnPark?.addEventListener('click', () => {
    if (driving.mode === 'parking') {
        driving.mode = 'manual'; driving.speed = 0; driving.parkingAnim = null; driving.parkingPath = null;
        updateModeUI('manual'); logMsg("泊车已取消");
    } else {
        if (driving.mode !== 'manual') driving.stopAutopilot();
        driving.startParking();
        document.querySelector('[data-view="driver"]')?.click();
    }
});

btnP2P?.addEventListener('click', () => {
    if (driving.isIncapacitated) return;
    driving.startP2P();
    document.querySelector('[data-view="chase"]')?.click();
});

btnDia?.addEventListener('click', () => {
    if (driving.isIncapacitated) driving.recoverFromIncapacitation();
    else driving.triggerIncapacitation();
});

let showRacingLine = false;
btnRacingLine?.addEventListener('click', () => { showRacingLine = !showRacingLine; btnRacingLine.classList.toggle('active', showRacingLine); });

btnSound?.addEventListener('click', () => {
    initAudio(); if (audioCtx.state === 'suspended') audioCtx.resume();
    soundEnabled = !soundEnabled; btnSound.classList.toggle('active', soundEnabled);
    logMsg(soundEnabled ? "科幻电机声浪已开启" : "声浪已静音");
    if (!soundEnabled) gainNode.gain.value = 0;
});

let isOnepedal = false;
btnOnepedal?.addEventListener('click', () => { isOnepedal = !isOnepedal; driving.onepedal = isOnepedal; btnOnepedal.classList.toggle('active', isOnepedal); });
let hazardOn = false;
btnHazard?.addEventListener('click', () => { hazardOn = !hazardOn; btnHazard.classList.toggle('active', hazardOn); });

let currentEnv = 'day'; let isRaining = false;
function applyEnvironment() {
    if (currentEnv === 'day') {
        scene.background.setHex(0x87a5c4); scene.fog.color.setHex(0x87a5c4);
        sun.color.setHex(0xfff5e6); sun.position.set(100, 100, 50); sun.intensity = 3.0; hemiLight.intensity = 1.0;
        if (btnDayNight) btnDayNight.textContent = '切换黄昏';
    } else if (currentEnv === 'dusk') {
        scene.background.setHex(0x3a2015); scene.fog.color.setHex(0x3a2015);
        sun.color.setHex(0xff7733); sun.position.set(-50, 20, 50); sun.intensity = 1.5; hemiLight.intensity = 0.4;
        if (btnDayNight) btnDayNight.textContent = '切换黑夜';
    } else {
        scene.background.setHex(0x050810); scene.fog.color.setHex(0x050810);
        sun.intensity = 0.1; hemiLight.intensity = 0.1;
        if (btnDayNight) btnDayNight.textContent = '切换白天';
    }
    env.rain.visible = isRaining; if (btnWeather) btnWeather.textContent = isRaining ? '关闭雨天' : '开启雨天';
    if (isRaining) env.trackMat.roughness = 0.2; else env.trackMat.roughness = 0.9;
}

btnDayNight?.addEventListener('click', () => { currentEnv = currentEnv === 'day' ? 'dusk' : (currentEnv === 'dusk' ? 'night' : 'day'); applyEnvironment(); });
btnWeather?.addEventListener('click', () => { isRaining = !isRaining; applyEnvironment(); });

function updateModeUI(mode) {
    [btnLCC, btnNCA, btnACC, btnRCA].forEach(b => b?.classList.remove('active'));
    if (mode === 'lcc') { btnLCC?.classList.add('active'); if (hudMode) hudMode.textContent = 'LCC 巡航'; }
    else if (mode === 'nca') { btnNCA?.classList.add('active'); if (hudMode) hudMode.textContent = 'NCA 领航'; }
    else if (mode === 'acc') { btnACC?.classList.add('active'); if (hudMode) hudMode.textContent = 'ACC 自适应'; }
    else if (mode === 'rca') { btnRCA?.classList.add('active'); if (hudMode) hudMode.textContent = 'RCA 漫游'; }
    else if (mode === 'parking') { if (hudMode) hudMode.textContent = '泊车中'; }
    else { if (hudMode) hudMode.textContent = '手动驾驶'; }
}

document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('[data-view]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active'); rig.setMode(btn.dataset.view);
        if (rearViewMirror) rearViewMirror.style.display = (btn.dataset.view === 'driver' || driving.mode === 'parking') ? 'block' : 'none';
        const holo = document.getElementById('hologram-hud');
        if (holo) holo.style.display = (btn.dataset.view === 'driver' || btn.dataset.view === 'passenger') ? 'flex' : 'none';
    });
});

const limitSlider = document.getElementById('limit-slider'); const limitVal = document.getElementById('limit-val');
limitSlider?.addEventListener('input', (e) => { driving.manualMaxSpeed = parseInt(e.target.value) / 3.6; if (limitVal) limitVal.textContent = e.target.value; });

const autoSpeedSlider = document.getElementById('auto-speed-slider'); const autoSpeedVal = document.getElementById('auto-speed-val');
autoSpeedSlider?.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    driving.autopilotTargetSpeed = val / 3.6;
    if (autoSpeedVal) autoSpeedVal.textContent = val;
});

const btnInputKeyboard = document.getElementById('btn-input-keyboard'), btnInputJoystick = document.getElementById('btn-input-joystick');
const joystickContainer = document.getElementById('joystick-container');
const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
if (isTouchDevice && window.innerWidth < 1024) { driving.inputMethod = 'joystick'; if (joystickContainer) joystickContainer.style.display = 'flex'; btnInputKeyboard?.classList.remove('active'); btnInputJoystick?.classList.add('active'); }
function setInputMethod(method) {
    driving.inputMethod = method;
    if (method === 'keyboard') { if (joystickContainer) joystickContainer.style.display = 'none'; btnInputKeyboard?.classList.add('active'); btnInputJoystick?.classList.remove('active'); }
    else { if (joystickContainer) joystickContainer.style.display = 'flex'; btnInputKeyboard?.classList.remove('active'); btnInputJoystick?.classList.add('active'); }
}
btnInputKeyboard?.addEventListener('click', () => setInputMethod('keyboard'));
btnInputJoystick?.addEventListener('click', () => setInputMethod('joystick'));

const joyLeft = document.getElementById('joy-left'), joyRight = document.getElementById('joy-right');
const stickL = joyLeft?.querySelector('.joystick-stick'), stickR = joyRight?.querySelector('.joystick-stick');
function setupJoy(base, stick, cb) {
    if (!base || !stick) return;
    let id = null; const max = base.clientWidth / 2;
    const start = (e) => { e.preventDefault(); const t = e.changedTouches ? e.changedTouches[0] : e; id = t.identifier !== undefined ? t.identifier : 'mouse'; move(e); };
    const move = (e) => { if (id === null) return; let t; if (e.changedTouches) { for (let i = 0; i < e.touches.length; i++) if (e.touches[i].identifier === id) t = e.touches[i]; } else t = e; if (!t) return; const r = base.getBoundingClientRect(); let dx = t.clientX - (r.left + r.width / 2); let dy = t.clientY - (r.top + r.height / 2); const d = Math.hypot(dx, dy); if (d > max) { dx = (dx / d) * max; dy = (dy / d) * max; } stick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`; cb(dx / max, dy / max); };
    const end = () => { id = null; stick.style.transform = `translate(-50%, -50%)`; cb(0, 0); };
    base.addEventListener('touchstart', start, { passive: false }); base.addEventListener('touchmove', move, { passive: false }); base.addEventListener('touchend', end); base.addEventListener('touchcancel', end);
    base.addEventListener('mousedown', start); window.addEventListener('mousemove', e => { if (id === 'mouse') move(e); }); window.addEventListener('mouseup', e => { if (id === 'mouse') end(); });
}
setupJoy(joyLeft, stickL, (x, y) => { driving.joySteer = -x; driving.lastInputTime = performance.now(); });
setupJoy(joyRight, stickR, (x, y) => { driving.joyThrottle = y; driving.lastInputTime = performance.now(); });

const btnJoyHandbrake = document.getElementById('btn-joy-handbrake'), btnJoyOverdrive = document.getElementById('btn-joy-overdrive');
if (btnJoyHandbrake) {
    const pressHandbrake = (e) => { e.preventDefault(); driving.keys.handbrake = true; btnJoyHandbrake.classList.add('active'); };
    const releaseHandbrake = () => { driving.keys.handbrake = false; btnJoyHandbrake.classList.remove('active'); };
    btnJoyHandbrake.addEventListener('touchstart', pressHandbrake, { passive: false }); btnJoyHandbrake.addEventListener('mousedown', pressHandbrake);
    btnJoyHandbrake.addEventListener('touchend', releaseHandbrake); btnJoyHandbrake.addEventListener('mouseup', releaseHandbrake); btnJoyHandbrake.addEventListener('mouseleave', releaseHandbrake);
}
if (btnJoyOverdrive) {
    const pressOverdrive = (e) => { e.preventDefault(); driving.keys.shift = true; btnJoyOverdrive.classList.add('active'); };
    const releaseOverdrive = () => { driving.keys.shift = false; btnJoyOverdrive.classList.remove('active'); };
    btnJoyOverdrive.addEventListener('touchstart', pressOverdrive, { passive: false }); btnJoyOverdrive.addEventListener('mousedown', pressOverdrive);
    btnJoyOverdrive.addEventListener('touchend', releaseOverdrive); btnJoyOverdrive.addEventListener('mouseup', releaseOverdrive); btnJoyOverdrive.addEventListener('mouseleave', releaseOverdrive);
}

const minimapCanvas = document.getElementById('minimap');
const mtx = minimapCanvas?.getContext('2d');
function drawMinimap(carPos, yaw) {
    if (!mtx) return;
    mtx.fillStyle = 'rgba(10, 20, 35, 0.9)'; mtx.fillRect(0, 0, 150, 150);

    mtx.beginPath();
    const pts = env.autopilotCurve.getPoints(60);
    pts.forEach((p, i) => {
        const x = 75 + (p.x / 300) * 60;
        const z = 75 + (p.z / 300) * 60;
        if (i === 0) mtx.moveTo(x, z); else mtx.lineTo(x, z);
    });
    mtx.closePath();
    mtx.strokeStyle = 'rgba(100, 200, 255, 0.5)'; mtx.lineWidth = 6; mtx.stroke();

    if (env.chargingStations) {
        env.chargingStations.forEach(station => {
            const x = 75 + (station.position.x / 300) * 60; const z = 75 + (station.position.z / 300) * 60;
            mtx.beginPath(); mtx.arc(x, z, 4, 0, Math.PI * 2); mtx.fillStyle = '#00ff88'; mtx.fill();
        });
    }

    aiCars.forEach(c => {
        const x = 75 + (c.mesh.position.x / 300) * 60; const z = 75 + (c.mesh.position.z / 300) * 60;
        mtx.beginPath(); mtx.arc(x, z, 3, 0, Math.PI * 2); mtx.fillStyle = '#aaa'; mtx.fill();
    });

    const x = 75 + (carPos.x / 300) * 60; const z = 75 + (carPos.z / 300) * 60;
    mtx.save();
    mtx.translate(x, z); mtx.rotate(-yaw);
    mtx.beginPath(); mtx.moveTo(0, -5); mtx.lineTo(-3, 3); mtx.lineTo(3, 3); mtx.closePath();
    mtx.fillStyle = '#ff0055'; mtx.fill();
    mtx.restore();
}

const clock = new THREE.Clock();
function animate() {
    const dt = Math.min(clock.getDelta(), 0.05);

    aiCars.forEach(car => {
        const distToPlayer = car.mesh.position.distanceTo(driving.position);
        let targetSpeed = 15;
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(car.mesh.quaternion);
        const toPlayer = driving.position.clone().sub(car.mesh.position).normalize();

        if (forward.dot(toPlayer) > 0.7 && distToPlayer < 15) {
            targetSpeed = Math.max(0, (distToPlayer - 5) * 1.5);
            if (distToPlayer < 6) targetSpeed = 0;
        }
        car.speed += (targetSpeed - car.speed) * Math.min(1, dt * 3);

        const distLat = driving.position.distanceTo(car.mesh.position);
        if (distLat < 4) {
            const localPlayer = driving.position.clone().sub(car.mesh.position).applyAxisAngle(new THREE.Vector3(0, 1, 0), -car.mesh.rotation.y);
            if (Math.abs(localPlayer.x) < 2) {
                car.lateralOffset += (localPlayer.x > 0 ? -1 : 1) * dt * 2;
            }
        } else {
            car.lateralOffset += (0 - car.lateralOffset) * dt;
        }
        car.lateralOffset = THREE.MathUtils.clamp(car.lateralOffset, -3, 3);

        car.t += (car.speed * dt) / driving.autopilotLength;
        car.t = ((car.t % 1) + 1) % 1;

        const p = driving.autopilotCurve.getPointAt(car.t);
        const tangent = driving.autopilotCurve.getTangentAt(car.t);
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

        car.mesh.position.copy(p).add(normal.multiplyScalar(car.lateralOffset));
        car.mesh.rotation.y = Math.atan2(tangent.x, tangent.z);
    });

    driving.update(dt, aiCars);
    rig.update(dt);

    const currentSpeed = Math.round(driving.getSpeedKmh());
    const gForce = Math.abs(driving.steer * (currentSpeed / 100) * 1.5).toFixed(2);

    if (hudSpeed) hudSpeed.textContent = currentSpeed;
    if (hudGear) hudGear.textContent = driving.gear;
    if (holoSpeed) holoSpeed.textContent = currentSpeed;
    if (holoG) holoG.textContent = gForce;

    if (valBattery) {
        valBattery.textContent = Math.round(driving.battery) + '%';
        if (driving.isCharging) {
            valBattery.style.color = '#00ff88';
            valBattery.style.textShadow = '0 0 10px #00ff88';
            if (chargingUI) chargingUI.style.display = 'block';
        } else {
            valBattery.style.color = '#00f0ff';
            valBattery.style.textShadow = 'none';
            if (chargingUI) chargingUI.style.display = 'none';
        }
    }

    if (valPower) valPower.textContent = driving.powerConsumption.toFixed(1) + ' kWh/100km';

    const baseTpms = 2.4 + Math.sin(performance.now() * 0.001) * 0.05 + (currentSpeed > 50 ? 0.2 : 0);
    if (valTpmsF) valTpmsF.textContent = baseTpms.toFixed(1) + ' bar';
    if (valTpmsR) valTpmsR.textContent = (baseTpms + 0.05).toFixed(1) + ' bar';

    drawMinimap(driving.position, driving.yaw);

    if (bsdWarning) {
        if ((driving.bsdAlert || driving.bsdAlertR) && driving.useBSD) {
            bsdWarning.style.display = 'block';
            bsdWarning.textContent = driving.bsdAlert ? "⚠️ 左侧盲区有车" : "⚠️ 右侧盲区有车";
        } else {
            bsdWarning.style.display = 'none';
        }
    }

    if (rig.mode === 'driver' || driving.mode === 'parking' || driving.isIncapacitated) {
        if (rearViewMirror) rearViewMirror.style.display = 'block';
        mirrorRenderer.render(scene, rig.rearCam);
    }

    const shouldHeadlightOn = currentEnv === 'night' || currentEnv === 'dusk' || isRaining;
    vehicle.headlight.intensity = shouldHeadlightOn ? 15 : 0;
    vehicle.lightWhite.emissiveIntensity = shouldHeadlightOn ? 3.0 : 0.1;

    const isBraking = driving.keys.s || driving.keys.handbrake || (driving.isIncapacitated && currentSpeed > 0) || driving.isCharging;
    vehicle.lightRed.emissiveIntensity = isBraking ? 5.0 : (shouldHeadlightOn ? 2.0 : 0.1);

    const blink = Math.sin(performance.now() * 0.015) > 0;
    if (vehicle.blinkerMatL && vehicle.blinkerMatR) {
        if (hazardOn) {
            vehicle.blinkerMatL.emissiveIntensity = blink ? 5 : 0;
            vehicle.blinkerMatR.emissiveIntensity = blink ? 5 : 0;
        } else {
            const isLeft = driving.keys.a;
            const isRight = driving.keys.d;
            vehicle.blinkerMatL.emissiveIntensity = (isLeft && blink) ? 5 : 0;
            vehicle.blinkerMatR.emissiveIntensity = (isRight && blink) ? 5 : 0;
        }
    }

    const isDrifting = driving.isStunting || ((Math.abs(driving.driftAngle) > 0.15 || driving.keys.handbrake) && currentSpeed > 5);
    const allowSmoke = rig.mode !== 'chase';

    if (isDrifting && allowSmoke) {
        if (!driving.isStunting) { driftScore += Math.floor((driving.driftAngle + 0.1) * 100 * dt); if (driftScoreEl) driftScoreEl.textContent = driftScore; }
        if (driftHint) driftHint.style.opacity = 1;

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

        if (Math.floor(performance.now() * 0.06) % 2 === 0) {
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
        if (driftHint) driftHint.style.opacity = 0; driftScore = Math.max(0, driftScore - 20 * dt); if (driftScoreEl) driftScoreEl.textContent = Math.floor(driftScore);
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

    if (driving.isOverdrive) {
        flameL.visible = true; flameR.visible = true; bloomPass.strength = 3.0;
        if (speedLines) speedLines.classList.add('active'); if (overdriveHint) overdriveHint.style.opacity = 1;
        camera.fov += (85 - camera.fov) * dt * 10;
    } else {
        flameL.visible = false; flameR.visible = false;
        if (speedLines) speedLines.classList.remove('active'); if (overdriveHint) overdriveHint.style.opacity = 0;
        bloomPass.strength += (1.0 - bloomPass.strength) * dt * 5;
        camera.fov += ((45 + Math.max(0, (currentSpeed - 60) * 0.15)) - camera.fov) * dt * 5;
    }
    camera.updateProjectionMatrix();

    if (soundEnabled && osc && filter) {
        osc.frequency.setTargetAtTime(100 + currentSpeed * 8, audioCtx.currentTime, 0.1);
        filter.frequency.setTargetAtTime(400 + currentSpeed * 30, audioCtx.currentTime, 0.1);
        let targetGain = driving.keys.w ? 0.15 : (driving.keys.s ? 0.05 : 0.02);
        if (driving.isOverdrive) targetGain = 0.25;
        gainNode.gain.setTargetAtTime(targetGain, audioCtx.currentTime, 0.1);
    }

    composer.render();
    requestAnimationFrame(animate);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight); composer.setSize(window.innerWidth, window.innerHeight);
});

rig.setMode('orbit'); animate();