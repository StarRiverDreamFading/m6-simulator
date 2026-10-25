import * as THREE from 'three';
const GEAR = { P: 'P', D: 'D', R: 'R', N: 'N' };

export class DrivingController {
    constructor(car, vehicle, env, callbacks = {}) {
        this.car = car; this.vehicle = vehicle; this.env = env; this.callbacks = callbacks;

        const startPoint = env.autopilotCurve.getPointAt(0);
        const startTangent = env.autopilotCurve.getTangentAt(0);
        this.position = new THREE.Vector3(startPoint.x, 0, startPoint.z);
        this.yaw = Math.atan2(startTangent.x, startTangent.z);

        this.speed = 0; this.steer = 0; this.gear = GEAR.P;
        this.mode = 'manual'; this.autopilotMode = 'lcc';

        this.maxSpeed = 33; this.accelForce = 12;
        this.manualMaxSpeed = 120 / 3.6;
        this.autopilotTargetSpeed = 80 / 3.6;

        this.pitch = 0; this.roll = 0; this.driftAngle = 0;

        this.autopilotT = 0;
        this.autopilotCurve = env.autopilotCurve;
        this.autopilotLength = this.autopilotCurve.getLength();

        this.wheelbase = 2.95; this.maxSteer = 0.55;
        this.keys = { w: false, s: false, a: false, d: false, handbrake: false, shift: false };

        this.ncaAvoidOffset = 0; this.onepedal = false; this.inSlipstream = false;
        this.launchReady = false; this.launchTimer = 0;
        this.overdriveEnergy = 100; this.isOverdrive = false;

        // 初始化电量从本地缓存读取
        const savedBattery = localStorage.getItem('m6_battery');
        this.battery = savedBattery !== null ? parseFloat(savedBattery) : 100;
        this.powerConsumption = 0;

        this.isCharging = false; // 充电状态

        this.isStunting = false; this.stuntTimer = 0; this.stuntAngle = 0;
        this.stuntCenter = new THREE.Vector3();

        this.inputMethod = 'keyboard';
        this.joySteer = 0; this.joyThrottle = 0;

        this.isIncapacitated = false;
        this.isP2PActive = false;
        this.p2pPhase = 'cruise';
        this.lastInputTime = performance.now();
        this.parkingAnim = null; this.parkingPath = null;

        this.useALC = true;
        this.useTJA = true;
        this.useAEB = true;
        this.useBSD = true;

        this.bsdAlert = false;
        this.bsdAlertR = false;

        this._bindKeys();
        this.applyToCar(0);
    }

    setDriveMode(mode) {
        if (mode === 'eco') { this.maxSpeed = 22; this.accelForce = 8; }
        else if (mode === 'sport') { this.maxSpeed = 50; this.accelForce = 20; }
        else { this.maxSpeed = 33; this.accelForce = 12; }
    }

    _bindKeys() {
        const down = (e) => {
            const k = e.key.toLowerCase();
            if (['w', 's', 'a', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'shift'].includes(k)) e.preventDefault();

            this.lastInputTime = performance.now();

            if (this.isStunting || this.isIncapacitated) return;

            if (k === 'w' || k === 'arrowup') this.keys.w = true;
            if (k === 's' || k === 'arrowdown') { this.keys.s = true; this.exitAuto(); }
            if (k === 'a' || k === 'arrowleft') { this.keys.a = true; if (this.mode !== 'autopilot' || this.autopilotMode !== 'nca') this.exitAuto(); }
            if (k === 'd' || k === 'arrowright') { this.keys.d = true; if (this.mode !== 'autopilot' || this.autopilotMode !== 'nca') this.exitAuto(); }
            if (k === ' ') { this.keys.handbrake = true; this.exitAuto(); }
            if (k === 'shift') this.keys.shift = true;
        };
        const up = (e) => {
            const k = e.key.toLowerCase();
            if (k === 'w' || k === 'arrowup') this.keys.w = false;
            if (k === 's' || k === 'arrowdown') this.keys.s = false;
            if (k === 'a' || k === 'arrowleft') this.keys.a = false;
            if (k === 'd' || k === 'arrowright') this.keys.d = false;
            if (k === ' ') this.keys.handbrake = false;
            if (k === 'shift') this.keys.shift = false;
        };
        window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    }

    exitAuto() {
        if (this.mode === 'autopilot' || this.isP2PActive) {
            this.mode = 'manual';
            this.isP2PActive = false;
            this.callbacks.onModeChange?.('manual');
            this.callbacks.onLog?.("驾驶员已接管车辆");
        }
    }

    startAutopilot(mode) {
        if (this.mode === 'parking' || this.isStunting || this.isIncapacitated) return;
        this.autopilotMode = mode;
        let bestT = 0, bestDist = Infinity;
        for (let i = 0; i < 200; i++) {
            const p = this.autopilotCurve.getPointAt(i / 200);
            const d = p.distanceToSquared(this.position);
            if (d < bestDist) { bestDist = d; bestT = i / 200; }
        }
        this.autopilotT = bestT; this.mode = 'autopilot'; this.gear = GEAR.D;
        this.callbacks.onModeChange?.(mode);
    }

    stopAutopilot() {
        if (this.mode === 'autopilot') { this.mode = 'manual'; this.callbacks.onModeChange?.('manual'); }
    }

    startP2P() {
        if (this.isIncapacitated || this.isStunting) return;
        this.isP2PActive = true;
        this.p2pPhase = 'cruise';
        this.startAutopilot('nca');
        this.callbacks.onLog?.("🚘 车位到车位已激活，正在巡航寻找车位...");
    }

    triggerIncapacitation() {
        if (this.isIncapacitated) return;
        this.isIncapacitated = true;
        this.mode = 'manual';
        this.isP2PActive = false;
        this.callbacks.onDIAStart?.();
    }

    recoverFromIncapacitation() {
        this.isIncapacitated = false;
        this.callbacks.onDIARecover?.();
    }

    update(dt, aiCars = []) {
        const timeSinceInput = performance.now() - this.lastInputTime;
        if ((timeSinceInput > 15000 && !this.isIncapacitated && this.mode === 'manual' && this.speed > 2) || this.isIncapacitated) {
            this.triggerIncapacitation();
        }

        if (this.isIncapacitated) {
            this.keys.w = false; this.keys.shift = false;
            this.callbacks.onHazardOn?.();

            let minDistSq = Infinity;
            let closestPoint = null;
            let closestTangent = null;
            for (let i = 0; i <= 100; i++) {
                const p = this.autopilotCurve.getPointAt(i / 100);
                const d = p.distanceToSquared(this.position);
                if (d < minDistSq) { minDistSq = d; closestPoint = p; closestTangent = this.autopilotCurve.getTangentAt(i / 100); }
            }

            const normal = new THREE.Vector3(-closestTangent.z, 0, closestTangent.x).normalize();
            const targetEdgePos = closestPoint.clone().add(normal.multiplyScalar(-6));

            const toTarget = targetEdgePos.clone().sub(this.position);
            const targetYaw = Math.atan2(toTarget.x, toTarget.z);
            let diff = targetYaw - this.yaw;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;

            this.steer = THREE.MathUtils.clamp(diff * 2.0, -this.maxSteer, this.maxSteer);

            const distToEdge = toTarget.length();
            if (distToEdge > 1.5) {
                this.speed += (8 / 3.6 - this.speed) * dt * 2;
            } else {
                this.speed *= Math.max(0, 1 - dt * 3);
                if (this.speed < 0.1) this.speed = 0;
            }

            if (Math.abs(this.speed) > 0.01) {
                const angularVel = (this.speed / this.wheelbase) * Math.tan(this.steer);
                this.yaw += angularVel * dt;
                this.position.x += Math.sin(this.yaw) * this.speed * dt;
                this.position.z += Math.cos(this.yaw) * this.speed * dt;
            }

            this.applyToCar(dt, -1, this.speed < 0.1);
            return;
        }

        if (this.isStunting) { this.updateStunt(dt); return; }

        // ================= 新增：充电检测 =================
        this.isCharging = false;
        if (this.env.chargingStations) {
            for (const station of this.env.chargingStations) {
                const dist = this.position.distanceTo(station.position);
                // 距离充电桩 5 米内，且车速低于 2km/h 时开始充电
                if (dist < 5 && Math.abs(this.speed) < 0.5) {
                    this.isCharging = true;
                    this.speed = 0; // 强制锁车
                    this.battery = Math.min(100, this.battery + dt * 10); // 每秒充 10%
                    break;
                }
            }
        }
        // ==================================================

        // BSD 检测
        this.bsdAlert = false;
        this.bsdAlertR = false;
        let minDistL = Infinity;
        let minDistR = Infinity;

        aiCars.forEach(car => {
            const toCar = car.mesh.position.clone().sub(this.position);
            const localCar = toCar.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);

            if (localCar.x > 1.2 && localCar.x < 5.5 && localCar.z < 3 && localCar.z > -10) {
                if (localCar.length() < minDistL) minDistL = localCar.length();
            }
            if (localCar.x < -1.2 && localCar.x > -5.5 && localCar.z < 3 && localCar.z > -10) {
                if (localCar.length() < minDistR) minDistR = localCar.length();
            }
        });

        if (minDistL < 6) this.bsdAlert = true;
        if (minDistR < 6) this.bsdAlertR = true;

        if (this.isP2PActive) {
            if (this.p2pPhase === 'cruise') {
                this.updateAutopilot(dt, aiCars);
                this.applyToCar(dt, -1, false);
                if (this.autopilotT > 0.95 && this.env.parkingSpots) {
                    let emptySpot = this.env.parkingSpots.find(s => !s.occupied);
                    if (emptySpot) {
                        this.p2pPhase = 'park';
                        this.startParking();
                        this.isP2PActive = false;
                        this.callbacks.onLog?.("🚘 发现空闲车位，自动泊入中...");
                    }
                }
            }
        } else if (this.mode === 'autopilot') {
            this.updateAutopilot(dt, aiCars);
            this.applyToCar(dt, -1, false);
        } else if (this.mode === 'parking') {
            this.updateParking(dt);
        } else if (this.isCharging) {
            // 充电中，禁止操作
            this.applyToCar(dt, -1, true);
        } else {
            if (this.keys.w && this.keys.s && this.speed < 0.5) {
                if (!this.launchReady) { this.launchReady = true; this.callbacks.onLaunchReady?.(); }
            } else if (this.launchReady) {
                if (this.keys.w && !this.keys.s) { this.launchReady = false; this.launchTimer = 2.5; this.callbacks.onLaunch?.(); }
                else if (!this.keys.w) { this.launchReady = false; this.callbacks.onLaunchCancel?.(); }
            }

            if (this.keys.shift && this.overdriveEnergy > 0 && this.speed > 0) {
                this.isOverdrive = true; this.overdriveEnergy -= dt * 20;
                if (this.overdriveEnergy <= 0) { this.overdriveEnergy = 0; this.isOverdrive = false; }
            } else {
                this.isOverdrive = false; this.overdriveEnergy = Math.min(100, this.overdriveEnergy + dt * 10);
            }

            const currentSpeedKmh = Math.abs(this.speed) * 3.6;
            if (currentSpeedKmh > 1) {
                const drain = (0.005 + (currentSpeedKmh / 100) * 0.05) * dt;
                this.battery = Math.max(0, this.battery - drain);
                const targetCons = 12 + Math.pow(currentSpeedKmh / 40, 2) * 5;
                this.powerConsumption += (targetCons - this.powerConsumption) * dt * 3;
                if (this.battery <= 0) { this.speed = 0; this.battery = 0; }
            } else {
                this.powerConsumption += (0 - this.powerConsumption) * dt * 2;
            }

            const res = this.updateManual(dt);
            this.applyToCar(dt, res.accel, res.isBraking);
        }

        // 保存电量到本地
        localStorage.setItem('m6_battery', this.battery.toString());

        if (Math.abs(this.speed) > 5) {
            this.driftAngle = Math.abs(this.steer) * (this.speed / 15);
            if (this.keys.handbrake || (this.inputMethod === 'joystick' && this.joyThrottle > 0.8)) this.driftAngle += 0.2;
        } else { this.driftAngle = 0; }
    }

    updateAutopilot(dt, aiCars) {
        let targetSpd = this.autopilotTargetSpeed;

        if (this.autopilotMode === 'nca' && this.useALC) {
            if (this.keys.a || (this.inputMethod === 'joystick' && this.joySteer < -0.5)) {
                if (this.bsdAlert && this.useBSD) {
                    this.callbacks.onLog?.("⚠️ 盲区有车，变道已取消");
                    this.ncaAvoidOffset = 0;
                } else {
                    this.ncaAvoidOffset = THREE.MathUtils.lerp(this.ncaAvoidOffset, 3.5, dt * 2);
                }
            } else if (this.keys.d || (this.inputMethod === 'joystick' && this.joySteer > 0.5)) {
                if (this.bsdAlertR && this.useBSD) {
                    this.callbacks.onLog?.("⚠️ 盲区有车，变道已取消");
                    this.ncaAvoidOffset = 0;
                } else {
                    this.ncaAvoidOffset = THREE.MathUtils.lerp(this.ncaAvoidOffset, -3.5, dt * 2);
                }
            } else {
                this.ncaAvoidOffset = THREE.MathUtils.lerp(this.ncaAvoidOffset, 0, dt * 2);
            }
        }

        let minDistanceFront = Infinity;
        const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

        aiCars.forEach(car => {
            const toCar = car.mesh.position.clone().sub(this.position);
            const dist = toCar.length(); toCar.normalize();
            if (forward.dot(toCar) > 0.8 && dist < 25) {
                if (dist < minDistanceFront) minDistanceFront = dist;
            }
        });

        if (this.useAEB && minDistanceFront < 6 && this.speed > 2) {
            targetSpd = 0;
            this.callbacks.onAEBTriggered?.();
        } else if (this.useTJA && minDistanceFront < 15 && this.speed < 30 / 3.6) {
            targetSpd = Math.min(targetSpd, (minDistanceFront - 6) * 1.5);
        } else if (this.autopilotMode === 'acc') {
            if (minDistanceFront < 15) {
                targetSpd = Math.min(targetSpd, (minDistanceFront - 5) * 1.5);
            }
        }

        const lookAheadT = (this.autopilotT + 0.03) % 1;
        const p1 = this.autopilotCurve.getTangentAt(this.autopilotT);
        const p2 = this.autopilotCurve.getTangentAt(lookAheadT);
        const curvature = Math.acos(Math.min(1, Math.max(-1, p1.dot(p2))));
        const curveSpeedFactor = Math.max(0.65, 1.0 - curvature * 10);
        targetSpd *= curveSpeedFactor;

        this.speed += (targetSpd - this.speed) * Math.min(1, dt * 3);
        this.gear = GEAR.D;

        const lookAheadDist = 6 + this.speed * 0.6;
        const advanceT = (this.autopilotT + (lookAheadDist / this.autopilotLength)) % 1;

        const targetPoint = this.autopilotCurve.getPointAt(advanceT);
        const targetTangent = this.autopilotCurve.getTangentAt(advanceT);
        const targetNormal = new THREE.Vector3(-targetTangent.z, 0, targetTangent.x).normalize();

        const finalTargetPos = targetPoint.clone().add(targetNormal.multiplyScalar(this.ncaAvoidOffset));

        const toTarget = finalTargetPos.clone().sub(this.position);
        const targetYaw = Math.atan2(toTarget.x, toTarget.z);

        let diff = targetYaw - this.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        const steerSmooth = this.autopilotMode === 'rca' ? 4 : 8;
        this.yaw += diff * Math.min(1, dt * steerSmooth);
        this.steer = THREE.MathUtils.clamp(diff * 2.5, -this.maxSteer, this.maxSteer);

        this.position.x += Math.sin(this.yaw) * this.speed * dt;
        this.position.z += Math.cos(this.yaw) * this.speed * dt;

        this.autopilotT += (this.speed * dt) / this.autopilotLength;
        this.autopilotT = ((this.autopilotT % 1) + 1) % 1;
    }

    updateManual(dt) {
        if (this.launchReady) { this.speed = 0; return { accel: 0, isBraking: true }; }
        if (this.launchTimer > 0) {
            this.launchTimer -= dt; const launchAccel = this.accelForce * 3.5; this.speed += launchAccel * dt;
            if (Math.abs(this.speed) > 0.01) {
                const angularVel = (this.speed / this.wheelbase) * Math.tan(this.steer);
                this.yaw += angularVel * dt;
                this.position.x += Math.sin(this.yaw) * this.speed * dt; this.position.z += Math.cos(this.yaw) * this.speed * dt;
            }
            return { accel: launchAccel, isBraking: false };
        }

        let steerInput = 0;
        let throttleInput = 0;

        if (this.inputMethod === 'keyboard') {
            steerInput = (this.keys.a ? 1 : 0) - (this.keys.d ? 1 : 0);
            if (this.keys.w) throttleInput = 1;
            else if (this.keys.s) throttleInput = -1;
        } else {
            steerInput = this.joySteer;
            throttleInput = -this.joyThrottle;
        }

        if (this.useBSD && this.speed > 10) {
            if (this.bsdAlert && steerInput > 0) steerInput *= 0.2;
            if (this.bsdAlertR && steerInput < 0) steerInput *= 0.2;
        }

        this.steer += (steerInput * this.maxSteer - this.steer) * Math.min(1, dt * 8);

        let accel = 0; let isBraking = false;

        if (this.keys.handbrake) {
            this.speed *= Math.max(0, 1 - dt * 8); isBraking = true;
        }
        else if (throttleInput > 0.1) {
            this.gear = GEAR.D;
            let currentLimit = this.manualMaxSpeed; let currentForce = this.accelForce;
            if (this.isOverdrive) { currentLimit = 60; currentForce = this.accelForce * 2.5; }
            if (this.speed < currentLimit) {
                accel = (this.inSlipstream ? currentForce * 1.3 : currentForce) * throttleInput;
            }
        } else if (throttleInput < -0.1) {
            if (this.speed > 0.2) { accel = -this.accelForce * 1.5 * Math.abs(throttleInput); isBraking = true; }
            else { this.gear = GEAR.R; accel = -this.accelForce * 0.6 * Math.abs(throttleInput); }
        } else {
            if (this.onepedal && this.speed > 0) accel = -this.accelForce * 0.6;
            else this.speed *= Math.max(0, 1 - dt * 0.6);
            if (Math.abs(this.speed) < 0.05) this.speed = 0;
        }

        this.speed += accel * dt;

        const hardLimit = this.isOverdrive ? 60 : this.manualMaxSpeed;
        if (this.speed > hardLimit) this.speed = hardLimit;
        if (this.speed < -8) this.speed = -8;
        if (this.speed > -0.3 && this.speed < 0.3 && Math.abs(throttleInput) < 0.1) this.gear = GEAR.P;

        if (Math.abs(this.speed) > 0.01) {
            const angularVel = (this.speed / this.wheelbase) * Math.tan(this.steer);
            this.yaw += angularVel * dt;
            this.position.x += Math.sin(this.yaw) * this.speed * dt; this.position.z += Math.cos(this.yaw) * this.speed * dt;
        }
        return { accel, isBraking };
    }

    startStunt() {
        if (this.isStunting || this.isIncapacitated || this.mode === 'parking' || this.isCharging) return;
        this.isStunting = true; this.stuntTimer = 5.0;
        this.stuntAngle = Math.atan2(this.position.z, this.position.x);
        const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
        const right = new THREE.Vector3(-forward.z, 0, forward.x);
        this.stuntCenter.copy(this.position).add(right.multiplyScalar(6));
        this.mode = 'manual'; this.callbacks.onModeChange?.('manual'); this.callbacks.onLog?.("🔥 自动特技启动：极限画圈漂移");
    }

    updateStunt(dt) {
        this.stuntTimer -= dt;
        if (this.stuntTimer <= 0) {
            this.isStunting = false; this.speed = 0; this.steer = 0; this.roll = 0; this.pitch = 0;
            this.callbacks.onLog?.("特技结束，控制权已交还"); this.applyToCar(dt, 0, false); return;
        }
        const radius = 6;
        this.stuntAngle += 2.8 * dt;
        this.position.x = this.stuntCenter.x + Math.cos(this.stuntAngle) * radius;
        this.position.z = this.stuntCenter.z + Math.sin(this.stuntAngle) * radius;
        const tangentAngle = this.stuntAngle + Math.PI / 2;
        this.yaw = tangentAngle + 0.7;
        this.steer = this.maxSteer; this.speed = 18; this.roll = 0.15; this.pitch = -0.05;
        this.car.position.copy(this.position); this.car.rotation.y = this.yaw;
        this.vehicle.bodyGroup.rotation.x = this.pitch; this.vehicle.bodyGroup.rotation.z = this.roll;
        const spinDelta = (this.speed * 0.016) / this.vehicle.wheelRadius;
        Object.values(this.vehicle.wheels).forEach(w => w.spinGroup.rotation.x -= spinDelta);
        this.vehicle.wheels.FL.steerPivot.rotation.y = this.steer; this.vehicle.wheels.FR.steerPivot.rotation.y = this.steer;
    }

    startParking() {
        if (this.mode === 'parking' || this.isCharging) return;
        let best = null, bestDist = Infinity;
        for (const s of this.env.parkingSpots) {
            if (s.occupied) continue;
            const d = (s.x - this.position.x) ** 2 + (s.z - this.position.z) ** 2;
            if (d < bestDist) { bestDist = d; best = s; }
        }
        if (!best) { this.callbacks.onParkingFail?.(); return; }

        this.mode = 'parking'; this.speed = 0; this.steer = 0; this.gear = GEAR.R; best.occupied = true;
        const p0 = this.position.clone();
        const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
        const p1 = p0.clone().add(forward.multiplyScalar(4));
        const p2 = new THREE.Vector3(best.x + (best.x > 50 ? 3 : -3), 0, best.z + 3);
        const p3 = new THREE.Vector3(best.x, 0, best.z);
        this.parkingPath = new THREE.CatmullRomCurve3([p0, p1, p2, p3]);
        this.parkingAnim = { t: 0, duration: 4.0, spot: best };
        this.callbacks.onModeChange?.('parking');
    }

    updateParking(dt) {
        const anim = this.parkingAnim;
        if (!anim || !this.parkingPath) return;
        anim.t += dt / anim.duration;
        const t = Math.min(1, anim.t);
        const ease = t * t * (3 - 2 * t);
        const p = this.parkingPath.getPointAt(ease);
        const tangent = this.parkingPath.getTangentAt(ease);
        this.position.copy(p);
        let targetYaw = Math.atan2(-tangent.x, -tangent.z);
        if (ease < 0.2) targetYaw = Math.atan2(tangent.x, tangent.z);
        let diff = targetYaw - this.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.yaw += diff * Math.min(1, dt * 4);
        this.speed = -3; this.steer = THREE.MathUtils.clamp(diff * 3, -this.maxSteer, this.maxSteer);

        this.applyToCar(dt, -1, false);

        if (t >= 1) {
            this.position.copy(new THREE.Vector3(anim.spot.x, 0, anim.spot.z));
            this.yaw = anim.spot.yaw; this.speed = 0; this.steer = 0; this.gear = GEAR.P;
            this.mode = 'manual'; this.parkingAnim = null; this.parkingPath = null;
            this.callbacks.onModeChange?.('manual');
            this.callbacks.onParkingComplete?.();
        }
    }

    applyToCar(dt, accel = 0, isBraking = false) {
        this.car.position.copy(this.position);
        this.car.position.y = 0;
        this.car.rotation.y = this.yaw;

        if (this.isStunting) return;

        const rollFactor = (this.maxSpeed === 50) ? 0.08 : 0.15;
        const extraPitch = this.isOverdrive ? -0.02 : 0;
        const targetPitch = this.launchTimer > 0 ? -0.08 : (accel * 0.005 - (isBraking ? 0.03 : 0) + extraPitch);
        const targetRoll = -this.steer * (this.speed / this.maxSpeed) * rollFactor;
        this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 5);
        this.roll += (targetRoll - this.roll) * Math.min(1, dt * 5);
        this.vehicle.bodyGroup.rotation.x = this.pitch; this.vehicle.bodyGroup.rotation.z = this.roll;
        const spinDelta = (this.speed * 0.016) / this.vehicle.wheelRadius;
        Object.values(this.vehicle.wheels).forEach(w => w.spinGroup.rotation.x -= spinDelta);
        this.vehicle.wheels.FL.steerPivot.rotation.y = this.steer; this.vehicle.wheels.FR.steerPivot.rotation.y = this.steer;
        if (this.vehicle.steeringWheel) this.vehicle.steeringWheel.rotation.z = -this.steer * 4;
        const targetWingRot = (Math.abs(this.speed) * 3.6 > 80 || this.isOverdrive) ? -0.4 : 0;
        this.vehicle.wing.rotation.x += (targetWingRot - this.vehicle.wing.rotation.x) * dt * 5;
    }

    getSpeedKmh() { return Math.abs(this.speed) * 3.6; }
}