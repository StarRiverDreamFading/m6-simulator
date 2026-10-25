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

    const numBarriers = 1200;
    for (let i = 0; i < numBarriers; i++) {
        const t = i / numBarriers;
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

    // === 加速带 (Boost Pads) ===
    const boostPads = [];
    const padMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
    for (let i = 0; i < 4; i++) {
        const t = 0.2 + i * 0.25; // 均匀放置 4 个
        const p = autopilotCurve.getPointAt(t);
        const tangent = autopilotCurve.getTangentAt(t);
        const pad = new THREE.Mesh(new THREE.PlaneGeometry(trackWidth * 0.8, 4), padMat);
        pad.rotation.x = -Math.PI / 2;
        pad.rotation.z = -Math.atan2(tangent.x, tangent.z);
        pad.position.copy(p); pad.position.y = 0.03;
        group.add(pad);
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
    garage.position.set(0, 5, -95); garage.castShadow = true; garage.receiveShadow = true; group.add(garage);

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

    return { group, parkingSpots: [], autopilotCurve, rain, obstacles, trackMat, boostPads };
}