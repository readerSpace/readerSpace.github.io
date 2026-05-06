const COLORS = [
    "#ff5b77",
    "#ff9f43",
    "#ffe66d",
    "#58f29c",
    "#62d6ff",
    "#7f7cff",
    "#d88cff"
];

const DEFAULTS = {
    gemType: "round",
    refract: 2.4,
    light: 80,
    dispersion: 60,
    angle: -0.22
};

const dom = {
    canvas: document.querySelector("#canvas"),
    canvasShell: document.querySelector("#canvasShell"),
    gemType: document.querySelector("#gemType"),
    refract: document.querySelector("#refract"),
    light: document.querySelector("#light"),
    dispersion: document.querySelector("#dispersion"),
    refractText: document.querySelector("#refractText"),
    lightText: document.querySelector("#lightText"),
    dispersionText: document.querySelector("#dispersionText"),
    rotateBtn: document.querySelector("#rotateBtn"),
    resetBtn: document.querySelector("#resetBtn"),
    summaryText: document.querySelector("#summaryText"),
    observeTitle: document.querySelector("#observeTitle"),
    observeText: document.querySelector("#observeText"),
    modeChip: document.querySelector("#modeChip"),
    criticalText: document.querySelector("#criticalText"),
    reflectionText: document.querySelector("#reflectionText"),
    spreadText: document.querySelector("#spreadText"),
    brillianceText: document.querySelector("#brillianceText")
};

const ctx = dom.canvas.getContext("2d");

const state = {
    autoRotate: true,
    angle: DEFAULTS.angle,
    viewport: {
        width: 960,
        height: 620,
        dpr: 1
    },
    stars: createStars(96),
    latestStats: {
        criticalAngle: 24.6,
        reflections: 0,
        spread: 0,
        brilliance: "やわらかい輝き"
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

function vector(x, y) {
    return { x, y };
}

function add(a, b) {
    return vector(a.x + b.x, a.y + b.y);
}

function subtract(a, b) {
    return vector(a.x - b.x, a.y - b.y);
}

function scale(point, factor) {
    return vector(point.x * factor, point.y * factor);
}

function dot(a, b) {
    return (a.x * b.x) + (a.y * b.y);
}

function cross(a, b) {
    return (a.x * b.y) - (a.y * b.x);
}

function length(point) {
    return Math.hypot(point.x, point.y);
}

function normalize(point) {
    const size = length(point) || 1;
    return vector(point.x / size, point.y / size);
}

function perpendicular(point) {
    return vector(-point.y, point.x);
}

function reflect(direction, normal) {
    return normalize(subtract(direction, scale(normal, 2 * dot(direction, normal))));
}

function refract(direction, normal, fromIndex, toIndex) {
    let cosi = clamp(dot(direction, normal), -1, 1);
    let etai = fromIndex;
    let etat = toIndex;
    let adjustedNormal = normal;

    if (cosi < 0) {
        cosi = -cosi;
    } else {
        const temp = etai;
        etai = etat;
        etat = temp;
        adjustedNormal = scale(normal, -1);
    }

    const eta = etai / etat;
    const k = 1 - (eta * eta * (1 - (cosi * cosi)));

    if (k < 0) {
        return null;
    }

    return normalize(add(scale(direction, eta), scale(adjustedNormal, (eta * cosi) - Math.sqrt(k))));
}

function rotatePoint(point, angle) {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);

    return vector(
        (point.x * cosine) - (point.y * sine),
        (point.x * sine) + (point.y * cosine)
    );
}

function polygonCentroid(points) {
    const sum = points.reduce((accumulator, point) => add(accumulator, point), vector(0, 0));
    return scale(sum, 1 / points.length);
}

function raySegmentIntersection(origin, direction, a, b) {
    const edge = subtract(b, a);
    const denominator = cross(direction, edge);

    if (Math.abs(denominator) < 1e-7) {
        return null;
    }

    const delta = subtract(a, origin);
    const t = cross(delta, edge) / denominator;
    const u = cross(delta, direction) / denominator;

    if (t <= 0.001 || u < -0.001 || u > 1.001) {
        return null;
    }

    return {
        t,
        u,
        point: add(origin, scale(direction, t))
    };
}

function createEllipseShape(stepCount, radiusX, radiusY) {
    return Array.from({ length: stepCount }, (_, index) => {
        const angle = (-Math.PI / 2) + ((index / stepCount) * Math.PI * 2);
        return vector(Math.cos(angle) * radiusX, Math.sin(angle) * radiusY);
    });
}

const GEM_TYPES = {
    round: {
        label: "ラウンド風カット",
        summaryLead: "ラウンド風カットは面のバランスがよく、反射と透過の切り替わりを比較しやすい形です。",
        observeLead: "回転による光の抜け口の変化が素直に見えるので、基準形として比較に向いています。",
        baseShape: [
            vector(-0.40, -1.0),
            vector(0.40, -1.0),
            vector(0.84, -0.48),
            vector(0.68, 0.04),
            vector(0.28, 0.84),
            vector(0, 1.14),
            vector(-0.28, 0.84),
            vector(-0.68, 0.04),
            vector(-0.84, -0.48)
        ]
    },
    oval: {
        label: "楕円形",
        summaryLead: "楕円形では側面の角度変化がなだらかで、回転すると光の抜け口が滑らかに移りやすくなります。",
        observeLead: "左右の肩に沿って出射光が流れるように動く点に注目すると、丸みに近い形の効果が見やすくなります。",
        baseShape: createEllipseShape(14, 0.94, 1.12)
    },
    diamond: {
        label: "ダイアモンドカット",
        summaryLead: "ダイアモンドカットは鋭い面が多く、条件が合うと限られた面から強いフラッシュが返りやすい形です。",
        observeLead: "角の立った面で全反射の切り替わりが起きやすく、明暗の差がはっきり出ます。",
        baseShape: [
            vector(-0.22, -1.0),
            vector(0.22, -1.0),
            vector(0.54, -0.84),
            vector(0.84, -0.50),
            vector(1.02, -0.06),
            vector(0.76, 0.30),
            vector(0.38, 0.74),
            vector(0, 1.22),
            vector(-0.38, 0.74),
            vector(-0.76, 0.30),
            vector(-1.02, -0.06),
            vector(-0.84, -0.50),
            vector(-0.54, -0.84)
        ]
    }
};

function getGemTypeDefinition(gemType) {
    return GEM_TYPES[gemType] || GEM_TYPES[DEFAULTS.gemType];
}

function buildGem(cx, cy, radius, angle, gemType = DEFAULTS.gemType) {
    const baseShape = getGemTypeDefinition(gemType).baseShape;

    return baseShape.map((point) => {
        const rotated = rotatePoint(point, angle);
        return vector(cx + (rotated.x * radius), cy + (rotated.y * radius));
    });
}

function findRayPolygonIntersection(origin, direction, polygon, ignoreEdge = -1) {
    const centroid = polygonCentroid(polygon);
    let closestHit = null;

    for (let index = 0; index < polygon.length; index += 1) {
        if (index === ignoreEdge) {
            continue;
        }

        const a = polygon[index];
        const b = polygon[(index + 1) % polygon.length];
        const hit = raySegmentIntersection(origin, direction, a, b);

        if (!hit || (closestHit && hit.t >= closestHit.t)) {
            continue;
        }

        const midpoint = scale(add(a, b), 0.5);
        const edge = subtract(b, a);
        const candidate = normalize(vector(edge.y, -edge.x));
        const outwardNormal = dot(candidate, subtract(midpoint, centroid)) > 0 ? candidate : scale(candidate, -1);

        closestHit = {
            ...hit,
            edgeIndex: index,
            normal: outwardNormal
        };
    }

    return closestHit;
}

function traceRay(origin, direction, polygon, refractiveIndex, exitLength) {
    const entry = findRayPolygonIntersection(origin, direction, polygon);

    if (!entry) {
        return null;
    }

    const segments = [
        { from: origin, to: entry.point, type: "incoming", intensity: 1 }
    ];
    const sparklePoints = [entry.point];
    const insideDirection = refract(direction, entry.normal, 1, refractiveIndex) || reflect(direction, entry.normal);
    let currentPoint = entry.point;
    let currentDirection = insideDirection;
    let currentEdge = entry.edgeIndex;
    let reflections = 0;
    let intensity = 0.92;
    const exitPoints = [];

    for (let bounce = 0; bounce < 7; bounce += 1) {
        const nextOrigin = add(currentPoint, scale(currentDirection, 0.6));
        const hit = findRayPolygonIntersection(nextOrigin, currentDirection, polygon, currentEdge);

        if (!hit) {
            break;
        }

        segments.push({ from: currentPoint, to: hit.point, type: "inside", intensity });
        sparklePoints.push(hit.point);

        const refractedOut = refract(currentDirection, hit.normal, refractiveIndex, 1);
        const cosine = clamp(dot(currentDirection, hit.normal), 0, 1);
        const r0 = ((refractiveIndex - 1) / (refractiveIndex + 1)) ** 2;
        const reflectance = refractedOut ? (r0 + ((1 - r0) * ((1 - cosine) ** 5))) : 1;
        const transmission = refractedOut ? intensity * (1 - reflectance) : 0;

        if (refractedOut && transmission > 0.08) {
            exitPoints.push(hit.point);
            segments.push({
                from: hit.point,
                to: add(hit.point, scale(refractedOut, exitLength)),
                type: "exit",
                intensity: transmission
            });
        }

        if (!refractedOut || ((reflectance > 0.14) && (intensity > 0.18) && (bounce < 4))) {
            reflections += 1;
            currentPoint = hit.point;
            currentDirection = reflect(currentDirection, hit.normal);
            currentEdge = hit.edgeIndex;
            intensity *= refractedOut ? clamp(reflectance * 1.12, 0.16, 0.86) : 0.88;
            continue;
        }

        break;
    }

    return {
        segments,
        reflections,
        exitPoints,
        sparklePoints
    };
}

function getRefractiveIndexForColor(baseIndex, dispersion, colorIndex) {
    const colorMix = (colorIndex / (COLORS.length - 1)) - 0.5;
    return baseIndex + (colorMix * 0.18 * (dispersion / 100));
}

function createStars(count) {
    let seed = 321987;

    const random = () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
    };

    return Array.from({ length: count }, () => ({
        x: random(),
        y: random(),
        size: random() * 1.8 + 0.4,
        alpha: random() * 0.45 + 0.15
    }));
}

function resizeCanvas() {
    const rect = dom.canvasShell.getBoundingClientRect();
    const cssWidth = Math.max(280, Math.round(rect.width || 760));
    const cssHeight = window.innerWidth < 720
        ? clamp(Math.round(window.innerHeight * 0.46), 300, 420)
        : clamp(Math.round(cssWidth * 0.62), 420, 620);
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

function updateLabels() {
    dom.refractText.textContent = formatNumber(Number(dom.refract.value), 2);
    dom.lightText.textContent = dom.light.value;
    dom.dispersionText.textContent = dom.dispersion.value;
    dom.rotateBtn.textContent = state.autoRotate ? "自動回転: ON" : "自動回転: OFF";
}

function classifyBrilliance(stats, refractiveIndex, dispersion) {
    if (stats.reflections >= 18 && dispersion >= 55 && refractiveIndex > 2.1) {
        return "強いファイア";
    }
    if (stats.reflections >= 10) {
        return "高輝度";
    }
    if (dispersion >= 60) {
        return "虹色強め";
    }
    if (refractiveIndex < 1.45) {
        return "素直に透過";
    }
    return "やわらかい輝き";
}

function describeScene(stats, refractiveIndex, dispersion, gemType) {
    const critical = stats.criticalAngle;
    const gemDefinition = getGemTypeDefinition(gemType);

    if (refractiveIndex < 1.4) {
        return {
            summary: `${gemDefinition.summaryLead} 屈折率 ${formatNumber(refractiveIndex, 2)} では光がそれほど強く曲がらず、内部に長く閉じ込められません。多くの光は比較的素直に抜けていきます。`,
            title: "ガラスに近い抜け方",
            text: `${gemDefinition.observeLead} 臨界角は ${formatNumber(critical, 1)}° と大きめで、全反射が起きる条件が限られています。内部反射より透過の印象が先に立ちます。`
        };
    }

    if (stats.reflections >= 18) {
        return {
            summary: `${gemDefinition.summaryLead} 屈折率が高く、臨界角 ${formatNumber(critical, 1)}° を下回る入射が多いため、光は宝石内で何度も跳ね返っています。出口ではまとまった明るさと色分かれが見えます。`,
            title: "内部で跳ね返ってから出る",
            text: `${gemDefinition.observeLead} この条件では全反射がきらめきの主役です。宝石を回すと、どの面で光が抜けるかが入れ替わり、強いフラッシュが出やすくなります。`
        };
    }

    if (dispersion >= 65) {
        return {
            summary: `${gemDefinition.summaryLead} 分散 ${formatNumber(dispersion, 0)} では色ごとの屈折率差がはっきりして、出口の虹色が大きく開きます。白い輝きよりも色のほどけ方が目立つ条件です。`,
            title: "色ごとに出口がずれる",
            text: `${gemDefinition.observeLead} 赤と青で少しずつ違う向きへ出るため、同じ面から出ても束がにじむように広がります。ファイアを強調したいときの典型条件です。`
        };
    }

    return {
        summary: `${gemDefinition.summaryLead} 屈折と内部反射のバランスが取れた条件です。光は一部が内部を回り、一部は早めに抜けるので、白い返り光と淡い色分かれが同時に見えます。`,
        title: "白いきらめきと色分かれの中間",
        text: `${gemDefinition.observeLead} 屈折率か分散を少しずつ動かすと、どこから先に全反射が増えるか、どこから色の開きが強く見えるかを比較しやすい領域です。`
    };
}

function updateStats(stats, refractiveIndex, dispersion, gemType) {
    state.latestStats = stats;
    dom.criticalText.textContent = `${formatNumber(stats.criticalAngle, 1)}°`;
    dom.reflectionText.textContent = String(stats.reflections);
    dom.spreadText.textContent = `${Math.round(stats.spread)} px`;
    dom.brillianceText.textContent = classifyBrilliance(stats, refractiveIndex, dispersion);
    dom.modeChip.textContent = dom.brillianceText.textContent;

    const description = describeScene(stats, refractiveIndex, dispersion, gemType);
    dom.summaryText.textContent = description.summary;
    dom.observeTitle.textContent = description.title;
    dom.observeText.textContent = description.text;
}

function drawBackground(width, height) {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#040913");
    gradient.addColorStop(1, "#0e1830");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    state.stars.forEach((star, index) => {
        const twinkle = 0.75 + (0.25 * Math.sin((performance.now() * 0.0008) + index));
        ctx.fillStyle = `rgba(255, 255, 255, ${star.alpha * twinkle})`;
        ctx.beginPath();
        ctx.arc(star.x * width, star.y * height, star.size, 0, Math.PI * 2);
        ctx.fill();
    });

    const floor = ctx.createLinearGradient(0, height * 0.78, 0, height);
    floor.addColorStop(0, "rgba(43, 64, 104, 0)");
    floor.addColorStop(1, "rgba(62, 88, 144, 0.22)");
    ctx.fillStyle = floor;
    ctx.fillRect(0, height * 0.72, width, height * 0.28);
}

function drawIncomingSource(start, direction, lightPower) {
    const alpha = clamp(0.24 + (lightPower / 180), 0.32, 0.94);
    const beamGradient = ctx.createLinearGradient(start.x, start.y, start.x + (direction.x * 240), start.y + (direction.y * 240));
    beamGradient.addColorStop(0, `rgba(255, 255, 255, ${alpha * 0.18})`);
    beamGradient.addColorStop(1, `rgba(255, 255, 255, ${alpha})`);
    ctx.strokeStyle = beamGradient;
    ctx.lineWidth = 16;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(start.x - (direction.x * 40), start.y - (direction.y * 40));
    ctx.lineTo(start.x + (direction.x * 180), start.y + (direction.y * 180));
    ctx.stroke();

    const sourceGlow = ctx.createRadialGradient(start.x - 24, start.y - 18, 6, start.x - 24, start.y - 18, 56);
    sourceGlow.addColorStop(0, `rgba(255,255,255,${alpha})`);
    sourceGlow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sourceGlow;
    ctx.beginPath();
    ctx.arc(start.x - 24, start.y - 18, 56, 0, Math.PI * 2);
    ctx.fill();
}

function drawGemBase(polygon, center, radius) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(polygon[0].x, polygon[0].y);
    for (let index = 1; index < polygon.length; index += 1) {
        ctx.lineTo(polygon[index].x, polygon[index].y);
    }
    ctx.closePath();

    const fill = ctx.createRadialGradient(center.x - (radius * 0.22), center.y - (radius * 0.38), radius * 0.08, center.x, center.y, radius * 1.08);
    fill.addColorStop(0, "rgba(255,255,255,0.94)");
    fill.addColorStop(0.16, "rgba(193, 241, 255, 0.78)");
    fill.addColorStop(0.46, "rgba(110, 166, 255, 0.36)");
    fill.addColorStop(1, "rgba(22, 44, 102, 0.16)");
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.clip();

    const innerGlow = ctx.createRadialGradient(center.x, center.y, radius * 0.12, center.x, center.y, radius * 0.95);
    innerGlow.addColorStop(0, "rgba(255,255,255,0.18)");
    innerGlow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = innerGlow;
    ctx.fillRect(center.x - radius, center.y - radius, radius * 2, radius * 2);

    ctx.restore();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.24)";
    ctx.lineWidth = 1;
    polygon.forEach((point, index) => {
        const next = polygon[(index + 2) % polygon.length];
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
        ctx.lineTo(next.x, next.y);
        ctx.stroke();
    });
}

function drawGemGlow(center, radius, lightPower) {
    const glow = ctx.createRadialGradient(center.x, center.y, radius * 0.1, center.x, center.y, radius * 1.5);
    glow.addColorStop(0, `rgba(255,255,255,${0.08 + (lightPower / 450)})`);
    glow.addColorStop(0.45, `rgba(96,175,255,${0.06 + (lightPower / 900)})`);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius * 1.55, 0, Math.PI * 2);
    ctx.fill();
}

function renderScene() {
    const width = state.viewport.width;
    const height = state.viewport.height;
    const gemType = dom.gemType.value;
    const refractiveIndex = Number(dom.refract.value);
    const lightPower = Number(dom.light.value);
    const dispersion = Number(dom.dispersion.value);

    if (state.autoRotate) {
        state.angle += 0.0022 * (0.65 + (refractiveIndex * 0.18));
    }

    drawBackground(width, height);

    const center = vector(width * 0.62, height * 0.52);
    const radius = Math.min(width, height) * 0.26;
    const polygon = buildGem(center.x, center.y, radius, state.angle, gemType);
    const beamDirection = normalize(vector(1, 0.22));
    const beamNormal = normalize(perpendicular(beamDirection));
    const start = vector(width * 0.1, height * 0.24);
    const rayOffsets = [-46, -24, 0, 24, 46];
    const exitLength = width * 0.24;
    const traces = [];
    let reflectionTotal = 0;
    let spreadMin = Number.POSITIVE_INFINITY;
    let spreadMax = Number.NEGATIVE_INFINITY;

    rayOffsets.forEach((offset) => {
        const rayOrigin = add(start, scale(beamNormal, offset));

        COLORS.forEach((color, colorIndex) => {
            const colorIndexValue = getRefractiveIndexForColor(refractiveIndex, dispersion, colorIndex);
            const trace = traceRay(rayOrigin, beamDirection, polygon, colorIndexValue, exitLength);

            if (!trace) {
                return;
            }

            reflectionTotal += trace.reflections;

            trace.exitPoints.forEach((point) => {
                spreadMin = Math.min(spreadMin, point.y);
                spreadMax = Math.max(spreadMax, point.y);
            });

            traces.push({
                color,
                trace,
                colorIndex
            });
        });
    });

    drawIncomingSource(start, beamDirection, lightPower);
    drawGemGlow(center, radius, lightPower);

    traces.forEach(({ color, trace, colorIndex }) => {
        trace.segments.forEach((segment) => {
            if (segment.type !== "exit") {
                return;
            }

            const alpha = clamp(segment.intensity * (lightPower / 120) * (0.4 + (colorIndex * 0.05)), 0.12, 0.9);
            const exitGradient = ctx.createLinearGradient(segment.from.x, segment.from.y, segment.to.x, segment.to.y);
            exitGradient.addColorStop(0, `rgba(255,255,255,${alpha * 0.16})`);
            exitGradient.addColorStop(0.22, `${color}dd`);
            exitGradient.addColorStop(1, `${color}00`);
            ctx.strokeStyle = exitGradient;
            ctx.lineWidth = 3.2;
            ctx.beginPath();
            ctx.moveTo(segment.from.x, segment.from.y);
            ctx.lineTo(segment.to.x, segment.to.y);
            ctx.stroke();
        });
    });

    drawGemBase(polygon, center, radius);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(polygon[0].x, polygon[0].y);
    for (let index = 1; index < polygon.length; index += 1) {
        ctx.lineTo(polygon[index].x, polygon[index].y);
    }
    ctx.closePath();
    ctx.clip();

    traces.forEach(({ color, trace, colorIndex }) => {
        trace.segments.forEach((segment) => {
            const alpha = segment.type === "incoming"
                ? clamp(segment.intensity * (lightPower / 260), 0.14, 0.34)
                : clamp(segment.intensity * (lightPower / 220) * (0.38 + (colorIndex * 0.05)), 0.16, 0.78);
            ctx.strokeStyle = segment.type === "incoming"
                ? `rgba(255,255,255,${alpha})`
                : `${color}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
            ctx.lineWidth = segment.type === "incoming" ? 1.6 : 2.4;
            ctx.beginPath();
            ctx.moveTo(segment.from.x, segment.from.y);
            ctx.lineTo(segment.to.x, segment.to.y);
            ctx.stroke();
        });

        trace.sparklePoints.forEach((point, sparkleIndex) => {
            const sparkleSize = 1.8 + (sparkleIndex * 0.36);
            const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, sparkleSize * 7);
            glow.addColorStop(0, `${color}bb`);
            glow.addColorStop(1, `${color}00`);
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(point.x, point.y, sparkleSize * 7, 0, Math.PI * 2);
            ctx.fill();
        });
    });

    ctx.restore();

    const criticalAngle = refractiveIndex > 1 ? (Math.asin(1 / refractiveIndex) * 180 / Math.PI) : 90;
    const spread = Number.isFinite(spreadMin) ? Math.max(0, spreadMax - spreadMin) : 0;

    updateStats(
        {
            criticalAngle,
            reflections: reflectionTotal,
            spread
        },
        refractiveIndex,
        dispersion,
        gemType
    );
}

function loop() {
    updateLabels();
    renderScene();
    requestAnimationFrame(loop);
}

dom.rotateBtn.addEventListener("click", () => {
    state.autoRotate = !state.autoRotate;
    updateLabels();
});

dom.resetBtn.addEventListener("click", () => {
    state.angle = DEFAULTS.angle;
});

[dom.gemType, dom.refract, dom.light, dom.dispersion].forEach((element) => {
    element.addEventListener("input", updateLabels);
});

const resizeObserver = new ResizeObserver(() => {
    resizeCanvas();
});

resizeObserver.observe(dom.canvasShell);
window.addEventListener("resize", resizeCanvas);

dom.gemType.value = DEFAULTS.gemType;
updateLabels();
resizeCanvas();
requestAnimationFrame(loop);