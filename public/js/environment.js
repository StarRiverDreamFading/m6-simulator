import * as THREE from 'three';

export function buildEnvironment() {
    const group = new THREE.Group();

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x0e1510, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; group.add(ground);

    const points = [
        new THREE.Vector3(0, 0, -60), new THREE.Vector3(100, 0, -60), new THREE.Vector3(140, 0, -20),
        new THREE.Vector3(140, 0, 40), new THREE.Vector3(80, 0, 80), new THREE.Vector3(0, 0, 60),
        new THREE.Vector3(-80, 0, 80), new THREE.Vector3(-140, 0, 40), new THREE.Vector3(-140, 0, -20), new THREE.Vector3(-100, 0, -60),
    ];
    const autopilotCurve = new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.5);

    const trackWidth = 16;
    const segments = 500;
    const vertices = []; const indices = [];
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const point = autopilotCurve.getPointAt(t);
        const tangent = autopilotCurve.getTangentAt(t);
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
        const left = point.clone().add(normal.clone().multiplyScalar(trackWidth / 2));
        const right = point.clone().add(normal.clone().multiplyScalar(-trackWidth / 2));
        vertices.push(left.x, 0.02, left.z, right.x, 0.02, right.z);
        if (i < segments) {
            const idx = i * 2;
            indices.push(idx, idx + 2, idx + 1, idx + 1, idx + 2, idx + 3);
        }
    }
    const trackGeo = new THREE.BufferGeometry();
    trackGeo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    trackGeo.setIndex(indices); trackGeo.computeVertexNormals();
    const trackMat = new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.85, metalness: 0.1 });
    const trackMesh = new THREE.Mesh(trackGeo, trackMat);
    trackMesh.receiveShadow = true; group.add(trackMesh);

    const redMat = new THREE.MeshStandardMaterial({ color: 0xcc1111 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee });
    const barrierMat = new THREE.MeshStandardMaterial({ color: 0x8899aa, metalness: 0.8, roughness: 0.3 });

    for (let i = 0; i < 1200; i++) {
        const t = i / 1200;
        const point = autopilotCurve.getPointAt(t);
        const tangent = autopilotCurve.getTangentAt(t);
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
        const angle = Math.atan2(tangent.x, tangent.z);

        const kerbColor = i % 2 === 0 ? redMat : whiteMat;
        [-1, 1].forEach(side => {
            const kerb = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 1.8), kerbColor);
            kerb.position.copy(point).add(normal.clone().multiplyScalar(side * (trackWidth / 2 - 0.75)));
            kerb.position.y = 0.04; kerb.rotation.y = angle + Math.PI / 2; group.add(kerb);
        });

        if (i % 10 === 0) {
            const barrier = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.8, 4), barrierMat);
            barrier.position.copy(point).add(normal.clone().multiplyScalar(trackWidth / 2 + 5));
            barrier.position.y = 0.4; barrier.rotation.y = angle + Math.PI / 2; group.add(barrier);
        }
    }

    const boostPads = [];
    const padMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
    for (let i = 0; i < 4; i++) {
        const t = 0.2 + i * 0.25;
        const p = autopilotCurve.getPointAt(t);
        const tangent = autopilotCurve.getTangentAt(t);
        const pad = new THREE.Mesh(new THREE.PlaneGeometry(trackWidth * 0.8, 4), padMat);
        pad.rotation.x = -Math.PI / 2; pad.rotation.z = -Math.atan2(tangent.x, tangent.z);
        pad.position.copy(p); pad.position.y = 0.03; group.add(pad);
        boostPads.push({ mesh: pad, position: p.clone(), active: true });
    }

    const startPoint = autopilotCurve.getPointAt(0);
    const startTangent = autopilotCurve.getTangentAt(0);
    const startAngle = Math.atan2(startTangent.x, startTangent.z);
    const startLine = new THREE.Group();
    for (let i = 0; i < 16; i++) {
        for (let j = 0; j < 2; j++) {
            const sq = new THREE.Mesh(new THREE.PlaneGeometry(1, 1.5), new THREE.MeshBasicMaterial({ color: (i + j) % 2 === 0 ? 0xffffff : 0x111111 }));
            sq.rotation.x = -Math.PI / 2; sq.position.set(-trackWidth / 2 + (i + 0.5) * 1, 0, j * 1.5 - 0.75);
            startLine.add(sq);
        }
    }
    startLine.position.copy(startPoint).add(new THREE.Vector3(0, 0.03, 0));
    startLine.rotation.y = startAngle; group.add(startLine);

    const garage = new THREE.Mesh(new THREE.BoxGeometry(50, 10, 15), new THREE.MeshStandardMaterial({ color: 0x334455, roughness: 0.6 }));
    garage.position.set(0, 5, -95); garage.castShadow = true; group.add(garage);

    // ===== 充电桩与停车位 =====
    const parkingSpots = [];
    const chargingStations = [];

    const pBase = autopilotCurve.getPointAt(0.05);
    const pTangent = autopilotCurve.getTangentAt(0.05);
    const pNormal = new THREE.Vector3(-pTangent.z, 0, pTangent.x).normalize();
    const angleP = Math.atan2(pTangent.x, pTangent.z);

    const stationMat = new THREE.MeshStandardMaterial({ color: 0x22252a, metalness: 0.8, roughness: 0.3 });
    const screenMat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });

    for (let i = 0; i < 5; i++) {
        const spotPos = pBase.clone().add(pTangent.clone().multiplyScalar(-i * 7)).add(pNormal.clone().multiplyScalar(-15));
        parkingSpots.push({ x: spotPos.x, z: spotPos.z, yaw: angleP + Math.PI / 2, occupied: false });

        const slot = new THREE.Group();
        const lMat = new THREE.MeshBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.5 });
        const w = 3, l = 5.5;
        [-w / 2, w / 2].forEach(dx => {
            const line = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.01, l), lMat);
            line.position.set(dx, 0.04, 0); slot.add(line);
        });
        [-l / 2, l / 2].forEach(dz => {
            const line = new THREE.Mesh(new THREE.BoxGeometry(w, 0.01, 0.1), lMat);
            line.position.set(0, 0.04, dz); slot.add(line);
        });
        slot.position.set(spotPos.x, 0, spotPos.z);
        slot.rotation.y = angleP + Math.PI / 2;
        group.add(slot);

        // 逼真的充电桩模型
        const stationGroup = new THREE.Group();
        // 底座
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.2, 0.6), stationMat);
        base.position.y = 0.1; base.castShadow = true;
        stationGroup.add(base);
        // 桩体
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.6, 0.4), stationMat);
        pillar.position.y = 0.9; pillar.castShadow = true;
        stationGroup.add(pillar);
        // 发光屏幕
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.6), screenMat);
        screen.position.set(0, 1.1, 0.21);
        stationGroup.add(screen);

        // 位置
        const stationOffset = new THREE.Vector3(0, 0, -3.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), angleP + Math.PI / 2);
        const finalStationPos = spotPos.clone().add(stationOffset);
        stationGroup.position.copy(finalStationPos);
        stationGroup.rotation.y = angleP + Math.PI / 2; // 面向车位
        group.add(stationGroup);

        chargingStations.push({ mesh: stationGroup, position: finalStationPos, spotIndex: i });
    }

    const obstacles = [];
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xff5500 });
    for (let i = 0; i < 8; i++) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.0, 16), coneMat);
        const p = autopilotCurve.getPointAt(0.4 + i * 0.02);
        cone.position.set(p.x, 0.5, p.z);
        cone.castShadow = true; group.add(cone); obstacles.push(cone);
    }

    const rainCount = 1500;
    const rainGeo = new THREE.BufferGeometry();
    const rainPos = new Float32Array(rainCount * 3);
    for (let i = 0; i < rainCount * 3; i += 3) {
        rainPos[i] = (Math.random() - 0.5) * 300;
        rainPos[i + 1] = Math.random() * 50;
        rainPos[i + 2] = (Math.random() - 0.5) * 300;
    }
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
    const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: 0xaaccff, size: 0.15, transparent: true, opacity: 0.6 }));
    rain.visible = false; group.add(rain);

    return { group, autopilotCurve, rain, obstacles, trackMat, boostPads, parkingSpots, chargingStations };
}