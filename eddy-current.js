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

const canvas = document.querySelector("#eddyCurrentCanvas");
const context = canvas?.getContext("2d");
const canvasStage = canvas?.parentElement;

if (!canvas || !context) {
    throw new Error("Eddy current canvas could not be initialized.");
}

const control = (id) => document.getElementById(id);

const controls = {
    magnetStrength: control("magnetStrength"),
    conductivity: control("conductivity"),
    spread: control("spread"),
    dragStrength: control("dragStrength"),
    displayMode: control("displayMode"),
    density: control("density"),
    autoBtn: control("autoBtn"),
    resetBtn: control("resetBtn")
};

const output = {
    magnetValue: control("magnetValue"),
    sigmaValue: control("sigmaValue"),
    spreadValue: control("spreadValue"),
    dragValue: control("dragValue"),
    densityValue: control("densityValue"),
    speedMetric: control("speedMetric"),
    fluxMetric: control("fluxMetric"),
    currentMetric: control("currentMetric"),
    brakeMetric: control("brakeMetric"),
    motionTitle: control("motionTitle"),
    motionSummary: control("motionSummary"),
    ruleTitle: control("ruleTitle"),
    ruleSummary: control("ruleSummary")
};

const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

let width = 0;
let height = 0;
let plate = { x: 0, y: 0, w: 0, h: 0 };

const magnet = {
    x: Number.NaN,
    y: Number.NaN,
    px: Number.NaN,
    py: Number.NaN,
    vx: 0,
    vy: 0,
    r: 36
};

let dragging = false;
let autoMode = false;
let simulationTime = 0;
let lastFrameTime = performance.now();
let pointerOffset = { x: 0, y: 0 };
let dragSample = { x: 0, y: 0, time: 0 };

const setAutoButtonLabel = () => {
    controls.autoBtn.textContent = autoMode ? "自動を止める" : "自動で動かす";
};

const updateLabels = () => {
    output.magnetValue.textContent = Number(controls.magnetStrength.value).toFixed(1);
    output.sigmaValue.textContent = Number(controls.conductivity.value).toFixed(1);
    output.spreadValue.textContent = Number(controls.spread.value).toFixed(0);
    output.dragValue.textContent = Number(controls.dragStrength.value).toFixed(2);
    output.densityValue.textContent = Number(controls.density.value).toFixed(0);
};

const computeLayout = (forceReset = false) => {
    const horizontalPadding = width < 640 ? 20 : 34;
    const plateWidth = Math.max(260, width - horizontalPadding * 2);
    const plateHeight = clamp(height * (width < 640 ? 0.56 : 0.62), 220, height - 112);

    plate = {
        x: (width - plateWidth) / 2,
        y: (height - plateHeight) / 2 + 20,
        w: plateWidth,
        h: plateHeight
    };

    magnet.r = clamp(Math.min(plate.w, plate.h) * 0.09, 28, 42);

    if (forceReset || !Number.isFinite(magnet.x) || !Number.isFinite(magnet.y)) {
        magnet.x = plate.x + plate.w / 2;
        magnet.y = plate.y + plate.h / 2 - plate.h * 0.05;
    } else {
        magnet.x = clamp(magnet.x, plate.x + magnet.r, plate.x + plate.w - magnet.r);
        magnet.y = clamp(magnet.y, plate.y + magnet.r, plate.y + plate.h - magnet.r);
    }

    magnet.px = magnet.x;
    magnet.py = magnet.y;
};

const resizeCanvas = () => {
    const dpr = window.devicePixelRatio || 1;
    width = Math.max(canvas.clientWidth, 1);
    height = Math.max(canvas.clientHeight, 1);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    computeLayout(false);
};

const resetSimulation = () => {
    autoMode = false;
    simulationTime = 0;
    magnet.vx = 0;
    magnet.vy = 0;
    computeLayout(true);
    setAutoButtonLabel();
};

const getPointerPosition = (event) => {
    const rect = canvas.getBoundingClientRect();
    return {
        x: ((event.clientX - rect.left) * width) / rect.width,
        y: ((event.clientY - rect.top) * height) / rect.height
    };
};

const isPointerNearMagnet = (point) => Math.hypot(point.x - magnet.x, point.y - magnet.y) <= magnet.r + 12;

const pointerDown = (event) => {
    const point = getPointerPosition(event);
    if (!isPointerNearMagnet(point)) {
        return;
    }

    dragging = true;
    autoMode = false;
    pointerOffset = {
        x: magnet.x - point.x,
        y: magnet.y - point.y
    };
    dragSample = {
        x: magnet.x,
        y: magnet.y,
        time: event.timeStamp
    };
    magnet.vx = 0;
    magnet.vy = 0;
    setAutoButtonLabel();
    canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
};

const pointerMove = (event) => {
    if (!dragging) {
        return;
    }

    const point = getPointerPosition(event);
    const nextX = clamp(point.x + pointerOffset.x, plate.x + magnet.r, plate.x + plate.w - magnet.r);
    const nextY = clamp(point.y + pointerOffset.y, plate.y + magnet.r, plate.y + plate.h - magnet.r);
    const elapsed = Math.max((event.timeStamp - dragSample.time) / 1000, 1 / 240);

    magnet.vx = (nextX - dragSample.x) / elapsed;
    magnet.vy = (nextY - dragSample.y) / elapsed;
    magnet.x = nextX;
    magnet.y = nextY;
    dragSample = {
        x: magnet.x,
        y: magnet.y,
        time: event.timeStamp
    };
    event.preventDefault();
};

const pointerUp = (event) => {
    if (!dragging) {
        return;
    }

    dragging = false;
    canvas.releasePointerCapture?.(event.pointerId);
};

canvas.addEventListener("pointerdown", pointerDown);
canvas.addEventListener("pointermove", pointerMove);
window.addEventListener("pointerup", pointerUp);
window.addEventListener("pointercancel", pointerUp);

controls.autoBtn.addEventListener("click", () => {
    autoMode = !autoMode;
    setAutoButtonLabel();
});

controls.resetBtn.addEventListener("click", resetSimulation);

const magneticFieldAt = (x, y) => {
    const strength = Number(controls.magnetStrength.value);
    const spread = Number(controls.spread.value);
    const dx = x - magnet.x;
    const dy = y - magnet.y;
    const rSquared = dx * dx + dy * dy;

    return strength * Math.exp(-rSquared / (2 * spread * spread));
};

const gradientBAt = (x, y) => {
    const spread = Number(controls.spread.value);
    const B = magneticFieldAt(x, y);
    return {
        x: -((x - magnet.x) / (spread * spread)) * B,
        y: -((y - magnet.y) / (spread * spread)) * B
    };
};

const eddyCurrentAt = (x, y) => {
    const sigma = Number(controls.conductivity.value);
    const gradient = gradientBAt(x, y);
    const dBdt = -((magnet.vx * gradient.x) + (magnet.vy * gradient.y)) / 240;
    const dx = x - magnet.x;
    const dy = y - magnet.y;
    const radius = Math.hypot(dx, dy) + 1e-6;
    const tangential = {
        x: -dy / radius,
        y: dx / radius
    };
    const localWeight = magneticFieldAt(x, y);
    const strength = sigma * dBdt * (0.28 + localWeight * 0.72);

    return {
        x: tangential.x * strength,
        y: tangential.y * strength,
        amp: Math.abs(strength),
        sign: Math.sign(strength) || 1
    };
};

const getIndicators = () => {
    const speed = Math.hypot(magnet.vx, magnet.vy);
    const spread = Math.max(Number(controls.spread.value), 1);
    const strength = Number(controls.magnetStrength.value);
    const conductivity = Number(controls.conductivity.value);
    const dragStrength = Number(controls.dragStrength.value);
    const fluxChange = (speed * strength) / (spread * 4.8);
    const currentIndex = fluxChange * conductivity;
    const brakeIndex = currentIndex * dragStrength * 0.82;

    return {
        speed,
        fluxChange,
        currentIndex,
        brakeIndex
    };
};

const updateReadouts = (indicators) => {
    output.speedMetric.textContent = `${indicators.speed.toFixed(1)} px/s`;
    output.fluxMetric.textContent = indicators.fluxChange.toFixed(2);
    output.currentMetric.textContent = indicators.currentIndex.toFixed(2);
    output.brakeMetric.textContent = indicators.brakeIndex.toFixed(2);

    if (indicators.speed < 6) {
        output.motionTitle.textContent = "磁石が止まっているので渦電流は弱い";
        output.motionSummary.textContent = "磁束の時間変化がほとんどないので、誘導起電力も小さくなります。まずは磁石を速く動かして変化を作ってください。";
    } else if (dragging) {
        output.motionTitle.textContent = "手で動かしたぶんだけ渦電流が立ち上がる";
        output.motionSummary.textContent = "今はドラッグで磁束変化を与えている状態です。速く動かすほど、導体板の矢印と磁気ブレーキの矢印が強くなります。";
    } else if (autoMode) {
        output.motionTitle.textContent = "周期的な磁束変化が続いている";
        output.motionSummary.textContent = "自動運動では磁石の向きと速さが変わり続けるので、渦電流の回る向きも場所ごとに切り替わります。";
    } else {
        output.motionTitle.textContent = "磁気ブレーキで滑るように減速している";
        output.motionSummary.textContent = "手を離したあとは、渦電流が返す抵抗をまとめた減衰モデルでゆっくり止まります。導体の電気伝導率を上げると止まりやすくなります。";
    }

    if (indicators.currentIndex < 0.14) {
        output.ruleTitle.textContent = "レンツの法則は『変化に逆らう』を選ぶ";
        output.ruleSummary.textContent = "今は変化が小さいので電流も弱いですが、向きそのものは常に『増えすぎるなら減らす、減りすぎるなら補う』側に決まります。";
    } else if (Number(controls.conductivity.value) > 1.8) {
        output.ruleTitle.textContent = "よく流れる導体ほど逆向きの応答が強くなる";
        output.ruleSummary.textContent = "電気伝導率が高いので、同じ磁束変化でも大きな渦電流が流れます。その結果、磁石へ返る磁気ブレーキも大きく見えます。";
    } else {
        output.ruleTitle.textContent = "渦電流は変化を打ち消す向きに流れる";
        output.ruleSummary.textContent = "磁石が近づいて磁束が増えるなら、それを弱める向きに。遠ざかって磁束が減るなら、それを補う向きに電流が生じます。";
    }
};

const updateSimulation = (dt) => {
    simulationTime += dt;

    if (autoMode && !dragging) {
        magnet.x = plate.x + plate.w * 0.5 + plate.w * 0.31 * Math.sin(simulationTime * 0.82);
        magnet.y = plate.y + plate.h * 0.5 + plate.h * 0.22 * Math.sin(simulationTime * 1.18 + 0.85);
    }

    if (dragging || autoMode) {
        magnet.vx = (magnet.x - magnet.px) / Math.max(dt, 1e-6);
        magnet.vy = (magnet.y - magnet.py) / Math.max(dt, 1e-6);
    } else {
        const sigma = Number(controls.conductivity.value);
        const drag = Number(controls.dragStrength.value);
        const damping = Math.exp(-sigma * drag * dt * 1.8);
        magnet.vx *= damping;
        magnet.vy *= damping;
        magnet.x += magnet.vx * dt;
        magnet.y += magnet.vy * dt;
    }

    const clampedX = clamp(magnet.x, plate.x + magnet.r, plate.x + plate.w - magnet.r);
    const clampedY = clamp(magnet.y, plate.y + magnet.r, plate.y + plate.h - magnet.r);

    if (clampedX !== magnet.x) {
        magnet.vx *= 0.22;
    }
    if (clampedY !== magnet.y) {
        magnet.vy *= 0.22;
    }

    magnet.x = clampedX;
    magnet.y = clampedY;
    magnet.px = magnet.x;
    magnet.py = magnet.y;
};

const drawArrowRaw = (x, y, dx, dy, headSize) => {
    const angle = Math.atan2(dy, dx);
    context.beginPath();
    context.moveTo(x - dx * 0.5, y - dy * 0.5);
    context.lineTo(x + dx * 0.5, y + dy * 0.5);
    context.stroke();

    context.beginPath();
    context.moveTo(x + dx * 0.5, y + dy * 0.5);
    context.lineTo(
        x + dx * 0.5 - headSize * Math.cos(angle - Math.PI / 6),
        y + dy * 0.5 - headSize * Math.sin(angle - Math.PI / 6)
    );
    context.lineTo(
        x + dx * 0.5 - headSize * Math.cos(angle + Math.PI / 6),
        y + dy * 0.5 - headSize * Math.sin(angle + Math.PI / 6)
    );
    context.closePath();
    context.fill();
};

const drawBackground = () => {
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#f6f9fd");
    gradient.addColorStop(1, "#dfe9f3");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
};

const drawPlate = () => {
    context.save();
    const gradient = context.createLinearGradient(plate.x, plate.y, plate.x + plate.w, plate.y + plate.h);
    gradient.addColorStop(0, "rgba(22, 163, 74, 0.12)");
    gradient.addColorStop(1, "rgba(20, 184, 166, 0.20)");
    context.fillStyle = gradient;
    context.strokeStyle = "#178052";
    context.lineWidth = 3;
    context.beginPath();
    context.roundRect(plate.x, plate.y, plate.w, plate.h, 18);
    context.fill();
    context.stroke();

    context.fillStyle = "#166534";
    context.font = "700 16px IBM Plex Sans JP";
    context.fillText("導体板", plate.x + 18, plate.y + 28);
    context.restore();
};

const drawFieldMap = () => {
    const mode = controls.displayMode.value;
    if (mode !== "field" && mode !== "both") {
        return;
    }

    const step = width < 640 ? 14 : 16;
    const baseStrength = Math.max(Number(controls.magnetStrength.value), 0.2);

    for (let x = plate.x; x < plate.x + plate.w; x += step) {
        for (let y = plate.y; y < plate.y + plate.h; y += step) {
            const B = magneticFieldAt(x + step * 0.5, y + step * 0.5);
            const alpha = clamp(B / (baseStrength * 1.2), 0, 0.58) * 0.62;
            context.fillStyle = `rgba(37, 99, 235, ${alpha})`;
            context.fillRect(x, y, step + 1, step + 1);
        }
    }
};

const drawCurrentVectors = () => {
    const mode = controls.displayMode.value;
    if (mode !== "current" && mode !== "both") {
        return;
    }

    const step = Number(controls.density.value);
    context.save();
    context.lineWidth = 2;

    for (let x = plate.x + step * 0.7; x < plate.x + plate.w - step * 0.4; x += step) {
        for (let y = plate.y + step * 0.7; y < plate.y + plate.h - step * 0.4; y += step) {
            const J = eddyCurrentAt(x, y);
            const magnitude = Math.hypot(J.x, J.y);
            const length = clamp(J.amp * 240, 0, 24);

            if (magnitude < 1e-5 || length < 2) {
                continue;
            }

            const unitX = J.x / magnitude;
            const unitY = J.y / magnitude;
            context.strokeStyle = J.sign >= 0 ? "rgba(249, 115, 22, 0.86)" : "rgba(147, 51, 234, 0.78)";
            context.fillStyle = context.strokeStyle;
            drawArrowRaw(x, y, unitX * length, unitY * length, 6);
        }
    }

    context.restore();
};

const drawMagnet = () => {
    context.save();
    context.translate(magnet.x, magnet.y);

    context.fillStyle = "rgba(239, 68, 68, 0.14)";
    context.beginPath();
    context.arc(0, 0, Number(controls.spread.value), 0, Math.PI * 2);
    context.fill();

    const magnetWidth = magnet.r * 1.6;
    const magnetHeight = magnet.r * 2.15;

    context.fillStyle = "#ef4444";
    context.strokeStyle = "#8f1f25";
    context.lineWidth = 3;
    context.beginPath();
    context.roundRect(-magnetWidth / 2, -magnetHeight / 2, magnetWidth, magnetHeight, 14);
    context.fill();
    context.stroke();

    context.fillStyle = "rgba(255, 255, 255, 0.14)";
    context.fillRect(-magnetWidth / 2 + 2, 0, magnetWidth - 4, magnetHeight / 2 - 2);

    context.fillStyle = "#ffffff";
    context.font = `700 ${Math.max(18, magnet.r * 0.65)}px IBM Plex Sans JP`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("N", 0, -magnetHeight * 0.22);
    context.fillText("S", 0, magnetHeight * 0.22);

    context.restore();
};

const drawVelocityAndDrag = (indicators) => {
    if (indicators.speed < 5) {
        return;
    }

    const unitX = magnet.vx / indicators.speed;
    const unitY = magnet.vy / indicators.speed;
    const velocityLength = clamp(indicators.speed * 0.055, 20, 84);

    context.save();
    context.lineWidth = 4;
    context.strokeStyle = "#2563eb";
    context.fillStyle = "#2563eb";
    drawArrowRaw(magnet.x, magnet.y - magnet.r - 24, unitX * velocityLength, unitY * velocityLength, 10);
    context.font = "700 15px IBM Plex Sans JP";
    context.fillText("v", magnet.x + unitX * velocityLength * 0.65 + 10, magnet.y - magnet.r - 24 + unitY * velocityLength * 0.65 - 6);

    const brakeLength = clamp(indicators.brakeIndex * 20, 0, 78);
    if (brakeLength > 8) {
        context.strokeStyle = "#9333ea";
        context.fillStyle = "#9333ea";
        drawArrowRaw(magnet.x, magnet.y + magnet.r + 24, -unitX * brakeLength, -unitY * brakeLength, 10);
        context.fillText("磁気ブレーキ", magnet.x - unitX * brakeLength * 0.65 + 12, magnet.y + magnet.r + 24 - unitY * brakeLength * 0.65);
    }

    context.restore();
};

const drawInfoBox = (indicators) => {
    context.save();
    context.fillStyle = "rgba(255, 255, 255, 0.9)";
    context.strokeStyle = "#dbe3f0";
    context.lineWidth = 1;
    context.beginPath();
    context.roundRect(20, 20, Math.min(360, width - 40), 128, 14);
    context.fill();
    context.stroke();

    context.fillStyle = "#111827";
    context.font = "14px IBM Plex Sans JP";
    context.fillText(`磁石の速さ: ${indicators.speed.toFixed(1)} px/s`, 38, 50);
    context.fillText(`磁束変化の目安: ${indicators.fluxChange.toFixed(2)}`, 38, 76);
    context.fillText(`渦電流の強さ目安: ${indicators.currentIndex.toFixed(2)}`, 38, 102);
    context.fillText("レンツの法則: 変化を打ち消す向き", 38, 128);
    context.restore();
};

const drawCanvasHint = () => {
    context.save();
    const boxWidth = Math.min(286, width - 36);
    context.fillStyle = "rgba(14, 31, 40, 0.56)";
    context.strokeStyle = "rgba(255, 255, 255, 0.1)";
    context.beginPath();
    context.roundRect(width - boxWidth - 18, 18, boxWidth, 72, 18);
    context.fill();
    context.stroke();
    context.fillStyle = "rgba(240, 248, 255, 0.92)";
    context.font = "700 12px IBM Plex Sans JP";
    context.fillText("磁石をドラッグして磁束変化を作る", width - boxWidth, 42);
    context.font = "400 12px IBM Plex Sans JP";
    context.fillText("橙 / 紫の矢印が渦電流、紫の長矢印が磁気ブレーキ", width - boxWidth, 64);
    context.restore();
};

const render = (indicators) => {
    drawBackground();
    drawPlate();
    drawFieldMap();
    drawCurrentVectors();
    drawMagnet();
    drawVelocityAndDrag(indicators);
    drawInfoBox(indicators);
    drawCanvasHint();
};

const loop = (now) => {
    const elapsedSeconds = Math.min(0.05, (now - lastFrameTime) / 1000);
    lastFrameTime = now;

    updateLabels();
    updateSimulation(elapsedSeconds);
    const indicators = getIndicators();
    updateReadouts(indicators);
    render(indicators);
    requestAnimationFrame(loop);
};

if (typeof ResizeObserver === "function") {
    const resizeObserver = new ResizeObserver(() => {
        resizeCanvas();
    });
    resizeObserver.observe(canvasStage || canvas);
} else {
    window.addEventListener("resize", resizeCanvas);
}

resizeCanvas();
resetSimulation();
updateLabels();
updateReadouts(getIndicators());
requestAnimationFrame(loop);