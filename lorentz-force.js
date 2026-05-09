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

const canvas = document.querySelector("#lorentzCanvas");
const context = canvas?.getContext("2d");
const canvasStage = canvas?.parentElement;

if (!canvas || !context) {
    throw new Error("Lorentz force canvas could not be initialized.");
}

const control = (id) => document.getElementById(id);

const controls = {
    charge: control("charge"),
    speedPreset: control("speedPreset"),
    speed: control("speed"),
    presetV: control("presetV"),
    vx: control("vx"),
    vy: control("vy"),
    vz: control("vz"),
    presetB: control("presetB"),
    bx: control("bx"),
    by: control("by"),
    bz: control("bz"),
    bStrength: control("bStrength"),
    timeScale: control("timeScale"),
    pauseBtn: control("pauseBtn"),
    resetBtn: control("resetBtn"),
    clearBtn: control("clearBtn")
};

const lessonPresetButtons = Array.from(document.querySelectorAll("[data-lesson-preset]"));

const output = {
    qValue: control("qValue"),
    speedValue: control("speedValue"),
    vxValue: control("vxValue"),
    vyValue: control("vyValue"),
    vzValue: control("vzValue"),
    bxValue: control("bxValue"),
    byValue: control("byValue"),
    bzValue: control("bzValue"),
    bStrengthValue: control("bStrengthValue"),
    timeScaleValue: control("timeScaleValue"),
    chargeMetric: control("chargeMetric"),
    angleMetric: control("angleMetric"),
    forceMetric: control("forceMetric"),
    radiusMetric: control("radiusMetric"),
    motionTitle: control("motionTitle"),
    motionSummary: control("motionSummary"),
    ruleTitle: control("ruleTitle"),
    ruleSummary: control("ruleSummary")
};

const vec = (x = 0, y = 0, z = 0) => ({ x, y, z });
const add = (a, b) => vec(a.x + b.x, a.y + b.y, a.z + b.z);
const mul = (v, scalar) => vec(v.x * scalar, v.y * scalar, v.z * scalar);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => vec(
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x
);
const length = (v) => Math.hypot(v.x, v.y, v.z);
const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

const speedPresets = {
    slow: 1.2,
    standard: 2.2,
    fast: 3.4,
    veryFast: 4.6
};

const velocityPresets = {
    xplus: vec(1, 0, 0),
    yplus: vec(0, 1, 0),
    xydiagonal: vec(0.78, 0.62, 0),
    xzhelical: vec(0.84, 0, 0.54),
    zplus: vec(0, 0, 1)
};

const magneticPresets = {
    zplus: vec(0, 0, 1),
    zminus: vec(0, 0, -1),
    xplus: vec(1, 0, 0),
    xminus: vec(-1, 0, 0),
    yplus: vec(0, 1, 0),
    yminus: vec(0, -1, 0),
    xydiagonal: vec(0.72, 0.72, 0)
};

const lessonPresets = {
    circlePositive: {
        charge: 1,
        speedPreset: "standard",
        velocityPreset: "xplus",
        magneticPreset: "zplus",
        bStrength: 1,
        timeScale: 1
    },
    circleNegative: {
        charge: -1,
        speedPreset: "standard",
        velocityPreset: "xplus",
        magneticPreset: "zplus",
        bStrength: 1,
        timeScale: 1
    },
    parallelNoForce: {
        charge: 1,
        speedPreset: "standard",
        velocityPreset: "xplus",
        magneticPreset: "xplus",
        bStrength: 1,
        timeScale: 1
    },
    helicalMotion: {
        charge: 1,
        speedPreset: "standard",
        velocityPreset: "xzhelical",
        magneticPreset: "zplus",
        bStrength: 1,
        timeScale: 1
    },
    tightRadius: {
        charge: 1,
        speedPreset: "standard",
        velocityPreset: "xplus",
        magneticPreset: "zplus",
        bStrength: 2,
        timeScale: 0.9
    },
    wideRadius: {
        charge: 1,
        speedPreset: "fast",
        velocityPreset: "xplus",
        magneticPreset: "zplus",
        bStrength: 1,
        timeScale: 1
    }
};

const normalizeOr = (v, fallback) => {
    const magnitude = length(v);
    if (magnitude < 1e-8) {
        return fallback;
    }

    return vec(v.x / magnitude, v.y / magnitude, v.z / magnitude);
};

const angleBetween = (a, b) => {
    const la = length(a);
    const lb = length(b);

    if (la < 1e-8 || lb < 1e-8) {
        return 0;
    }

    const cosine = clamp(dot(a, b) / (la * lb), -1, 1);
    return Math.acos(cosine) * 180 / Math.PI;
};

let width = 0;
let height = 0;
let paused = false;
const mass = 1;
let position = vec(0, 0, 0);
let velocity = vec(2.2, 0, 0);
let trail = [];
let lastFrameTime = performance.now();

const setControlValue = (element, value) => {
    element.value = String(value);
};

const setVelocitySliders = (x, y, z) => {
    controls.vx.value = x;
    controls.vy.value = y;
    controls.vz.value = z;
};

const setActiveLessonPreset = (presetName) => {
    lessonPresetButtons.forEach((button) => {
        button.classList.toggle("is-active", button.dataset.lessonPreset === presetName);
    });
};

const clearLessonPresetSelection = () => {
    setActiveLessonPreset("");
};

const getVelocityDirection = () => normalizeOr(
    vec(
        Number(controls.vx.value),
        Number(controls.vy.value),
        Number(controls.vz.value)
    ),
    vec(1, 0, 0)
);

const getMagneticField = () => {
    const direction = vec(
        Number(controls.bx.value),
        Number(controls.by.value),
        Number(controls.bz.value)
    );
    const magnitude = Number(controls.bStrength.value);

    if (length(direction) < 1e-8 || magnitude < 1e-8) {
        return vec(0, 0, 0);
    }

    return mul(normalizeOr(direction, vec(0, 0, 1)), magnitude);
};

const currentParams = () => ({
    q: Number(controls.charge.value),
    speed: Number(controls.speed.value),
    B: getMagneticField(),
    timeScale: Number(controls.timeScale.value)
});

const worldScale = () => Math.max(20, Math.min(width, height) / 22);

const worldToScreen = (point) => {
    const scale = worldScale();
    return {
        x: width / 2 + point.x * scale,
        y: height / 2 - point.y * scale
    };
};

const resetSimulation = () => {
    position = vec(0, 0, 0);
    velocity = mul(getVelocityDirection(), Number(controls.speed.value));
    trail = [];
};

const clearTrail = () => {
    trail = [];
};

const setBSliders = (x, y, z) => {
    controls.bx.value = x;
    controls.by.value = y;
    controls.bz.value = z;
};

const applySpeedPreset = (presetName) => {
    const speed = speedPresets[presetName];
    if (speed === undefined) {
        return;
    }

    setControlValue(controls.speed, speed);
};

const applyVelocityPreset = (presetName) => {
    const preset = velocityPresets[presetName];
    if (!preset) {
        return;
    }

    setVelocitySliders(preset.x, preset.y, preset.z);
};

const applyMagneticPreset = (presetName) => {
    const preset = magneticPresets[presetName];
    if (!preset) {
        return;
    }

    setBSliders(preset.x, preset.y, preset.z);
};

const applyLessonPreset = (presetName) => {
    const preset = lessonPresets[presetName];
    if (!preset) {
        return;
    }

    setControlValue(controls.charge, preset.charge);
    setControlValue(controls.speedPreset, preset.speedPreset);
    applySpeedPreset(preset.speedPreset);
    setControlValue(controls.presetV, preset.velocityPreset);
    applyVelocityPreset(preset.velocityPreset);
    setControlValue(controls.presetB, preset.magneticPreset);
    applyMagneticPreset(preset.magneticPreset);
    setControlValue(controls.bStrength, preset.bStrength);
    setControlValue(controls.timeScale, preset.timeScale);
    resetSimulation();
    updateLabels();
    updateReadouts();
    setActiveLessonPreset(presetName);
};

const updateLabels = () => {
    output.qValue.textContent = Number(controls.charge.value) > 0 ? "+1" : "-1";
    output.speedValue.textContent = Number(controls.speed.value).toFixed(1);
    output.vxValue.textContent = Number(controls.vx.value).toFixed(2);
    output.vyValue.textContent = Number(controls.vy.value).toFixed(2);
    output.vzValue.textContent = Number(controls.vz.value).toFixed(2);
    output.bxValue.textContent = Number(controls.bx.value).toFixed(2);
    output.byValue.textContent = Number(controls.by.value).toFixed(2);
    output.bzValue.textContent = Number(controls.bz.value).toFixed(2);
    output.bStrengthValue.textContent = Number(controls.bStrength.value).toFixed(2);
    output.timeScaleValue.textContent = Number(controls.timeScale.value).toFixed(1);
};

const updateReadouts = () => {
    const params = currentParams();
    const B = params.B;
    const speed = length(velocity);
    const angle = angleBetween(velocity, B);
    const force = mul(cross(velocity, B), params.q);
    const forceMagnitude = length(force);
    const BMagnitude = length(B);
    const BDirection = BMagnitude > 1e-8 ? normalizeOr(B, vec(0, 0, 1)) : vec(0, 0, 1);
    const vParallel = dot(velocity, BDirection);
    const vPerpendicular = Math.sqrt(Math.max(0, speed * speed - vParallel * vParallel));
    const radius = (BMagnitude > 1e-8 && Math.abs(params.q) > 1e-8 && vPerpendicular > 1e-8)
        ? (mass * vPerpendicular) / (Math.abs(params.q) * BMagnitude)
        : Infinity;

    output.chargeMetric.textContent = params.q > 0 ? "正電荷 (+q)" : "負電荷 (-q)";
    output.angleMetric.textContent = `${angle.toFixed(1)}°`;
    output.forceMetric.textContent = forceMagnitude.toFixed(2);
    output.radiusMetric.textContent = Number.isFinite(radius) ? radius.toFixed(2) : "∞";

    if (BMagnitude < 1e-8) {
        output.motionTitle.textContent = "磁場がないので等速直線運動";
        output.motionSummary.textContent = "B = 0 なら q v × B = 0 となり、粒子はそのままの向きへ進みます。";
    } else if (vPerpendicular < 1e-5) {
        output.motionTitle.textContent = "速度が磁場と平行なので曲がらない";
        output.motionSummary.textContent = "v と B がほぼ平行なので sin θ ≈ 0 です。磁場はその成分を曲げず、投影は直線に見えます。";
    } else if (Math.abs(vParallel) < 1e-4) {
        output.motionTitle.textContent = "円運動の x-y 投影";
        output.motionSummary.textContent = "速度が磁場に垂直なので、力はいつも横向きです。速さを保ったまま向きだけが回り、円運動になります。";
    } else {
        output.motionTitle.textContent = "らせん運動の x-y 投影";
        output.motionSummary.textContent = "磁場に平行な成分は前進を保ち、垂直成分だけが回るので、実際にはらせん運動になります。";
    }

    const bzText = Math.abs(B.z) < 0.05
        ? "画面奥行き成分は小さく"
        : B.z > 0
            ? "磁場は画面の奥向き成分を含み"
            : "磁場は画面の手前向き成分を含み";

    if (params.q > 0) {
        output.ruleTitle.textContent = "正電荷では右手の向きがそのまま力になる";
        output.ruleSummary.textContent = `${bzText}、右手で v から B へ回した外積の向きが F です。紫の矢印でその向きを見比べてください。`;
    } else {
        output.ruleTitle.textContent = "負電荷では右手の向きを反転して読む";
        output.ruleSummary.textContent = `${bzText}、右手で得た v × B の向きを、電荷が負なので反対向きに読みます。正電荷と曲がり方が逆になります。`;
    }
};

const resizeCanvas = () => {
    const dpr = window.devicePixelRatio || 1;
    width = Math.max(canvas.clientWidth, 1);
    height = Math.max(canvas.clientHeight, 1);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
};

const borisPush = (dt) => {
    const params = currentParams();
    const B = params.B;

    if (Math.abs(params.q) < 1e-8 || length(B) < 1e-8) {
        position = add(position, mul(velocity, dt));
        return;
    }

    const t = mul(B, (params.q * dt) / (2 * mass));
    const tMagnitudeSquared = dot(t, t);
    const s = mul(t, 2 / (1 + tMagnitudeSquared));
    const vMinus = velocity;
    const vPrime = add(vMinus, cross(vMinus, t));
    const vPlus = add(vMinus, cross(vPrime, s));

    velocity = vPlus;
    position = add(position, mul(velocity, dt));
};

const physicsStep = (dt) => {
    borisPush(dt);

    const visibleX = width / (2 * worldScale());
    const visibleY = height / (2 * worldScale());

    if (
        Math.abs(position.x) > visibleX + 3 ||
        Math.abs(position.y) > visibleY + 3 ||
        Math.abs(position.z) > 80
    ) {
        resetSimulation();
        return;
    }

    trail.push({ x: position.x, y: position.y });
    if (trail.length > 1800) {
        trail.shift();
    }
};

const drawArrowScreen = (startX, startY, vectorX, vectorY, color, label, scale = 54) => {
    const magnitude = Math.hypot(vectorX, vectorY);
    if (magnitude < 1e-6) {
        return;
    }

    const endX = startX + (vectorX / magnitude) * scale;
    const endY = startY - (vectorY / magnitude) * scale;
    const angle = Math.atan2(endY - startY, endX - startX);

    context.save();
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(startX, startY);
    context.lineTo(endX, endY);
    context.stroke();

    context.beginPath();
    context.moveTo(endX, endY);
    context.lineTo(endX - 12 * Math.cos(angle - Math.PI / 6), endY - 12 * Math.sin(angle - Math.PI / 6));
    context.lineTo(endX - 12 * Math.cos(angle + Math.PI / 6), endY - 12 * Math.sin(angle + Math.PI / 6));
    context.closePath();
    context.fill();

    context.font = "700 15px IBM Plex Sans JP";
    context.fillText(label, endX + 8, endY - 8);
    context.restore();
};

const drawBackground = () => {
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#0a1a29");
    gradient.addColorStop(1, "#12304a");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
};

const drawGrid = () => {
    const step = worldScale();

    context.save();
    context.strokeStyle = "rgba(166, 196, 224, 0.12)";
    context.lineWidth = 1;

    for (let x = width / 2 % step; x < width; x += step) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
    }

    for (let y = height / 2 % step; y < height; y += step) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();
    }

    context.strokeStyle = "rgba(207, 227, 244, 0.58)";
    context.lineWidth = 1.6;
    context.beginPath();
    context.moveTo(0, height / 2);
    context.lineTo(width, height / 2);
    context.stroke();

    context.beginPath();
    context.moveTo(width / 2, 0);
    context.lineTo(width / 2, height);
    context.stroke();

    context.fillStyle = "rgba(230, 239, 247, 0.9)";
    context.font = "600 13px IBM Plex Sans JP";
    context.fillText("x", width - 22, height / 2 - 10);
    context.fillText("y", width / 2 + 10, 18);
    context.restore();
};

const drawMagneticBackground = (B) => {
    if (Math.abs(B.z) < 0.06) {
        return;
    }

    const symbol = B.z > 0 ? "×" : "•";
    const alpha = Math.min(0.58, Math.abs(B.z) * 0.26);

    context.save();
    context.globalAlpha = alpha;
    context.fillStyle = "#8be08f";
    context.font = "22px IBM Plex Sans JP";
    for (let x = 34; x < width; x += 54) {
        for (let y = 34; y < height; y += 54) {
            context.fillText(symbol, x, y);
        }
    }
    context.restore();
};

const drawTrail = () => {
    if (trail.length < 2) {
        return;
    }

    context.save();
    context.strokeStyle = "rgba(251, 113, 133, 0.72)";
    context.lineWidth = 2.2;
    context.beginPath();
    const first = worldToScreen(trail[0]);
    context.moveTo(first.x, first.y);

    trail.forEach((point) => {
        const screen = worldToScreen(point);
        context.lineTo(screen.x, screen.y);
    });

    context.stroke();
    context.restore();
};

const drawParticle = (force) => {
    const screen = worldToScreen(position);
    const charge = Number(controls.charge.value);

    context.save();
    context.fillStyle = charge > 0 ? "#ff5b5b" : "#45a4ff";
    context.beginPath();
    context.arc(screen.x, screen.y, 10.5, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#ffffff";
    context.font = "700 16px IBM Plex Sans JP";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(charge > 0 ? "+" : "−", screen.x, screen.y + 0.5);
    context.restore();

    drawArrowScreen(screen.x, screen.y, velocity.x, velocity.y, "#5db8ff", "v", 58);
    drawArrowScreen(screen.x, screen.y, force.x, force.y, "#c183ff", "F", 50);
};

const drawMagneticVector = (B) => {
    context.save();
    context.fillStyle = "rgba(6, 17, 29, 0.58)";
    context.strokeStyle = "rgba(255, 255, 255, 0.08)";
    context.lineWidth = 1;
    context.beginPath();
    context.roundRect(18, height - 110, 250, 80, 18);
    context.fill();
    context.stroke();

    context.fillStyle = "rgba(235, 246, 255, 0.92)";
    context.font = "700 12px IBM Plex Sans JP";
    context.fillText("磁場ベクトル B の表示", 34, height - 82);
    context.restore();

    drawArrowScreen(62, height - 52, B.x, B.y, "#7fe18d", "B", 64);

    context.save();
    context.fillStyle = "rgba(228, 240, 251, 0.86)";
    context.font = "600 13px IBM Plex Sans JP";
    const bzText = Math.abs(B.z) < 0.05
        ? "Bz はほぼ 0"
        : B.z > 0
            ? "Bz: 画面の奥向き ×"
            : "Bz: 画面の手前向き •";
    context.fillText(bzText, 120, height - 48);
    context.restore();
};

const drawProjectionNote = () => {
    context.save();
    context.fillStyle = "rgba(6, 17, 29, 0.52)";
    context.strokeStyle = "rgba(255, 255, 255, 0.08)";
    context.beginPath();
    context.roundRect(width - 284, 18, 266, 72, 18);
    context.fill();
    context.stroke();
    context.fillStyle = "rgba(235, 246, 255, 0.9)";
    context.font = "700 12px IBM Plex Sans JP";
    context.fillText("表示は x-y 平面への投影", width - 264, 42);
    context.font = "400 12px IBM Plex Sans JP";
    context.fillText("z 方向は背景の × / • と右ねじ説明で読む", width - 264, 64);
    context.restore();
};

const render = () => {
    const params = currentParams();
    const B = params.B;
    const force = mul(cross(velocity, B), params.q);

    drawBackground();
    drawMagneticBackground(B);
    drawGrid();
    drawTrail();
    drawMagneticVector(B);
    drawProjectionNote();
    drawParticle(force);
};

const loop = (now) => {
    const elapsedSeconds = Math.min(0.04, (now - lastFrameTime) / 1000);
    lastFrameTime = now;

    updateLabels();

    if (!paused) {
        const scaledDt = elapsedSeconds * Number(controls.timeScale.value);
        const substeps = 5;
        for (let step = 0; step < substeps; step += 1) {
            physicsStep(scaledDt / substeps);
        }
    }

    updateReadouts();
    render();
    requestAnimationFrame(loop);
};

controls.speedPreset.addEventListener("change", () => {
    if (controls.speedPreset.value !== "custom") {
        applySpeedPreset(controls.speedPreset.value);
        resetSimulation();
    }
    clearLessonPresetSelection();
});

controls.presetV.addEventListener("change", () => {
    if (controls.presetV.value !== "custom") {
        applyVelocityPreset(controls.presetV.value);
        resetSimulation();
    }
    clearLessonPresetSelection();
});

controls.presetB.addEventListener("change", () => {
    if (controls.presetB.value !== "custom") {
        applyMagneticPreset(controls.presetB.value);
        clearTrail();
    }
    clearLessonPresetSelection();
});

lessonPresetButtons.forEach((button) => {
    button.addEventListener("click", () => {
        applyLessonPreset(button.dataset.lessonPreset);
    });
});

[controls.bx, controls.by, controls.bz].forEach((input) => {
    input.addEventListener("input", () => {
        controls.presetB.value = "custom";
        clearLessonPresetSelection();
        clearTrail();
    });
});

[controls.bStrength].forEach((input) => {
    input.addEventListener("input", () => {
        clearLessonPresetSelection();
        clearTrail();
    });
});

[controls.speed].forEach((input) => {
    input.addEventListener("input", () => {
        controls.speedPreset.value = "custom";
        clearLessonPresetSelection();
        resetSimulation();
    });
});

[controls.vx, controls.vy, controls.vz].forEach((input) => {
    input.addEventListener("input", () => {
        controls.presetV.value = "custom";
        clearLessonPresetSelection();
        resetSimulation();
    });
});

[controls.charge].forEach((input) => {
    input.addEventListener("input", () => {
        clearLessonPresetSelection();
        resetSimulation();
    });
});

[controls.timeScale].forEach((input) => {
    input.addEventListener("input", () => {
        clearLessonPresetSelection();
    });
});

controls.pauseBtn.addEventListener("click", () => {
    paused = !paused;
    controls.pauseBtn.textContent = paused ? "再開" : "一時停止";
});

controls.resetBtn.addEventListener("click", resetSimulation);
controls.clearBtn.addEventListener("click", clearTrail);

if (typeof ResizeObserver === "function") {
    const resizeObserver = new ResizeObserver(() => {
        resizeCanvas();
    });
    resizeObserver.observe(canvasStage || canvas);
} else {
    window.addEventListener("resize", resizeCanvas);
}

resizeCanvas();
applyLessonPreset("circlePositive");
requestAnimationFrame(loop);