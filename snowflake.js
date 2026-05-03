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

const canvas = document.querySelector("#snowflakeCanvas");
const context = canvas?.getContext("2d");
const bufferCanvas = document.createElement("canvas");
const bufferContext = bufferCanvas.getContext("2d");

const diffusionRange = document.querySelector("#diffusionRange");
const supplyRange = document.querySelector("#supplyRange");
const thresholdRange = document.querySelector("#thresholdRange");
const anisotropyRange = document.querySelector("#anisotropyRange");
const resetButton = document.querySelector("#resetButton");
const presetButtons = Array.from(document.querySelectorAll(".preset-chip"));

const diffusionValue = document.querySelector("#diffusionValue");
const supplyValue = document.querySelector("#supplyValue");
const thresholdValue = document.querySelector("#thresholdValue");
const anisotropyValue = document.querySelector("#anisotropyValue");
const morphologyValue = document.querySelector("#morphologyValue");
const symmetryValue = document.querySelector("#symmetryValue");
const branchingValue = document.querySelector("#branchingValue");
const radiusValue = document.querySelector("#radiusValue");
const frozenValue = document.querySelector("#frozenValue");
const environmentValue = document.querySelector("#environmentValue");
const demoNote = document.querySelector("#demoNote");

// 4つのスライダー値の意味（DLA 版）：
//   walks   : 1フレーム中に各粒子がランダムウォークする最大ステップ数
//   particles: 同時に空中を漂う粒子の数
//   stickProb: 氷の隣に来た粒子が付着する確率
//   hexBias : 完全ランダムウォークではなく六方向へ進む割合（0〜0.45）
const presets = {
    plate: {
        diffusion: 12,
        supply: 32,
        threshold: 45,
        anisotropy: 8,
        label: "-2°C 付近",
        note: "板状のプリセットでは、付着確率を下げて粒子が中まで入り込めるようにし、面が密に詰まる条件にしています。"
    },
    column: {
        diffusion: 28,
        supply: 6,
        threshold: 95,
        anisotropy: 4,
        label: "-5°C 付近",
        note: "柱状のプリセットでは、付着確率を高くして粒子が触れた瞬間に止まり、対称軸が少なめで細長い枝が伸びる条件にしています。"
    },
    dendrite: {
        diffusion: 22,
        supply: 10,
        threshold: 90,
        anisotropy: 28,
        label: "-15°C 付近",
        note: "樹枝状のプリセットでは、粒子を六角方向に偏らせ、付着確率を高くして枝先が育ちやすい条件にしています。"
    }
};

const simulation = {
    gridSize: 240,
    ice: null,
    walkers: [],
    imageData: null,
    activePresetKey: "dendrite",
    frozenCount: 1,
    growthRadius: 0,
    frameCount: 0
};

if (bufferContext) {
    bufferCanvas.width = simulation.gridSize;
    bufferCanvas.height = simulation.gridSize;
    simulation.imageData = bufferContext.createImageData(simulation.gridSize, simulation.gridSize);
}

const getCenter = () => Math.floor(simulation.gridSize / 2);
const cellIndex = (x, y) => y * simulation.gridSize + x;
const inBounds = (x, y) =>
    x >= 0 && x < simulation.gridSize && y >= 0 && y < simulation.gridSize;

const getSettings = () => {
    const walks = Number(diffusionRange?.value || 22);
    const particles = Number(supplyRange?.value || 10);
    const stickProb = Number(thresholdRange?.value || 90) / 100;
    const hexBias = Number(anisotropyRange?.value || 28) / 100;

    return { walks, particles, stickProb, hexBias };
};

const symmetryOrder = (hexBias) => {
    if (hexBias >= 0.18) {
        return 6;
    }

    if (hexBias >= 0.10) {
        return 4;
    }

    return 2;
};

const updatePresetButtons = () => {
    presetButtons.forEach((button) => {
        button.classList.toggle("is-active", button.dataset.preset === simulation.activePresetKey);
    });
};

const describeMorphology = (settings) => {
    if (simulation.activePresetKey === "plate") {
        return "板状に近い";
    }

    if (simulation.activePresetKey === "column") {
        return "柱状に近い";
    }

    if (simulation.activePresetKey === "dendrite") {
        return "樹枝状";
    }

    if (settings.stickProb >= 0.85 && settings.hexBias >= 0.20) {
        return "樹枝状";
    }

    if (settings.stickProb <= 0.55) {
        return "板状に近い";
    }

    if (settings.hexBias <= 0.08) {
        return "柱状に近い";
    }

    return "遷移的";
};

const describeSymmetry = (hexBias) => {
    const order = symmetryOrder(hexBias);

    if (order === 6) {
        return "六角がはっきり";
    }

    if (order === 4) {
        return "四方向対称";
    }

    return "二方向対称";
};

const describeBranching = (settings) => {
    const score =
        settings.stickProb * 4 +
        settings.hexBias * 5 +
        settings.walks / 14 -
        settings.particles / 18;

    if (score >= 5.4) {
        return "かなり高い";
    }

    if (score >= 4.2) {
        return "高い";
    }

    if (score >= 3.0) {
        return "中程度";
    }

    return "穏やか";
};

const describeDemo = (settings) => {
    const preset = simulation.activePresetKey ? presets[simulation.activePresetKey] : null;

    if (preset) {
        return `${preset.note} リセットすると、その条件から成長を見直せます。`;
    }

    if (settings.stickProb >= 0.85 && settings.hexBias >= 0.20) {
        return "粒子が氷に触れた瞬間に強く付着し、六角方向へ偏るため、雪片らしい枝先が伸びやすい条件です。";
    }

    if (settings.stickProb <= 0.55) {
        return "付着しにくいので粒子が中まで入り込み、面が詰まった板のような形になりやすい条件です。";
    }

    return "付着確率と六角バイアスのバランスで、枝が細く伸びるか、ふっくら太るかが変わります。";
};

const updateOutputs = () => {
    const settings = getSettings();

    if (diffusionValue) {
        diffusionValue.textContent = `${settings.walks} 歩`;
    }

    if (supplyValue) {
        supplyValue.textContent = `${settings.particles} 個`;
    }

    if (thresholdValue) {
        thresholdValue.textContent = settings.stickProb.toFixed(2);
    }

    if (anisotropyValue) {
        anisotropyValue.textContent = settings.hexBias.toFixed(2);
    }

    if (morphologyValue) {
        morphologyValue.textContent = describeMorphology(settings);
    }

    if (symmetryValue) {
        symmetryValue.textContent = describeSymmetry(settings.hexBias);
    }

    if (branchingValue) {
        branchingValue.textContent = describeBranching(settings);
    }

    if (radiusValue) {
        radiusValue.textContent = `${Math.round(simulation.growthRadius)} セル`;
    }

    if (frozenValue) {
        frozenValue.textContent = `${simulation.frozenCount}`;
    }

    if (environmentValue) {
        environmentValue.textContent = simulation.activePresetKey
            ? presets[simulation.activePresetKey].label
            : "カスタム条件";
    }

    if (demoNote) {
        demoNote.textContent = describeDemo(settings);
    }
};

const setIceCell = (x, y) => {
    if (!inBounds(x, y)) {
        return;
    }

    const i = cellIndex(x, y);

    if (simulation.ice[i]) {
        return;
    }

    simulation.ice[i] = 1;
    simulation.frozenCount += 1;

    const center = getCenter();
    const radius = Math.hypot(x - center, y - center);

    if (radius > simulation.growthRadius) {
        simulation.growthRadius = radius;
    }
};

const stickWithSymmetry = (gx, gy, order) => {
    const center = getCenter();
    const dx = gx - center;
    const dy = gy - center;

    for (let k = 0; k < order; k += 1) {
        const angle = (k * 2 * Math.PI) / order;
        const ca = Math.cos(angle);
        const sa = Math.sin(angle);
        const rx = Math.round(dx * ca - dy * sa);
        const ry = Math.round(dx * sa + dy * ca);
        setIceCell(center + rx, center + ry);

        // x 軸に対する鏡映で 12 方向の対称を作る
        const mx = Math.round(dx * ca + dy * sa);
        const my = Math.round(dx * sa - dy * ca);
        setIceCell(center + mx, center + my);
    }
};

const isAdjacentToIce = (x, y) => {
    if (!simulation.ice) {
        return false;
    }

    return (
        (inBounds(x + 1, y) && simulation.ice[cellIndex(x + 1, y)]) ||
        (inBounds(x - 1, y) && simulation.ice[cellIndex(x - 1, y)]) ||
        (inBounds(x, y + 1) && simulation.ice[cellIndex(x, y + 1)]) ||
        (inBounds(x, y - 1) && simulation.ice[cellIndex(x, y - 1)])
    );
};

const spawnRadius = () => {
    const center = getCenter();
    const margin = 6;
    const wanted = simulation.growthRadius + 14;
    const maxRadius = center - margin;

    if (wanted < 18) {
        return 18;
    }

    return Math.min(wanted, maxRadius);
};

const spawnWalker = (target) => {
    const center = getCenter();
    const radius = spawnRadius();
    const angle = Math.random() * Math.PI * 2;

    target.x = Math.round(center + Math.cos(angle) * radius);
    target.y = Math.round(center + Math.sin(angle) * radius);
};

// 六角格子っぽい 6 方向（正方格子上の近似）
const HEX_DIRS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, -1]
];

const stepWalker = (walker, hexBias) => {
    if (Math.random() < hexBias) {
        const dir = HEX_DIRS[Math.floor(Math.random() * HEX_DIRS.length)];
        walker.x += dir[0];
        walker.y += dir[1];
        return;
    }

    const r = Math.floor(Math.random() * 4);

    if (r === 0) {
        walker.x += 1;
    } else if (r === 1) {
        walker.x -= 1;
    } else if (r === 2) {
        walker.y += 1;
    } else {
        walker.y -= 1;
    }
};

const stepSimulation = (settings) => {
    if (!simulation.ice) {
        return;
    }

    const center = getCenter();
    const killRadius = center - 2;
    const order = symmetryOrder(settings.hexBias);

    while (simulation.walkers.length < settings.particles) {
        const fresh = { x: 0, y: 0 };
        spawnWalker(fresh);
        simulation.walkers.push(fresh);
    }

    for (let i = 0; i < simulation.walkers.length; i += 1) {
        const walker = simulation.walkers[i];
        let stuck = false;

        for (let s = 0; s < settings.walks; s += 1) {
            stepWalker(walker, settings.hexBias);

            const distance = Math.hypot(walker.x - center, walker.y - center);

            if (distance > killRadius || !inBounds(walker.x, walker.y)) {
                spawnWalker(walker);
                continue;
            }

            const onIce = simulation.ice[cellIndex(walker.x, walker.y)];

            if (onIce) {
                if (Math.random() < settings.stickProb) {
                    stickWithSymmetry(walker.x, walker.y, order);
                    stuck = true;
                    break;
                }

                stepWalker(walker, settings.hexBias);
                continue;
            }

            if (isAdjacentToIce(walker.x, walker.y)) {
                if (Math.random() < settings.stickProb) {
                    stickWithSymmetry(walker.x, walker.y, order);
                    stuck = true;
                    break;
                }
            }
        }

        if (stuck) {
            spawnWalker(walker);
        }
    }
};

const resizeCanvas = () => {
    if (!canvas) {
        return;
    }

    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const displaySize = Math.min(canvas.parentElement?.clientWidth || 560, 620);

    canvas.width = Math.round(displaySize * ratio);
    canvas.height = Math.round(displaySize * ratio);
    canvas.style.width = `${displaySize}px`;
    canvas.style.height = `${displaySize}px`;
};

const draw = () => {
    if (!canvas || !context || !simulation.ice || !simulation.imageData || !bufferContext) {
        return;
    }

    const data = simulation.imageData.data;
    const size = simulation.gridSize;

    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const pixelIndex = (y * size + x) * 4;

            if (simulation.ice[cellIndex(x, y)]) {
                data[pixelIndex] = 215;
                data[pixelIndex + 1] = 240;
                data[pixelIndex + 2] = 255;
                data[pixelIndex + 3] = 255;
            } else {
                data[pixelIndex] = 8;
                data[pixelIndex + 1] = 16;
                data[pixelIndex + 2] = 38;
                data[pixelIndex + 3] = 255;
            }
        }
    }

    // 漂っている粒子を薄く描く
    for (let i = 0; i < simulation.walkers.length; i += 1) {
        const w = simulation.walkers[i];

        if (!inBounds(w.x, w.y)) {
            continue;
        }

        const pixelIndex = (w.y * size + w.x) * 4;
        data[pixelIndex] = 120;
        data[pixelIndex + 1] = 160;
        data[pixelIndex + 2] = 220;
        data[pixelIndex + 3] = 255;
    }

    bufferContext.putImageData(simulation.imageData, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = false;
    context.drawImage(bufferCanvas, 0, 0, canvas.width, canvas.height);
};

const resetSimulation = () => {
    const size = simulation.gridSize;
    simulation.ice = new Uint8Array(size * size);
    simulation.walkers = [];
    simulation.frozenCount = 0;
    simulation.growthRadius = 0;
    simulation.frameCount = 0;

    const center = getCenter();
    simulation.ice[cellIndex(center, center)] = 1;
    simulation.frozenCount = 1;

    updateOutputs();
    draw();
};

const applyPreset = (presetKey) => {
    const preset = presets[presetKey];

    if (!preset || !diffusionRange || !supplyRange || !thresholdRange || !anisotropyRange) {
        return;
    }

    simulation.activePresetKey = presetKey;
    diffusionRange.value = `${preset.diffusion}`;
    supplyRange.value = `${preset.supply}`;
    thresholdRange.value = `${preset.threshold}`;
    anisotropyRange.value = `${preset.anisotropy}`;
    updatePresetButtons();
    resetSimulation();
};

const setCustomMode = () => {
    simulation.activePresetKey = null;
    updatePresetButtons();
    updateOutputs();
};

const loop = () => {
    if (context && simulation.ice) {
        const settings = getSettings();
        stepSimulation(settings);
        draw();
        simulation.frameCount += 1;

        if (simulation.frameCount % 8 === 0) {
            updateOutputs();
        }
    }

    window.requestAnimationFrame(loop);
};

presetButtons.forEach((button) => {
    button.addEventListener("click", () => {
        applyPreset(button.dataset.preset || "dendrite");
    });
});

[diffusionRange, supplyRange, thresholdRange, anisotropyRange].forEach((element) => {
    element?.addEventListener("input", setCustomMode);
    element?.addEventListener("change", resetSimulation);
});

resetButton?.addEventListener("click", resetSimulation);

window.addEventListener("resize", () => {
    resizeCanvas();
    draw();
});

resizeCanvas();
applyPreset(simulation.activePresetKey || "dendrite");
loop();
