import * as THREE from 'three';

export function createVehicle() {
    const car = new THREE.Group();
    const bodyGroup = new THREE.Group();
    car.add(bodyGroup);

    // 逼真车漆
    const paint = new THREE.MeshPhysicalMaterial({
        color: 0x2c1b3d, metalness: 0.65, roughness: 0.25,
        clearcoat: 1.0, clearcoatRoughness: 0.05, envMapIntensity: 1.5
    });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x08121c, transmission: 0.9, thickness: 0.5, transparent: true, depthWrite: false, roughness: 0.05 });
    const blackTrim = new THREE.MeshStandardMaterial({ color: 0x0a0c0e, roughness: 0.6 });

    const lightWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.1 });
    const lightRed = new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff1111, emissiveIntensity: 0.1 });
    // 单数材质，非数组
    const blinkerMatL = new THREE.MeshStandardMaterial({ color: 0xff8800, emissive: 0xff6600, emissiveIntensity: 0 });
    const blinkerMatR = new THREE.MeshStandardMaterial({ color: 0xff8800, emissive: 0xff6600, emissiveIntensity: 0 });

    const profile = [
        [2.40, 0.26], [2.47, 0.40], [2.44, 0.56], [2.34, 0.70], [2.10, 0.82], [1.62, 0.88], [1.16, 0.94],
        [0.92, 1.02], [0.60, 1.34], [0.22, 1.52], [-0.42, 1.58], [-0.95, 1.50], [-1.28, 1.24], [-1.55, 1.12],
        [-1.92, 1.06], [-2.22, 1.00], [-2.42, 0.86], [-2.47, 0.66], [-2.46, 0.42], [-2.36, 0.28], [-2.10, 0.20], [-1.20, 0.18], [1.20, 0.18], [2.10, 0.20]
    ];
    const shape = new THREE.Shape();
    shape.moveTo(profile[0][0], profile[0][1]);
    shape.splineThru(profile.slice(1).map(p => new THREE.Vector2(p[0], p[1])));
    shape.closePath();

    const WIDTH = 1.92;
    const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: WIDTH - 0.16, bevelEnabled: true, bevelSegments: 4, steps: 1, bevelSize: 0.08, bevelThickness: 0.08, curveSegments: 32 });
    bodyGeo.rotateY(-Math.PI / 2); bodyGeo.translate((WIDTH - 0.16) / 2, 0, 0); bodyGeo.computeVertexNormals();

    const body = new THREE.Mesh(bodyGeo, paint);
    body.castShadow = true; body.receiveShadow = true;
    bodyGroup.add(body);

    [-1.0, 1.0].forEach(x => {
        const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 0.2), paint);
        mirror.position.set(x * 0.95, 1.15, 0.75); bodyGroup.add(mirror);
    });

    const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.56, 1.1), glass);
    windshield.rotation.x = -0.555; windshield.position.set(0, 1.23, 0.69); bodyGroup.add(windshield);

    const wiper = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.02, 0.02), blackTrim);
    wiper.position.set(-0.4, 1.05, 0.9); bodyGroup.add(wiper);

    const dashBoard = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 0.4), blackTrim);
    dashBoard.position.set(0, 0.95, 0.7); bodyGroup.add(dashBoard);

    // 中控屏
    const screenCanvas = document.createElement('canvas');
    screenCanvas.width = 512; screenCanvas.height = 256;
    const ctx = screenCanvas.getContext('2d');
    const screenTexture = new THREE.CanvasTexture(screenCanvas);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.22), new THREE.MeshBasicMaterial({ map: screenTexture }));
    screen.position.set(0.05, 1.12, 0.65); screen.rotation.x = -0.15; screen.rotation.y = -0.2;
    bodyGroup.add(screen);

    const steeringWheel = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.02, 8, 24), blackTrim);
    steeringWheel.position.set(-0.38, 0.98, 0.5); steeringWheel.rotation.x = -0.3; bodyGroup.add(steeringWheel);

    [-0.62, 0.62].forEach(x => {
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 16), lightWhite);
        lamp.scale.set(1.5, 0.5, 0.65); lamp.position.set(x, 0.82, 2.42); bodyGroup.add(lamp);
    });

    const tail = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.06, 0.04), lightRed);
    tail.position.set(0, 0.95, -2.44); bodyGroup.add(tail);

    const blinkerL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.04), blinkerMatL);
    blinkerL.position.set(-0.65, 0.82, 2.43); bodyGroup.add(blinkerL);
    const blinkerR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.04), blinkerMatR);
    blinkerR.position.set(0.65, 0.82, 2.43); bodyGroup.add(blinkerR);

    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.04, 0.3), blackTrim);
    wing.position.set(0, 1.15, -2.2); wing.rotation.x = 0; bodyGroup.add(wing);

    const headlight = new THREE.SpotLight(0xffffff, 0, 50, Math.PI / 4, 0.5, 1);
    headlight.position.set(0, 0.8, 2.3); headlight.target.position.set(0, 0, 25);
    car.add(headlight); car.add(headlight.target);

    const wheels = {};
    const wheelRadius = 0.37;
    function createWheel(name, x, z) {
        const group = new THREE.Group();
        const steerPivot = new THREE.Group();
        const spinGroup = new THREE.Group();
        const tire = new THREE.Mesh(new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.27, 32), new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.95 }));
        tire.rotation.z = Math.PI / 2; spinGroup.add(tire);
        const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.28, 24), new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 1 }));
        rim.rotation.z = Math.PI / 2; spinGroup.add(rim);
        steerPivot.add(spinGroup); group.add(steerPivot);
        group.position.set(x, wheelRadius, z); car.add(group);
        wheels[name] = { group, steerPivot, spinGroup };
    }
    createWheel('FL', 0.88, 1.45); createWheel('FR', -0.88, 1.45);
    createWheel('RL', 0.88, -1.50); createWheel('RR', -0.88, -1.50);

    return {
        group: car, bodyGroup, paint, wheels, wheelRadius, headlight,
        lightWhite, lightRed, blinkerMatL, blinkerMatR,
        screenCtx: ctx, screenTexture, wing, wiper, steeringWheel
    };
}