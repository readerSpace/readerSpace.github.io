const GRID_SIZE = 42;
const HISTORY_LIMIT = 360;
const INITIAL_RABBITS = 70;
const INITIAL_FOXES = 14;

const DEFAULTS = {
    preset: "balanced",
    grassRate: 0.012,
    rabbitBirth: 0.014,
    huntPower: 1.3,
    foxCost: 0.08
};

const PRESETS = {
    balanced: {
        label: "バランス型",
        grassRate: 0.012,
        rabbitBirth: 0.014,
        huntPower: 1.3,
        foxCost: 0.08
    },
    "grass-rich": {
        label: "草が豊富",
        grassRate: 0.022,
        rabbitBirth: 0.018,
        huntPower: 1.2,
        foxCost: 0.07
    },
    "predator-pressure": {
        label: "捕食圧が高い",
        grassRate: 0.011,
        rabbitBirth: 0.013,
        huntPower: 2.2,
        foxCost: 0.06
    },
    fragile: {
        label: "不安定で崩れやすい",
        grassRate: 0.006,
        rabbitBirth: 0.021,
        huntPower: 2.4,
        foxCost: 0.11
    }
};

const dom = {
    canvas: document.querySelector("#canvas"),
    canvasShell: document.querySelector("#canvasShell"),
    preset: document.querySelector("#preset"),
    grassRate: document.querySelector("#grassRate"),
    rabbitBirth: document.querySelector("#rabbitBirth"),
    huntPower: document.querySelector("#huntPower"),
    foxCost: document.querySelector("#foxCost"),
    grassValue: document.querySelector("#grassValue"),
    rabbitBirthValue: document.querySelector("#rabbitBirthValue"),
    huntValue: document.querySelector("#huntValue"),
    foxCostValue: document.querySelector("#foxCostValue"),
    rabbitCount: document.querySelector("#rabbitCount"),
    foxCount: document.querySelector("#foxCount"),
    grassCoverage: document.querySelector("#grassCoverage"),
    phaseStat: document.querySelector("#phaseStat"),
    balanceStat: document.querySelector("#balanceStat"),
    phaseText: document.querySelector("#phaseText"),
    observeTitle: document.querySelector("#observeTitle"),
    observeText: document.querySelector("#observeText"),
    statusChip: document.querySelector("#statusChip"),
    pauseBtn: document.querySelector("#pauseBtn"),
    resetBtn: document.querySelector("#resetBtn")
};

const ctx = dom.canvas.getContext("2d");

const state = {
    viewport: {
        width: 760,
        height: 560,
        dpr: 1
    },
    worldHeight: 400,
    graphHeight: 170,
    paused: false,
    tick: 0,
    rabbits: [],
    foxes: [],
    grass: [],
    history: []
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

function rand(min, max) {
    return min + (Math.random() * (max - min));
}

function dist2(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return (dx * dx) + (dy * dy);
}

function formatValue(value, digits) {
    return Number(value).toFixed(digits);
}

function createGrassGrid() {
    state.grass = [];

    for (let y = 0; y < GRID_SIZE; y += 1) {
        state.grass[y] = [];
        for (let x = 0; x < GRID_SIZE; x += 1) {
            state.grass[y][x] = Math.random();
        }
    }
}

function createRabbit(x = rand(30, state.viewport.width - 30), y = rand(30, state.worldHeight - 30)) {
    return {
        x,
        y,
        vx: rand(-1.2, 1.2),
        vy: rand(-1.2, 1.2),
        energy: rand(35, 70),
        age: 0
    };
}

function createFox(x = rand(30, state.viewport.width - 30), y = rand(30, state.worldHeight - 30)) {
    return {
        x,
        y,
        vx: rand(-1.5, 1.5),
        vy: rand(-1.5, 1.5),
        energy: rand(80, 130),
        age: 0
    };
}

function syncControlLabels() {
    dom.grassValue.textContent = formatValue(dom.grassRate.value, 3);
    dom.rabbitBirthValue.textContent = formatValue(dom.rabbitBirth.value, 3);
    dom.huntValue.textContent = formatValue(dom.huntPower.value, 1);
    dom.foxCostValue.textContent = formatValue(dom.foxCost.value, 2);
}

function resizeCanvas() {
    const bounds = dom.canvasShell.getBoundingClientRect();
    const cssWidth = Math.max(320, Math.round(bounds.width || 760));
    const cssHeight = window.innerWidth <= 780
        ? clamp(Math.round(Math.max(cssWidth * 0.92, window.innerHeight * 0.54)), 430, 560)
        : 620;
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

    state.graphHeight = window.innerWidth <= 780 ? 172 : 184;
    state.worldHeight = cssHeight - state.graphHeight - 16;

    state.rabbits.forEach((rabbit) => {
        rabbit.x = clamp(rabbit.x, 8, state.viewport.width - 8);
        rabbit.y = clamp(rabbit.y, 8, state.worldHeight - 8);
    });
    state.foxes.forEach((fox) => {
        fox.x = clamp(fox.x, 8, state.viewport.width - 8);
        fox.y = clamp(fox.y, 8, state.worldHeight - 8);
    });
}

function grassAt(x, y) {
    const gx = clamp(Math.floor((x / state.viewport.width) * GRID_SIZE), 0, GRID_SIZE - 1);
    const gy = clamp(Math.floor((y / state.worldHeight) * GRID_SIZE), 0, GRID_SIZE - 1);

    return {
        gx,
        gy,
        value: state.grass[gy][gx]
    };
}

function nearest(from, list, maxDistance) {
    let best = null;
    let bestDistance = maxDistance * maxDistance;

    list.forEach((item) => {
        const distance = dist2(from, item);
        if (distance < bestDistance) {
            best = item;
            bestDistance = distance;
        }
    });

    return best;
}

function moveAnimal(animal, speed, fearTarget = null, chaseTarget = null) {
    if (fearTarget) {
        const dx = animal.x - fearTarget.x;
        const dy = animal.y - fearTarget.y;
        const distance = Math.hypot(dx, dy) + 0.001;
        animal.vx += (dx / distance) * 0.35;
        animal.vy += (dy / distance) * 0.35;
    }

    if (chaseTarget) {
        const dx = chaseTarget.x - animal.x;
        const dy = chaseTarget.y - animal.y;
        const distance = Math.hypot(dx, dy) + 0.001;
        animal.vx += (dx / distance) * 0.42;
        animal.vy += (dy / distance) * 0.42;
    }

    animal.vx += rand(-0.22, 0.22);
    animal.vy += rand(-0.22, 0.22);

    const velocity = Math.hypot(animal.vx, animal.vy) || 1;
    animal.vx = (animal.vx / velocity) * speed;
    animal.vy = (animal.vy / velocity) * speed;
    animal.x += animal.vx;
    animal.y += animal.vy;

    if (animal.x < 8 || animal.x > state.viewport.width - 8) {
        animal.vx *= -1;
    }
    if (animal.y < 8 || animal.y > state.worldHeight - 8) {
        animal.vy *= -1;
    }

    animal.x = clamp(animal.x, 8, state.viewport.width - 8);
    animal.y = clamp(animal.y, 8, state.worldHeight - 8);
}

function updateGrass() {
    const rate = Number(dom.grassRate.value);

    for (let y = 0; y < GRID_SIZE; y += 1) {
        for (let x = 0; x < GRID_SIZE; x += 1) {
            state.grass[y][x] = clamp(state.grass[y][x] + (rate * (1 - state.grass[y][x])), 0, 1);
        }
    }
}

function updateRabbits() {
    const birthRate = Number(dom.rabbitBirth.value);
    const newRabbits = [];

    state.rabbits.forEach((rabbit) => {
        rabbit.age += 1;

        const predator = nearest(rabbit, state.foxes, 70);
        moveAnimal(rabbit, 1.45, predator, null);

        const grassCell = grassAt(rabbit.x, rabbit.y);
        if (grassCell.value > 0.12) {
            const eaten = Math.min(grassCell.value, 0.12);
            state.grass[grassCell.gy][grassCell.gx] -= eaten;
            rabbit.energy += eaten * 40;
        }

        rabbit.energy -= 0.09;

        if (rabbit.energy > 65 && Math.random() < birthRate && state.rabbits.length + newRabbits.length < 260) {
            rabbit.energy *= 0.72;
            newRabbits.push(createRabbit(rabbit.x + rand(-10, 10), rabbit.y + rand(-10, 10)));
        }
    });

    state.rabbits = state.rabbits.filter((rabbit) => rabbit.energy > 0 && rabbit.age < 2800);
    state.rabbits.push(...newRabbits);
}

function updateFoxes() {
    const cost = Number(dom.foxCost.value);
    const power = Number(dom.huntPower.value);
    const newFoxes = [];
    const eaten = new Set();

    state.foxes.forEach((fox) => {
        fox.age += 1;
        const prey = nearest(fox, state.rabbits, 120);
        moveAnimal(fox, 1.75, null, prey);
        fox.energy -= cost;

        for (let index = 0; index < state.rabbits.length; index += 1) {
            if (eaten.has(index)) {
                continue;
            }

            const rabbit = state.rabbits[index];
            const catchRadius = 9 + (power * 5);

            if (dist2(fox, rabbit) < catchRadius * catchRadius) {
                eaten.add(index);
                fox.energy += 46;
                break;
            }
        }

        if (fox.energy > 155 && Math.random() < 0.018 && state.foxes.length + newFoxes.length < 90) {
            fox.energy *= 0.62;
            newFoxes.push(createFox(fox.x + rand(-12, 12), fox.y + rand(-12, 12)));
        }
    });

    state.rabbits = state.rabbits.filter((_, index) => !eaten.has(index));
    state.foxes = state.foxes.filter((fox) => fox.energy > 0 && fox.age < 3600);
    state.foxes.push(...newFoxes);
}

function updateHistory() {
    if (state.tick % 5 !== 0) {
        return;
    }

    state.history.push({
        rabbits: state.rabbits.length,
        foxes: state.foxes.length
    });

    if (state.history.length > HISTORY_LIMIT) {
        state.history.shift();
    }
}

function resetSimulation() {
    state.rabbits = [];
    state.foxes = [];
    state.history = [];
    state.tick = 0;
    createGrassGrid();

    for (let index = 0; index < INITIAL_RABBITS; index += 1) {
        state.rabbits.push(createRabbit());
    }

    for (let index = 0; index < INITIAL_FOXES; index += 1) {
        state.foxes.push(createFox());
    }
}

function averageGrass() {
    let total = 0;

    for (let y = 0; y < GRID_SIZE; y += 1) {
        for (let x = 0; x < GRID_SIZE; x += 1) {
            total += state.grass[y][x];
        }
    }

    return total / (GRID_SIZE * GRID_SIZE);
}

function computeTrend(key) {
    if (state.history.length < 18) {
        return 0;
    }

    const recent = state.history.slice(-18);
    const midpoint = Math.floor(recent.length / 2);
    const early = recent.slice(0, midpoint);
    const late = recent.slice(midpoint);
    const earlyAverage = early.reduce((sum, item) => sum + item[key], 0) / early.length;
    const lateAverage = late.reduce((sum, item) => sum + item[key], 0) / late.length;
    return lateAverage - earlyAverage;
}

function describePhase() {
    const rabbits = state.rabbits.length;
    const foxes = state.foxes.length;
    const rabbitTrend = computeTrend("rabbits");
    const foxTrend = computeTrend("foxes");
    const grass = averageGrass();

    if (rabbits < 10 && foxes < 4) {
        return {
            phase: "低密度",
            summary: "両方の個体群がかなり少なく、草だけが戻りやすい静かな局面です。",
            observeTitle: "谷の底では草が先に回復する",
            observeText: "個体数が少ないあいだは草が蓄積し、次のウサギ増加の準備段階になります。"
        };
    }

    if (rabbitTrend > 4 && foxTrend <= 1) {
        return {
            phase: "被食者先行",
            summary: "草が残っていてウサギが先に増えています。捕食者はまだ追いついていません。",
            observeTitle: "白線の立ち上がりが先に来る",
            observeText: "被食者が先に増えることで、次の数十ステップ後に捕食者の増加が始まりやすくなります。"
        };
    }

    if (rabbitTrend < -3 && foxTrend > 1) {
        return {
            phase: "捕食圧ピーク",
            summary: "キツネの増加が効いてウサギが減り始めています。赤線の山が白線より遅れて現れる典型局面です。",
            observeTitle: "赤線の山が遅れて立つ",
            observeText: "捕食者は被食者の増加を利用してから増えるため、2 つの波には自然な位相差ができます。"
        };
    }

    if (rabbitTrend < -2 && foxTrend < -1 && grass > 0.55) {
        return {
            phase: "同時減少",
            summary: "被食者も捕食者も同時に減っており、草だけが回復へ向かっています。次の回復局面の手前です。",
            observeTitle: "谷のあとは回復の準備期間",
            observeText: "草が十分に戻るまで個体数は低く留まり、そのあとでウサギが先に立ち上がります。"
        };
    }

    if (rabbitTrend > 1 && foxTrend > 1) {
        return {
            phase: "回復期",
            summary: "両方の個体群が増えていますが、主導しているのはまだウサギ側です。次は捕食圧が強まりやすい局面です。",
            observeTitle: "回復期では白い粒子が先に密になる",
            observeText: "被食者が増えたあとに捕食者が増えるので、画面上の密度差とグラフの時間差を対応づけて見られます。"
        };
    }

    return {
        phase: "揺らぎの途中",
        summary: "資源、繁殖、捕食が同時に動き、次の山へ向けて個体数が揺れています。",
        observeTitle: "粒子の密度とグラフを見比べる",
        observeText: "局所の捕食や逃避はランダムでも、長い時間で見ると全体として波の形が見えてきます。"
    };
}

function updateStats() {
    const grass = averageGrass();
    const phase = describePhase();
    const rabbitCount = state.rabbits.length;
    const foxCount = state.foxes.length;

    dom.rabbitCount.textContent = String(rabbitCount);
    dom.foxCount.textContent = String(foxCount);
    dom.grassCoverage.textContent = `${Math.round(grass * 100)}%`;
    dom.phaseStat.textContent = phase.phase;
    dom.balanceStat.textContent = `ウサギ ${rabbitCount} / キツネ ${foxCount}`;
    dom.phaseText.textContent = phase.summary;
    dom.observeTitle.textContent = phase.observeTitle;
    dom.observeText.textContent = phase.observeText;
    dom.statusChip.textContent = state.paused ? "停止中" : "動作中";
}

function drawBackground() {
    const gradient = ctx.createLinearGradient(0, 0, 0, state.viewport.height);
    gradient.addColorStop(0, "#cfead3");
    gradient.addColorStop(0.62, "#eef6dc");
    gradient.addColorStop(1, "#f6efe5");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, state.viewport.width, state.viewport.height);

    const haze = ctx.createRadialGradient(state.viewport.width * 0.78, 54, 10, state.viewport.width * 0.78, 54, 180);
    haze.addColorStop(0, "rgba(255, 248, 214, 0.38)");
    haze.addColorStop(1, "rgba(255, 248, 214, 0)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, state.viewport.width, state.worldHeight);

    ctx.fillStyle = "rgba(23, 56, 37, 0.72)";
    ctx.font = "13px IBM Plex Sans JP";
    ctx.fillText("草が多い → ウサギが増える → キツネが増える → ウサギが減る → キツネも減る", 18, 24);
}

function drawGrassLayer() {
    const cellWidth = state.viewport.width / GRID_SIZE;
    const cellHeight = state.worldHeight / GRID_SIZE;

    for (let y = 0; y < GRID_SIZE; y += 1) {
        for (let x = 0; x < GRID_SIZE; x += 1) {
            const value = state.grass[y][x];
            ctx.fillStyle = `rgba(34, 197, 94, ${0.06 + (value * 0.36)})`;
            ctx.fillRect(x * cellWidth, y * cellHeight, cellWidth + 0.6, cellHeight + 0.6);
        }
    }

    const groundGradient = ctx.createLinearGradient(0, state.worldHeight * 0.68, 0, state.worldHeight);
    groundGradient.addColorStop(0, "rgba(105, 158, 77, 0.06)");
    groundGradient.addColorStop(1, "rgba(96, 128, 60, 0.18)");
    ctx.fillStyle = groundGradient;
    ctx.fillRect(0, state.worldHeight * 0.6, state.viewport.width, state.worldHeight * 0.4);
}

function drawRabbit(rabbit) {
    ctx.save();
    ctx.translate(rabbit.x, rabbit.y);
    ctx.rotate(Math.atan2(rabbit.vy, rabbit.vx));
    ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
    ctx.strokeStyle = "rgba(71, 85, 105, 0.82)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 7, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(5, -4, 2, 6, 0.45, 0, Math.PI * 2);
    ctx.ellipse(5, 4, 2, 6, -0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
}

function drawFox(fox) {
    ctx.save();
    ctx.translate(fox.x, fox.y);
    ctx.rotate(Math.atan2(fox.vy, fox.vx));
    ctx.fillStyle = "#ef6a42";
    ctx.strokeStyle = "#7f2c15";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-7, -7);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-7, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ffd5c3";
    ctx.beginPath();
    ctx.moveTo(-7, -5);
    ctx.lineTo(-16, 0);
    ctx.lineTo(-7, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function drawGraph() {
    const x0 = 18;
    const y0 = state.worldHeight + 16;
    const graphWidth = state.viewport.width - 36;
    const graphHeight = state.graphHeight - 26;
    const graphFloor = y0 + graphHeight - 12;
    const graphStartX = x0 + 12;
    const graphEndX = x0 + graphWidth - 12;

    ctx.save();
    ctx.fillStyle = "rgba(255, 255, 255, 0.86)";
    ctx.strokeStyle = "rgba(148, 163, 184, 0.62)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x0, y0, graphWidth, graphHeight, 14);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#334155";
    ctx.font = "13px IBM Plex Sans JP";
    ctx.fillText("個体数の時間変化", x0 + 12, y0 + 22);
    ctx.fillStyle = "#64748b";
    ctx.fillText("白線: ウサギ   赤線: キツネ", x0 + 134, y0 + 22);

    if (state.history.length > 2) {
        const maxRabbits = Math.max(80, ...state.history.map((item) => item.rabbits));
        const maxFoxes = Math.max(20, ...state.history.map((item) => item.foxes));

        const buildPlotPoints = (key, maxValue) => state.history.map((item, index) => ({
            x: graphStartX + ((index / (state.history.length - 1)) * (graphWidth - 24)),
            y: graphFloor - ((item[key] / maxValue) * (graphHeight - 44))
        }));

        const tracePlot = (points) => {
            ctx.beginPath();
            points.forEach((point, index) => {
                if (index === 0) {
                    ctx.moveTo(point.x, point.y);
                } else {
                    ctx.lineTo(point.x, point.y);
                }
            });
        };

        const fillPlot = (points, fillColor) => {
            tracePlot(points);
            ctx.lineTo(graphEndX, graphFloor);
            ctx.lineTo(graphStartX, graphFloor);
            ctx.closePath();
            ctx.fillStyle = fillColor;
            ctx.fill();
        };

        const strokePlot = (points, color, outlineColor) => {
            if (outlineColor) {
                tracePlot(points);
                ctx.lineWidth = 5.6;
                ctx.strokeStyle = outlineColor;
                ctx.stroke();
            }

            tracePlot(points);
            ctx.lineWidth = 2.6;
            ctx.strokeStyle = color;
            ctx.stroke();
        };

        const rabbitPoints = buildPlotPoints("rabbits", maxRabbits);
        const foxPoints = buildPlotPoints("foxes", maxFoxes);

        fillPlot(rabbitPoints, "rgba(255,255,255,0.08)");
        fillPlot(foxPoints, "rgba(239,106,66,0.08)");
        strokePlot(foxPoints, "rgba(239,106,66,0.94)", "rgba(127,44,21,0.20)");
        strokePlot(rabbitPoints, "rgba(255,255,255,0.98)", "rgba(51,65,85,0.42)");
    }

    ctx.restore();
}

function render() {
    ctx.clearRect(0, 0, state.viewport.width, state.viewport.height);
    drawBackground();
    drawGrassLayer();
    state.rabbits.forEach(drawRabbit);
    state.foxes.forEach(drawFox);
    drawGraph();
    updateStats();
    syncControlLabels();
}

function stepSimulation() {
    if (!state.paused) {
        updateGrass();
        updateRabbits();
        updateFoxes();
        updateHistory();
        state.tick += 1;

        if (state.rabbits.length < 3 && Math.random() < 0.03) {
            for (let index = 0; index < 20; index += 1) {
                state.rabbits.push(createRabbit());
            }
        }

        if (state.foxes.length < 1 && state.rabbits.length > 45 && Math.random() < 0.02) {
            for (let index = 0; index < 4; index += 1) {
                state.foxes.push(createFox());
            }
        }
    }

    render();
    requestAnimationFrame(stepSimulation);
}

function applyPreset(presetName, shouldReset = true) {
    const preset = PRESETS[presetName] ?? PRESETS[DEFAULTS.preset];

    dom.preset.value = presetName;
    dom.grassRate.value = String(preset.grassRate);
    dom.rabbitBirth.value = String(preset.rabbitBirth);
    dom.huntPower.value = String(preset.huntPower);
    dom.foxCost.value = String(preset.foxCost);
    syncControlLabels();

    if (shouldReset) {
        resetSimulation();
        render();
    }
}

dom.preset.addEventListener("change", () => {
    applyPreset(dom.preset.value, true);
});

[dom.grassRate, dom.rabbitBirth, dom.huntPower, dom.foxCost].forEach((element) => {
    element.addEventListener("input", () => {
        syncControlLabels();
        render();
    });
});

dom.pauseBtn.addEventListener("click", () => {
    state.paused = !state.paused;
    dom.pauseBtn.textContent = state.paused ? "再開" : "一時停止";
    render();
});

dom.resetBtn.addEventListener("click", () => {
    applyPreset(dom.preset.value, true);
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
createGrassGrid();
applyPreset(DEFAULTS.preset, false);
resetSimulation();
render();
stepSimulation();