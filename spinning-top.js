const DEFAULTS = {
    spin: 80,
    tiltDeg: 25,
    gravity: 1,
    friction: 0.2,
    speed: 1
};

const PRESETS = {
    stable: {
        spin: 118,
        tiltDeg: 18,
        gravity: 0.95,
        friction: 0.08,
        speed: 1
    },
    wobble: {
        spin: 42,
        tiltDeg: 36,
        gravity: 1.35,
        friction: 0.62,
        speed: 1
    }
};

const dom = {
    spin: document.querySelector("#spin"),
    tilt: document.querySelector("#tilt"),
    gravity: document.querySelector("#gravity"),
    friction: document.querySelector("#friction"),
    speed: document.querySelector("#speed"),
    spinText: document.querySelector("#spinText"),
    tiltText: document.querySelector("#tiltText"),
    gravityText: document.querySelector("#gravityText"),
    frictionText: document.querySelector("#frictionText"),
    speedText: document.querySelector("#speedText"),
    precessionStat: document.querySelector("#precessionStat"),
    spinStat: document.querySelector("#spinStat"),
    tiltStat: document.querySelector("#tiltStat"),
    torqueStat: document.querySelector("#torqueStat"),
    stabilityStat: document.querySelector("#stabilityStat"),
    stateStat: document.querySelector("#stateStat"),
    stateChip: document.querySelector("#stateChip"),
    trackChip: document.querySelector("#trackChip"),
    summaryText: document.querySelector("#summaryText"),
    observeTitle: document.querySelector("#observeTitle"),
    observeText: document.querySelector("#observeText"),
    pauseBtn: document.querySelector("#pauseBtn"),
    resetBtn: document.querySelector("#resetBtn"),
    stableBtn: document.querySelector("#stableBtn"),
    wobbleBtn: document.querySelector("#wobbleBtn"),
    sideCanvas: document.querySelector("#sideCanvas"),
    topCanvas: document.querySelector("#topCanvas")
};

const contexts = {
    side: dom.sideCanvas.getContext("2d"),
    top: dom.topCanvas.getContext("2d")
};

const state = {
    running: true,
    spin: DEFAULTS.spin,
    tilt: degreesToRadians(DEFAULTS.tiltDeg),
    phi: 0,
    selfAngle: 0,
    trail: [],
    lastTime: performance.now(),
    latestMetrics: {
        precession: 0,
        torque: 0,
        stability: 0,
        mode: "歳差運動中"
    },
    viewports: {
        side: { width: 560, height: 560, dpr: 1 },
        top: { width: 560, height: 560, dpr: 1 }
    }
};

const revealObserver = new IntersectionObserver(
    (entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add("is-visible");
                revealObserver.unobserve(entry.target);
            }
        });
    },
    {
        threshold: 0.18,
        rootMargin: "0px 0px -40px 0px"
    }
);

document.querySelectorAll(".reveal, .site-footer").forEach((element) => {
    if (!element.classList.contains("is-visible")) {
        revealObserver.observe(element);
    }
});

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function lerp(from, to, progress) {
    return from + ((to - from) * progress);
}

function degreesToRadians(value) {
    return value * Math.PI / 180;
}

function radiansToDegrees(value) {
    return value * 180 / Math.PI;
}

function formatNumber(value, digits = 1) {
    return value.toFixed(digits).replace(/(?:\.0+|(\.\d*?[1-9]))0+$/, "$1");
}

function syncInputsFromPreset(preset) {
    dom.spin.value = String(preset.spin);
    dom.tilt.value = String(preset.tiltDeg);
    dom.gravity.value = String(preset.gravity);
    dom.friction.value = String(preset.friction);
    dom.speed.value = String(preset.speed);
}

function updateLabels() {
    dom.spinText.textContent = dom.spin.value;
    dom.tiltText.textContent = `${dom.tilt.value}°`;
    dom.gravityText.textContent = formatNumber(Number(dom.gravity.value), 2);
    dom.frictionText.textContent = formatNumber(Number(dom.friction.value), 2);
    dom.speedText.textContent = `${formatNumber(Number(dom.speed.value), 1)}×`;
}

function resetSimulation() {
    state.spin = Number(dom.spin.value);
    state.tilt = degreesToRadians(Number(dom.tilt.value));
    state.phi = 0;
    state.selfAngle = 0;
    state.trail = [];
    state.latestMetrics.precession = 0;
    state.latestMetrics.torque = 0;
    state.latestMetrics.stability = 0;
    state.latestMetrics.mode = "歳差運動中";
    state.lastTime = performance.now();
    updateStats();
}

function setPreset(presetKey) {
    syncInputsFromPreset(PRESETS[presetKey]);
    updateLabels();
    resetSimulation();
}

function axisVector() {
    return {
        x: Math.sin(state.tilt) * Math.cos(state.phi),
        y: Math.sin(state.tilt) * Math.sin(state.phi),
        z: Math.cos(state.tilt)
    };
}

function resizeCanvas(canvas, key) {
    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.max(220, Math.round(rect.width || canvas.clientWidth || 560));
    const cssHeight = Math.round(cssWidth);
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.height = `${cssHeight}px`;

    const ctx = contexts[key];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    state.viewports[key] = {
        width: cssWidth,
        height: cssHeight,
        dpr
    };
}

function resizeAllCanvases() {
    resizeCanvas(dom.sideCanvas, "side");
    resizeCanvas(dom.topCanvas, "top");
    drawScene();
}

function describeState() {
    const gravity = Number(dom.gravity.value);
    const friction = Number(dom.friction.value);
    const tiltDeg = radiansToDegrees(state.tilt);
    const spin = state.spin;
    const stability = spin / (20 + (gravity * 10));

    if (spin < 8 || tiltDeg > 78) {
        return {
            mode: "倒れそう",
            stability: "限界",
            summary: `自転が ${formatNumber(spin, 1)} まで落ち、重力トルクに抗うだけの角運動量が足りなくなっています。軸は外へ開きながら倒れ込みへ向かいます。`,
            title: "転倒直前の領域",
            text: "この段階では歳差よりも傾きの増加が目立ちます。摩擦を下げるか、自転速度を上げると再び安定側へ戻せます。"
        };
    }

    if (friction > 0.45 || stability < 1.6) {
        return {
            mode: "減衰中",
            stability: "不安定寄り",
            summary: `摩擦 ${formatNumber(friction, 2)} のため自転が削られ、歳差の輪が少しずつ外へ広がりやすい条件です。まだ回っていますが、安定余裕は大きくありません。`,
            title: "歳差しながら崩れていく",
            text: "上から見ると軌跡が太くなり、横から見ると軸の先端がじわじわ下がります。角運動量が減ると歳差はむしろ速まりやすい点にも注目です。"
        };
    }

    if (tiltDeg < 15 && spin > 95) {
        return {
            mode: "高速歳差",
            stability: "かなり安定",
            summary: `傾きが小さく、自転も十分速いため、コマは細い円を描きながらゆっくり向きを変えています。重力は働いていても、見かけ上はかなり安定です。`,
            title: "速く回ると、倒れずに向きだけ変わる",
            text: "ここでは重力トルクに対して角運動量が大きく、横から見た傾きがあまり増えません。歳差の輪が締まって見えるのが特徴です。"
        };
    }

    return {
        mode: "歳差運動中",
        stability: "安定",
        summary: `重力トルクと角運動量のつり合いで、軸は倒れずに周囲を回っています。摩擦が小さいうちは、上から見た軌跡はほぼ一定半径の円に近くなります。`,
        title: "典型的な歳差運動",
        text: "自転速度、傾き、重力の 3 つを少しずつ変えると、歳差の速さと円の半径がどう動くか比較しやすい領域です。"
    };
}

function updateStats() {
    const description = describeState();
    const torque = state.latestMetrics.torque;
    const precession = state.latestMetrics.precession;

    dom.precessionStat.textContent = `${formatNumber(precession, 2)} rad/s`;
    dom.spinStat.textContent = formatNumber(state.spin, 1);
    dom.tiltStat.textContent = `${formatNumber(radiansToDegrees(state.tilt), 1)}°`;
    dom.torqueStat.textContent = formatNumber(torque, 2);
    dom.stabilityStat.textContent = description.stability;
    dom.stateStat.textContent = description.mode;
    dom.stateChip.textContent = description.mode;
    dom.summaryText.textContent = description.summary;
    dom.observeTitle.textContent = description.title;
    dom.observeText.textContent = description.text;
    dom.trackChip.textContent = state.running ? "軌跡を表示" : "停止中";
}

function stepSimulation(dt) {
    const gravity = Number(dom.gravity.value);
    const friction = Number(dom.friction.value);
    const viewSpeed = Number(dom.speed.value);
    const scaledDt = dt * viewSpeed;
    const angularMomentum = Math.max(8, state.spin);
    const torque = gravity * Math.sin(state.tilt) * 42;
    const precession = torque / angularMomentum;

    state.phi += precession * scaledDt;
    state.selfAngle += state.spin * 0.25 * scaledDt;

    state.spin -= friction * scaledDt * (0.8 + (state.spin * 0.015));
    state.spin = Math.max(0, state.spin);

    const stability = state.spin / (20 + (gravity * 10));
    const criticalSpin = 32 + (gravity * 18) + (radiansToDegrees(state.tilt) * 0.25) + (friction * 8);
    const spinDeficit = criticalSpin - state.spin;
    const fallRate = clamp(spinDeficit * 0.0032, -0.008, 0.08);
    state.tilt += fallRate * scaledDt;
    state.tilt = clamp(state.tilt, 0.04, Math.PI / 2.05);

    const radius = Math.sin(state.tilt);
    state.trail.push({
        x: Math.cos(state.phi) * radius,
        y: Math.sin(state.phi) * radius
    });

    if (state.trail.length > 260) {
        state.trail.shift();
    }

    state.latestMetrics.precession = precession;
    state.latestMetrics.torque = torque;
    state.latestMetrics.stability = stability;
    state.latestMetrics.mode = describeState().mode;
}

function drawSideView() {
    const ctx = contexts.side;
    const viewport = state.viewports.side;
    const width = viewport.width;
    const height = viewport.height;
    const centerX = width / 2;
    const groundY = height - 78;

    ctx.clearRect(0, 0, width, height);

    const background = ctx.createLinearGradient(0, 0, 0, height);
    background.addColorStop(0, "#fbf7ff");
    background.addColorStop(1, "#dde6ff");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(140, 156, 189, 0.28)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }
    for (let y = 0; y <= height; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }

    ctx.strokeStyle = "#44315d";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(34, groundY);
    ctx.lineTo(width - 34, groundY);
    ctx.stroke();

    const axis = axisVector();
    const axisLength = Math.min(width, height) * 0.48;
    const pivot = { x: centerX, y: groundY };
    const tip = {
        x: pivot.x + (axis.x * axisLength),
        y: pivot.y - (axis.z * axisLength)
    };

    ctx.save();
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = "rgba(67, 54, 92, 0.4)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(centerX, groundY);
    ctx.lineTo(centerX, groundY - axisLength);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "#4f4765";
    ctx.font = "700 13px IBM Plex Sans JP";
    ctx.fillText("鉛直方向", centerX + 12, groundY - axisLength + 18);

    const bodyCenter = {
        x: lerp(pivot.x, tip.x, 0.43),
        y: lerp(pivot.y, tip.y, 0.43)
    };
    const bodyAngle = Math.atan2(tip.y - pivot.y, tip.x - pivot.x);
    const spinStripe = (Math.sin(state.selfAngle) + 1) * 0.5;

    ctx.save();
    ctx.translate(bodyCenter.x, bodyCenter.y);
    ctx.rotate(bodyAngle + (Math.PI / 2));

    const bodyGradient = ctx.createLinearGradient(-72, 0, 72, 0);
    bodyGradient.addColorStop(0, "#3a63df");
    bodyGradient.addColorStop(clamp(0.28 + (spinStripe * 0.38), 0.18, 0.82), "#b6d7ff");
    bodyGradient.addColorStop(1, "#1d2b70");

    ctx.fillStyle = bodyGradient;
    ctx.beginPath();
    ctx.moveTo(0, -92);
    ctx.bezierCurveTo(82, -38, 72, 58, 0, 112);
    ctx.bezierCurveTo(-72, 58, -82, -38, 0, -92);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#101229";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = "#ff8e72";
    ctx.beginPath();
    ctx.arc(0, -18, 12, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
    ctx.beginPath();
    ctx.ellipse(-12, 16, 18, 42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "#df445a";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(pivot.x, pivot.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();

    ctx.fillStyle = "#df445a";
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#1a1530";
    ctx.font = "700 16px IBM Plex Sans JP";
    ctx.fillText("横から見た傾き", 20, 30);
}

function drawTopView() {
    const ctx = contexts.top;
    const viewport = state.viewports.top;
    const width = viewport.width;
    const height = viewport.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const ringRadius = Math.min(width, height) * 0.37;

    ctx.clearRect(0, 0, width, height);

    const background = ctx.createLinearGradient(0, 0, 0, height);
    background.addColorStop(0, "#fbf7ff");
    background.addColorStop(1, "#dde6ff");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(125, 144, 181, 0.32)";
    ctx.lineWidth = 1;
    for (let radius = 50; radius <= ringRadius + 40; radius += 50) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(centerX, 24);
    ctx.lineTo(centerX, height - 24);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(24, centerY);
    ctx.lineTo(width - 24, centerY);
    ctx.stroke();

    ctx.strokeStyle = "rgba(68, 49, 93, 0.45)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
    ctx.stroke();

    if (state.trail.length > 1) {
        ctx.strokeStyle = "#2a6dff";
        ctx.lineWidth = 3;
        ctx.beginPath();
        state.trail.forEach((point, index) => {
            const x = centerX + (point.x * ringRadius);
            const y = centerY + (point.y * ringRadius);
            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        ctx.stroke();
    }

    const axis = axisVector();
    const tip = {
        x: centerX + (axis.x * ringRadius),
        y: centerY + (axis.y * ringRadius)
    };

    ctx.strokeStyle = "#df445a";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();

    ctx.fillStyle = "#df445a";
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#1a1530";
    ctx.beginPath();
    ctx.arc(centerX, centerY, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = "700 16px IBM Plex Sans JP";
    ctx.fillText("上から見た軸の向き", 20, 30);
    ctx.font = "13px IBM Plex Sans JP";
    ctx.fillStyle = "#4f4765";
    ctx.fillText("青い線は軸先端が描く軌跡", 20, 52);
}

function drawScene() {
    drawSideView();
    drawTopView();
}

function loop(now) {
    const dt = Math.min(0.045, (now - state.lastTime) / 1000);
    state.lastTime = now;

    updateLabels();

    if (state.running) {
        stepSimulation(dt);
    }

    updateStats();
    drawScene();
    requestAnimationFrame(loop);
}

dom.pauseBtn.addEventListener("click", () => {
    state.running = !state.running;
    dom.pauseBtn.textContent = state.running ? "停止" : "再開";
    dom.trackChip.textContent = state.running ? "軌跡を表示" : "停止中";
    state.lastTime = performance.now();
});

dom.resetBtn.addEventListener("click", () => {
    resetSimulation();
});

dom.stableBtn.addEventListener("click", () => {
    setPreset("stable");
});

dom.wobbleBtn.addEventListener("click", () => {
    setPreset("wobble");
});

[dom.spin, dom.tilt].forEach((element) => {
    element.addEventListener("input", () => {
        updateLabels();
        resetSimulation();
    });
});

[dom.gravity, dom.friction, dom.speed].forEach((element) => {
    element.addEventListener("input", () => {
        updateLabels();
    });
});

const resizeObserver = new ResizeObserver(() => {
    resizeAllCanvases();
});

resizeObserver.observe(dom.sideCanvas);
resizeObserver.observe(dom.topCanvas);
window.addEventListener("resize", resizeAllCanvases);

updateLabels();
resetSimulation();
resizeAllCanvases();
requestAnimationFrame(loop);