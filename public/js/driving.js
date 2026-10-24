import * as THREE from 'three';

const GEAR = { P: 'P', D: 'D', R: 'R', N: 'N' };

export class DrivingController {
    constructor(car, vehicle, env, callbacks = {}) {
        this.car = car;
        this.vehicle = vehicle;
        this.env = env;
        this.callbacks = callbacks;

        // 初始位置和朝向
        const startPoint = env.autopilotCurve.getPointAt(0);
        const startTangent = env.autopilotCurve.getTangentAt(0);
        this.position = new THREE.Vector3(startPoint.x, 0, startPoint.z);
        this.yaw = Math.atan2(startTangent.x, startTangent.z);

        // 基础物理参数
        this.speed = 0;
        this.steer = 0;
        this.gear = GEAR.P;
        this.mode = 'manual';
        this.autopilotMode = 'lcc';

        this.maxSpeed = 33;
        this.accelForce = 12;
        this.manualMaxSpeed = 120 / 3.6; // 手动最高限速 (默认 120km/h)
        this.autopilotTargetSpeed = 16.6; // 智驾目标速度

        // 动态悬挂参数
        this.pitch = 0;
        this.roll = 0;
        this.driftAngle = 0; // 漂移侧滑角

        // 智驾与泊车参数
        this.autopilotT = 0;
        this.autopilotCurve = env.autopilotCurve;
        this.autopilotLength = this.autopilotCurve.getLength();
        this.parkingAnim = null;
        this.parkingPath = null;

        // 转向物理
        this.wheelbase = 2.95;
        this.maxSteer = 0.55; // 默认最大转向角，可由 UI 调整
        this.keys = { w: false, s: false, a: false, d: false, handbrake: false };

        // 智能辅助状态
        this.aebAlerted = false;
        this.ncaAvoidOffset = 0;
        this.onepedal = false;
        this.inSlipstream = false;

        // 弹射起步状态
        this.launchReady = false;
        this.launchActive = false;
        this.launchTimer = 0;

        // 电池系统
        this.battery = 100;
        this.powerConsumption = 0;

        // 幽灵车记录数据
        this.ghostData = [];
        this.isRecording = false;

        this._bindKeys();
        this.applyToCar(0);
    }

    // 切换驾驶模式
    setDriveMode(mode) {
        if (mode === 'eco') { this.maxSpeed = 22; this.accelForce = 8; }
        else if (mode === 'sport') { this.maxSpeed = 50; this.accelForce = 20; }
        else { this.maxSpeed = 33; this.accelForce = 12; }
    }

    // 键盘事件绑定
    _bindKeys() {
        const down = (e) => {
            const k = e.key.toLowerCase();
            if (['w', 's', 'a', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
            if (k === 'w' || k === 'arrowup') this.keys.w = true;
            if (k === 's' || k === 'arrowdown') {
                this.keys.s = true;
                this.exitAuto(); // 踩刹车秒退智驾
            }
            if (k === 'a' || k === 'arrowleft') { this.keys.a = true; this.exitAuto(); }
            if (k === 'd' || k === 'arrowright') { this.keys.d = true; this.exitAuto(); }
            if (k === ' ') {
                this.keys.handbrake = true;
                this.exitAuto(); // 拉手刹秒退智驾
            }
        };
        const up = (e) => {
            const k = e.key.toLowerCase();
            if (k === 'w' || k === 'arrowup') this.keys.w = false;
            if (k === 's' || k === 'arrowdown') this.keys.s = false;
            if (k === 'a' || k === 'arrowleft') this.keys.a = false;
            if (k === 'd' || k === 'arrowright') this.keys.d = false;
            if (k === ' ') this.keys.handbrake = false;
        };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
    }

    // 退出智驾
    exitAuto() {
        if (this.mode === 'autopilot') {
            this.mode = 'manual';
            this.callbacks.onModeChange?.('manual');
            this.callbacks.onLog?.("驾驶员已接管车辆（踩刹车/手刹）");
        }
    }

    // 开启智驾
    startAutopilot(mode) {
        if (this.mode === 'parking') return;
        this.autopilotMode = mode;
        let bestT = 0, bestDist = Infinity;
        for (let i = 0; i < 200; i++) {
            const p = this.autopilotCurve.getPointAt(i / 200);
            const d = p.distanceToSquared(this.position);
            if (d < bestDist) { bestDist = d; bestT = i / 200; }
        }
        this.autopilotT = bestT;
        this.mode = 'autopilot';
        this.gear = GEAR.D;
        this.callbacks.onModeChange?.(mode);
    }

    // 关闭智驾
    stopAutopilot() {
        if (this.mode === 'autopilot') {
            this.mode = 'manual';
            this.callbacks.onModeChange?.('manual');
        }
    }

    // 开启自动泊车
    startParking() {
        if (this.mode === 'parking') return;
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

    // 核心更新循环
    update(dt) {
        let isBraking = false;
        let currentAccel = 0;

        // 1. 弹射起步状态机
        if (this.mode === 'manual') {
            if (this.keys.w && this.keys.s && this.speed < 0.5) {
                if (!this.launchReady) { this.launchReady = true; this.callbacks.onLaunchReady?.(); }
            } else if (this.launchReady) {
                if (this.keys.w && !this.keys.s) {
                    this.launchReady = false;
                    this.launchActive = true;
                    this.launchTimer = 2.5;
                    this.callbacks.onLaunch?.();
                } else if (!this.keys.w) {
                    this.launchReady = false;
                    this.callbacks.onLaunchCancel?.();
                }
            }
        }

        // 2. 电量与能耗计算
        const currentSpeedKmh = Math.abs(this.speed) * 3.6;
        if (currentSpeedKmh > 1) {
            const drain = (0.005 + (currentSpeedKmh / 100) * 0.05) * dt;
            this.battery = Math.max(0, this.battery - drain);
            this.powerConsumption = 12 + Math.pow(currentSpeedKmh / 40, 2) * 5;
            if (this.battery <= 0) { this.speed = 0; this.battery = 0; }
        }

        // 3. AEB 障碍物检测
        let aebTriggered = false;
        let closestObs = null;
        let minDist = Infinity;
        const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

        for (const obs of this.env.obstacles) {
            const toObs = obs.position.clone().sub(this.position);
            const dist = toObs.length();
            toObs.normalize();
            if (forward.dot(toObs) > 0.6 && dist < 15) {
                if (dist < minDist) { minDist = dist; closestObs = obs; }
                if (dist < 8) aebTriggered = true;
            }
        }

        if (aebTriggered && this.speed > 0.5) {
            this.speed *= Math.max(0, 1 - dt * 10);
            if (!this.aebAlerted) { this.callbacks.onAEB?.(); this.aebAlerted = true; }
            isBraking = true;
        } else {
            if (this.aebAlerted) { this.aebAlerted = false; this.callbacks.onAEBReset?.(); }

            // 4. 模式分发
            if (this.mode === 'manual') {
                const res = this.updateManual(dt);
                currentAccel = res.accel; isBraking = res.isBraking;
            } else if (this.mode === 'autopilot') {
                this.updateAutopilot(dt, closestObs);
            } else if (this.mode === 'parking') {
                this.updateParking(dt);
            }
        }

        // 5. 智驾状态限速
        if (this.launchTimer <= 0 && this.mode === 'autopilot') {
            const currentMax = this.maxSpeed;
            const maxSpd = this.inSlipstream ? currentMax * 1.15 : currentMax;
            if (this.speed > maxSpd) this.speed -= 5 * dt;
        }

        // 6. 漂移角计算（用于触发烟雾和得分）
        if (Math.abs(this.speed) > 8) { // 速度超过约 28.8 km/h
            const speedFactor = this.speed / 15;
            this.driftAngle = Math.abs(this.steer) * speedFactor;
            if (this.keys.handbrake) this.driftAngle += 0.2; // 手刹增加漂移角
        } else {
            this.driftAngle = 0;
        }

        this.applyToCar(dt, currentAccel, isBraking);
    }

    // 手动驾驶逻辑
    updateManual(dt) {
        // 如果正在准备弹射，锁死车辆
        if (this.launchReady) {
            this.speed = 0;
            return { accel: 0, isBraking: true };
        }

        // 如果处于弹射爆发状态
        if (this.launchTimer > 0) {
            this.launchTimer -= dt;
            const launchAccel = this.accelForce * 3.5;
            this.speed += launchAccel * dt;

            if (Math.abs(this.speed) > 0.01) {
                const angularVel = (this.speed / this.wheelbase) * Math.tan(this.steer);
                this.yaw += angularVel * dt;
                this.position.x += Math.sin(this.yaw) * this.speed * dt;
                this.position.z += Math.cos(this.yaw) * this.speed * dt;
            }
            return { accel: launchAccel, isBraking: false };
        }

        // 正常驾驶
        const steerInput = (this.keys.a ? 1 : 0) - (this.keys.d ? 1 : 0);
        this.steer += (steerInput * this.maxSteer - this.steer) * Math.min(1, dt * 8);

        let accel = 0; let isBraking = false;

        if (this.keys.handbrake) {
            this.speed *= Math.max(0, 1 - dt * 8); isBraking = true;
        } else if (this.keys.w) {
            this.gear = GEAR.D;
            // 手动最高限速拦截
            if (this.speed < this.manualMaxSpeed) {
                accel = this.inSlipstream ? this.accelForce * 1.3 : this.accelForce;
            }
        } else if (this.keys.s) {
            if (this.speed > 0.2) { accel = -this.accelForce * 1.5; isBraking = true; }
            else { this.gear = GEAR.R; accel = -this.accelForce * 0.6; }
        } else {
            // 单踏板逻辑
            if (this.onepedal && this.speed > 0) {
                accel = -this.accelForce * 0.6; isBraking = true;
            } else {
                this.speed *= Math.max(0, 1 - dt * 0.6);
            }
            if (Math.abs(this.speed) < 0.05) this.speed = 0;
        }

        this.speed += accel * dt;

        // 强制物理截断，确保绝对不超速
        if (this.speed > this.manualMaxSpeed) this.speed = this.manualMaxSpeed;
        if (this.speed < -8) this.speed = -8;

        if (this.speed > -0.3 && this.speed < 0.3 && !this.keys.w && !this.keys.s) this.gear = GEAR.P;

        if (Math.abs(this.speed) > 0.01) {
            const angularVel = (this.speed / this.wheelbase) * Math.tan(this.steer);
            this.yaw += angularVel * dt;
            this.position.x += Math.sin(this.yaw) * this.speed * dt;
            this.position.z += Math.cos(this.yaw) * this.speed * dt;
        }
        return { accel, isBraking };
    }

    // 智驾逻辑
    updateAutopilot(dt, closestObs) {
        let targetSpd = this.autopilotTargetSpeed;

        // NCA 智能变道辅助 (ALC)
        if (this.autopilotMode === 'nca') {
            let targetOffset = 0;
            if (this.keys.a) targetOffset = 3.5; // 向左变道
            else if (this.keys.d) targetOffset = -3.5; // 向右变道

            this.ncaAvoidOffset += (targetOffset - this.ncaAvoidOffset) * Math.min(1, dt * 2);
        }

        // NCA 自动避障
        if (this.autopilotMode === 'nca' && closestObs && closestObs.position.distanceTo(this.position) < 20) {
            targetSpd *= 0.7;
        }

        // NCA 弯道减速
        if (this.autopilotMode === 'nca') {
            const p1 = this.autopilotCurve.getTangentAt(this.autopilotT);
            const p2 = this.autopilotCurve.getTangentAt((this.autopilotT + 0.01) % 1);
            const curvature = Math.acos(Math.min(1, Math.max(-1, p1.dot(p2))));
            targetSpd *= Math.max(0.4, 1.0 - curvature * 15);
        }

        this.speed += (targetSpd - this.speed) * Math.min(1, dt * 2);
        this.autopilotT += (this.speed * dt) / this.autopilotLength;
        this.autopilotT = ((this.autopilotT % 1) + 1) % 1;

        const point = this.autopilotCurve.getPointAt(this.autopilotT);
        const tangent = this.autopilotCurve.getTangentAt(this.autopilotT);
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

        // 应用变道偏移
        this.position.copy(point).add(normal.multiplyScalar(this.ncaAvoidOffset));

        const targetYaw = Math.atan2(tangent.x, tangent.z);
        let diff = targetYaw - this.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.yaw += diff * Math.min(1, dt * 6);
        this.steer = THREE.MathUtils.clamp(diff * 2.5, -this.maxSteer, this.maxSteer);
        this.gear = GEAR.D;
    }

    // 泊车逻辑
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

        this.speed = -3;
        this.steer = THREE.MathUtils.clamp(diff * 3, -this.maxSteer, this.maxSteer);

        if (t >= 1) {
            this.position.copy(new THREE.Vector3(anim.spot.x, 0, anim.spot.z));
            this.yaw = anim.spot.yaw;
            this.speed = 0; this.steer = 0; this.gear = GEAR.P;
            this.mode = 'manual';
            this.parkingAnim = null;
            this.parkingPath = null;
            this.callbacks.onModeChange?.('manual');
        }
    }

    // 应用物理到模型
    applyToCar(dt, accel = 0, isBraking = false) {
        this.car.position.copy(this.position);
        this.car.position.y = 0;
        this.car.rotation.y = this.yaw;

        // 动态悬挂 (加速抬头、刹车点头、转弯侧倾)
        const rollFactor = (this.maxSpeed === 50) ? 0.08 : 0.15;
        const targetPitch = this.launchTimer > 0 ? -0.08 : (accel * 0.005 - (isBraking ? 0.03 : 0));
        const targetRoll = -this.steer * (this.speed / this.maxSpeed) * rollFactor;

        this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 5);
        this.roll += (targetRoll - this.roll) * Math.min(1, dt * 5);

        this.vehicle.bodyGroup.rotation.x = this.pitch;
        this.vehicle.bodyGroup.rotation.z = this.roll;

        // 轮毂旋转与转向
        const spinDelta = (this.speed * 0.016) / this.vehicle.wheelRadius;
        Object.values(this.vehicle.wheels).forEach(w => w.spinGroup.rotation.x -= spinDelta);
        this.vehicle.wheels.FL.steerPivot.rotation.y = this.steer;
        this.vehicle.wheels.FR.steerPivot.rotation.y = this.steer;

        // 方向盘联动
        if (this.vehicle.steeringWheel) {
            this.vehicle.steeringWheel.rotation.z = -this.steer * 4;
        }

        // 动态尾翼 (速度 > 80km/h 自动升起)
        const targetWingRot = (Math.abs(this.speed) * 3.6 > 80) ? -0.4 : 0;
        this.vehicle.wing.rotation.x += (targetWingRot - this.vehicle.wing.rotation.x) * dt * 5;
    }

    getSpeedKmh() {
        return Math.abs(this.speed) * 3.6;
    }
}