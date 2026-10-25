import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class CameraRig {
    constructor(camera, domElement, car) {
        this.camera = camera;
        this.car = car;
        this.mode = 'orbit';

        this.controls = new OrbitControls(camera, domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.06;
        this.controls.minDistance = 3.2;
        this.controls.maxDistance = 25;
        this.controls.maxPolarAngle = Math.PI / 2.1;
        this.controls.target.set(0, 0.9, 0);

        this._tempV = new THREE.Vector3();
        this._chasePos = new THREE.Vector3();
        this._chaseLook = new THREE.Vector3();
        this._initializedChase = false;

        // 后视镜专用相机
        this.rearCam = new THREE.PerspectiveCamera(60, 2, 0.1, 100);
    }

    setMode(mode) {
        this.mode = mode;
        this.controls.enabled = (mode === 'orbit');
        if (mode === 'chase' || mode === 'drone') this._initializedChase = false;
        this.camera.fov = ['driver', 'passenger', 'rear'].includes(mode) ? 60 : 45;
        this.camera.updateProjectionMatrix();

        const mirrorDom = document.getElementById('rear-view-mirror');
        if (mirrorDom) mirrorDom.style.display = (mode === 'driver') ? 'block' : 'none';
    }

    update(dt) {
        const carPos = this.car.position;
        const carQuat = this.car.quaternion;

        if (this.mode === 'orbit') {
            this.controls.target.lerp(this._tempV.copy(carPos).add(new THREE.Vector3(0, 0.9, 0)), 0.15);
            this.controls.update();
            return;
        }

        if (this.mode === 'chase') {
            const offset = new THREE.Vector3(0, 2.6, -6.5).applyQuaternion(carQuat);
            this._chasePos.copy(carPos).add(offset);
            if (!this._initializedChase) {
                this.camera.position.copy(this._chasePos);
                this._initializedChase = true;
            } else {
                this.camera.position.lerp(this._chasePos, Math.min(1, dt * 4));
            }
            this._chaseLook.copy(carPos).add(new THREE.Vector3(0, 1.0, 0));
            this.camera.lookAt(this._chaseLook);
            return;
        }

        if (this.mode === 'drone') {
            const time = performance.now() * 0.0005;
            const radius = 14;
            this._chasePos.set(
                carPos.x + Math.cos(time) * radius,
                carPos.y + 8,
                carPos.z + Math.sin(time) * radius
            );
            this.camera.position.lerp(this._chasePos, Math.min(1, dt * 2));
            this.camera.lookAt(carPos.x, carPos.y + 1, carPos.z);
            return;
        }

        // 第一人称视角
        const offsets = {
            driver: new THREE.Vector3(-0.38, 1.15, 0.2),
            passenger: new THREE.Vector3(0.38, 1.15, 0.2),
            rear: new THREE.Vector3(0, 1.25, -0.8)
        };
        const off = offsets[this.mode];
        if (!off) return;

        this._tempV.copy(off).applyQuaternion(carQuat).add(carPos);
        this.camera.position.copy(this._tempV);

        const forward = new THREE.Vector3(0, -0.08, 1).applyQuaternion(carQuat);
        this.camera.lookAt(this._tempV.clone().add(forward.multiplyScalar(10)));

        // 更新后视镜相机
        this.rearCam.position.copy(carPos).add(new THREE.Vector3(0, 1.2, -1).applyQuaternion(carQuat));
        const rearForward = new THREE.Vector3(0, -0.1, -1).applyQuaternion(carQuat);
        this.rearCam.lookAt(this.rearCam.position.clone().add(rearForward.multiplyScalar(10)));
    }
}