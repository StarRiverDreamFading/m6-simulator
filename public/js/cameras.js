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
        this._targetPos = new THREE.Vector3();
        this._lookAt = new THREE.Vector3();
        this._chasePos = new THREE.Vector3();
        this._chaseLook = new THREE.Vector3();
        this._initializedChase = false;
    }

    setMode(mode) {
        this.mode = mode;
        this.controls.enabled = (mode === 'orbit');
        if (mode === 'chase') this._initializedChase = false;

        // 第一人称视角时，稍微拉大视野
        if (['driver', 'passenger', 'rear'].includes(mode)) {
            this.camera.fov = 60;
        } else {
            this.camera.fov = 42;
        }
        this.camera.updateProjectionMatrix();
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

        // 第一人称视角 (主驾在左 x=-0.38, 副驾在右 x=0.38)
        const offsets = {
            driver: new THREE.Vector3(-0.38, 1.15, 0.2),
            passenger: new THREE.Vector3(0.38, 1.15, 0.2),
            rear: new THREE.Vector3(0, 1.25, -0.8)
        };
        const off = offsets[this.mode];
        if (!off) return;

        this._targetPos.copy(off).applyQuaternion(carQuat).add(carPos);
        this.camera.position.copy(this._targetPos);

        // 视线看前方，微微向下看着屏幕
        const forward = new THREE.Vector3(0, -0.08, 1).applyQuaternion(carQuat);
        this._lookAt.copy(this._targetPos).add(forward.multiplyScalar(10));
        this.camera.lookAt(this._lookAt);
    }
}