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

const mirrorTarget = new THREE.WebGLRenderTarget(300, 150);
const mirrorCanvas = document.getElementById('mirror-canvas');
const mirrorCtx = mirrorCanvas.getContext('2d');
let mirrorFrame = 0;
const rearViewMirror = document.getElementById('rear-view-mirror');

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

let ghostCar = null;
let ghostData = [];
let ghostFrame = 0;
const ghostMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.3, wireframe: true });

const aiCars = [];
const aiCarMat = new THREE.MeshStandardMaterial({ color: 0x223344, metalness: 0.8, roughness: 0.2 });
for (let i = 0; i < 3; i++) {
    const aiCar = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2, 1.5, 4), aiCarMat);
    body.position.y = 0.75; aiCar.add(body); scene.add(aiCar);
    aiCars.push({ mesh: aiCar, t: Math.random() });
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
for (let i = 0; i < 300; i++) {
    const mark = new THREE.Mesh(skidGeo, skidMat); mark.visible = false;
    scene.add(mark); skidMarks.push(mark);
}
let skidIndex = 0;

const arLineGroup = new THREE.Group();
scene.add(arLineGroup);
for (let i = 0; i < 100; i++) {
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 3), mat);
    plane.visible = false; arLineGroup.add(plane);
}

// ================= 升级版：科幻声浪音频引擎 =================
let soundEnabled = false;
let audioCtx = null, osc = null, gainNode = null, filter = null, distortion = null;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        osc = audioCtx.createOscillator();
        osc.type = 'sawtooth'; // 锯齿波作为基础
        osc.frequency.value = 100;

        distortion = audioCtx.createWaveShaper();
        // 生成非线性失真曲线
        const k = 50;
        const n = 44100;
        const curve = new Float32Array(n);
        const deg = Math.PI / 180;
        for (let i = 0; i < n; i++) {
            const x = (i * 2) / n - 1;
            curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
        }
        distortion.curve = curve;

        filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 800; // 初始低通

        gainNode = audioCtx.createGain();
        gainNode.gain.value = 0;

        osc.connect(distortion);
        distortion.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        osc.start();
    }
}

let currentMode = 'manual'; let driftScore = 0;
const hudSpeed = document.getElementById('hud-speed'); const hudGear = document.getElementById('hud-gear');
const sysLog = document.getElementById('sys-log'); const driftHint = document.getElementById('drift-hint');
const driftScoreEl = document.getElementById('drift-score'); const overdriveHint = document.getElementById('overdrive-hint');
const speedLines = document.getElementById('speed-lines'); const hudMode = document.getElementById('hud-mode');

// 获取电耗 DOM
const valBattery = document.getElementById('val-battery');
const valPower = document.getElementById('val-power');
const valWeather = document.getElementById('val-weather');

const driving = new DrivingController(vehicle.group, vehicle, env, {
    onModeChange: (mode) => { currentMode = mode; updateModeUI(mode); },
    onLog: (msg) => logMsg(msg),
    onBoostPad: () => { logMsg("🚀 加速带触发！"); bloomPass.strength = 3.0; camera.fov = 90; },
    onLaunchReady: () => { document.getElementById('launch-hint').style.display = 'block'; },
    onLaunch: () => { document.getElementById('launch-hint').style.display = 'none'; logMsg("⚡ 弹射起步！"); bloomPass.strength = 2.5; },
    onLaunchCancel: () => { document.getElementById('launch-hint').style.display = 'none'; },
    onParkingComplete: () => { logMsg("泊车完成，已驻车"); },
    onParkingFail: () => { logMsg("无空车位"); }
});

const rig = new CameraRig(camera, renderer.domElement, vehicle.group);
rig.controls.target.set(0, 0.9, 0);

function logMsg(text) {
    const div = document.createElement('div'); div.className = 'log-line'; div.textContent = `> ${text}`;
    sysLog.appendChild(div); if (sysLog.children.length > 4) sysLog.removeChild(sysLog.firstChild);
}

const btnLCC = document.getElementById('btn-lcc'), btnNCA = document.getElementById('btn-nca');
const btnACC = document.getElementById('btn-acc'), btnRCA = document.getElementById('btn-rca');
const btnStunt = document.getElementById('btn-stunt'), btnPark = document.getElementById('btn-park');
const btnRacingLine = document.getElementById('btn-racingline'), btnGhost = document.getElementById('btn-ghost');
const btnSound = document.getElementById('btn-sound'), btnOnepedal = document.getElementById('btn-onepedal');
const btnHazard = document.getElementById('btn-hazard'), btnDayNight = document.getElementById('btn-daynight');
const btnWeather = document.getElementById('btn-weather'), btnAutoWeather = document.getElementById('btn-auto-weather');

btnLCC.addEventListener('click', () => { currentMode === 'lcc' ? driving.stopAutopilot() : driving.startAutopilot('lcc'); });
btnNCA.addEventListener('click', () => { currentMode === 'nca' ? driving.stopAutopilot() : driving.startAutopilot('nca'); });
btnACC.addEventListener('click', () => { currentMode === 'acc' ? driving.stopAutopilot() : driving.startAutopilot('acc'); });
btnRCA.addEventListener('click', () => { currentMode === 'rca' ? driving.stopAutopilot() : driving.startAutopilot('rca'); });
btnStunt.addEventListener('click', () => { if (driving.mode !== 'manual') driving.stopAutopilot(); driving.startStunt(); document.querySelector('[data-view="orbit"]').click(); });

btnPark.addEventListener('click', () => {
    if (driving.mode === 'parking') {
        driving.mode = 'manual'; driving.speed = 0; driving.parkingAnim = null; driving.parkingPath = null;
        updateModeUI('manual'); logMsg("泊车已取消");
    } else {
        if (driving.mode !== 'manual') driving.stopAutopilot();
        driving.startParking();
        document.querySelector('[data-view="driver"]').click();
    }
});

let showRacingLine = false;
btnRacingLine.addEventListener('click', () => { showRacingLine = !showRacingLine; btnRacingLine.classList.toggle('active', showRacingLine); });

let showGhost = true;
btnGhost.addEventListener('click', () => { showGhost = !showGhost; btnGhost.classList.toggle('active', showGhost); if (ghostCar) ghostCar.visible = showGhost; });

btnSound.addEventListener('click', () => {
    initAudio(); if (audioCtx.state === 'suspended') audioCtx.resume();
    soundEnabled = !soundEnabled; btnSound.classList.toggle('active', soundEnabled);
    logMsg(soundEnabled ? "科幻电机声浪已开启" : "声浪已静音");
    if (!soundEnabled) gainNode.gain.value = 0;
});

let isOnepedal = false;
btnOnepedal.addEventListener('click', () => { isOnepedal = !isOnepedal; driving.onepedal = isOnepedal; btnOnepedal.classList.toggle('active', isOnepedal); });

let hazardOn = false;
btnHazard.addEventListener('click', () => { hazardOn = !hazardOn; btnHazard.classList.toggle('active', hazardOn); });

// ================= 天气与日夜系统 =================
let currentEnv = 'day';
let isRaining = false;

function applyEnvironment() {
    if (currentEnv === 'day') {
        scene.background.setHex(0x87a5c4); scene.fog.color.setHex(0x87a5c4);
        sun.color.setHex(0xfff5e6); sun.position.set(100, 100, 50); sun.intensity = 3.0; hemiLight.intensity = 1.0;
        btnDayNight.textContent = '切换黄昏';
    } else if (currentEnv === 'dusk') {
        scene.background.setHex(0x3a2015); scene.fog.color.setHex(0x3a2015);
        sun.color.setHex(0xff7733); sun.position.set(-50, 20, 50); sun.intensity = 1.5; hemiLight.intensity = 0.4;
        btnDayNight.textContent = '切换黑夜';
    } else {
        scene.background.setHex(0x050810); scene.fog.color.setHex(0x050810);
        sun.intensity = 0.1; hemiLight.intensity = 0.1;
        btnDayNight.textContent = '切换白天';
    }

    env.rain.visible = isRaining;
    btnWeather.textContent = isRaining ? '关闭雨天' : '开启雨天';
    if (isRaining) env.trackMat.roughness = 0.2; else env.trackMat.roughness = 0.9;

    // 更新左侧面板
    let weatherText = isRaining ? '雨天' : '晴天';
    if (currentEnv === 'dusk') weatherText = isRaining ? '黄昏·雨' : '黄昏';
    if (currentEnv === 'night') weatherText = isRaining ? '黑夜·雨' : '黑夜';
    valWeather.textContent = weatherText;
}

btnDayNight.addEventListener('click', () => {
    if (currentEnv === 'day') currentEnv = 'dusk';
    else if (currentEnv === 'dusk') currentEnv = 'night';
    else currentEnv = 'day';
    applyEnvironment();
});

btnWeather.addEventListener('click', () => {
    isRaining = !isRaining;
    applyEnvironment();
});

btnAutoWeather.addEventListener('click', () => {
    // 随机切换天气和时辰
    const envs = ['day', 'dusk', 'night'];
    currentEnv = envs[Math.floor(Math.random() * envs.length)];
    isRaining = Math.random() > 0.5;
    applyEnvironment();
    logMsg(`环境自动切换: ${valWeather.textContent}`);
});

function updateModeUI(mode) {
    [btnLCC, btnNCA, btnACC, btnRCA].forEach(b => b.classList.remove('active'));
    if (mode === 'lcc') { btnLCC.classList.add('active'); hudMode.textContent = 'LCC 巡航'; }
    else if (mode === 'nca') { btnNCA.classList.add('active'); hudMode.textContent = 'NCA 领航'; }
    else if (mode === 'acc') { btnACC.classList.add('active'); hudMode.textContent = 'ACC 自适应'; }
    else if (mode === 'rca') { btnRCA.classList.add('active'); hudMode.textContent = 'RCA 漫游'; }
    else if (mode === 'parking') { hudMode.textContent = '泊车中'; }
    else { hudMode.textContent = '手动驾驶'; }
}

document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('[data-view]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active'); rig.setMode(btn.dataset.view);
        rearViewMirror.style.display = (btn.dataset.view === 'driver' || driving.mode === 'parking') ? 'block' : 'none';
    });
});

const limitSlider = document.getElementById('limit-slider');
const limitVal = document.getElementById('limit-val');
limitSlider.addEventListener('input', (e) => { driving.manualMaxSpeed = parseInt(e.target.value) / 3.6; limitVal.textContent = e.target.value; });

// ================= 默认设备判定 (电脑端默认键盘) =================
const btnInputKeyboard = document.getElementById('btn-input-keyboard');
const btnInputJoystick = document.getElementById('btn-input-joystick');
const joystickContainer = document.getElementById('joystick-container');

// 严格检测手机端 (只有有 touch 事件才切摇杆)
const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
if (isTouchDevice && window.innerWidth < 1024) {
    driving.inputMethod = 'joystick';
    joystickContainer.style.display = 'flex';
    btnInputKeyboard.classList.remove('active'); btnInputJoystick.classList.add('active');
} else {
    driving.inputMethod = 'keyboard';
}

function setInputMethod(method) {
    driving.inputMethod = method;
    if (method === 'keyboard') { joystickContainer.style.display = 'none'; btnInputKeyboard.classList.add('active'); btnInputJoystick.classList.remove('active'); }
    else { joystickContainer.style.display = 'flex'; btnInputKeyboard.classList.remove('active'); btnInputJoystick.classList.add('active'); }
}
btnInputKeyboard.addEventListener('click', () => setInputMethod('keyboard'));
btnInputJoystick.addEventListener('click', () => setInputMethod('joystick'));

// 摇杆操作逻辑...
const joyLeft = document.getElementById('joy-left'), joyRight = document.getElementById('joy-right');
const stickL = joyLeft.querySelector('.joystick-stick'), stickR = joyRight.querySelector('.joystick-stick');
function setupJoy(base, stick, cb) {
    let id = null; const max = base.clientWidth / 2;
    const start = (e) => { e.preventDefault(); const t = e.changedTouches ? e.changedTouches[0] : e; id = t.identifier !== undefined ? t.identifier : 'mouse'; move(e); };
    const move = (e) => { if (id === null) return; let t; if (e.changedTouches) { for (let i = 0; i < e.touches.length; i++) if (e.touches[i].identifier === id) t = e.touches[i]; } else t = e; if (!t) return; const r = base.getBoundingClientRect(); let dx = t.clientX - (r.left + r.width / 2); let dy = t.clientY - (r.top + r.height / 2); const d = Math.hypot(dx, dy); if (d > max) { dx = (dx / d) * max; dy = (dy / d) * max; } stick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`; cb(dx / max, dy / max); };
    const end = () => { id = null; stick.style.transform = `translate(-50%, -50%)`; cb(0, 0); };
    base.addEventListener('touchstart', start, { passive: false }); base.addEventListener('touchmove', move, { passive: false }); base.addEventListener('touchend', end); base.addEventListener('touchcancel', end);
    base.addEventListener('mousedown', start); window.addEventListener('mousemove', e => { if (id === 'mouse') move(e); }); window.addEventListener('mouseup', e => { if (id === 'mouse') end(); });
}
setupJoy(joyLeft, stickL, (x, y) => driving.joySteer = -x);
setupJoy(joyRight, stickR, (x, y) => driving.joyThrottle = y);

const btnJoyHandbrake = document.getElementById('btn-joy-handbrake');
const btnJoyOverdrive = document.getElementById('btn-joy-overdrive');
const pressHandbrake = (e) => { e.preventDefault(); driving.keys.handbrake = true; btnJoyHandbrake.classList.add('active'); };
const releaseHandbrake = () => { driving.keys.handbrake = false; btnJoyHandbrake.classList.remove('active'); };
btnJoyHandbrake.addEventListener('touchstart', pressHandbrake, { passive: false });
btnJoyHandbrake.addEventListener('mousedown', pressHandbrake);
btnJoyHandbrake.addEventListener('touchend', releaseHandbrake);
btnJoyHandbrake.addEventListener('mouseup', releaseHandbrake);
btnJoyHandbrake.addEventListener('mouseleave', releaseHandbrake);

const pressOverdrive = (e) => { e.preventDefault(); driving.keys.shift = true; btnJoyOverdrive.classList.add('active'); };
const releaseOverdrive = () => { driving.keys.shift = false; btnJoyOverdrive.classList.remove('active'); };
btnJoyOverdrive.addEventListener('touchstart', pressOverdrive, { passive: false });
btnJoyOverdrive.addEventListener('mousedown', pressOverdrive);
btnJoyOverdrive.addEventListener('touchend', releaseOverdrive);
btnJoyOverdrive.addEventListener('mouseup', releaseOverdrive);
btnJoyOverdrive.addEventListener('mouseleave', releaseOverdrive);

const clock = new THREE.Clock();
function animate() {
    const dt = Math.min(clock.getDelta(), 0.05);
    driving.update(dt, aiCars); rig.update(dt);

    const currentSpeed = Math.round(driving.getSpeedKmh());

    // AI 车流
    aiCars.forEach(car => {
        car.t += (15 * dt) / driving.autopilotLength; car.t %= 1;
        car.mesh.position.copy(driving.autopilotCurve.getPointAt(car.t));
        car.mesh.rotation.y = Math.atan2(driving.autopilotCurve.getTangentAt(car.t).x, driving.autopilotCurve.getTangentAt(car.t).z);
    });

    // 后视镜
    if (rig.mode === 'driver' || driving.mode === 'parking') {
        rearViewMirror.style.display = 'block';
        mirrorFrame++;
        if (mirrorFrame % 3 === 0) {
            renderer.setRenderTarget(mirrorTarget);
            if (driving.mode === 'parking') {
                rig.rearCam.position.copy(vehicle.group.position).add(new THREE.Vector3(0, 2.5, -3).applyQuaternion(vehicle.group.quaternion));
                rig.rearCam.lookAt(vehicle.group.position.x, 0, vehicle.group.position.z);
            } else {
                rig.rearCam.position.copy(vehicle.group.position).add(new THREE.Vector3(0, 1.2, -1).applyQuaternion(vehicle.group.quaternion));
                const rearForward = new THREE.Vector3(0, -0.1, -1).applyQuaternion(vehicle.group.quaternion);
                rig.rearCam.lookAt(rig.rearCam.position.clone().add(rearForward.multiplyScalar(10)));
            }
            renderer.render(scene, rig.rearCam);
            renderer.setRenderTarget(null);
            mirrorCtx.drawImage(renderer.domElement, 0, renderer.domElement.height - 150, 300, 150, 0, 0, 300, 150);
        }
    } else {
        rearViewMirror.style.display = 'none';
    }

    // ================= 修复并优化：实时数据 UI 更新 =================
    valBattery.textContent = Math.round(driving.battery) + '%';
    valPower.textContent = driving.powerConsumption.toFixed(1) + ' kWh/100km';

    // 自动大灯控制
    const shouldHeadlightOn = currentEnv === 'night' || currentEnv === 'dusk' || isRaining;
    vehicle.headlight.intensity = shouldHeadlightOn ? 15 : 0;
    vehicle.lightWhite.emissiveIntensity = shouldHeadlightOn ? 3.0 : 0.1;
    vehicle.lightRed.emissiveIntensity = (driving.keys.s || driving.keys.handbrake || (isOnepedal && !driving.keys.w && currentSpeed > 0)) ? 5.0 : (shouldHeadlightOn ? 2.0 : 0.1);

    // 漂移烟雾
    const isDrifting = driving.isStunting || ((Math.abs(driving.driftAngle) > 0.15 || driving.keys.handbrake) && currentSpeed > 5);
    const allowSmoke = rig.mode !== 'chase';

    if (isDrifting && allowSmoke) {
        if (!driving.isStunting) {
            driftScore += Math.floor((driving.driftAngle + 0.1) * 100 * dt);
            driftScoreEl.textContent = driftScore;
        }
        driftHint.style.opacity = 1;

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

    // ================= 升级版：声浪实时控制 =================
    if (soundEnabled && osc && filter) {
        const targetFreq = 100 + currentSpeed * 8;
        osc.frequency.setTargetAtTime(targetFreq, audioCtx.currentTime, 0.1);

        const targetFilter = 400 + currentSpeed * 30;
        filter.frequency.setTargetAtTime(targetFilter, audioCtx.currentTime, 0.1);

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