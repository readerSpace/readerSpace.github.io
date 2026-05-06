const MODES = {
    normal: {
        formula: "A + B → C",
        chip: "通常反応 / 衝突モデル",
        legends: [
            { label: "A: 反応物", color: "#2563eb" },
            { label: "B: 反応物", color: "#dc2626" },
            { label: "C: 生成物", color: "#7c3aed" }
        ]
    },
    enzyme: {
        formula: "E + S → ES → E + P",
        chip: "酵素反応 / ES 複合体",
        legends: [
            { label: "S: 基質", color: "#f97316" },
            { label: "E: 酵素", color: "#16a34a" },
            { label: "ES: 酵素-基質複合体", color: "#0f766e" },
            { label: "P: 生成物", color: "#9333ea" }
        ]
    }
};

const COLORS = {
    A: "#2563eb",
    B: "#dc2626",
    C: "#7c3aed",
    S: "#f97316",
    E: "#16a34a",
    ES: "#0f766e",
    P: "#9333ea"
};

const dom = {
    canvas: document.querySelector("#canvas"),
    mode: document.querySelector("#mode"),
    temp: document.querySelector("#temp"),
    ea: document.querySelector("#ea"),
    conc: document.querySelector("#conc"),
    enzymeCount: document.querySelector("#enzymeCount"),
    enzymeControl: document.querySelector("#enzymeControl"),
    formula: document.querySelector("#formula"),
    legend: document.querySelector("#legend"),
    tempText: document.querySelector("#tempText"),
    eaText: document.querySelector("#eaText"),
    concText: document.querySelector("#concText"),
    enzymeText: document.querySelector("#enzymeText"),
    reactionCount: document.querySelector("#reactionCount"),
    rateStat: document.querySelector("#rateStat"),
    substrateStat: document.querySelector("#substrateStat"),
    productStat: document.querySelector("#productStat"),
    startBtn: document.querySelector("#startBtn"),
    resetBtn: document.querySelector("#resetBtn"),
    summaryText: document.querySelector("#summaryText"),
    observeTitle: document.querySelector("#observeTitle"),
    observeText: document.querySelector("#observeText"),
    modeChip: document.querySelector("#modeChip")
};

const ctx = dom.canvas.getContext("2d");

const state = {
    mode: dom.mode.value,
    temperature: Number(dom.temp.value),
    activationEnergy: Number(dom.ea.value),
    concentration: Number(dom.conc.value),
    enzymeCount: Number(dom.enzymeCount.value),
    particles: [],
    reactionCount: 0,
    currentRate: 0,
    lastReactionCount: 0,
    lastRateTime: performance.now(),
    running: true,
    viewport: {
        width: 800,
        height: 560,
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

function randomBetween(min, max) {
    return min + (Math.random() * (max - min));
}

function distanceBetween(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function formatNumber(value, digits = 1) {
    return value.toFixed(digits).replace(/(?:\.0+|(\.\d*?[1-9]))0+$/, "$1");
}

function getChamberBounds() {
    return {
        left: 24,
        top: 24,
        right: state.viewport.width - 24,
        bottom: state.viewport.height - 24
    };
}

function getBaseSpeed() {
    return 0.55 + ((state.temperature - 5) / 95) * 1.9;
}

function getRadius(kind) {
    if (kind === "E" || kind === "ES") {
        return 18;
    }
    if (kind === "C" || kind === "P") {
        return 12;
    }
    return 9;
}

function createParticle(kind, x, y) {
    const speed = getBaseSpeed() * randomBetween(0.55, 1.1);
    const angle = randomBetween(0, Math.PI * 2);

    return {
        kind,
        x: x ?? randomBetween(50, state.viewport.width - 50),
        y: y ?? randomBetween(50, state.viewport.height - 50),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r: getRadius(kind),
        pulse: 0,
        boundTime: 0
    };
}

function syncStateFromInputs() {
    state.mode = dom.mode.value;
    state.temperature = Number(dom.temp.value);
    state.activationEnergy = Number(dom.ea.value);
    state.concentration = Number(dom.conc.value);
    state.enzymeCount = Number(dom.enzymeCount.value);
}

function resizeCanvas() {
    const shell = dom.canvas.parentElement;
    const bounds = shell.getBoundingClientRect();
    const cssWidth = Math.max(320, Math.round(bounds.width || shell.clientWidth || 800));
    const cssHeight = window.innerWidth <= 780
        ? Math.round(clamp(cssWidth * 0.78, 360, 520))
        : Math.round(clamp(cssWidth * 0.68, 440, 620));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    dom.canvas.style.height = `${cssHeight}px`;
    dom.canvas.width = Math.round(cssWidth * dpr);
    dom.canvas.height = Math.round(cssHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    state.viewport = {
        width: cssWidth,
        height: cssHeight,
        dpr
    };
}

function getNormalReactionProbability() {
    const margin = (state.temperature - state.activationEnergy) / 20;
    const sigmoid = 1 / (1 + Math.exp(-margin));
    return clamp(0.01 + (sigmoid * 0.62) + ((state.temperature / 100) * 0.08), 0.01, 0.95);
}

function getEnzymeBindingProbability() {
    const effectiveEa = state.activationEnergy * 0.45;
    const margin = (state.temperature - effectiveEa) / 18;
    const sigmoid = 1 / (1 + Math.exp(-margin));
    return clamp(0.08 + (sigmoid * 0.72), 0.08, 0.98);
}

function getEnzymeTurnoverProbability() {
    const effectiveEa = state.activationEnergy * 0.48;
    const margin = (state.temperature - effectiveEa) / 22;
    const sigmoid = 1 / (1 + Math.exp(-margin));
    return clamp(0.04 + (sigmoid * 0.34), 0.04, 0.9);
}

function setLegend() {
    dom.legend.innerHTML = MODES[state.mode].legends.map((item) => `
        <span class="legend-chip" style="border: 1px solid ${item.color}22; color: ${item.color};">${item.label}</span>
    `).join("");
}

function updateStaticUi() {
    dom.tempText.textContent = String(state.temperature);
    dom.eaText.textContent = String(state.activationEnergy);
    dom.concText.textContent = String(state.concentration);
    dom.enzymeText.textContent = String(state.enzymeCount);
    dom.formula.textContent = MODES[state.mode].formula;
    dom.enzymeControl.style.display = state.mode === "enzyme" ? "grid" : "none";
    setLegend();

    dom.modeChip.textContent = MODES[state.mode].chip;
    dom.modeChip.className = "canvas-chip";
    dom.modeChip.classList.add(state.mode === "enzyme" ? "is-enzyme" : "is-normal");

    if (state.mode === "normal") {
        const probability = getNormalReactionProbability();
        dom.summaryText.textContent = `通常反応 / 温度 ${state.temperature} / 活性化エネルギー ${state.activationEnergy} / 反応しうる衝突の目安 ${formatNumber(probability * 100, 0)}%`;
        dom.observeTitle.textContent = "衝突しても全部は反応しない";
        dom.observeText.textContent = "温度を上げると粒子が速くなり、活性化エネルギーを下げると壁を越えやすくなります。同じ衝突でも、条件しだいで反応したりしなかったりします。";
    } else {
        const effectiveEa = state.activationEnergy * 0.45;
        const binding = getEnzymeBindingProbability();
        dom.summaryText.textContent = `酵素反応 / 温度 ${state.temperature} / 実効的な壁の目安 ${formatNumber(effectiveEa, 0)} / 酵素量 ${state.enzymeCount} / 結合しやすさの目安 ${formatNumber(binding * 100, 0)}%`;
        dom.observeTitle.textContent = "酵素は反応経路を変えて壁を下げる";
        dom.observeText.textContent = "E が S をつかんで ES 複合体を作ると、通常より低い壁で反応が進めるように見えます。酵素は P を放したあと再び E として残ります。";
    }

    dom.startBtn.textContent = state.running ? "一時停止" : "再開";
}

function resetSimulation() {
    syncStateFromInputs();
    state.particles = [];
    state.reactionCount = 0;
    state.currentRate = 0;
    state.lastReactionCount = 0;
    state.lastRateTime = performance.now();

    if (state.mode === "normal") {
        for (let index = 0; index < state.concentration; index += 1) {
            state.particles.push(createParticle("A"));
            state.particles.push(createParticle("B"));
        }
    } else {
        for (let index = 0; index < state.concentration; index += 1) {
            state.particles.push(createParticle("S"));
        }
        for (let index = 0; index < state.enzymeCount; index += 1) {
            state.particles.push(createParticle("E"));
        }
    }

    updateStaticUi();
    updateStats();
}

function updateParticle(particle) {
    const chamber = getChamberBounds();
    const speedScale = 0.92 + ((state.temperature - 5) / 95) * 0.68;

    particle.x += particle.vx * speedScale;
    particle.y += particle.vy * speedScale;

    if (particle.x < chamber.left + particle.r || particle.x > chamber.right - particle.r) {
        particle.vx *= -1;
        particle.x = clamp(particle.x, chamber.left + particle.r, chamber.right - particle.r);
    }

    if (particle.y < chamber.top + particle.r || particle.y > chamber.bottom - particle.r) {
        particle.vy *= -1;
        particle.y = clamp(particle.y, chamber.top + particle.r, chamber.bottom - particle.r);
    }

    particle.pulse *= 0.9;

    if (particle.kind === "ES") {
        particle.boundTime += 1;
        particle.pulse = Math.max(particle.pulse, 0.35);
    }
}

function reactNormal() {
    const probability = getNormalReactionProbability();

    for (let index = 0; index < state.particles.length; index += 1) {
        const first = state.particles[index];
        if (first.kind !== "A") {
            continue;
        }

        for (let secondIndex = index + 1; secondIndex < state.particles.length; secondIndex += 1) {
            const second = state.particles[secondIndex];
            if (second.kind !== "B") {
                continue;
            }

            if (distanceBetween(first, second) < first.r + second.r + 4 && Math.random() < probability) {
                const product = createParticle("C", (first.x + second.x) / 2, (first.y + second.y) / 2);
                product.vx = ((first.vx + second.vx) * 0.5) + randomBetween(-0.6, 0.6);
                product.vy = ((first.vy + second.vy) * 0.5) + randomBetween(-0.6, 0.6);
                product.pulse = 1;

                state.particles.splice(secondIndex, 1);
                state.particles.splice(index, 1);
                state.particles.push(product);
                state.reactionCount += 1;
                return;
            }
        }
    }
}

function reactEnzyme() {
    const turnoverProbability = getEnzymeTurnoverProbability();
    const bindingProbability = getEnzymeBindingProbability();

    for (let index = 0; index < state.particles.length; index += 1) {
        const particle = state.particles[index];
        if (particle.kind !== "ES") {
            continue;
        }

        if (particle.boundTime > 24 && Math.random() < turnoverProbability) {
            particle.kind = "E";
            particle.boundTime = 0;
            particle.pulse = 1;
            particle.r = getRadius("E");

            const product = createParticle("P", particle.x + randomBetween(-16, 16), particle.y + randomBetween(-16, 16));
            product.vx += randomBetween(-0.7, 0.7);
            product.vy += randomBetween(-0.7, 0.7);
            product.pulse = 1;
            state.particles.push(product);
            state.reactionCount += 1;
        }
    }

    for (let index = 0; index < state.particles.length; index += 1) {
        const enzyme = state.particles[index];
        if (enzyme.kind !== "E") {
            continue;
        }

        for (let substrateIndex = 0; substrateIndex < state.particles.length; substrateIndex += 1) {
            const substrate = state.particles[substrateIndex];
            if (substrate.kind !== "S") {
                continue;
            }

            if (distanceBetween(enzyme, substrate) < enzyme.r + substrate.r + 6 && Math.random() < bindingProbability) {
                enzyme.kind = "ES";
                enzyme.boundTime = 0;
                enzyme.pulse = 1;
                enzyme.r = getRadius("ES");
                state.particles.splice(substrateIndex, 1);
                return;
            }
        }
    }
}

function updateStats() {
    const now = performance.now();
    const elapsed = now - state.lastRateTime;
    if (elapsed > 1000) {
        state.currentRate = ((state.reactionCount - state.lastReactionCount) * 1000) / elapsed;
        state.lastReactionCount = state.reactionCount;
        state.lastRateTime = now;
    }

    const substrate = state.mode === "enzyme"
        ? state.particles.filter((particle) => particle.kind === "S" || particle.kind === "ES").length
        : state.particles.filter((particle) => particle.kind === "A" || particle.kind === "B").length;
    const product = state.mode === "enzyme"
        ? state.particles.filter((particle) => particle.kind === "P").length
        : state.particles.filter((particle) => particle.kind === "C").length;

    dom.reactionCount.textContent = String(state.reactionCount);
    dom.rateStat.textContent = `${formatNumber(state.currentRate, 1)} /s`;
    dom.substrateStat.textContent = String(substrate);
    dom.productStat.textContent = String(product);
}

function drawRoundedRect(x, y, width, height, radius) {
    const r = Math.min(radius, width * 0.5, height * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function drawBackground() {
    const chamber = getChamberBounds();
    const background = ctx.createLinearGradient(0, 0, 0, state.viewport.height);
    background.addColorStop(0, "#fcfffb");
    background.addColorStop(1, "#eef7f1");
    ctx.clearRect(0, 0, state.viewport.width, state.viewport.height);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, state.viewport.width, state.viewport.height);

    drawRoundedRect(chamber.left, chamber.top, chamber.right - chamber.left, chamber.bottom - chamber.top, 20);
    const chamberFill = ctx.createLinearGradient(chamber.left, chamber.top, chamber.right, chamber.bottom);
    chamberFill.addColorStop(0, "rgba(255, 255, 255, 0.96)");
    chamberFill.addColorStop(1, "rgba(231, 245, 236, 0.94)");
    ctx.fillStyle = chamberFill;
    ctx.fill();

    ctx.strokeStyle = "rgba(18, 35, 26, 0.1)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.strokeStyle = "rgba(28, 139, 87, 0.06)";
    for (let x = chamber.left + 18; x < chamber.right; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x, chamber.top);
        ctx.lineTo(x, chamber.bottom);
        ctx.stroke();
    }
    for (let y = chamber.top + 18; y < chamber.bottom; y += 32) {
        ctx.beginPath();
        ctx.moveTo(chamber.left, y);
        ctx.lineTo(chamber.right, y);
        ctx.stroke();
    }

    ctx.fillStyle = "rgba(18, 35, 26, 0.68)";
    ctx.font = "600 14px IBM Plex Sans JP";
    ctx.fillText(state.mode === "enzyme" ? "E と S が出会って ES をつくり、P を放す" : "A と B が衝突して C をつくる", chamber.left + 18, chamber.top + 22);
}

function drawParticle(particle) {
    if (particle.pulse > 0.02) {
        ctx.fillStyle = `${COLORS[particle.kind]}33`;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.r + (particle.pulse * 12), 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.fillStyle = COLORS[particle.kind];
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(18, 35, 26, 0.22)";
    ctx.lineWidth = 2;
    ctx.stroke();

    if (particle.kind === "E" || particle.kind === "ES") {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.82)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y - particle.r + 8, 7, 0, Math.PI);
        ctx.stroke();
    }

    if (particle.kind === "ES") {
        ctx.fillStyle = "rgba(249, 115, 22, 0.84)";
        ctx.beginPath();
        ctx.arc(particle.x + 5, particle.y + 2, 5, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${particle.kind.length === 2 ? 11 : 13}px IBM Plex Sans JP`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(particle.kind, particle.x, particle.y + 0.5);
}

function drawEnergyDiagram() {
    const boxX = 26;
    const boxWidth = 232;
    const boxHeight = 116;
    const boxY = state.viewport.height - boxHeight - 22;
    const curveBottom = boxY + 84;
    const curveWidth = 186;
    const peak = curveBottom - (state.activationEnergy * 0.58);

    drawRoundedRect(boxX, boxY, boxWidth, boxHeight, 18);
    ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
    ctx.fill();
    ctx.strokeStyle = "rgba(18, 35, 26, 0.1)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#12231a";
    ctx.font = "700 13px IBM Plex Sans JP";
    ctx.textAlign = "left";
    ctx.fillText("活性化エネルギー", boxX + 14, boxY + 20);

    ctx.strokeStyle = "#cf4d4d";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(boxX + 14, curveBottom);
    ctx.quadraticCurveTo(boxX + 14 + (curveWidth * 0.5), peak, boxX + 14 + curveWidth, curveBottom - 8);
    ctx.stroke();

    if (state.mode === "enzyme") {
        const enzymePeak = curveBottom - (state.activationEnergy * 0.58 * 0.45);
        ctx.strokeStyle = "#1c8b57";
        ctx.beginPath();
        ctx.moveTo(boxX + 14, curveBottom);
        ctx.quadraticCurveTo(boxX + 14 + (curveWidth * 0.5), enzymePeak, boxX + 14 + curveWidth, curveBottom - 8);
        ctx.stroke();
    }

    ctx.fillStyle = "#466257";
    ctx.font = "12px IBM Plex Sans JP";
    ctx.fillText("赤: 酵素なし", boxX + 14, boxY + 102);
    if (state.mode === "enzyme") {
        ctx.fillText("緑: 酵素あり", boxX + 104, boxY + 102);
    }
}

function stepSimulation() {
    state.particles.forEach((particle) => {
        updateParticle(particle);
    });

    if (state.mode === "normal") {
        reactNormal();
    } else {
        reactEnzyme();
    }
}

function renderFrame() {
    drawBackground();
    state.particles.forEach((particle) => {
        drawParticle(particle);
    });
    drawEnergyDiagram();
    updateStats();
}

function loop() {
    if (state.running) {
        stepSimulation();
    }
    renderFrame();
    window.requestAnimationFrame(loop);
}

dom.startBtn.addEventListener("click", () => {
    state.running = !state.running;
    updateStaticUi();
});

dom.resetBtn.addEventListener("click", () => {
    resetSimulation();
});

dom.mode.addEventListener("change", () => {
    resetSimulation();
});

dom.conc.addEventListener("change", () => {
    resetSimulation();
});

dom.enzymeCount.addEventListener("change", () => {
    resetSimulation();
});

[dom.temp, dom.ea].forEach((element) => {
    element.addEventListener("input", () => {
        syncStateFromInputs();
        updateStaticUi();
    });
});

[dom.conc, dom.enzymeCount].forEach((element) => {
    element.addEventListener("input", () => {
        syncStateFromInputs();
        updateStaticUi();
    });
});

window.addEventListener("resize", () => {
    resizeCanvas();
});

resizeCanvas();
resetSimulation();
loop();