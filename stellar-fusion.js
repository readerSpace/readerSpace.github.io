const REACTIONS = [
    {
        key: "pp",
        name: "pp連鎖",
        stage: "H燃焼",
        minTemp: 6,
        temperatureExponent: 2,
        equations: [
            "1H + 1H -> 2H + e+ + nu_e",
            "2H + 1H -> 3He + gamma",
            "3He + 3He -> 4He + 2 1H",
            "合計: 4 1H -> 4He + 2e+ + 2nu_e + energy"
        ],
        consumes: { H: 0.9 },
        produces: { He: 0.75 },
        color: "#ffd878"
    },
    {
        key: "cno",
        name: "CNOサイクル",
        stage: "H燃焼",
        minTemp: 15,
        temperatureExponent: 4,
        equations: [
            "12C + 1H -> 13N + gamma",
            "13N -> 13C + e+ + nu_e",
            "13C + 1H -> 14N + gamma",
            "14N + 1H -> 15O + gamma",
            "15O -> 15N + e+ + nu_e",
            "15N + 1H -> 12C + 4He",
            "合計: 4 1H -> 4He + 2e+ + 2nu_e + energy"
        ],
        consumes: { H: 1.2 },
        produces: { He: 0.9 },
        color: "#ff9f1c"
    },
    {
        key: "tripleAlpha",
        name: "三重アルファ反応",
        stage: "He燃焼",
        minTemp: 10,
        temperatureExponent: 4,
        equations: [
            "4He + 4He <-> 8Be",
            "8Be + 4He -> 12C + gamma",
            "合計: 3 4He -> 12C + gamma"
        ],
        consumes: { He: 1.0 },
        produces: { C: 0.8 },
        color: "#ff6b35"
    },
    {
        key: "alphaCapture",
        name: "アルファ捕獲",
        stage: "He燃焼",
        minTemp: 14,
        temperatureExponent: 4,
        equations: [
            "12C + 4He -> 16O + gamma"
        ],
        consumes: { He: 0.35, C: 0.25 },
        produces: { O: 0.5 },
        color: "#f77f00"
    },
    {
        key: "carbon",
        name: "炭素燃焼",
        stage: "C燃焼",
        minTemp: 28,
        temperatureExponent: 4,
        equations: [
            "12C + 12C -> 20Ne + 4He",
            "12C + 12C -> 23Na + 1H",
            "12C + 12C -> 24Mg + gamma"
        ],
        consumes: { C: 1.0 },
        produces: { Ne: 0.45, Mg: 0.35 },
        color: "#ef476f"
    },
    {
        key: "neon",
        name: "ネオン燃焼",
        stage: "Ne燃焼",
        minTemp: 32,
        temperatureExponent: 4,
        equations: [
            "20Ne + gamma -> 16O + 4He",
            "20Ne + 4He -> 24Mg + gamma"
        ],
        consumes: { Ne: 0.8 },
        produces: { O: 0.35, Mg: 0.45 },
        color: "#c9184a"
    },
    {
        key: "oxygen",
        name: "酸素燃焼",
        stage: "O燃焼",
        minTemp: 36,
        temperatureExponent: 4,
        equations: [
            "16O + 16O -> 28Si + 4He",
            "16O + 16O -> 31P + 1H",
            "16O + 16O -> 32S + gamma"
        ],
        consumes: { O: 1.0 },
        produces: { Si: 0.45, S: 0.25 },
        color: "#9d0208"
    },
    {
        key: "silicon",
        name: "ケイ素燃焼",
        stage: "Si燃焼",
        minTemp: 40,
        temperatureExponent: 4,
        equations: [
            "28Si + gamma <-> 24Mg + 4He",
            "alpha capture chain -> 32S, 36Ar, 40Ca, 44Ti, 48Cr, 52Fe, 56Ni",
            "56Ni -> 56Co -> 56Fe"
        ],
        consumes: { Si: 0.85 },
        produces: { Fe: 0.6 },
        color: "#7f5cff"
    }
];

const PRESETS = {
    sun: {
        label: "太陽型主系列星",
        temp: 15,
        density: 20,
        fuels: { H: 70, He: 25, C: 2, O: 2, Ne: 0.5, Mg: 0.2, Si: 0.1, S: 0, Fe: 0 },
        reactionWeights: { pp: 1.0, cno: 0.18, tripleAlpha: 0, alphaCapture: 0, carbon: 0, neon: 0, oxygen: 0, silicon: 0 }
    },
    massive: {
        label: "大質量主系列星",
        temp: 24,
        density: 35,
        fuels: { H: 66, He: 24, C: 3, O: 3, Ne: 0.8, Mg: 0.4, Si: 0.2, S: 0, Fe: 0 },
        reactionWeights: { pp: 0.28, cno: 1.0, tripleAlpha: 0, alphaCapture: 0, carbon: 0, neon: 0, oxygen: 0, silicon: 0 }
    },
    redgiant: {
        label: "赤色巨星中心核",
        temp: 18,
        density: 55,
        fuels: { H: 10, He: 78, C: 4, O: 2, Ne: 0.5, Mg: 0.2, Si: 0.1, S: 0, Fe: 0 },
        reactionWeights: { pp: 0, cno: 0, tripleAlpha: 1.0, alphaCapture: 0.52, carbon: 0, neon: 0, oxygen: 0, silicon: 0 }
    },
    "supergiant-carbon": {
        label: "超巨星中心核: 炭素燃焼段階",
        temp: 34,
        density: 72,
        fuels: { H: 1, He: 10, C: 36, O: 25, Ne: 10, Mg: 6, Si: 8, S: 3, Fe: 1 },
        reactionWeights: { pp: 0, cno: 0, tripleAlpha: 0, alphaCapture: 0, carbon: 1.0, neon: 0.06, oxygen: 0.01, silicon: 0 }
    },
    "supergiant-neon": {
        label: "超巨星中心核: ネオン燃焼段階",
        temp: 37,
        density: 78,
        fuels: { H: 1, He: 8, C: 9, O: 28, Ne: 24, Mg: 10, Si: 12, S: 5, Fe: 3 },
        reactionWeights: { pp: 0, cno: 0, tripleAlpha: 0, alphaCapture: 0, carbon: 0.08, neon: 1.0, oxygen: 0.12, silicon: 0.02 }
    },
    "supergiant-oxygen": {
        label: "超巨星中心核: 酸素燃焼段階",
        temp: 40,
        density: 82,
        fuels: { H: 0.5, He: 6.5, C: 4, O: 40, Ne: 9, Mg: 8, Si: 16, S: 10, Fe: 6 },
        reactionWeights: { pp: 0, cno: 0, tripleAlpha: 0, alphaCapture: 0, carbon: 0.02, neon: 0.08, oxygen: 1.0, silicon: 0.12 }
    },
    "supergiant-silicon": {
        label: "超巨星中心核: ケイ素燃焼段階",
        temp: 43,
        density: 88,
        fuels: { H: 0, He: 4, C: 2, O: 12, Ne: 6, Mg: 10, Si: 38, S: 20, Fe: 8 },
        reactionWeights: { pp: 0, cno: 0, tripleAlpha: 0, alphaCapture: 0, carbon: 0, neon: 0.02, oxygen: 0.06, silicon: 1.0 }
    }
};

const ELEMENT_COLORS = {
    H: "#79c4ff",
    He: "#ffd878",
    C: "#ff8c4a",
    O: "#ef476f",
    Ne: "#c9184a",
    Mg: "#f77f00",
    Si: "#b28cff",
    S: "#d57cff",
    Fe: "#c7d0df"
};

const dom = {
    canvas: document.querySelector("#fusionCanvas"),
    canvasShell: document.querySelector("#canvasShell"),
    starType: document.querySelector("#starType"),
    temp: document.querySelector("#temp"),
    density: document.querySelector("#density"),
    speed: document.querySelector("#speed"),
    tempText: document.querySelector("#tempText"),
    densityText: document.querySelector("#densityText"),
    speedText: document.querySelector("#speedText"),
    toggleButton: document.querySelector("#toggleButton"),
    resetButton: document.querySelector("#resetButton"),
    timeText: document.querySelector("#timeText"),
    stageText: document.querySelector("#stageText"),
    lumText: document.querySelector("#lumText"),
    coreText: document.querySelector("#coreText"),
    topReactions: document.querySelector("#topReactions"),
    observeTitle: document.querySelector("#observeTitle"),
    summaryText: document.querySelector("#summaryText"),
    mixLabel: document.querySelector("#mixLabel"),
    modeChip: document.querySelector("#modeChip"),
    equations: document.querySelector("#equations"),
    fuelBars: document.querySelector("#fuelBars")
};

const context = dom.canvas?.getContext("2d");

if (!dom.canvas || !dom.canvasShell || !context) {
    throw new Error("Stellar fusion page failed to initialize.");
}

const state = {
    running: false,
    time: 0,
    fuels: { ...PRESETS.sun.fuels },
    particles: [],
    activeReactions: [],
    reactionRates: [],
    luminosity: 0,
    viewport: {
        width: 860,
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

function formatNumber(value, digits = 1) {
    return value.toFixed(digits).replace(/(?:\.0+|(\.\d*?[1-9]))0+$/, "$1");
}

function getPreset() {
    return PRESETS[dom.starType.value] || PRESETS.sun;
}

function elementColor(element) {
    return ELEMENT_COLORS[element] || "#ffffff";
}

function buildParticlePool() {
    const fuels = state.fuels;
    const entries = Object.entries(fuels)
        .filter(([, value]) => value > 0.15)
        .sort((a, b) => b[1] - a[1]);
    const weighted = [];

    entries.forEach(([element, value]) => {
        const amount = Math.max(1, Math.round(value));
        for (let index = 0; index < amount; index += 1) {
            weighted.push(element);
        }
    });

    return weighted.length ? weighted : ["H", "He"];
}

function resetParticles() {
    const width = state.viewport.width;
    const height = state.viewport.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const pool = buildParticlePool();

    state.particles = Array.from({ length: 210 }, () => {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.sqrt(Math.random()) * Math.min(width, height) * 0.34;
        return {
            x: centerX + (Math.cos(angle) * radius),
            y: centerY + (Math.sin(angle) * radius),
            vx: (Math.random() - 0.5) * 1.3,
            vy: (Math.random() - 0.5) * 1.3,
            element: pool[Math.floor(Math.random() * pool.length)],
            flash: 0
        };
    });
}

function normalizeFuels() {
    const total = Object.values(state.fuels).reduce((sum, value) => sum + value, 0);

    if (total <= 0) {
        return;
    }

    Object.keys(state.fuels).forEach((key) => {
        state.fuels[key] = (state.fuels[key] / total) * 100;
    });
}

function applyPreset() {
    const preset = getPreset();
    dom.temp.value = String(preset.temp);
    dom.density.value = String(preset.density);
    state.time = 0;
    state.fuels = { ...preset.fuels };
    resetParticles();
    refreshIdleState();
    updateUi();
}

function refreshIdleState() {
    state.reactionRates = REACTIONS.map((reaction) => ({ ...reaction, rate: rateForReaction(reaction) }));
    state.activeReactions = state.reactionRates.filter((reaction) => reaction.rate > 0.001);
    state.luminosity = state.activeReactions.reduce((sum, reaction) => sum + (reaction.rate * 100), 0);
}

function rateForReaction(reaction) {
    const temp = Number(dom.temp.value);
    const density = Number(dom.density.value) / 50;
    const preset = getPreset();
    const weight = preset.reactionWeights[reaction.key] ?? 0;

    if (temp < reaction.minTemp || weight <= 0) {
        return 0;
    }

    let fuelFactor = 1;
    Object.entries(reaction.consumes).forEach(([element, exponent]) => {
        fuelFactor *= Math.max(0, state.fuels[element] / 50) ** exponent;
    });

    const tempFactor = ((temp - reaction.minTemp + 1) / 10) ** reaction.temperatureExponent;
    return Math.min(4.4, tempFactor * density * fuelFactor * weight);
}

function getSortedActiveReactions() {
    return [...state.activeReactions].sort((left, right) => right.rate - left.rate);
}

function getSortedReactionRates() {
    return [...state.reactionRates].sort((left, right) => right.rate - left.rate);
}

function getVisibleReactionRankings() {
    const weights = getPreset().reactionWeights;
    return getSortedReactionRates().filter((reaction) => (weights[reaction.key] ?? 0) > 0);
}

function updateSimulation() {
    const dt = Number(dom.speed.value) * 0.03;
    state.time += dt;
    state.activeReactions = [];
    state.reactionRates = [];
    state.luminosity = 0;

    REACTIONS.forEach((reaction) => {
        const rate = rateForReaction(reaction);
        state.reactionRates.push({ ...reaction, rate });

        if (rate <= 0.001) {
            return;
        }

        state.activeReactions.push({ ...reaction, rate });
        state.luminosity += rate * 100;

        Object.entries(reaction.consumes).forEach(([element, amount]) => {
            state.fuels[element] = Math.max(0, state.fuels[element] - (rate * amount * dt * 0.08));
        });

        Object.entries(reaction.produces).forEach(([element, amount]) => {
            state.fuels[element] = Math.min(100, state.fuels[element] + (rate * amount * dt * 0.07));
        });
    });

    normalizeFuels();

    const active = getSortedActiveReactions();
    const dominant = active[0];

    state.particles.forEach((particle) => {
        const centerX = state.viewport.width / 2;
        const centerY = state.viewport.height / 2;
        const dx = particle.x - centerX;
        const dy = particle.y - centerY;
        const distance = Math.hypot(dx, dy) || 1;
        const pull = -0.002 * Number(dom.density.value) / 30;
        const temperatureScale = Number(dom.temp.value) / 15;

        particle.vx += dx * pull;
        particle.vy += dy * pull;
        particle.x += particle.vx * temperatureScale;
        particle.y += particle.vy * temperatureScale;

        if (distance > Math.min(state.viewport.width, state.viewport.height) * 0.36) {
            particle.vx -= (dx / distance) * 1.2;
            particle.vy -= (dy / distance) * 1.2;
        }

        if (Math.random() < (state.luminosity / 19000)) {
            particle.flash = 1;
        }

        particle.flash *= 0.9;

        if (dominant && Math.random() < 0.007) {
            const productKeys = Object.keys(dominant.produces);
            if (productKeys.length) {
                particle.element = productKeys[Math.floor(Math.random() * productKeys.length)];
            }
        }
    });
}

function drawBackground(width, height) {
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#060a14");
    gradient.addColorStop(1, "#03060d");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    for (let index = 0; index < 90; index += 1) {
        const x = (index * 71) % width;
        const y = (index * 53) % height;
        const alpha = 0.08 + ((Math.sin((state.time * 0.18) + index) + 1) * 0.05);
        context.fillStyle = `rgba(255,255,255,${alpha})`;
        context.beginPath();
        context.arc(x, y, 1 + ((index % 3) * 0.6), 0, Math.PI * 2);
        context.fill();
    }
}

function drawStarCore(width, height) {
    const centerX = width / 2;
    const centerY = height / 2;
    const temp = Number(dom.temp.value);
    const glow = Math.min(1, temp / 45);
    const radius = Math.min(width, height) * 0.39;
    const gradient = context.createRadialGradient(centerX, centerY, 8, centerX, centerY, radius);
    gradient.addColorStop(0, "rgba(255,255,234,0.98)");
    gradient.addColorStop(0.16, "rgba(255,216,120,0.88)");
    gradient.addColorStop(0.4, `rgba(255,140,74,${0.64 + (glow * 0.16)})`);
    gradient.addColorStop(1, "rgba(18,29,54,0.14)");
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.fill();

    context.strokeStyle = "rgba(255,255,255,0.14)";
    context.lineWidth = 2;
    for (let index = 0; index < 5; index += 1) {
        context.beginPath();
        context.arc(centerX, centerY, radius * (0.24 + (index * 0.15)), 0, Math.PI * 2);
        context.stroke();
    }

    const flare = context.createRadialGradient(centerX, centerY, radius * 0.2, centerX, centerY, radius * 1.3);
    flare.addColorStop(0, `rgba(255, 220, 145, ${0.06 + (state.luminosity / 2600)})`);
    flare.addColorStop(1, "rgba(255, 220, 145, 0)");
    context.fillStyle = flare;
    context.beginPath();
    context.arc(centerX, centerY, radius * 1.25, 0, Math.PI * 2);
    context.fill();
}

function drawParticles(width, height) {
    const centerX = width / 2;
    const centerY = height / 2;
    const active = getSortedActiveReactions();
    const main = active[0];

    state.particles.forEach((particle) => {
        const distance = Math.hypot(particle.x - centerX, particle.y - centerY);

        if (distance > Math.min(width, height) * 0.43) {
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * Math.min(width, height) * 0.3;
            particle.x = centerX + (Math.cos(angle) * radius);
            particle.y = centerY + (Math.sin(angle) * radius);
        }

        context.fillStyle = particle.flash > 0.1 ? "#ffffff" : elementColor(particle.element);
        context.globalAlpha = 0.68 + (particle.flash * 0.32);
        context.beginPath();
        context.arc(particle.x, particle.y, 3 + (particle.flash * 8), 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = 1;
    });

    context.fillStyle = "rgba(5, 9, 18, 0.76)";
    context.fillRect(18, 18, Math.min(390, width - 36), 120);
    context.fillStyle = "#ffffff";
    context.font = "700 22px IBM Plex Sans JP";
    context.fillText(main ? main.name : "反応ほぼ停止", 34, 52);
    context.font = "15px IBM Plex Sans JP";
    context.fillStyle = "#cad7f3";
    context.fillText(`T = ${formatNumber(Number(dom.temp.value), 1)} MK, 密度 = ${dom.density.value}`, 34, 82);
    context.fillText(main ? main.equations[0] : "温度を上げると核融合が立ち上がります", 34, 110);
}

function renderScene() {
    const width = state.viewport.width;
    const height = state.viewport.height;

    drawBackground(width, height);
    drawStarCore(width, height);
    drawParticles(width, height);
}

function getDominantReaction() {
    return getSortedActiveReactions()[0] || null;
}

function describeCurrentState() {
    const presetKey = dom.starType.value;
    const dominant = getDominantReaction();
    const temp = Number(dom.temp.value);

    if (presetKey === "sun") {
        if (dominant?.key === "cno") {
            return {
                title: "高温側へ寄ると CNO の寄与が前に出る",
                summary: "太陽型としては高温寄りなので、pp 連鎖に加えて CNO サイクルの寄与が見えています。温度依存性の差がそのまま現れています。"
            };
        }
        return {
            title: "太陽型では pp 連鎖が主役になりやすい",
            summary: "温度がそれほど高くない主系列星では、pp 連鎖が水素燃焼の主役です。高温側へ寄せると CNO の寄与が目立ち始めます。"
        };
    }

    if (presetKey === "massive") {
        return {
            title: "大質量主系列星では CNO が支配的になりやすい",
            summary: "高温の水素燃焼では CNO サイクルの感度が強く、相対発熱も大きくなりやすい条件です。少し温度を下げると pp 連鎖の寄与との差が見やすくなります。"
        };
    }

    if (presetKey === "redgiant") {
        return {
            title: dominant?.key === "alphaCapture" ? "炭素から酸素への捕獲も視野に入る" : "三重アルファ反応がヘリウム燃焼の入口になる",
            summary: dominant?.key === "alphaCapture"
                ? "ヘリウム燃焼が進み、三重アルファでできた炭素にさらにアルファ粒子が捕獲されて酸素が増えやすくなっています。"
                : "水素主体の時期を過ぎた中心核では、三重アルファ反応がヘリウムから炭素を作る主役になります。"
        };
    }

    if (presetKey === "supergiant-carbon") {
        return {
            title: "炭素燃焼段階では 12C + 12C が入口になる",
            summary: "炭素が多く残る中心核では、炭素燃焼が最初の重元素燃焼として立ち上がりやすくなります。生成物のネオンやマグネシウムが次段階への足場になります。"
        };
    }

    if (presetKey === "supergiant-neon") {
        return {
            title: "ネオン燃焼段階では光分解とアルファ捕獲が主役になる",
            summary: "ネオンが多い段階では、ネオン燃焼が酸素とマグネシウムを増やしやすくなります。炭素燃焼段階より必要温度が高い点に注目してください。"
        };
    }

    if (presetKey === "supergiant-oxygen") {
        return {
            title: "酸素燃焼段階では Si と S へ進みやすい",
            summary: "酸素が豊富な中心核では、酸素燃焼がケイ素や硫黄を増やす方向へ進みます。さらに高温にするとケイ素燃焼が近づきます。"
        };
    }

    if (presetKey === "supergiant-silicon") {
        return {
            title: "ケイ素燃焼段階では鉄族元素の蓄積が視野に入る",
            summary: "ケイ素が多い中心核では、ケイ素燃焼が鉄族元素へ向かう最終段階を担います。発熱の余地が細くなり、中心核状態の変化も見やすくなります。"
        };
    }

    if (temp < 32) {
        return {
            title: "超巨星でも温度が低いと前段の燃料が残る",
            summary: "超巨星の中心核でも、温度が足りなければ高次の重元素燃焼は十分に立ち上がりません。しきい値の違いを見てください。"
        };
    }

    if (dominant?.key === "silicon") {
        return {
            title: "ケイ素燃焼が鉄族元素へ向かう最終段階に近い",
            summary: "ケイ素燃焼が目立つと、鉄族元素の蓄積が進み始めます。この先は発熱源としての余地が細くなり、中心核状態の意味が変わります。"
        };
    }

    return {
        title: "重元素燃焼は短く高温で切り替わる",
        summary: "炭素、ネオン、酸素、ケイ素燃焼はそれぞれ必要温度が違います。温度を少しずつ上げると、主反応が段階的に入れ替わるのが見えます。"
    };
}

function coreStateText() {
    if (state.fuels.Fe > 12) {
        return "鉄コア成長";
    }
    if (state.luminosity > 280) {
        return "激しい燃焼";
    }
    if (state.luminosity > 120) {
        return "高出力";
    }
    return "安定";
}

function updateUi() {
    dom.tempText.textContent = `${formatNumber(Number(dom.temp.value), 1)} MK`;
    dom.densityText.textContent = dom.density.value;
    dom.speedText.textContent = `${formatNumber(Number(dom.speed.value), 1)}x`;
    dom.toggleButton.textContent = state.running ? "進行: ON" : "進行: OFF";

    const dominant = getDominantReaction();
    const topReactions = getVisibleReactionRankings().slice(0, 3);
    dom.timeText.textContent = formatNumber(state.time, 1);
    dom.stageText.textContent = dominant ? dominant.name : "停止";
    dom.lumText.textContent = String(Math.round(state.luminosity));
    dom.coreText.textContent = coreStateText();
    dom.modeChip.textContent = dominant ? dominant.stage : "待機中";

    const description = describeCurrentState();
    dom.observeTitle.textContent = description.title;
    dom.summaryText.textContent = description.summary;

    const sortedFuels = Object.entries(state.fuels)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 3)
        .map(([element]) => element);
    dom.mixLabel.textContent = `${sortedFuels.join(" / ")} が中心`;

    dom.topReactions.innerHTML = "";
    if (!topReactions.length) {
        dom.topReactions.innerHTML = '<div class="reaction-ranking-empty">反応率を計算できませんでした。</div>';
    } else {
        topReactions.forEach((reaction, index) => {
            const card = document.createElement("div");
            const isDominant = index === 0 && reaction.rate > 0.001;
            card.className = `reaction-ranking-card${isDominant ? " is-dominant" : ""}`;
            card.innerHTML = `
                <div class="reaction-ranking-head">
                    <span class="reaction-ranking-name">${index + 1}. ${reaction.name}</span>
                    <span class="reaction-ranking-rate">rate ${formatNumber(reaction.rate, 2)}</span>
                </div>
                <p class="reaction-ranking-stage">${reaction.stage}${reaction.rate <= 0.001 ? " / しきい値未満" : ""}</p>
            `;
            dom.topReactions.appendChild(card);
        });
    }

    dom.fuelBars.innerHTML = "";
    Object.entries(state.fuels)
        .sort((left, right) => right[1] - left[1])
        .forEach(([element, value]) => {
            const row = document.createElement("div");
            row.className = "fuel-row";
            row.innerHTML = `
                <div class="fuel-row-head">
                    <span>${element}</span>
                    <span>${formatNumber(value, 1)}%</span>
                </div>
                <div class="fuel-track">
                    <div class="fuel-fill" style="width:${value}%; background:${elementColor(element)}"></div>
                </div>
            `;
            dom.fuelBars.appendChild(row);
        });

    Array.from(dom.equations.children).forEach((node) => {
        const key = node.getAttribute("data-reaction-key");
        const isActive = state.activeReactions.some((reaction) => reaction.key === key);
        node.classList.toggle("is-active", isActive);
    });
}

function renderEquations() {
    dom.equations.innerHTML = "";

    REACTIONS.forEach((reaction) => {
        const card = document.createElement("article");
        card.className = "reaction-card";
        card.setAttribute("data-reaction-key", reaction.key);
        card.style.borderLeft = `4px solid ${reaction.color}`;
        card.innerHTML = `
            <p class="card-label">${reaction.stage}</p>
            <h3>${reaction.name}</h3>
            <p>必要温度の目安: ${formatNumber(reaction.minTemp, 0)} MK 以上</p>
            ${reaction.equations.map((equation) => `<code>${equation}</code>`).join("")}
        `;
        dom.equations.appendChild(card);
    });
}

function resizeCanvas() {
    const rect = dom.canvasShell.getBoundingClientRect();
    const cssWidth = Math.max(320, Math.round(rect.width || 760));
    const cssHeight = window.innerWidth < 720
        ? clamp(Math.round(window.innerHeight * 0.45), 320, 440)
        : clamp(Math.round(cssWidth * 0.72), 420, 620);
    const dpr = window.devicePixelRatio || 1;

    dom.canvas.width = Math.round(cssWidth * dpr);
    dom.canvas.height = Math.round(cssHeight * dpr);
    dom.canvas.style.height = `${cssHeight}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    state.viewport = {
        width: cssWidth,
        height: cssHeight,
        dpr
    };

    resetParticles();
}

function loop() {
    if (state.running) {
        updateSimulation();
    } else {
        refreshIdleState();
    }

    renderScene();
    updateUi();
    requestAnimationFrame(loop);
}

dom.starType.addEventListener("change", () => {
    applyPreset();
});

dom.toggleButton.addEventListener("click", () => {
    state.running = !state.running;
    updateUi();
});

dom.resetButton.addEventListener("click", () => {
    state.running = false;
    applyPreset();
});

[dom.temp, dom.density, dom.speed].forEach((element) => {
    element.addEventListener("input", () => {
        if (!state.running) {
            refreshIdleState();
        }
        updateUi();
    });
});

const resizeObserver = new ResizeObserver(() => {
    resizeCanvas();
});

resizeObserver.observe(dom.canvasShell);
window.addEventListener("resize", resizeCanvas);

renderEquations();
applyPreset();
resizeCanvas();
requestAnimationFrame(loop);