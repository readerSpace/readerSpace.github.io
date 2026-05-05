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

const canvas = document.querySelector("#fireCanvas");
const simulationShell = document.querySelector("#playgroundShell");
const context = canvas?.getContext("2d");

if (!canvas || !simulationShell || !context) {
    throw new Error("Fire and smoke page failed to initialize.");
}

const renderCanvas = document.createElement("canvas");
const renderContext = renderCanvas.getContext("2d");

if (!renderContext) {
    throw new Error("Offscreen canvas failed to initialize.");
}

const playPauseButton = document.querySelector("#playPause");
const clearButton = document.querySelector("#clear");
const campfireButton = document.querySelector("#campfire");
const sparkButton = document.querySelector("#spark");
const heatSlider = document.querySelector("#heat");
const smokeSlider = document.querySelector("#smoke");
const buoyancySlider = document.querySelector("#buoyancy");
const windSlider = document.querySelector("#wind");
const brushSlider = document.querySelector("#brush");
const heatValue = document.querySelector("#heatValue");
const smokeValue = document.querySelector("#smokeValue");
const buoyancyValue = document.querySelector("#buoyancyValue");
const windValue = document.querySelector("#windValue");
const brushValue = document.querySelector("#brushValue");
const particleCountValue = document.querySelector("#particleCount");
const resolutionValue = document.querySelector("#resolution");
const toolLabel = document.querySelector("#toolLabel");
const panelStatus = document.querySelector("#panelStatus");
const hintText = document.querySelector("#hintText");
const toolButtons = Array.from(document.querySelectorAll("[data-tool]"));

const toolNames = {
    fire: "火",
    smoke: "煙",
    wind: "風",
    cool: "冷やす",
    wall: "壁",
    erase: "消す"
};

const toolHints = {
    fire: "操作: 火ツールは熱と煙を同時に足します。ドラッグした線に沿って炎が伸び、上昇流が立ちます。",
    smoke: "操作: 煙ツールは温度をあまり上げずに可視化だけを足します。既存の流れを読むのに向いています。",
    wind: "操作: 風ツールはドラッグ方向に局所風を入れます。煙の柱を横に倒したり、渦の種を作ったりできます。",
    cool: "操作: 冷やすツールは熱と速度を弱めます。上昇流の消え方と煙の残り方を比べてください。",
    wall: "操作: 壁ツールは流れを通さない障害物を描きます。細い煙突や斜めの仕切りを置くと変化が分かりやすいです。",
    erase: "操作: 消すツールは壁を消しつつ、その場所の熱と煙も弱めます。場を部分的に作り直したいときに使います。"
};

let width = 0;
let height = 0;
let scale = 4;
let gridWidth = 0;
let gridHeight = 0;

let heat = new Float32Array(0);
let smoke = new Float32Array(0);
let velocityX = new Float32Array(0);
let velocityY = new Float32Array(0);
let walls = new Uint8Array(0);
let nextHeat = new Float32Array(0);
let nextSmoke = new Float32Array(0);
let nextVelocityX = new Float32Array(0);
let nextVelocityY = new Float32Array(0);
let imageData;

let particles = [];
let running = true;
let drawing = false;
let activeTool = "fire";
let lastPointer = null;
let activePointerId = null;
let statusTimeout = 0;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const index = (x, y) => y * gridWidth + x;
const inBounds = (x, y) => x >= 1 && x < gridWidth - 1 && y >= 1 && y < gridHeight - 1;

class Ember {
    constructor(x, y, hot = false) {
        this.x = x;
        this.y = y;
        this.vx = (Math.random() - 0.5) * 3.2;
        this.vy = hot ? -2.8 - Math.random() * 4.2 : -0.8 - Math.random() * 1.6;
        this.life = 1;
        this.size = hot ? 1.8 + Math.random() * 2.2 : 1.2 + Math.random() * 1.5;
    }

    update() {
        const gx = Math.floor(this.x / scale);
        const gy = Math.floor(this.y / scale);

        if (inBounds(gx, gy)) {
            const cell = index(gx, gy);
            this.vx += velocityX[cell] * 0.07;
            this.vy += velocityY[cell] * 0.07;
        }

        this.vy += 0.015;
        this.x += this.vx;
        this.y += this.vy;
        this.life *= 0.975;
    }

    draw() {
        context.beginPath();
        context.arc(this.x, this.y, this.size * this.life, 0, Math.PI * 2);
        context.fillStyle = `rgba(255, ${Math.floor(120 + 100 * this.life)}, 30, ${this.life})`;
        context.shadowColor = "#fb923c";
        context.shadowBlur = 8;
        context.fill();
        context.shadowBlur = 0;
    }
}

function setStatus(message, resetToToolHint = false) {
    if (!panelStatus) {
        return;
    }

    panelStatus.textContent = message;
    window.clearTimeout(statusTimeout);

    if (resetToToolHint) {
        statusTimeout = window.setTimeout(() => {
            panelStatus.textContent = toolHints[activeTool];
        }, 2800);
    }
}

function updateToolUi() {
    toolButtons.forEach((button) => {
        button.classList.toggle("is-active", button.dataset.tool === activeTool);
    });

    if (toolLabel) {
        toolLabel.textContent = toolNames[activeTool];
    }

    if (hintText) {
        hintText.textContent = toolHints[activeTool];
    }
}

function updateLabels() {
    if (heatValue) {
        heatValue.textContent = heatSlider.value;
    }

    if (smokeValue) {
        smokeValue.textContent = smokeSlider.value;
    }

    if (buoyancyValue) {
        buoyancyValue.textContent = Number(buoyancySlider.value).toFixed(2);
    }

    if (windValue) {
        windValue.textContent = Number(windSlider.value).toFixed(2);
    }

    if (brushValue) {
        brushValue.textContent = `${brushSlider.value}px`;
    }

    if (particleCountValue) {
        particleCountValue.textContent = `${particles.length}`;
    }

    if (resolutionValue) {
        resolutionValue.textContent = `${gridWidth}×${gridHeight}`;
    }

    updateToolUi();
}

function allocateWorld() {
    const size = gridWidth * gridHeight;

    heat = new Float32Array(size);
    smoke = new Float32Array(size);
    velocityX = new Float32Array(size);
    velocityY = new Float32Array(size);
    walls = new Uint8Array(size);
    nextHeat = new Float32Array(size);
    nextSmoke = new Float32Array(size);
    nextVelocityX = new Float32Array(size);
    nextVelocityY = new Float32Array(size);
    particles = [];
}

function addFire(cx, cy, radius, strength) {
    const r = Math.floor(radius);

    for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
            const x = cx + dx;
            const y = cy + dy;

            if (!inBounds(x, y) || walls[index(x, y)]) {
                continue;
            }

            const distance = Math.hypot(dx, dy);

            if (distance <= r) {
                const falloff = 1 - distance / (r + 1);
                const cell = index(x, y);
                heat[cell] = Math.min(255, heat[cell] + strength * falloff);
                smoke[cell] = Math.min(255, smoke[cell] + Number(smokeSlider.value) * 0.35 * falloff);
                velocityY[cell] -= 1.2 * falloff;
                velocityX[cell] += (Math.random() - 0.5) * 0.8 * falloff;
            }
        }
    }

    for (let i = 0; i < 4; i += 1) {
        particles.push(new Ember(cx * scale, cy * scale, true));
    }

    trimParticles();
}

function addSmoke(cx, cy, radius, amount) {
    const r = Math.floor(radius);

    for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
            const x = cx + dx;
            const y = cy + dy;

            if (!inBounds(x, y) || walls[index(x, y)]) {
                continue;
            }

            const distance = Math.hypot(dx, dy);

            if (distance <= r) {
                const falloff = 1 - distance / (r + 1);
                const cell = index(x, y);
                smoke[cell] = Math.min(255, smoke[cell] + amount * falloff);
                velocityY[cell] -= 0.45 * falloff;
            }
        }
    }
}

function coolArea(cx, cy, radius) {
    const r = Math.floor(radius);

    for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
            const x = cx + dx;
            const y = cy + dy;

            if (!inBounds(x, y)) {
                continue;
            }

            const distance = Math.hypot(dx, dy);

            if (distance <= r) {
                const cell = index(x, y);
                heat[cell] *= 0.3;
                smoke[cell] *= 0.75;
                velocityX[cell] *= 0.4;
                velocityY[cell] *= 0.4;
            }
        }
    }
}

function paintWall(cx, cy, radius, value) {
    const r = Math.floor(radius);

    for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
            const x = cx + dx;
            const y = cy + dy;

            if (!inBounds(x, y)) {
                continue;
            }

            if (Math.hypot(dx, dy) <= r) {
                const cell = index(x, y);
                walls[cell] = value;

                if (value) {
                    heat[cell] = 0;
                    smoke[cell] = 0;
                    velocityX[cell] = 0;
                    velocityY[cell] = 0;
                }
            }
        }
    }
}

function addWind(cx, cy, radius, forceX, forceY) {
    const r = Math.floor(radius);

    for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
            const x = cx + dx;
            const y = cy + dy;

            if (!inBounds(x, y) || walls[index(x, y)]) {
                continue;
            }

            const distance = Math.hypot(dx, dy);

            if (distance <= r) {
                const falloff = 1 - distance / (r + 1);
                const cell = index(x, y);
                velocityX[cell] += forceX * falloff;
                velocityY[cell] += forceY * falloff;
            }
        }
    }
}

function average(field, x, y) {
    return (
        field[index(x - 1, y)] +
        field[index(x + 1, y)] +
        field[index(x, y - 1)] +
        field[index(x, y + 1)]
    ) * 0.25;
}

function bilinearSample(sampleX, sampleY) {
    const x0 = Math.floor(sampleX);
    const y0 = Math.floor(sampleY);
    const x1 = Math.min(gridWidth - 1, x0 + 1);
    const y1 = Math.min(gridHeight - 1, y0 + 1);
    const tx = sampleX - x0;
    const ty = sampleY - y0;
    const i00 = index(x0, y0);
    const i10 = index(x1, y0);
    const i01 = index(x0, y1);
    const i11 = index(x1, y1);

    const interpolate = (field) => {
        const a = field[i00] * (1 - tx) + field[i10] * tx;
        const b = field[i01] * (1 - tx) + field[i11] * tx;
        return a * (1 - ty) + b * ty;
    };

    return {
        heat: interpolate(heat),
        smoke: interpolate(smoke),
        velocityX: interpolate(velocityX),
        velocityY: interpolate(velocityY)
    };
}

function stepSimulation() {
    const ambientWind = Number(windSlider.value);
    const buoyancy = Number(buoyancySlider.value);

    nextHeat.fill(0);
    nextSmoke.fill(0);
    nextVelocityX.fill(0);
    nextVelocityY.fill(0);

    for (let y = 1; y < gridHeight - 1; y += 1) {
        for (let x = 1; x < gridWidth - 1; x += 1) {
            const cell = index(x, y);

            if (walls[cell]) {
                continue;
            }

            const currentHeat = heat[cell];
            const currentSmoke = smoke[cell];

            velocityX[cell] += ambientWind * 0.012 + (Math.random() - 0.5) * 0.015;
            velocityY[cell] += -buoyancy * currentHeat / 255 * 0.055 - currentSmoke / 255 * 0.012;

            velocityX[cell] *= 0.992;
            velocityY[cell] *= 0.992;

            const backX = clamp(x - velocityX[cell] * 0.7, 1, gridWidth - 2);
            const backY = clamp(y - velocityY[cell] * 0.7, 1, gridHeight - 2);
            const sample = bilinearSample(backX, backY);

            nextHeat[cell] = Math.max(0, sample.heat * 0.965 + average(heat, x, y) * 0.06 - 0.28);
            nextSmoke[cell] = Math.max(0, sample.smoke * 0.992 + average(smoke, x, y) * 0.035 - 0.035);
            nextVelocityX[cell] = sample.velocityX;
            nextVelocityY[cell] = sample.velocityY;
        }
    }

    let swap = heat;
    heat = nextHeat;
    nextHeat = swap;

    swap = smoke;
    smoke = nextSmoke;
    nextSmoke = swap;

    swap = velocityX;
    velocityX = nextVelocityX;
    nextVelocityX = swap;

    swap = velocityY;
    velocityY = nextVelocityY;
    nextVelocityY = swap;

    updateParticles();
}

function updateParticles() {
    particles.forEach((particle) => particle.update());
    particles = particles.filter(
        (particle) => particle.life > 0.06 && particle.x > -20 && particle.x < width + 20 && particle.y > -40 && particle.y < height + 20
    );
}

function trimParticles() {
    if (particles.length > 1400) {
        particles.splice(0, particles.length - 1400);
    }
}

function render() {
    const data = imageData.data;

    for (let y = 0; y < gridHeight; y += 1) {
        for (let x = 0; x < gridWidth; x += 1) {
            const cell = index(x, y);
            const pixel = cell * 4;

            if (walls[cell]) {
                data[pixel] = 134;
                data[pixel + 1] = 144;
                data[pixel + 2] = 162;
                data[pixel + 3] = 255;
                continue;
            }

            const currentHeat = clamp(heat[cell], 0, 255);
            const currentSmoke = clamp(smoke[cell], 0, 255);
            const glow = Math.pow(currentHeat / 255, 0.65);
            const mist = Math.pow(currentSmoke / 255, 0.85);

            let red = 6 + mist * 94 + glow * 255;
            let green = 10 + mist * 88 + glow * 150;
            let blue = 25 + mist * 112 + glow * 18;

            if (currentHeat > 190) {
                red = 255;
                green = 225;
                blue = 120 + (currentHeat - 190) * 1.4;
            }

            data[pixel] = clamp(Math.round(red), 0, 255);
            data[pixel + 1] = clamp(Math.round(green), 0, 255);
            data[pixel + 2] = clamp(Math.round(blue), 0, 255);
            data[pixel + 3] = 255;
        }
    }

    renderContext.putImageData(imageData, 0, 0);

    context.clearRect(0, 0, width, height);
    context.imageSmoothingEnabled = false;
    context.drawImage(renderCanvas, 0, 0, width, height);
    particles.forEach((particle) => particle.draw());

    updateLabels();
}

function animate() {
    if (running) {
        for (let step = 0; step < 2; step += 1) {
            stepSimulation();
        }
    }

    render();
    window.requestAnimationFrame(animate);
}

function applyToolAtPoint(point, previousPoint) {
    const gridX = Math.floor(point.x / scale);
    const gridY = Math.floor(point.y / scale);
    const brushRadius = Number(brushSlider.value) / scale;

    if (!inBounds(gridX, gridY)) {
        return;
    }

    if (activeTool === "fire") {
        addFire(gridX, gridY, brushRadius, Number(heatSlider.value));
    } else if (activeTool === "smoke") {
        addSmoke(gridX, gridY, brushRadius * 1.2, Number(smokeSlider.value));
    } else if (activeTool === "cool") {
        coolArea(gridX, gridY, brushRadius * 1.3);
    } else if (activeTool === "wall") {
        paintWall(gridX, gridY, brushRadius * 0.7, 1);
    } else if (activeTool === "erase") {
        paintWall(gridX, gridY, brushRadius, 0);
        coolArea(gridX, gridY, brushRadius * 1.4);
    } else if (activeTool === "wind") {
        const dx = previousPoint ? point.x - previousPoint.x : 0;
        const dy = previousPoint ? point.y - previousPoint.y : 0;
        addWind(gridX, gridY, brushRadius * 1.8, dx * 0.05, dy * 0.05);
    }
}

function paintStroke(point) {
    if (!lastPointer) {
        applyToolAtPoint(point, point);
        lastPointer = point;
        return;
    }

    const dx = point.x - lastPointer.x;
    const dy = point.y - lastPointer.y;
    const distance = Math.hypot(dx, dy);
    const stepSize = Math.max(4, Number(brushSlider.value) * 0.35);
    const steps = Math.max(1, Math.ceil(distance / stepSize));
    let previousPoint = lastPointer;

    for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        const currentPoint = {
            x: lastPointer.x + dx * t,
            y: lastPointer.y + dy * t
        };

        applyToolAtPoint(currentPoint, previousPoint);
        previousPoint = currentPoint;
    }

    lastPointer = point;
}

function pointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    const x = clamp(event.clientX - rect.left, 0, rect.width - 1);
    const y = clamp(event.clientY - rect.top, 0, rect.height - 1);
    return { x, y };
}

function stopDrawing() {
    drawing = false;
    lastPointer = null;

    if (activePointerId !== null && canvas.hasPointerCapture(activePointerId)) {
        canvas.releasePointerCapture(activePointerId);
    }

    activePointerId = null;
}

function applyCampfirePreset() {
    allocateWorld();

    const fireLineY = Math.floor(gridHeight * 0.78);

    for (let x = Math.floor(gridWidth * 0.35); x < Math.floor(gridWidth * 0.65); x += 1) {
        for (let y = fireLineY; y < fireLineY + 4; y += 1) {
            if (inBounds(x, y)) {
                walls[index(x, y)] = 1;
            }
        }
    }

    for (let count = 0; count < 24; count += 1) {
        addFire(Math.floor(gridWidth * (0.42 + Math.random() * 0.16)), fireLineY - 3, 5 + Math.random() * 5, 130);
    }

    updateLabels();
}

function addSparkBurst() {
    for (let i = 0; i < 120; i += 1) {
        particles.push(new Ember(width * (0.45 + Math.random() * 0.1), height * 0.7, true));
    }

    trimParticles();
    updateLabels();
}

function resizeCanvas() {
    const rect = simulationShell.getBoundingClientRect();

    if (!rect.width || !rect.height) {
        return;
    }

    width = Math.max(320, Math.floor(rect.width));
    height = Math.max(320, Math.floor(rect.height));

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    scale = width < 760 ? 5 : 4;
    gridWidth = Math.max(64, Math.floor(width / scale));
    gridHeight = Math.max(64, Math.floor(height / scale));

    renderCanvas.width = gridWidth;
    renderCanvas.height = gridHeight;
    imageData = renderContext.createImageData(gridWidth, gridHeight);

    applyCampfirePreset();
}

toolButtons.forEach((button) => {
    button.addEventListener("click", () => {
        activeTool = button.dataset.tool;
        updateToolUi();
        setStatus(toolHints[activeTool]);
    });
});

playPauseButton?.addEventListener("click", () => {
    running = !running;
    playPauseButton.textContent = running ? "一時停止" : "再生";
    playPauseButton.classList.toggle("is-paused", !running);
    setStatus(running ? "再生を再開しました。風や上昇気流を変えると plume の傾きがすぐ変わります。" : "一時停止中です。今の場の形を見比べてください。", true);
});

clearButton?.addEventListener("click", () => {
    allocateWorld();
    updateLabels();
    setStatus("場を空にしました。火か煙を描いて新しく作り直せます。", true);
});

campfireButton?.addEventListener("click", () => {
    applyCampfirePreset();
    setStatus("たき火プリセットを置きました。風を少し上げると煙の柱がきれいに傾きます。", true);
});

sparkButton?.addEventListener("click", () => {
    addSparkBurst();
    setStatus("火花を追加しました。上昇流に乗る粒子の軌跡を見てください。", true);
});

[heatSlider, smokeSlider, buoyancySlider, windSlider, brushSlider].forEach((element) => {
    element?.addEventListener("input", updateLabels);
});

canvas.addEventListener("pointerdown", (event) => {
    drawing = true;
    activePointerId = event.pointerId;
    canvas.setPointerCapture(activePointerId);
    lastPointer = pointerPosition(event);
    paintStroke(lastPointer);
});

canvas.addEventListener("pointermove", (event) => {
    if (!drawing) {
        return;
    }

    paintStroke(pointerPosition(event));
});

canvas.addEventListener("pointerup", stopDrawing);
canvas.addEventListener("pointercancel", stopDrawing);
window.addEventListener("pointerup", stopDrawing);
window.addEventListener("resize", resizeCanvas);

updateToolUi();
resizeCanvas();
setStatus(toolHints[activeTool]);
animate();