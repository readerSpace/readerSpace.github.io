const POPULATION_SIZE = 84;
const ELITE_COUNT = 4;
const HISTORY_LIMIT = 15;

const dom = {
    canvas: document.querySelector("#canvas"),
    targetColor: document.querySelector("#targetColor"),
    mutationRate: document.querySelector("#mutationRate"),
    selectionPower: document.querySelector("#selectionPower"),
    mutationRateText: document.querySelector("#mutationRateText"),
    selectionPowerText: document.querySelector("#selectionPowerText"),
    targetColorHex: document.querySelector("#targetColorHex"),
    targetSwatch: document.querySelector("#targetSwatch"),
    targetRGBText: document.querySelector("#targetRGBText"),
    nextBtn: document.querySelector("#nextBtn"),
    autoBtn: document.querySelector("#autoBtn"),
    resetBtn: document.querySelector("#resetBtn"),
    generation: document.querySelector("#generation"),
    bestFitness: document.querySelector("#bestFitness"),
    avgFitness: document.querySelector("#avgFitness"),
    diversityValue: document.querySelector("#diversityValue"),
    bestRGB: document.querySelector("#bestRGB"),
    bestFlower: document.querySelector("#bestFlower"),
    bestDescription: document.querySelector("#bestDescription"),
    historySwatches: document.querySelector("#historySwatches")
};

const ctx = dom.canvas.getContext("2d");

let population = [];
let generation = 0;
let history = [];
let autoRunning = false;
let autoTimer = null;
let viewport = {
    width: 760,
    height: 560,
    dpr: 1
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

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const randomGene = () => Math.floor(Math.random() * 256);

const randomFlower = () => ({
    r: randomGene(),
    g: randomGene(),
    b: randomGene(),
    x: Math.random(),
    y: 0.16 + Math.random() * 0.72
});

const hexToRgb = (hex) => {
    const numeric = Number.parseInt(hex.slice(1), 16);

    return {
        r: (numeric >> 16) & 255,
        g: (numeric >> 8) & 255,
        b: numeric & 255
    };
};

const rgbToCss = ({ r, g, b }) => `rgb(${r}, ${g}, ${b})`;

const rgbToText = ({ r, g, b }) => `RGB(${r}, ${g}, ${b})`;

const colorDistance = (colorA, colorB) => {
    const dr = colorA.r - colorB.r;
    const dg = colorA.g - colorB.g;
    const db = colorA.b - colorB.b;

    return Math.sqrt((dr * dr) + (dg * dg) + (db * db));
};

const maxColorDistance = Math.sqrt(255 * 255 * 3);

const getTargetColor = () => hexToRgb(dom.targetColor.value);

const getMutationRate = () => Number(dom.mutationRate.value) / 100;

const getSelectionPower = () => Number(dom.selectionPower.value);

const computeFitness = (flower, targetColor = getTargetColor()) => {
    const closeness = 1 - (colorDistance(flower, targetColor) / maxColorDistance);

    return Math.pow(Math.max(0, closeness), getSelectionPower());
};

const computeAverageColor = (flowers) => {
    const total = flowers.reduce(
        (accumulator, flower) => ({
            r: accumulator.r + flower.r,
            g: accumulator.g + flower.g,
            b: accumulator.b + flower.b
        }),
        { r: 0, g: 0, b: 0 }
    );

    return {
        r: Math.round(total.r / flowers.length),
        g: Math.round(total.g / flowers.length),
        b: Math.round(total.b / flowers.length)
    };
};

const evaluatePopulation = () => {
    const targetColor = getTargetColor();
    const fitnessValues = population.map((flower) => computeFitness(flower, targetColor));
    const averageFitness = fitnessValues.reduce((sum, value) => sum + value, 0) / fitnessValues.length;
    const bestIndex = fitnessValues.reduce(
        (bestSoFar, value, index) => (value > fitnessValues[bestSoFar] ? index : bestSoFar),
        0
    );
    const averageColor = computeAverageColor(population);
    const diversity = population.reduce(
        (sum, flower) => sum + (colorDistance(flower, averageColor) / maxColorDistance),
        0
    ) / population.length;

    return {
        targetColor,
        fitnessValues,
        averageFitness,
        bestIndex,
        bestFlower: population[bestIndex],
        bestFitness: fitnessValues[bestIndex],
        diversity,
        averageColor
    };
};

const selectParent = (fitnessValues) => {
    const totalFitness = fitnessValues.reduce((sum, value) => sum + value, 0);

    if (totalFitness <= 0) {
        return population[Math.floor(Math.random() * population.length)];
    }

    let remaining = Math.random() * totalFitness;

    for (let index = 0; index < population.length; index += 1) {
        remaining -= fitnessValues[index];
        if (remaining <= 0) {
            return population[index];
        }
    }

    return population[population.length - 1];
};

const mutateGene = (value) => {
    if (Math.random() >= getMutationRate()) {
        return value;
    }

    const delta = (Math.random() - 0.5) * 100;

    return clamp(Math.round(value + delta), 0, 255);
};

const createChild = (parentA, parentB) => ({
    r: mutateGene(Math.round((parentA.r * Math.random()) + (parentB.r * (1 - Math.random())))),
    g: mutateGene(Math.round((parentA.g * Math.random()) + (parentB.g * (1 - Math.random())))),
    b: mutateGene(Math.round((parentA.b * Math.random()) + (parentB.b * (1 - Math.random())))),
    x: Math.random(),
    y: 0.16 + Math.random() * 0.72
});

const resizeCanvas = () => {
    const bounds = dom.canvas.getBoundingClientRect();
    const cssWidth = Math.max(320, Math.round(bounds.width || dom.canvas.parentElement.clientWidth || 760));
    const cssHeight = window.innerWidth <= 780
        ? Math.round(clamp(cssWidth * 0.78, 360, 440))
        : 560;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    dom.canvas.style.height = `${cssHeight}px`;
    dom.canvas.width = Math.round(cssWidth * dpr);
    dom.canvas.height = Math.round(cssHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    viewport = {
        width: cssWidth,
        height: cssHeight,
        dpr
    };
};

const drawBackground = () => {
    const gradient = ctx.createLinearGradient(0, 0, 0, viewport.height);

    gradient.addColorStop(0, "#dff7ff");
    gradient.addColorStop(0.6, "#eefce9");
    gradient.addColorStop(1, "#d4ebc1");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, viewport.width, viewport.height);

    const hillGradient = ctx.createLinearGradient(0, viewport.height * 0.66, 0, viewport.height);

    hillGradient.addColorStop(0, "rgba(77, 151, 97, 0.15)");
    hillGradient.addColorStop(1, "rgba(67, 128, 77, 0.45)");
    ctx.fillStyle = hillGradient;
    ctx.beginPath();
    ctx.moveTo(0, viewport.height * 0.7);
    ctx.bezierCurveTo(viewport.width * 0.18, viewport.height * 0.62, viewport.width * 0.36, viewport.height * 0.76, viewport.width * 0.52, viewport.height * 0.7);
    ctx.bezierCurveTo(viewport.width * 0.74, viewport.height * 0.62, viewport.width * 0.88, viewport.height * 0.8, viewport.width, viewport.height * 0.68);
    ctx.lineTo(viewport.width, viewport.height);
    ctx.lineTo(0, viewport.height);
    ctx.closePath();
    ctx.fill();

    for (let index = 0; index < 12; index += 1) {
        ctx.fillStyle = `rgba(255, 255, 255, ${0.06 + (index % 4) * 0.03})`;
        ctx.beginPath();
        ctx.arc((index * 97) % viewport.width, 50 + ((index * 43) % 120), 18 + (index % 3) * 8, 0, Math.PI * 2);
        ctx.fill();
    }
};

const drawTargetMarker = (targetColor) => {
    const centerX = viewport.width / 2;
    const centerY = 58;

    ctx.save();
    ctx.fillStyle = rgbToCss(targetColor);
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - 8);
    ctx.bezierCurveTo(centerX - 46, centerY - 52, centerX - 92, centerY + 10, centerX, centerY + 42);
    ctx.bezierCurveTo(centerX + 92, centerY + 10, centerX + 46, centerY - 52, centerX, centerY - 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(31, 42, 36, 0.22)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "rgba(20, 32, 25, 0.78)";
    ctx.font = "700 16px IBM Plex Sans JP";
    ctx.textAlign = "center";
    ctx.fillText("虫が好む色", centerX, 122);
    ctx.restore();
};

const drawFlower = (flower, flowerFitness) => {
    const x = 52 + (flower.x * (viewport.width - 104));
    const y = 118 + (flower.y * (viewport.height - 194));
    const size = 0.62 + (flowerFitness * 1.5);

    ctx.save();
    ctx.translate(x, y);

    ctx.strokeStyle = "#2e6b45";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 18 * size);
    ctx.lineTo(0, 60 * size);
    ctx.stroke();

    ctx.fillStyle = rgbToCss(flower);
    ctx.strokeStyle = "rgba(20, 32, 25, 0.18)";
    ctx.lineWidth = 1;
    for (let index = 0; index < 6; index += 1) {
        ctx.save();
        ctx.rotate((Math.PI * 2 * index) / 6);
        ctx.beginPath();
        ctx.ellipse(0, -15 * size, 10 * size, 22 * size, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    ctx.fillStyle = "#f5c33e";
    ctx.beginPath();
    ctx.arc(0, 0, 9 * size, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(20, 32, 25, 0.22)";
    ctx.stroke();

    if (flowerFitness > 0.75) {
        ctx.strokeStyle = "rgba(217, 79, 142, 0.22)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, 24 * size, 0, Math.PI * 2);
        ctx.stroke();
    }

    ctx.restore();
};

const updateTargetPanel = (targetColor) => {
    const hex = dom.targetColor.value.toUpperCase();

    dom.targetColorHex.textContent = hex;
    dom.targetSwatch.style.background = `linear-gradient(145deg, rgba(${targetColor.r}, ${targetColor.g}, ${targetColor.b}, 0.96), rgba(${Math.round(targetColor.r * 0.7)}, ${Math.round(targetColor.g * 0.7)}, ${Math.round(targetColor.b * 0.7)}, 0.96))`;
    dom.targetRGBText.textContent = rgbToText(targetColor);
};

const updateBestPreview = (bestFlower, bestFitness) => {
    const flowerColor = rgbToCss(bestFlower);

    dom.bestFlower.innerHTML = "";

    for (let index = 0; index < 6; index += 1) {
        const petal = document.createElement("div");

        petal.className = "flower-petal";
        petal.style.background = flowerColor;
        petal.style.transform = `rotate(${index * 60}deg) translateY(-30px)`;
        dom.bestFlower.appendChild(petal);
    }

    const center = document.createElement("div");
    center.className = "flower-center";

    const stem = document.createElement("div");
    stem.className = "flower-stem";

    dom.bestFlower.append(center, stem);
    dom.bestDescription.innerHTML = `<strong>${rgbToText(bestFlower)}</strong><br>適応度 ${bestFitness.toFixed(2)} の個体です。目標色に近いほど次世代へ残りやすくなります。`;
};

const renderHistory = () => {
    dom.historySwatches.innerHTML = "";

    if (history.length === 0) {
        const empty = document.createElement("p");
        empty.className = "history-empty";
        empty.textContent = "まだ履歴がありません。";
        dom.historySwatches.appendChild(empty);
        return;
    }

    history.forEach((item) => {
        const swatch = document.createElement("span");
        swatch.className = "history-swatch";
        swatch.style.background = rgbToCss(item.color);
        swatch.title = `世代 ${item.generation}: ${rgbToText(item.color)}`;
        dom.historySwatches.appendChild(swatch);
    });
};

const renderStats = (evaluation) => {
    dom.generation.textContent = String(generation);
    dom.bestFitness.textContent = evaluation.bestFitness.toFixed(2);
    dom.avgFitness.textContent = evaluation.averageFitness.toFixed(2);
    dom.diversityValue.textContent = evaluation.diversity.toFixed(2);
    dom.bestRGB.textContent = `${evaluation.bestFlower.r}, ${evaluation.bestFlower.g}, ${evaluation.bestFlower.b}`;
};

const render = () => {
    const evaluation = evaluatePopulation();

    updateTargetPanel(evaluation.targetColor);
    updateBestPreview(evaluation.bestFlower, evaluation.bestFitness);
    renderStats(evaluation);
    renderHistory();

    ctx.clearRect(0, 0, viewport.width, viewport.height);
    drawBackground();
    drawTargetMarker(evaluation.targetColor);
    population.forEach((flower, index) => {
        drawFlower(flower, evaluation.fitnessValues[index]);
    });
};

const syncControls = () => {
    dom.mutationRateText.textContent = dom.mutationRate.value;
    dom.selectionPowerText.textContent = Number(dom.selectionPower.value).toFixed(1);
    updateTargetPanel(getTargetColor());
};

const stopAuto = () => {
    autoRunning = false;
    clearInterval(autoTimer);
    autoTimer = null;
    dom.autoBtn.textContent = "自動進化";
    dom.autoBtn.classList.remove("is-running");
};

const stepGeneration = () => {
    const evaluation = evaluatePopulation();
    const elite = [...population]
        .map((flower, index) => ({ flower, fitness: evaluation.fitnessValues[index] }))
        .sort((left, right) => right.fitness - left.fitness)
        .slice(0, ELITE_COUNT)
        .map((entry) => ({
            ...entry.flower,
            x: Math.random(),
            y: 0.16 + Math.random() * 0.72
        }));
    const nextPopulation = [...elite];

    while (nextPopulation.length < POPULATION_SIZE) {
        const parentA = selectParent(evaluation.fitnessValues);
        const parentB = selectParent(evaluation.fitnessValues);
        nextPopulation.push(createChild(parentA, parentB));
    }

    history = [
        ...history,
        {
            generation,
            color: {
                r: evaluation.bestFlower.r,
                g: evaluation.bestFlower.g,
                b: evaluation.bestFlower.b
            }
        }
    ].slice(-HISTORY_LIMIT);

    population = nextPopulation;
    generation += 1;
    render();
};

const initialize = () => {
    population = Array.from({ length: POPULATION_SIZE }, randomFlower);
    generation = 0;
    history = [];
    syncControls();
    render();
};

dom.nextBtn?.addEventListener("click", stepGeneration);

dom.autoBtn?.addEventListener("click", () => {
    if (autoRunning) {
        stopAuto();
        return;
    }

    autoRunning = true;
    dom.autoBtn.textContent = "停止";
    dom.autoBtn.classList.add("is-running");
    autoTimer = setInterval(stepGeneration, 240);
});

dom.resetBtn?.addEventListener("click", () => {
    stopAuto();
    initialize();
});

dom.targetColor?.addEventListener("input", () => {
    syncControls();
    render();
});

dom.mutationRate?.addEventListener("input", syncControls);

dom.selectionPower?.addEventListener("input", () => {
    syncControls();
    render();
});

window.addEventListener("resize", () => {
    resizeCanvas();
    render();
});

document.addEventListener("visibilitychange", () => {
    if (document.hidden && autoRunning) {
        stopAuto();
    }
});

resizeCanvas();
initialize();