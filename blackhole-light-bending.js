const dom = {
    canvas: document.querySelector("#canvas"),
    observerCanvas: document.querySelector("#observerCanvas"),
    massRange: document.querySelector("#massRange"),
    spinRange: document.querySelector("#spinRange"),
    rayRange: document.querySelector("#rayRange"),
    lensRange: document.querySelector("#lensRange"),
    stepRange: document.querySelector("#stepRange"),
    massValue: document.querySelector("#massValue"),
    spinValue: document.querySelector("#spinValue"),
    rayValue: document.querySelector("#rayValue"),
    lensValue: document.querySelector("#lensValue"),
    stepValue: document.querySelector("#stepValue"),
    resetBtn: document.querySelector("#resetBtn"),
    animateBtn: document.querySelector("#animateBtn"),
    statusChip: document.querySelector("#statusChip"),
    observerModeChip: document.querySelector("#observerModeChip"),
    summaryText: document.querySelector("#summaryText"),
    horizonText: document.querySelector("#horizonText"),
    photonSphereText: document.querySelector("#photonSphereText"),
    progradeText: document.querySelector("#progradeText"),
    retrogradeText: document.querySelector("#retrogradeText"),
    capturedText: document.querySelector("#capturedText"),
    escapedText: document.querySelector("#escapedText"),
    closestText: document.querySelector("#closestText"),
    criticalText: document.querySelector("#criticalText"),
    shadowShiftText: document.querySelector("#shadowShiftText")
};

const ctx = dom.canvas.getContext("2d");
const observerCtx = dom.observerCanvas.getContext("2d");
const staticCanvas = document.createElement("canvas");
const staticCtx = staticCanvas.getContext("2d");

const state = {
    mass: 1.4,
    spin: 0.35,
    rayCount: 65,
    lensStrength: 1.0,
    maxSteps: 1000,
    paused: false,
    drawProgress: 0,
    maxRayPoints: 0,
    animationId: null,
    lastFrameTime: 0,
    rays: [],
    spread: 10,
    scene: null,
    stars: [],
    observerStars: [],
    needsStaticRedraw: true,
    needsObserverRedraw: true,
    needsCompositeRedraw: true,
    stats: {
        captured: 0,
        escaped: 0,
        closest: Number.POSITIVE_INFINITY,
        shadowShift: 0
    },
    viewport: {
        width: 960,
        height: 560,
        dpr: 1
    },
    observerViewport: {
        width: 960,
        height: 190,
        dpr: 1
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

function formatNumber(value, digits = 1) {
    return value.toFixed(digits).replace(/(?:\.0+|(\.\d*?[1-9]))0+$/, "$1");
}

function resizeCanvasElement(canvas, context, cssWidth, cssHeight) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.height = `${cssHeight}px`;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    return {
        width: cssWidth,
        height: cssHeight,
        dpr
    };
}

function resizeBufferCanvas(viewport) {
    staticCanvas.width = Math.round(viewport.width * viewport.dpr);
    staticCanvas.height = Math.round(viewport.height * viewport.dpr);
    staticCtx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
}

function buildStarField(width, height, count, xStep, yStep) {
    const stars = [];

    for (let index = 0; index < count; index += 1) {
        stars.push({
            x: ((index * xStep) % width) + ((index % 7) * 0.37),
            y: ((index * yStep) % height) + ((index % 5) * 0.41),
            size: 0.7 + ((index % 4) * 0.28),
            alpha: 0.18 + ((index % 6) * 0.08)
        });
    }

    return stars;
}

function getKerrLikeMetrics(mass, spin) {
    const spinAbs = Math.min(Math.abs(spin), 0.999);
    const horizon = mass * (1 + Math.sqrt(Math.max(0, 1 - (spinAbs * spinAbs))));
    const progradePhoton = 2 * mass * (1 + Math.cos((2 / 3) * Math.acos(-spinAbs)));
    const retrogradePhoton = 2 * mass * (1 + Math.cos((2 / 3) * Math.acos(spinAbs)));
    const basePhoton = 3 * mass;
    const baseCritical = 3 * Math.sqrt(3) * mass;

    return {
        horizon,
        progradePhoton,
        retrogradePhoton,
        basePhoton,
        baseCritical,
        progradeCritical: baseCritical * (1 - (0.18 * spinAbs)),
        retrogradeCritical: baseCritical * (1 + (0.18 * spinAbs))
    };
}

function getSceneMetrics() {
    const { width, height } = state.viewport;
    const kerr = getKerrLikeMetrics(state.mass, state.spin);
    const worldRadius = 18 + (state.mass * 7) + (Math.abs(state.spin) * 2);
    const unit = Math.min((width * 0.96) / (worldRadius * 2), (height * 0.86) / (worldRadius * 1.34));

    return {
        width,
        height,
        centerX: width * 0.48,
        centerY: height * 0.54,
        unit,
        worldRadius,
        ...kerr
    };
}

function toCanvasPoint(scene, point) {
    return {
        x: scene.centerX + (point.x * scene.unit),
        y: scene.centerY + (point.y * scene.unit)
    };
}

function getColorForImpact(impact, spread, alpha) {
    const normalized = clamp((impact + spread) / (spread * 2), 0, 1);
    const hue = 188 + (normalized * 28);
    const lightness = 66 + ((1 - Math.abs((normalized - 0.5) * 2)) * 10);
    return `hsla(${hue}, 92%, ${lightness}%, ${alpha})`;
}

function worldToObserverY(value, spread, height) {
    const safeSpread = Math.max(spread, 1);
    const clamped = clamp(value, -(safeSpread * 1.3), safeSpread * 1.3);
    const normalized = 0.5 - (clamped / (safeSpread * 2.6));
    return normalized * height;
}

function markAllLayersDirty() {
    state.needsStaticRedraw = true;
    state.needsObserverRedraw = true;
    state.needsCompositeRedraw = true;
}

function requestRender() {
    if (state.animationId === null) {
        state.animationId = window.requestAnimationFrame(renderLoop);
    }
}

function updateControls() {
    const kerr = getKerrLikeMetrics(state.mass, state.spin);
    const spinAbs = Math.abs(state.spin);
    const total = state.stats.captured + state.stats.escaped;
    const captureRatio = total > 0 ? state.stats.captured / total : 0;

    dom.massValue.textContent = formatNumber(state.mass, 1);
    dom.spinValue.textContent = formatNumber(state.spin, 2);
    dom.rayValue.textContent = String(state.rayCount);
    dom.lensValue.textContent = formatNumber(state.lensStrength, 1);
    dom.stepValue.textContent = String(state.maxSteps);

    dom.horizonText.textContent = `${formatNumber(kerr.horizon, 2)} M`;
    dom.photonSphereText.textContent = `${formatNumber(kerr.basePhoton, 2)} M`;
    dom.progradeText.textContent = `${formatNumber(kerr.progradePhoton, 2)} M`;
    dom.retrogradeText.textContent = `${formatNumber(kerr.retrogradePhoton, 2)} M`;
    dom.capturedText.textContent = `${state.stats.captured} 本`;
    dom.escapedText.textContent = `${state.stats.escaped} 本`;
    dom.closestText.textContent = Number.isFinite(state.stats.closest)
        ? `${formatNumber(state.stats.closest, 2)} M`
        : "--";
    dom.criticalText.textContent = spinAbs < 0.03
        ? `${formatNumber(kerr.baseCritical * Math.sqrt(state.lensStrength), 2)} M`
        : `${formatNumber(kerr.progradeCritical * Math.sqrt(state.lensStrength), 2)} ↔ ${formatNumber(kerr.retrogradeCritical * Math.sqrt(state.lensStrength), 2)} M`;

    const shadowPercent = Math.round(Math.abs(state.stats.shadowShift) * 100);
    dom.shadowShiftText.textContent = shadowPercent === 0
        ? "ほぼ対称"
        : `${state.stats.shadowShift > 0 ? "右" : "左"}へ ${shadowPercent}%`;

    let summary = "遠くを通る光は少しだけ曲がって右へ抜けます。まずは青い線の曲がり方に注目してください。";

    if (state.mass >= 2.2 || state.lensStrength >= 1.6) {
        summary = "光子球の近くをかすめる光が長く滞在し、大きく巻いてから抜ける軌道が増えています。";
    }

    if (state.rayCount >= 90) {
        summary = "光線が細かく並び、どの衝突パラメータから捕獲へ切り替わるかが読みやすい状態です。";
    }

    if (captureRatio > 0.45) {
        summary = "光子球付近へ入る光線が増え、巻き込まれる金色の線が目立っています。境目の鋭さを見るのに向いています。";
    }

    if (spinAbs > 0.05) {
        const draggedSide = state.spin > 0 ? "上側" : "下側";
        const screenSide = state.stats.shadowShift > 0 ? "右" : "左";
        summary = `${draggedSide}の光線が回転に引きずられてより強く巻き、observer screen の影も ${screenSide} へ寄っています。順行側と逆行側の光子軌道の差を見てください。`;
    }

    const observerModeText = spinAbs < 0.03
        ? "observer / 非回転"
        : `observer / ${state.spin > 0 ? "時計回り寄り" : "反時計回り寄り"}`;

    dom.summaryText.textContent = summary;
    dom.statusChip.textContent = state.paused ? "停止中" : "再生中";
    dom.observerModeChip.textContent = observerModeText;
    dom.animateBtn.textContent = state.paused ? "再開" : "一時停止";
}

function syncStateFromControls() {
    state.mass = Number(dom.massRange.value);
    state.spin = Number(dom.spinRange.value);
    state.rayCount = Number(dom.rayRange.value);
    state.lensStrength = Number(dom.lensRange.value);
    state.maxSteps = Number(dom.stepRange.value);
}

function resizeCanvas() {
    const mainShell = dom.canvas.parentElement;
    const mainBounds = mainShell.getBoundingClientRect();
    const mainWidth = Math.max(320, Math.round(mainBounds.width || mainShell.clientWidth || 960));
    const mainHeight = window.innerWidth <= 780
        ? Math.round(clamp(mainWidth * 0.82, 340, 500))
        : Math.round(clamp(mainWidth * 0.62, 420, 640));

    const observerShell = dom.observerCanvas.parentElement;
    const observerBounds = observerShell.getBoundingClientRect();
    const observerWidth = Math.max(320, Math.round(observerBounds.width || observerShell.clientWidth || mainWidth));
    const observerHeight = window.innerWidth <= 780
        ? Math.round(clamp(observerWidth * 0.42, 150, 240))
        : Math.round(clamp(observerWidth * 0.26, 160, 220));

    state.viewport = resizeCanvasElement(dom.canvas, ctx, mainWidth, mainHeight);
    state.observerViewport = resizeCanvasElement(dom.observerCanvas, observerCtx, observerWidth, observerHeight);
    resizeBufferCanvas(state.viewport);

    state.stars = buildStarField(mainWidth, mainHeight, 96, 163, 97);
    state.observerStars = buildStarField(observerWidth, observerHeight, 72, 211, 149);
    markAllLayersDirty();
}

function tracePhoton(impact, mass, spin, lensStrength, maxSteps) {
    const kerr = getKerrLikeMetrics(mass, spin);
    const startX = -18 - (mass * 6);
    const worldRadius = 18 + (mass * 7) + (Math.abs(spin) * 2);
    const impactSign = Math.sign(impact || 1);
    const sideLens = clamp(lensStrength * (1 + (spin * impactSign * 0.55)), 0.22, 3.4);
    const dragStrength = spin * impactSign;
    let phi = Math.atan2(impact, startX);
    let u = 1 / Math.hypot(startX, impact);
    let du = Math.cos(phi) / impact;
    const dphi = -0.0056 * Math.sign(impact || 1);
    const points = [];
    let captured = false;
    let closest = Number.POSITIVE_INFINITY;

    for (let step = 0; step < maxSteps; step += 1) {
        const safeU = Math.max(Math.abs(u), 1e-6);
        const r = 1 / safeU;
        const x = r * Math.cos(phi);
        const y = r * Math.sin(phi);

        closest = Math.min(closest, r);
        points.push({ x, y, r });

        if (r <= kerr.horizon * 1.01) {
            captured = true;
            break;
        }

        if (step > 40 && x > worldRadius * 0.92) {
            break;
        }

        const spinBias = clamp((safeU * mass * 1.9), 0, 0.28);
        const localStep = dphi * (1 + (dragStrength * spinBias));
        const secondDerivative = (value) => -value
            + (3 * mass * sideLens * value * value)
            + (2.05 * dragStrength * mass * value * value * value);

        const k1u = du;
        const k1v = secondDerivative(u);
        const k2u = du + (0.5 * localStep * k1v);
        const k2v = secondDerivative(u + (0.5 * localStep * k1u));
        const k3u = du + (0.5 * localStep * k2v);
        const k3v = secondDerivative(u + (0.5 * localStep * k2u));
        const k4u = du + (localStep * k3v);
        const k4v = secondDerivative(u + (localStep * k3u));

        u += (localStep / 6) * (k1u + (2 * k2u) + (2 * k3u) + k4u);
        du += (localStep / 6) * (k1v + (2 * k2v) + (2 * k3v) + k4v);
        phi += localStep;

        if (!Number.isFinite(u) || !Number.isFinite(du) || Math.abs(u) > 8) {
            captured = true;
            break;
        }
    }

    const lastPoint = points[points.length - 1] || { x: startX, y: impact, r: Number.POSITIVE_INFINITY };
    const previousPoint = points[Math.max(points.length - 5, 0)] || lastPoint;
    const exitAngle = Math.atan2(lastPoint.y - previousPoint.y, lastPoint.x - previousPoint.x);
    const screenY = lastPoint.y + (Math.tan(exitAngle) * (2 + (Math.abs(spin) * 1.5)));

    return {
        points,
        impact,
        captured,
        closest,
        exitAngle,
        screenY,
        sideLens,
        canvasPoints: []
    };
}

function generateRays(resetProgress = true) {
    syncStateFromControls();
    state.scene = getSceneMetrics();

    const spread = 6.4 + (state.mass * 2.1);
    const rays = [];
    let closest = Number.POSITIVE_INFINITY;
    let captured = 0;
    let escaped = 0;
    let maxRayPoints = 0;

    state.spread = spread;

    for (let index = 0; index < state.rayCount; index += 1) {
        const t = state.rayCount === 1 ? 0.5 : index / (state.rayCount - 1);
        const impact = -spread + ((spread * 2) * t);

        if (Math.abs(impact) < Math.max(0.12, state.mass * 0.08)) {
            continue;
        }

        const ray = tracePhoton(impact, state.mass, state.spin, state.lensStrength, state.maxSteps);
        ray.canvasPoints = ray.points.map((point) => toCanvasPoint(state.scene, point));
        maxRayPoints = Math.max(maxRayPoints, ray.canvasPoints.length);
        closest = Math.min(closest, ray.closest);

        if (ray.captured) {
            captured += 1;
        } else {
            escaped += 1;
        }

        rays.push(ray);
    }

    state.rays = rays;
    state.maxRayPoints = maxRayPoints;
    state.stats = {
        captured,
        escaped,
        closest,
        shadowShift: clamp(state.spin * (0.09 + ((captured / Math.max(captured + escaped, 1)) * 0.05)), -0.18, 0.18)
    };

    if (state.paused) {
        state.drawProgress = state.maxRayPoints + 70;
    } else if (resetProgress) {
        state.drawProgress = 0;
    } else {
        state.drawProgress = Math.min(state.drawProgress, state.maxRayPoints + 70);
    }

    markAllLayersDirty();
    updateControls();
    requestRender();
}

function drawBackground(targetCtx, scene, stars) {
    const gradient = targetCtx.createRadialGradient(scene.centerX, scene.centerY, 0, scene.centerX, scene.centerY, Math.max(scene.width, scene.height) * 0.75);
    gradient.addColorStop(0, "#121a2e");
    gradient.addColorStop(0.45, "#091120");
    gradient.addColorStop(1, "#03060c");

    targetCtx.clearRect(0, 0, scene.width, scene.height);
    targetCtx.fillStyle = gradient;
    targetCtx.fillRect(0, 0, scene.width, scene.height);

    stars.forEach((star) => {
        targetCtx.fillStyle = `rgba(255, 255, 255, ${star.alpha})`;
        targetCtx.fillRect(star.x, star.y, star.size, star.size);
    });

    targetCtx.strokeStyle = "rgba(130, 162, 220, 0.08)";
    targetCtx.lineWidth = 1;
    for (let index = 0; index < 4; index += 1) {
        const y = scene.height * (0.18 + (index * 0.18));
        targetCtx.beginPath();
        targetCtx.moveTo(0, y);
        targetCtx.lineTo(scene.width, y);
        targetCtx.stroke();
    }
}

function drawEmitter(targetCtx, scene) {
    const glow = targetCtx.createLinearGradient(0, 0, scene.width * 0.18, 0);
    glow.addColorStop(0, "rgba(120, 229, 255, 0.14)");
    glow.addColorStop(1, "rgba(120, 229, 255, 0)");
    targetCtx.fillStyle = glow;
    targetCtx.fillRect(0, scene.height * 0.08, scene.width * 0.2, scene.height * 0.78);

    targetCtx.fillStyle = "rgba(199, 235, 255, 0.82)";
    targetCtx.font = "700 15px IBM Plex Sans JP";
    targetCtx.fillText("incoming light", 20, 28);
}

function drawBlackHole(targetCtx, scene) {
    const horizon = scene.horizon * scene.unit;
    const photonSphere = scene.basePhoton * scene.unit;
    const progradePhoton = scene.progradePhoton * scene.unit;
    const retrogradePhoton = scene.retrogradePhoton * scene.unit;
    const progradeIsUpper = state.spin >= 0;

    targetCtx.save();
    targetCtx.translate(scene.centerX, scene.centerY);
    targetCtx.rotate(-0.18);
    targetCtx.globalAlpha = 0.58;
    targetCtx.strokeStyle = "rgba(255, 153, 76, 0.72)";
    targetCtx.lineWidth = 9;
    targetCtx.beginPath();
    targetCtx.ellipse(0, 0, horizon * 2.35, horizon * 0.66, 0, 0, Math.PI * 2);
    targetCtx.stroke();
    targetCtx.strokeStyle = "rgba(255, 222, 148, 0.3)";
    targetCtx.lineWidth = 3;
    targetCtx.beginPath();
    targetCtx.ellipse(0, 0, horizon * 2.84, horizon * 0.9, 0, 0, Math.PI * 2);
    targetCtx.stroke();
    targetCtx.restore();

    targetCtx.save();
    targetCtx.setLineDash([8, 8]);
    targetCtx.strokeStyle = "rgba(164, 205, 255, 0.34)";
    targetCtx.lineWidth = 1.2;
    targetCtx.beginPath();
    targetCtx.arc(scene.centerX, scene.centerY, photonSphere, 0, Math.PI * 2);
    targetCtx.stroke();

    if (Math.abs(state.spin) > 0.03) {
        const upperStart = Math.PI * 1.08;
        const upperEnd = Math.PI * 1.92;
        const lowerStart = Math.PI * 0.08;
        const lowerEnd = Math.PI * 0.92;

        targetCtx.strokeStyle = "rgba(255, 207, 98, 0.72)";
        targetCtx.beginPath();
        targetCtx.arc(scene.centerX, scene.centerY, progradeIsUpper ? progradePhoton : retrogradePhoton, progradeIsUpper ? upperStart : lowerStart, progradeIsUpper ? upperEnd : lowerEnd);
        targetCtx.stroke();

        targetCtx.strokeStyle = "rgba(118, 219, 255, 0.66)";
        targetCtx.beginPath();
        targetCtx.arc(scene.centerX, scene.centerY, progradeIsUpper ? retrogradePhoton : progradePhoton, progradeIsUpper ? lowerStart : upperStart, progradeIsUpper ? lowerEnd : upperEnd);
        targetCtx.stroke();
    }
    targetCtx.restore();

    const coreGradient = targetCtx.createRadialGradient(scene.centerX - (horizon * 0.2), scene.centerY - (horizon * 0.24), 2, scene.centerX, scene.centerY, horizon);
    coreGradient.addColorStop(0, "#000000");
    coreGradient.addColorStop(0.7, "#030303");
    coreGradient.addColorStop(1, "#151515");
    targetCtx.fillStyle = coreGradient;
    targetCtx.beginPath();
    targetCtx.arc(scene.centerX, scene.centerY, horizon, 0, Math.PI * 2);
    targetCtx.fill();

    targetCtx.strokeStyle = "rgba(115, 154, 255, 0.34)";
    targetCtx.lineWidth = 2;
    targetCtx.beginPath();
    targetCtx.arc(scene.centerX, scene.centerY, horizon * 1.08, 0, Math.PI * 2);
    targetCtx.stroke();

    targetCtx.fillStyle = "rgba(255, 255, 255, 0.62)";
    targetCtx.font = "600 13px IBM Plex Sans JP";
    targetCtx.fillText("r = 3M", scene.centerX + photonSphere + 10, scene.centerY - 10);
    targetCtx.fillText(`r+ = ${formatNumber(scene.horizon, 2)} M`, scene.centerX + horizon + 10, scene.centerY + 20);
}

function drawObserverMarker(targetCtx, scene) {
    const planePoint = toCanvasPoint(scene, { x: scene.worldRadius * 0.96, y: 0 });
    const planeX = planePoint.x;
    const lineTop = scene.height * 0.12;
    const lineBottom = scene.height * 0.88;
    const iconX = Math.min(scene.width - 26, planeX + 18);
    const iconY = scene.centerY;

    targetCtx.save();

    const planeGlow = targetCtx.createLinearGradient(planeX - 18, 0, planeX + 18, 0);
    planeGlow.addColorStop(0, "rgba(118, 219, 255, 0)");
    planeGlow.addColorStop(0.45, "rgba(118, 219, 255, 0.16)");
    planeGlow.addColorStop(1, "rgba(118, 219, 255, 0.02)");
    targetCtx.fillStyle = planeGlow;
    targetCtx.fillRect(planeX - 11, lineTop, 22, lineBottom - lineTop);

    targetCtx.setLineDash([8, 6]);
    targetCtx.strokeStyle = "rgba(182, 222, 255, 0.52)";
    targetCtx.lineWidth = 1.2;
    targetCtx.beginPath();
    targetCtx.moveTo(planeX, lineTop);
    targetCtx.lineTo(planeX, lineBottom);
    targetCtx.stroke();
    targetCtx.setLineDash([]);

    targetCtx.strokeStyle = "rgba(182, 222, 255, 0.44)";
    targetCtx.lineWidth = 1.1;
    targetCtx.beginPath();
    targetCtx.moveTo(planeX, iconY);
    targetCtx.lineTo(iconX - 10, iconY);
    targetCtx.stroke();

    targetCtx.fillStyle = "rgba(3, 11, 22, 0.96)";
    targetCtx.beginPath();
    targetCtx.arc(iconX, iconY, 9, 0, Math.PI * 2);
    targetCtx.fill();

    targetCtx.strokeStyle = "rgba(118, 219, 255, 0.88)";
    targetCtx.lineWidth = 1.5;
    targetCtx.beginPath();
    targetCtx.ellipse(iconX, iconY, 11, 8, 0, 0, Math.PI * 2);
    targetCtx.stroke();

    targetCtx.fillStyle = "rgba(118, 219, 255, 0.9)";
    targetCtx.beginPath();
    targetCtx.arc(iconX, iconY, 2.8, 0, Math.PI * 2);
    targetCtx.fill();

    targetCtx.fillStyle = "rgba(220, 238, 255, 0.82)";
    targetCtx.font = "700 12px IBM Plex Sans JP";
    targetCtx.fillText("観測者", planeX - 28, lineTop - 8);
    targetCtx.font = "600 11px IBM Plex Sans JP";
    targetCtx.fillStyle = "rgba(182, 222, 255, 0.68)";
    targetCtx.fillText("observer plane", planeX - 42, lineBottom + 18);

    targetCtx.restore();
}

function drawOverlay(targetCtx, scene) {
    const spinLabel = Math.abs(state.spin) < 0.03 ? "a/M = 0" : `a/M = ${formatNumber(state.spin, 2)}`;
    targetCtx.fillStyle = "rgba(255, 255, 255, 0.72)";
    targetCtx.font = "13px IBM Plex Sans JP";
    targetCtx.fillText(`近似式: d²u/dφ² + u ≈ 3M_eff u² + drag(a, sign b) / M = ${formatNumber(state.mass, 1)} / ${spinLabel}`, 18, scene.height - 18);
}

function renderStaticLayer() {
    if (!state.scene) {
        return;
    }

    drawBackground(staticCtx, state.scene, state.stars);
    drawEmitter(staticCtx, state.scene);
    drawBlackHole(staticCtx, state.scene);
    drawObserverMarker(staticCtx, state.scene);
    drawOverlay(staticCtx, state.scene);
    state.needsStaticRedraw = false;
    state.needsCompositeRedraw = true;
}

function drawRays(scene) {
    const visibleLength = Math.floor(state.drawProgress);

    state.rays.forEach((ray) => {
        if (ray.canvasPoints.length < 2) {
            return;
        }

        const visibleCount = Math.min(ray.canvasPoints.length, visibleLength);
        if (visibleCount < 2) {
            return;
        }

        ctx.save();
        ctx.lineWidth = ray.captured ? 1.65 : 1.25;
        ctx.strokeStyle = ray.captured ? "rgba(255, 212, 105, 0.92)" : getColorForImpact(ray.impact, state.spread, 0.78);
        ctx.beginPath();
        ctx.moveTo(ray.canvasPoints[0].x, ray.canvasPoints[0].y);

        for (let index = 1; index < visibleCount; index += 1) {
            ctx.lineTo(ray.canvasPoints[index].x, ray.canvasPoints[index].y);
        }

        ctx.stroke();
        ctx.restore();
    });
}

function drawObserverScreen() {
    const { width, height } = state.observerViewport;
    const shadowShift = state.stats.shadowShift;
    const shadowCenterX = width * (0.5 + shadowShift);
    const shadowCenterY = height * 0.5;
    const shadowRadiusY = height * 0.22;
    const shadowRadiusX = shadowRadiusY * 1.14;

    const background = observerCtx.createLinearGradient(0, 0, 0, height);
    background.addColorStop(0, "#07101b");
    background.addColorStop(1, "#03050c");
    observerCtx.clearRect(0, 0, width, height);
    observerCtx.fillStyle = background;
    observerCtx.fillRect(0, 0, width, height);

    state.observerStars.forEach((star) => {
        observerCtx.fillStyle = `rgba(255, 255, 255, ${star.alpha * 0.82})`;
        observerCtx.fillRect(star.x, star.y, star.size, star.size);
    });

    const escapedRays = state.rays.filter((ray) => !ray.captured);
    const bandHeight = clamp(height / Math.max(escapedRays.length * 0.58, 22), 2, 10);

    escapedRays.forEach((ray, index) => {
        const y = worldToObserverY(ray.screenY, state.spread, height);
        const alpha = clamp(0.18 + (Math.abs(ray.exitAngle) * 0.18), 0.18, 0.5);
        observerCtx.fillStyle = getColorForImpact(ray.impact, state.spread, alpha);
        observerCtx.fillRect(0, y - (bandHeight * 0.5), width, bandHeight);

        const starSeed = Math.round((ray.impact + state.spread) * 1000) + index;
        for (let starIndex = 0; starIndex < 2; starIndex += 1) {
            const x = ((starSeed * (starIndex + 3) * 73) % Math.round(width * 0.82)) + (width * 0.08);
            const offset = (((starSeed * (starIndex + 5) * 19) % 5) - 2) * 1.2;
            const size = 1 + (((starSeed + starIndex) % 3) * 0.25);
            observerCtx.fillStyle = `rgba(255, 255, 255, ${0.45 + (starIndex * 0.15)})`;
            observerCtx.fillRect(x, y + offset, size, size);
        }
    });

    const glow = observerCtx.createRadialGradient(shadowCenterX + (shadowShift * width * 0.22), shadowCenterY, shadowRadiusY * 0.6, shadowCenterX, shadowCenterY, shadowRadiusX * 1.9);
    glow.addColorStop(0, "rgba(255, 216, 110, 0.18)");
    glow.addColorStop(0.45, "rgba(116, 220, 255, 0.12)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    observerCtx.fillStyle = glow;
    observerCtx.beginPath();
    observerCtx.ellipse(shadowCenterX, shadowCenterY, shadowRadiusX * 2.05, shadowRadiusY * 1.55, 0, 0, Math.PI * 2);
    observerCtx.fill();

    const crescentGradient = observerCtx.createLinearGradient(shadowCenterX - (shadowRadiusX * 1.7), 0, shadowCenterX + (shadowRadiusX * 1.7), 0);
    if (state.spin >= 0) {
        crescentGradient.addColorStop(0, "rgba(255, 214, 109, 0.04)");
        crescentGradient.addColorStop(0.45, "rgba(255, 214, 109, 0.12)");
        crescentGradient.addColorStop(1, "rgba(255, 214, 109, 0.78)");
    } else {
        crescentGradient.addColorStop(0, "rgba(255, 214, 109, 0.78)");
        crescentGradient.addColorStop(0.55, "rgba(255, 214, 109, 0.12)");
        crescentGradient.addColorStop(1, "rgba(255, 214, 109, 0.04)");
    }

    observerCtx.fillStyle = crescentGradient;
    observerCtx.beginPath();
    observerCtx.ellipse(shadowCenterX, shadowCenterY, shadowRadiusX * 1.34, shadowRadiusY * 1.18, 0, 0, Math.PI * 2);
    observerCtx.fill();

    observerCtx.fillStyle = "rgba(0, 0, 0, 0.96)";
    observerCtx.beginPath();
    observerCtx.ellipse(shadowCenterX, shadowCenterY, shadowRadiusX, shadowRadiusY, 0, 0, Math.PI * 2);
    observerCtx.fill();

    observerCtx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    observerCtx.lineWidth = 1;
    observerCtx.beginPath();
    observerCtx.ellipse(shadowCenterX, shadowCenterY, shadowRadiusX * 1.02, shadowRadiusY * 1.02, 0, 0, Math.PI * 2);
    observerCtx.stroke();

    observerCtx.fillStyle = "rgba(255, 255, 255, 0.7)";
    observerCtx.font = "600 12px IBM Plex Sans JP";
    observerCtx.fillText("observer screen (approx.)", 14, 18);
    state.needsObserverRedraw = false;
}

function renderCompositeFrame() {
    if (!state.scene) {
        return;
    }

    ctx.clearRect(0, 0, state.viewport.width, state.viewport.height);
    ctx.drawImage(staticCanvas, 0, 0, state.viewport.width, state.viewport.height);
    drawRays(state.scene);
    state.needsCompositeRedraw = false;
}

function renderLoop(timestamp) {
    state.animationId = null;
    const frameInterval = 1000 / 30;
    let keepAnimating = false;

    if (state.needsStaticRedraw) {
        renderStaticLayer();
    }

    if (state.needsObserverRedraw) {
        drawObserverScreen();
    }

    if (!state.paused && state.maxRayPoints > 0) {
        if (!state.lastFrameTime) {
            state.lastFrameTime = timestamp;
            state.needsCompositeRedraw = true;
        }

        const elapsed = timestamp - state.lastFrameTime;
        if (elapsed >= frameInterval) {
            const frameSteps = Math.max(1, Math.floor(elapsed / frameInterval));
            state.lastFrameTime = timestamp;
            state.drawProgress = Math.min(state.drawProgress + (8 * frameSteps), state.maxRayPoints + 70);
            state.needsCompositeRedraw = true;

            if (state.drawProgress >= state.maxRayPoints + 70) {
                state.paused = true;
                state.lastFrameTime = 0;
                updateControls();
            }
        }

        keepAnimating = !state.paused;
    } else {
        state.lastFrameTime = 0;
    }

    if (state.needsCompositeRedraw) {
        renderCompositeFrame();
    }

    if (keepAnimating || state.needsStaticRedraw || state.needsObserverRedraw || state.needsCompositeRedraw) {
        requestRender();
    }
}

dom.resetBtn.addEventListener("click", () => {
    generateRays(true);
});

dom.animateBtn.addEventListener("click", () => {
    if (state.paused && state.drawProgress >= state.maxRayPoints + 70) {
        state.drawProgress = 0;
    }

    state.paused = !state.paused;
    state.lastFrameTime = 0;
    state.needsCompositeRedraw = true;
    updateControls();
    requestRender();
});

[dom.massRange, dom.spinRange, dom.rayRange, dom.lensRange, dom.stepRange].forEach((element) => {
    element.addEventListener("input", () => {
        generateRays(true);
    });
});

window.addEventListener("resize", () => {
    resizeCanvas();
    generateRays(false);
});

resizeCanvas();
generateRays(true);