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

const canvas = document.querySelector("#reactionCanvas");
const context = canvas?.getContext("2d", { alpha: false });
const bufferCanvas = document.createElement("canvas");
const bufferContext = bufferCanvas.getContext("2d", { alpha: false });

const playPauseButton = document.querySelector("#playPause");
const seedButton = document.querySelector("#seed");
const clearButton = document.querySelector("#clear");
const invertButton = document.querySelector("#invert");
const feedSlider = document.querySelector("#feed");
const killSlider = document.querySelector("#kill");
const brushSlider = document.querySelector("#brush");
const speedSlider = document.querySelector("#speed");
const feedValue = document.querySelector("#feedValue");
const killValue = document.querySelector("#killValue");
const brushValue = document.querySelector("#brushValue");
const speedValue = document.querySelector("#speedValue");
const generationSpan = document.querySelector("#generation");
const resolutionSpan = document.querySelector("#resolution");
const panelStatus = document.querySelector("#panelStatus");
const presetValue = document.querySelector("#presetValue");
const presetPanelValue = document.querySelector("#presetPanelValue");
const paletteValue = document.querySelector("#paletteValue");
const runningValue = document.querySelector("#runningValue");
const presetButtons = document.querySelectorAll("[data-preset]");

const presetLabels = {
    zebra: "シマウマ",
    leopard: "ヒョウ柄",
    coral: "サンゴ",
    maze: "迷路",
    spots: "水玉",
    chaos: "カオス"
};

const presets = {
    zebra: { feed: 0.035, kill: 0.060 },
    leopard: { feed: 0.055, kill: 0.062 },
    coral: { feed: 0.054, kill: 0.063 },
    maze: { feed: 0.029, kill: 0.057 },
    spots: { feed: 0.025, kill: 0.055 },
    chaos: { feed: 0.018, kill: 0.050 }
};

const params = {
    dA: 1.0,
    dB: 0.5,
    feed: presets.zebra.feed,
    kill: presets.zebra.kill
};

let displayWidth = 0;
let displayHeight = 0;
let simulationWidth = 0;
let simulationHeight = 0;
let renderScale = 3;
let a = new Float32Array(0);
let b = new Float32Array(0);
let nextA = new Float32Array(0);
let nextB = new Float32Array(0);
let imageData;
let running = true;
let drawing = false;
let inverted = false;
let generation = 0;
let currentPreset = "zebra";
let statusTimeout = 0;
let animationTimeout = 0;

const defaultStatus = "キャンバスをドラッグすると薬品 B を足せます。Feed と Kill を少しずつ動かすと、模様の相が変わります。";

const setStatus = (message, persist = false) => {
    panelStatus.textContent = message;

    if (statusTimeout) {
        window.clearTimeout(statusTimeout);
        statusTimeout = 0;
    }

    if (!persist) {
        statusTimeout = window.setTimeout(() => {
            panelStatus.textContent = defaultStatus;
        }, 2600);
    }
};

const updateReadouts = () => {
    feedValue.textContent = Number(feedSlider.value).toFixed(3);
    killValue.textContent = Number(killSlider.value).toFixed(3);
    brushValue.textContent = `${brushSlider.value}px`;
    speedValue.textContent = `${speedSlider.value} 回/フレーム`;
    generationSpan.textContent = String(generation);
    resolutionSpan.textContent = simulationWidth && simulationHeight ? `${simulationWidth}×${simulationHeight}` : "-";
    presetValue.textContent = presetLabels[currentPreset];
    presetPanelValue.textContent = presetLabels[currentPreset];
    paletteValue.textContent = inverted ? "反転" : "標準";
    runningValue.textContent = running ? "再生中" : "停止中";
};

const indexOf = (x, y) => y * simulationWidth + x;

const addChemicalB = (centerX, centerY, radius) => {
    const radiusFloor = Math.floor(radius);

    for (let offsetY = -radiusFloor; offsetY <= radiusFloor; offsetY += 1) {
        for (let offsetX = -radiusFloor; offsetX <= radiusFloor; offsetX += 1) {
            const x = centerX + offsetX;
            const y = centerY + offsetY;

            if (x < 1 || x >= simulationWidth - 1 || y < 1 || y >= simulationHeight - 1) {
                continue;
            }

            const distance = Math.hypot(offsetX, offsetY);
            if (distance > radius) {
                continue;
            }

            const index = indexOf(x, y);
            b[index] = Math.max(b[index], 1 - distance / (radius + 1));
            a[index] = Math.min(a[index], 0.45);
        }
    }
};

const seedPattern = (announce = true) => {
    if (!simulationWidth || !simulationHeight) {
        return;
    }

    for (let attempt = 0; attempt < 18; attempt += 1) {
        const x = Math.floor(Math.random() * simulationWidth);
        const y = Math.floor(Math.random() * simulationHeight);
        addChemicalB(x, y, 3 + Math.random() * Math.min(12, simulationWidth * 0.06));
    }

    addChemicalB(
        Math.floor(simulationWidth / 2),
        Math.floor(simulationHeight / 2),
        Math.min(simulationWidth, simulationHeight) * 0.08
    );

    if (announce) {
        setStatus("タネをまきました。初期条件の差で模様の育ち方も変わります。", false);
    }
};

const resetGrid = ({ seed = true, announce = false } = {}) => {
    const cellCount = simulationWidth * simulationHeight;
    a = new Float32Array(cellCount);
    b = new Float32Array(cellCount);
    nextA = new Float32Array(cellCount);
    nextB = new Float32Array(cellCount);

    a.fill(1);
    b.fill(0);
    generation = 0;

    if (seed) {
        seedPattern(announce);
    }

    updateReadouts();
};

const laplace = (field, x, y) => (
    field[indexOf(x, y)] * -1.0 +
    field[indexOf(x - 1, y)] * 0.2 +
    field[indexOf(x + 1, y)] * 0.2 +
    field[indexOf(x, y - 1)] * 0.2 +
    field[indexOf(x, y + 1)] * 0.2 +
    field[indexOf(x - 1, y - 1)] * 0.05 +
    field[indexOf(x + 1, y - 1)] * 0.05 +
    field[indexOf(x - 1, y + 1)] * 0.05 +
    field[indexOf(x + 1, y + 1)] * 0.05
);

const stepSimulation = () => {
    params.feed = Number(feedSlider.value);
    params.kill = Number(killSlider.value);

    for (let y = 1; y < simulationHeight - 1; y += 1) {
        for (let x = 1; x < simulationWidth - 1; x += 1) {
            const index = indexOf(x, y);
            const valueA = a[index];
            const valueB = b[index];
            const reaction = valueA * valueB * valueB;

            const nextValueA = valueA + (params.dA * laplace(a, x, y) - reaction + params.feed * (1 - valueA));
            const nextValueB = valueB + (params.dB * laplace(b, x, y) + reaction - (params.kill + params.feed) * valueB);

            nextA[index] = Math.max(0, Math.min(1, nextValueA));
            nextB[index] = Math.max(0, Math.min(1, nextValueB));
        }
    }

    for (let x = 0; x < simulationWidth; x += 1) {
        const top = indexOf(x, 0);
        const bottom = indexOf(x, simulationHeight - 1);
        nextA[top] = nextA[bottom] = 1;
        nextB[top] = nextB[bottom] = 0;
    }

    for (let y = 0; y < simulationHeight; y += 1) {
        const left = indexOf(0, y);
        const right = indexOf(simulationWidth - 1, y);
        nextA[left] = nextA[right] = 1;
        nextB[left] = nextB[right] = 0;
    }

    let swap = a;
    a = nextA;
    nextA = swap;
    swap = b;
    b = nextB;
    nextB = swap;
    generation += 1;
};

const render = () => {
    if (!imageData || !bufferContext || !context) {
        return;
    }

    const pixels = imageData.data;

    for (let y = 0; y < simulationHeight; y += 1) {
        for (let x = 0; x < simulationWidth; x += 1) {
            const index = indexOf(x, y);
            const pixel = index * 4;
            let value = Math.floor((a[index] - b[index]) * 255);
            value = Math.max(0, Math.min(255, value));

            if (inverted) {
                value = 255 - value;
            }

            pixels[pixel] = inverted ? value : Math.floor(value * 0.74);
            pixels[pixel + 1] = inverted ? Math.floor(value * 0.86) : Math.floor(62 + value * 0.72);
            pixels[pixel + 2] = inverted ? Math.floor(255 - value * 0.36) : Math.floor(124 + value * 0.48);
            pixels[pixel + 3] = 255;
        }
    }

    bufferContext.putImageData(imageData, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = false;
    context.drawImage(bufferCanvas, 0, 0, canvas.width, canvas.height);
    updateReadouts();
};

const animate = () => {
    if (running) {
        const steps = Number(speedSlider.value);
        for (let step = 0; step < steps; step += 1) {
            stepSimulation();
        }
    }

    render();
    animationTimeout = window.setTimeout(animate, 16);
};

const resizeCanvas = () => {
    if (!canvas || !context || !bufferContext) {
        return;
    }

    const bounds = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    displayWidth = Math.max(Math.floor(bounds.width), 1);
    displayHeight = Math.max(Math.floor(bounds.height), 1);
    canvas.width = Math.max(Math.floor(displayWidth * dpr), 1);
    canvas.height = Math.max(Math.floor(displayHeight * dpr), 1);
    renderScale = displayWidth < 420 ? 5 : displayWidth < 840 ? 4 : 3;
    simulationWidth = Math.max(Math.floor(displayWidth / renderScale), 48);
    simulationHeight = Math.max(Math.floor(displayHeight / renderScale), 36);
    bufferCanvas.width = simulationWidth;
    bufferCanvas.height = simulationHeight;
    imageData = bufferContext.createImageData(simulationWidth, simulationHeight);
    resetGrid({ seed: true, announce: false });
};

const pointerToSimulation = (event) => {
    const bounds = canvas.getBoundingClientRect();
    const clientX = event.clientX ?? event.touches?.[0]?.clientX ?? 0;
    const clientY = event.clientY ?? event.touches?.[0]?.clientY ?? 0;

    return {
        x: Math.max(0, Math.min(simulationWidth - 1, Math.floor(((clientX - bounds.left) / bounds.width) * simulationWidth))),
        y: Math.max(0, Math.min(simulationHeight - 1, Math.floor(((clientY - bounds.top) / bounds.height) * simulationHeight)))
    };
};

const drawAtPointer = (event) => {
    const point = pointerToSimulation(event);
    const brushRadius = Math.max(Number(brushSlider.value) / renderScale, 1.5);
    addChemicalB(point.x, point.y, brushRadius);
};

const applyPreset = (name, announce = true) => {
    const preset = presets[name];
    currentPreset = name;
    feedSlider.value = preset.feed.toFixed(3);
    killSlider.value = preset.kill.toFixed(3);
    params.feed = preset.feed;
    params.kill = preset.kill;

    presetButtons.forEach((button) => {
        button.classList.toggle("active", button.dataset.preset === name);
    });

    resetGrid({ seed: true, announce: false });
    updateReadouts();

    if (announce) {
        setStatus(`${presetLabels[name]} の相に切り替えました。Feed と Kill の近くで別の模様も探せます。`, false);
    }
};

const toggleRunning = () => {
    running = !running;
    playPauseButton.textContent = running ? "一時停止" : "再生";
    playPauseButton.classList.toggle("green", running);
    updateReadouts();
    setStatus(running ? "再生を再開しました。" : "停止しました。パラメータを変えてから再生すると比較しやすいです。", false);
};

const resetSimulation = () => {
    resetGrid({ seed: true, announce: false });
    setStatus("現在のプリセットで初期状態に戻しました。", false);
};

canvas?.addEventListener("pointerdown", (event) => {
    drawing = true;
    canvas.setPointerCapture?.(event.pointerId);
    drawAtPointer(event);
});

canvas?.addEventListener("pointermove", (event) => {
    if (drawing) {
        drawAtPointer(event);
    }
});

canvas?.addEventListener("pointerup", () => {
    drawing = false;
});

canvas?.addEventListener("pointercancel", () => {
    drawing = false;
});

window.addEventListener("pointerup", () => {
    drawing = false;
});

playPauseButton?.addEventListener("click", toggleRunning);
seedButton?.addEventListener("click", () => seedPattern(true));
clearButton?.addEventListener("click", resetSimulation);
invertButton?.addEventListener("click", () => {
    inverted = !inverted;
    invertButton.classList.toggle("active", inverted);
    updateReadouts();
    setStatus(inverted ? "配色を反転しました。" : "標準配色に戻しました。", false);
});

presetButtons.forEach((button) => {
    button.addEventListener("click", () => {
        applyPreset(button.dataset.preset);
    });
});

[feedSlider, killSlider, brushSlider, speedSlider].forEach((slider) => {
    slider?.addEventListener("input", () => {
        updateReadouts();
    });
});

window.addEventListener("resize", resizeCanvas);

if (canvas && context && bufferContext) {
    applyPreset(currentPreset, false);
    resizeCanvas();
    updateReadouts();
    setStatus(defaultStatus, true);
    window.clearTimeout(animationTimeout);
    animate();
}