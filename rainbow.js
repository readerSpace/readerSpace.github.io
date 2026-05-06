const COLORS = [
    { name: "red", label: "赤", color: "#ef4444", n: 1.331 },
    { name: "orange", label: "橙", color: "#f97316", n: 1.332 },
    { name: "yellow", label: "黄", color: "#eab308", n: 1.333 },
    { name: "green", label: "緑", color: "#22c55e", n: 1.335 },
    { name: "blue", label: "青", color: "#3b82f6", n: 1.338 },
    { name: "violet", label: "紫", color: "#8b5cf6", n: 1.343 }
];

const DEFAULTS = {
    impact: 0.5,
    sunAngle: 0,
    radius: 125,
    mode: "white",
    bounces: "1"
};

const IMPACT_PRESETS = {
    "1": 0.5,
    "2": 0.74
};

const EXPLANATION_BOX = {
    height: 128,
    bottomMargin: 14,
    gapFromScene: 22,
    sceneTopPadding: 24
};

const dom = {
    canvas: document.querySelector("#canvas"),
    canvasShell: document.querySelector("#canvasShell"),
    impact: document.querySelector("#impact"),
    sunAngle: document.querySelector("#sunAngle"),
    radius: document.querySelector("#radius"),
    mode: document.querySelector("#mode"),
    bounces: document.querySelector("#bounces"),
    resetBtn: document.querySelector("#resetBtn"),
    impactText: document.querySelector("#impactText"),
    angleText: document.querySelector("#angleText"),
    radiusText: document.querySelector("#radiusText"),
    summaryText: document.querySelector("#summaryText"),
    observeTitle: document.querySelector("#observeTitle"),
    observeText: document.querySelector("#observeText"),
    modeChip: document.querySelector("#modeChip"),
    typeStat: document.querySelector("#typeStat"),
    angleStat: document.querySelector("#angleStat"),
    spreadStat: document.querySelector("#spreadStat"),
    orderStat: document.querySelector("#orderStat")
};

const ctx = dom.canvas.getContext("2d");

const state = {
    viewport: {
        width: 960,
        height: 620,
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

function toRadians(value) {
    return value * Math.PI / 180;
}

function toDegrees(value) {
    return value * 180 / Math.PI;
}

function formatNumber(value, digits = 1) {
    return value.toFixed(digits).replace(/(?:\.0+|(\.\d*?[1-9]))0+$/, "$1");
}

function vec(x, y) {
    return { x, y };
}

function add(a, b) {
    return vec(a.x + b.x, a.y + b.y);
}

function sub(a, b) {
    return vec(a.x - b.x, a.y - b.y);
}

function mul(a, scale) {
    return vec(a.x * scale, a.y * scale);
}

function dot(a, b) {
    return (a.x * b.x) + (a.y * b.y);
}

function len(a) {
    return Math.hypot(a.x, a.y);
}

function norm(a) {
    const length = len(a) || 1;
    return vec(a.x / length, a.y / length);
}

function reflect(direction, normal) {
    return sub(direction, mul(normal, 2 * dot(direction, normal)));
}

function perpendicular(direction) {
    return vec(-direction.y, direction.x);
}

function refract(direction, normal, n1, n2) {
    let cosi = clamp(dot(direction, normal), -1, 1);
    let etai = n1;
    let etat = n2;
    let adjustedNormal = normal;

    if (cosi < 0) {
        cosi = -cosi;
    } else {
        adjustedNormal = mul(normal, -1);
        [etai, etat] = [etat, etai];
    }

    const eta = etai / etat;
    const k = 1 - (eta * eta * (1 - (cosi * cosi)));

    if (k < 0) {
        return null;
    }

    return norm(add(mul(direction, eta), mul(adjustedNormal, (eta * cosi) - Math.sqrt(k))));
}

function intersectCircle(origin, direction, center, radius, minT = 0.001) {
    const offset = sub(origin, center);
    const a = dot(direction, direction);
    const b = 2 * dot(offset, direction);
    const c = dot(offset, offset) - (radius * radius);
    const discriminant = (b * b) - (4 * a * c);

    if (discriminant < 0) {
        return null;
    }

    const sqrtDiscriminant = Math.sqrt(discriminant);
    const t1 = (-b - sqrtDiscriminant) / (2 * a);
    const t2 = (-b + sqrtDiscriminant) / (2 * a);
    const t = [t1, t2].filter((value) => value > minT).sort((left, right) => left - right)[0];

    if (t === undefined) {
        return null;
    }

    return add(origin, mul(direction, t));
}

function getSelectedColors() {
    if (dom.mode.value === "white") {
        return COLORS;
    }

    return COLORS.filter((color) => color.name === dom.mode.value);
}

function getColorOrderLabel() {
    if (dom.mode.value !== "white") {
        return `${getSelectedColors()[0].label}のみ`;
    }

    return dom.bounces.value === "1"
        ? "外側 赤 / 内側 紫"
        : "外側 紫 / 内側 赤";
}

function scatteringAngle(outgoing, incoming) {
    const reverseIncoming = norm(mul(incoming, -1));
    return toDegrees(Math.acos(clamp(dot(reverseIncoming, norm(outgoing)), -1, 1)));
}

function simulateRay(center, radius, impactRatio, incomingAngleRad, colorInfo, bounceCount) {
    const direction = norm(vec(Math.cos(incomingAngleRad), Math.sin(incomingAngleRad)));
    const normalOffset = perpendicular(direction);
    const start = add(add(center, mul(direction, -(radius + 240))), mul(normalOffset, impactRatio * radius));
    const entry = intersectCircle(start, direction, center, radius);

    if (!entry) {
        return null;
    }

    const entryNormal = norm(sub(entry, center));
    const insideDirection = refract(direction, entryNormal, 1, colorInfo.n);

    if (!insideDirection) {
        return null;
    }

    const points = [start, entry];
    const reflectionPoints = [];
    let currentPoint = entry;
    let currentDirection = insideDirection;

    for (let bounce = 0; bounce < bounceCount; bounce += 1) {
        const hit = intersectCircle(currentPoint, currentDirection, center, radius, 0.01);

        if (!hit) {
            return null;
        }

        points.push(hit);
        reflectionPoints.push(hit);

        const normal = norm(sub(hit, center));
        currentDirection = reflect(currentDirection, normal);
        currentPoint = hit;
    }

    const exit = intersectCircle(currentPoint, currentDirection, center, radius, 0.01);

    if (!exit) {
        return null;
    }

    points.push(exit);

    const exitNormal = norm(sub(exit, center));
    const outgoing = refract(currentDirection, exitNormal, colorInfo.n, 1);

    if (!outgoing) {
        return null;
    }

    const farPoint = add(exit, mul(outgoing, 420));
    points.push(farPoint);

    return {
        points,
        direction,
        entry,
        entryNormal,
        exit,
        exitNormal,
        outgoing,
        farPoint,
        reflectionPoints,
        scatteringAngle: scatteringAngle(outgoing, direction)
    };
}

function resizeCanvas() {
    const rect = dom.canvasShell.getBoundingClientRect();
    const cssWidth = Math.max(280, Math.round(rect.width || 760));
    const radius = Number(dom.radius.value);
    const minimumSceneHeight = (radius * 2)
        + EXPLANATION_BOX.height
        + EXPLANATION_BOX.bottomMargin
        + EXPLANATION_BOX.gapFromScene
        + EXPLANATION_BOX.sceneTopPadding;
    const cssHeight = window.innerWidth < 720
        ? Math.max(Math.round(window.innerHeight * 0.52), minimumSceneHeight)
        : clamp(Math.round(cssWidth * 0.68), 460, 680);
    const dpr = window.devicePixelRatio || 1;

    dom.canvas.width = Math.round(cssWidth * dpr);
    dom.canvas.height = Math.round(cssHeight * dpr);
    dom.canvas.style.height = `${cssHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    state.viewport = {
        width: cssWidth,
        height: cssHeight,
        dpr
    };
}

function drawRoundedRectPath(x, y, width, height, radius) {
    const safeRadius = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + safeRadius, y);
    ctx.arcTo(x + width, y, x + width, y + height, safeRadius);
    ctx.arcTo(x + width, y + height, x, y + height, safeRadius);
    ctx.arcTo(x, y + height, x, y, safeRadius);
    ctx.arcTo(x, y, x + width, y, safeRadius);
    ctx.closePath();
}

function drawSky(width, height) {
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "#dff3ff");
    sky.addColorStop(0.65, "#f7fbff");
    sky.addColorStop(1, "#ffffff");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const cloudColor = "rgba(255,255,255,0.58)";
    const clouds = [
        { x: width * 0.22, y: height * 0.18, scale: 1.1 },
        { x: width * 0.76, y: height * 0.2, scale: 0.92 },
        { x: width * 0.58, y: height * 0.1, scale: 0.7 }
    ];

    clouds.forEach((cloud) => {
        ctx.fillStyle = cloudColor;
        ctx.beginPath();
        ctx.ellipse(cloud.x, cloud.y, 48 * cloud.scale, 18 * cloud.scale, 0, 0, Math.PI * 2);
        ctx.ellipse(cloud.x - (26 * cloud.scale), cloud.y + (4 * cloud.scale), 30 * cloud.scale, 13 * cloud.scale, 0, 0, Math.PI * 2);
        ctx.ellipse(cloud.x + (30 * cloud.scale), cloud.y + (3 * cloud.scale), 34 * cloud.scale, 14 * cloud.scale, 0, 0, Math.PI * 2);
        ctx.fill();
    });
}

function drawSun() {
    const sun = vec(74, 74);
    const gradient = ctx.createRadialGradient(sun.x, sun.y, 8, sun.x, sun.y, 62);
    gradient.addColorStop(0, "rgba(253, 224, 71, 1)");
    gradient.addColorStop(1, "rgba(253, 224, 71, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(sun.x, sun.y, 62, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#8b5a00";
    ctx.font = "700 14px IBM Plex Sans JP";
    ctx.fillText("太陽光", 28, 136);
}

function drawDrop(center, radius) {
    const gradient = ctx.createRadialGradient(center.x - (radius * 0.34), center.y - (radius * 0.38), radius * 0.06, center.x, center.y, radius);
    gradient.addColorStop(0, "rgba(255,255,255,0.94)");
    gradient.addColorStop(0.5, "rgba(147,197,253,0.24)");
    gradient.addColorStop(1, "rgba(37,99,235,0.20)");

    ctx.fillStyle = gradient;
    ctx.strokeStyle = "rgba(37, 99, 235, 0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.beginPath();
    ctx.ellipse(center.x - (radius * 0.34), center.y - (radius * 0.35), radius * 0.22, radius * 0.12, -0.7, 0, Math.PI * 2);
    ctx.fill();
}

function drawObserver(width, height) {
    const observer = vec(92, height * 0.68);
    ctx.save();
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(observer.x, observer.y - 20, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(observer.x, observer.y - 6);
    ctx.lineTo(observer.x, observer.y + 44);
    ctx.moveTo(observer.x, observer.y + 8);
    ctx.lineTo(observer.x - 22, observer.y + 24);
    ctx.moveTo(observer.x, observer.y + 8);
    ctx.lineTo(observer.x + 22, observer.y + 24);
    ctx.moveTo(observer.x, observer.y + 44);
    ctx.lineTo(observer.x - 18, observer.y + 70);
    ctx.moveTo(observer.x, observer.y + 44);
    ctx.lineTo(observer.x + 18, observer.y + 70);
    ctx.stroke();
    ctx.fillStyle = "#334155";
    ctx.font = "13px IBM Plex Sans JP";
    ctx.fillText("観察者", observer.x - 24, observer.y + 96);
    ctx.restore();
}

function drawRay(points, color, width, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
        ctx.lineTo(points[index].x, points[index].y);
    }
    ctx.stroke();
    ctx.restore();
}

function drawNormal(point, normal) {
    const length = 34;
    ctx.save();
    ctx.strokeStyle = "rgba(71, 85, 105, 0.65)";
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(point.x - (normal.x * length), point.y - (normal.y * length));
    ctx.lineTo(point.x + (normal.x * length), point.y + (normal.y * length));
    ctx.stroke();
    ctx.restore();
}

function drawArrow(start, direction, color, label) {
    const end = add(start, mul(direction, 54));
    drawRay([start, end], color, 2.2, 0.92);

    const angle = Math.atan2(direction.y, direction.x);
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x - (10 * Math.cos(angle - 0.35)), end.y - (10 * Math.sin(angle - 0.35)));
    ctx.lineTo(end.x - (10 * Math.cos(angle + 0.35)), end.y - (10 * Math.sin(angle + 0.35)));
    ctx.closePath();
    ctx.fill();

    if (label) {
        ctx.font = "13px IBM Plex Sans JP";
        ctx.fillText(label, end.x + 8, end.y + 4);
    }

    ctx.restore();
}

function drawExplanationBox(width, height, bounceCount) {
    const boxWidth = Math.min(560, width - 44);
    const boxX = width - boxWidth - 22;
    const boxHeight = EXPLANATION_BOX.height;
    const boxY = height - boxHeight - EXPLANATION_BOX.bottomMargin;

    ctx.save();
    drawRoundedRectPath(boxX, boxY, boxWidth, boxHeight, 16);
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.fill();
    ctx.strokeStyle = "rgba(148, 163, 184, 0.55)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#0f172a";
    ctx.font = "700 15px IBM Plex Sans JP";
    ctx.fillText(bounceCount === 1 ? "主虹: 内部反射 1 回" : "副虹: 内部反射 2 回", boxX + 16, boxY + 28);
    ctx.font = "13px IBM Plex Sans JP";
    ctx.fillText("1. 空気から水へ入るときに屈折する。", boxX + 16, boxY + 54);
    ctx.fillText(`2. 水滴の内側で ${bounceCount} 回反射する。`, boxX + 16, boxY + 78);
    ctx.fillText("3. 水から空気へ出るとき、色ごとに少し違う向きへ分かれる。", boxX + 16, boxY + 102);
    ctx.restore();
}

function updateLabels() {
    dom.impactText.textContent = formatNumber(Number(dom.impact.value), 2);
    dom.angleText.textContent = `${formatNumber(Number(dom.sunAngle.value), 1)}°`;
    dom.radiusText.textContent = `${dom.radius.value} px`;
}

function applyRecommendedImpact() {
    dom.impact.value = String(IMPACT_PRESETS[dom.bounces.value] ?? DEFAULTS.impact);
}

function updateNarration(meanAngle, spreadAngle) {
    const bounceCount = Number(dom.bounces.value);
    const radius = Number(dom.radius.value);
    const mode = dom.mode.value;
    const orderLabel = getColorOrderLabel();
    const typeLabel = bounceCount === 1 ? "主虹" : "副虹";

    dom.modeChip.textContent = typeLabel;
    dom.typeStat.textContent = typeLabel;
    dom.angleStat.textContent = `${formatNumber(meanAngle, 1)}°`;
    dom.spreadStat.textContent = `${formatNumber(spreadAngle, 1)}°`;
    dom.orderStat.textContent = orderLabel;

    if (mode === "white") {
        dom.summaryText.textContent = `${typeLabel}では白色光が分散し、${orderLabel}の順で見えます。代表的な出射角は約 ${formatNumber(meanAngle, 1)}° で、色の広がりは約 ${formatNumber(spreadAngle, 1)}° です。`;
    } else {
        dom.summaryText.textContent = `${getSelectedColors()[0].label}だけを表示しています。色分散は見えませんが、1 本の光が屈折し、内部反射 ${bounceCount} 回を経てどの角度へ出るかを追いやすくなります。`;
    }

    if (bounceCount === 1 && mode === "white") {
        dom.observeTitle.textContent = "主虹では赤が外、紫が内";
        dom.observeText.textContent = `内部反射 1 回のとき、赤は少し曲がりにくく、紫は少し曲がりやすいので色順が分かれます。水滴サイズ ${radius} px は見やすさを変えますが、代表角自体は大きくは変わりません。`;
        return;
    }

    if (bounceCount === 2 && mode === "white") {
        dom.observeTitle.textContent = "副虹では色の順番が逆になる";
        dom.observeText.textContent = `内部反射が 2 回になると、光がもう一度向きを変えるため、主虹より外側へ出やすくなり、色順も反転します。副虹は主虹より暗くなりやすいのも特徴です。`;
        return;
    }

    dom.observeTitle.textContent = "単色光では角度だけを追いやすい";
    dom.observeText.textContent = `${getSelectedColors()[0].label}の光だけにすると、分散ではなく 1 本の光線の曲がり方に集中できます。入射位置や太陽光の傾きを変え、どの条件で観察者方向へ返るかを見てください。`;
}

function drawScene() {
    const width = state.viewport.width;
    const height = state.viewport.height;
    const radius = Number(dom.radius.value);
    const minimumCenterY = radius + EXPLANATION_BOX.sceneTopPadding;
    const maximumCenterY = height - radius - EXPLANATION_BOX.height - EXPLANATION_BOX.bottomMargin - EXPLANATION_BOX.gapFromScene;
    const centerY = clamp(height * 0.45, minimumCenterY, maximumCenterY);
    const center = vec(width * 0.48, centerY);
    const impact = Number(dom.impact.value);
    const incomingAngle = toRadians(Number(dom.sunAngle.value));
    const bounceCount = Number(dom.bounces.value);
    const selectedColors = getSelectedColors();
    const offsetStep = dom.mode.value === "white" ? 0.012 : 0;

    drawSky(width, height);
    drawSun();
    drawDrop(center, radius);
    drawObserver(width, height);

    const traces = selectedColors.map((color, index) => {
        const shiftedImpact = impact + ((index - ((selectedColors.length - 1) / 2)) * offsetStep);
        return {
            color,
            trace: simulateRay(center, radius, shiftedImpact, incomingAngle, color, bounceCount)
        };
    }).filter((item) => item.trace);

    const beamDirection = norm(vec(Math.cos(incomingAngle), Math.sin(incomingAngle)));
    const beamNormal = perpendicular(beamDirection);
    const beamStart = add(add(center, mul(beamDirection, -(radius + 210))), mul(beamNormal, impact * radius));

    for (let index = -2; index <= 2; index += 1) {
        const offsetOrigin = add(beamStart, mul(beamNormal, index * 7));
        drawRay([offsetOrigin, add(offsetOrigin, mul(beamDirection, 195))], dom.mode.value === "white" ? "rgba(255,255,255,0.9)" : `${selectedColors[0].color}`, 3, 0.75);
    }

    ctx.fillStyle = "#334155";
    ctx.font = "13px IBM Plex Sans JP";
    ctx.fillText("平行な太陽光が入る", beamStart.x + 12, beamStart.y - 16);

    traces.forEach(({ color, trace }) => {
        drawRay([trace.points[0], trace.points[1]], dom.mode.value === "white" ? "rgba(255,255,255,0.9)" : color.color, 2.8, 0.86);
        drawRay(trace.points.slice(1, -1), color.color, 2.6, 0.92);
        drawArrow(trace.exit, trace.outgoing, color.color, dom.mode.value === "white" ? color.label : `${color.label}の光`);
    });

    const referenceTrace = traces.find((item) => item.color.name === "green")?.trace || traces[0]?.trace;

    if (referenceTrace) {
        drawNormal(referenceTrace.entry, referenceTrace.entryNormal);
        drawNormal(referenceTrace.exit, referenceTrace.exitNormal);

        referenceTrace.reflectionPoints.forEach((point) => {
            ctx.fillStyle = "rgba(15, 23, 42, 0.72)";
            ctx.beginPath();
            ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
            ctx.fill();
        });

        ctx.fillStyle = "rgba(15, 23, 42, 0.76)";
        ctx.font = "700 12px IBM Plex Sans JP";
        ctx.fillText("屈折", referenceTrace.entry.x + 14, referenceTrace.entry.y - 10);
        ctx.fillText("屈折", referenceTrace.exit.x + 14, referenceTrace.exit.y - 10);

        if (referenceTrace.reflectionPoints[0]) {
            ctx.fillText("反射", referenceTrace.reflectionPoints[0].x + 12, referenceTrace.reflectionPoints[0].y - 10);
        }
    }

    drawExplanationBox(width, height, bounceCount);

    const validAngles = traces.map((item) => item.trace.scatteringAngle);
    const meanAngle = validAngles.reduce((sum, value) => sum + value, 0) / Math.max(validAngles.length, 1);
    const spreadAngle = validAngles.length > 1 ? Math.max(...validAngles) - Math.min(...validAngles) : 0;
    updateNarration(meanAngle, spreadAngle);
}

function render() {
    updateLabels();
    drawScene();
}

dom.impact.addEventListener("input", render);
dom.sunAngle.addEventListener("input", render);
dom.radius.addEventListener("input", () => {
    resizeCanvas();
    render();
});

dom.mode.addEventListener("input", render);
dom.mode.addEventListener("change", render);

dom.bounces.addEventListener("change", () => {
    applyRecommendedImpact();
    render();
});

dom.resetBtn.addEventListener("click", () => {
    applyRecommendedImpact();
    dom.sunAngle.value = String(DEFAULTS.sunAngle);
    dom.radius.value = String(DEFAULTS.radius);
    dom.mode.value = DEFAULTS.mode;
    resizeCanvas();
    render();
});

const resizeObserver = new ResizeObserver(() => {
    resizeCanvas();
    render();
});

resizeObserver.observe(dom.canvasShell);
window.addEventListener("resize", () => {
    resizeCanvas();
    render();
});

resizeCanvas();
render();