import * as THREE from 'three';

export function buildEnvironment() {
    const group = new THREE.Group();

    // 1. 基础地面
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(600, 600),
        new THREE.MeshStandardMaterial({ color: 0x0e1510, roughness: 0.95 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    group.add(ground);

    // 2. 赛道关键点 (完美对称、平滑的封闭环形)
    const points = [
        new THREE.Vector3(0, 0, -60),     // 起跑线
        new THREE.Vector3(100, 0, -60),   // 长直道末端
        new THREE.Vector3(140, 0, -20),   // T1 高速弯
        new THREE.Vector3(140, 0, 40),    // T2
        new THREE.Vector3(80, 0, 80),     // T3
        new THREE.Vector3(0, 0, 60),      // T4 发卡弯(向内凹陷)
        new THREE.Vector3(-80, 0, 80),    // T5
        new THREE.Vector3(-140, 0, 40),   // T6
        new THREE.Vector3(-140, 0, -20),  // T7
        new THREE.Vector3(-100, 0, -60),  // T8 长直道入弯
    ];
    const autopilotCurve = new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.5);

    // 3. 沿曲线生成赛道路面
    const trackWidth = 16;
    const segments = 500;
    const vertices = [];
    const indices = [];

    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const point = autopilotCurve.getPointAt(t);
        const tangent = autopilotCurve.getTangentAt(t);
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

        const left = point.clone().add(normal.clone().multiplyScalar(trackWidth / 2));
        const right = point.clone().add(normal.clone().multiplyScalar(-trackWidth / 2));

        vertices.push(left.x, 0.02, left.z);
        vertices.push(right.x, 0.02, right.z);

        if (i < segments) {
            const idx = i * 2;
            indices.push(idx, idx + 2, idx + 1);
            indices.push(idx + 1, idx + 2, idx + 3);
        }
    }

    const trackGeo = new THREE.BufferGeometry();
    trackGeo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    trackGeo.setIndex(indices);
    trackGeo.computeVertexNormals();

    const trackMat = new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.85, metalness: 0.1 });
    const trackMesh = new THREE.Mesh(trackGeo, trackMat);
    trackMesh.receiveShadow = true;
    group.add(trackMesh);

    // 4. 生成极其密集的红白路肩，视觉上完全连成一条线
    const redMat = new THREE.MeshStandardMaterial({ color: 0xcc1111 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee });
    const barrierMat = new THREE.MeshStandardMaterial({ color: 0x8899aa, metalness: 0.8, roughness: 0.3 });

    const numBarriers = 1200; // 极其密集，保证没有缝隙
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
            kerb.position.y = 0.04;
            kerb.rotation.y = angle + Math.PI / 2;
            group.add(kerb);
        });

        // 外侧护栏 (每10段生成一个，避免卡顿)
        if (i % 10 === 0) {
            const barrier = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.8, 4), barrierMat);
            barrier.position.copy(point).add(normal.clone().multiplyScalar(trackWidth / 2 + 5));
            barrier.position.y = 0.4;
            barrier.rotation.y = angle + Math.PI / 2;
            group.add(barrier);
        }
    }

    // 5. 起跑线
    const startPoint = autopilotCurve.getPointAt(0);
    const startTangent = autopilotCurve.getTangentAt(0);
    const startAngle = Math.atan2(startTangent.x, startTangent.z);
    const startLine = new THREE.Group();

    // 黑白格子起跑线
    for (let i = 0; i < 16; i++) {
        for (let j = 0; j < 2; j++) {
            const sq = new THREE.Mesh(new THREE.PlaneGeometry(1, 1.5), new THREE.MeshBasicMaterial({ color: (i + j) % 2 === 0 ? 0xffffff : 0x111111 }));
            sq.rotation.x = -Math.PI / 2;
            sq.position.set(-trackWidth / 2 + (i + 0.5) * 1, 0, j * 1.5 - 0.75);
            startLine.add(sq);
        }
    }
    startLine.position.copy(startPoint).add(new THREE.Vector3(0, 0.03, 0));
    startLine.rotation.y = startAngle;
    group.add(startLine);

    // 6. 建筑 (通过固定坐标绝对定位，绝不挡路)
    const garage = new THREE.Mesh(new THREE.BoxGeometry(50, 10, 15), new THREE.MeshStandardMaterial({ color: 0x334455, roughness: 0.6 }));
    garage.position.set(0, 5, -95); // 直道外侧
    garage.castShadow = true;
    garage.receiveShadow = true;
    group.add(garage);

    const grandstand = new THREE.Mesh(new THREE.BoxGeometry(60, 15, 10), new THREE.MeshStandardMaterial({ color: 0x223344 }));
    grandstand.position.set(0, 7.5, -80); // 看台
    grandstand.castShadow = true;
    group.add(grandstand);

    // 7. 停车位 (放在直道旁边)
    const parkingSpots = [];
    for (let i = 0; i < 5; i++) {
        const spot = { x: 30 + i * 6, z: -45, yaw: 0, occupied: false };
        parkingSpots.push(spot);

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
        slot.position.set(spot.x, 0, spot.z);
        group.add(slot);
    }

    // 8. 障碍物（发卡弯放置雪糕筒）
    const obstacles = [];
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xff5500 });
    for (let i = 0; i < 5; i++) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.0, 16), coneMat);
        const p = autopilotCurve.getPointAt(0.4); // T4附近
        cone.position.set(p.x, 0.5, p.z);
        cone.castShadow = true;
        group.add(cone);
        obstacles.push(cone);
    }

    // 9. 雨滴系统
    const rainCount = 1500;
    const rainGeo = new THREE.BufferGeometry();
    const rainPos = new Float32Array(rainCount * 3);
    for (let i = 0; i < rainCount * 3; i += 3) {
        rainPos[i] = (Math.random() - 0.5) * 300;
        rainPos[i + 1] = Math.random() * 50;
        rainPos[i + 2] = (Math.random() - 0.5) * 300;
    }
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
    const rainMat = new THREE.PointsMaterial({ color: 0xaaccff, size: 0.15, transparent: true, opacity: 0.6 });
    const rain = new THREE.Points(rainGeo, rainMat);
    rain.visible = false;
    group.add(rain);

    return { group, parkingSpots, autopilotCurve, rain, obstacles, trackMat };
}