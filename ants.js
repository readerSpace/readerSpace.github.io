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

const canvas = document.querySelector("#antCanvas");
const context = canvas?.getContext("2d");
const simulationShell = document.querySelector(".simulation-shell");
const simulationPanel = document.querySelector("#simulationPanel");

const playPauseButton = document.querySelector("#playPause");
const togglePanelButton = document.querySelector("#togglePanel");
const showPanelButton = document.querySelector("#showPanel");
const resetButton = document.querySelector("#reset");
const clearPheromoneButton = document.querySelector("#clearPheromone");
const addAntsButton = document.querySelector("#addAnts");
const shortcutExperimentButton = document.querySelector("#shortcutExperiment");
const mazeExperimentButton = document.querySelector("#mazeExperiment");
const antCountSlider = document.querySelector("#antCount");
const evaporationSlider = document.querySelector("#evaporation");
const followSlider = document.querySelector("#follow");
const randomnessSlider = document.querySelector("#randomness");
const antCountValue = document.querySelector("#antCountValue");
const evapValue = document.querySelector("#evapValue");
const followValue = document.querySelector("#followValue");
const randomValue = document.querySelector("#randomValue");
const deliveredSpan = document.querySelector("#delivered");
const searchingSpan = document.querySelector("#searching");
const panelStatus = document.querySelector("#panelStatus");
const toolValue = document.querySelector("#toolValue");
const toolPanelValue = document.querySelector("#toolPanelValue");
const sceneValue = document.querySelector("#sceneValue");
const scenePanelValue = document.querySelector("#scenePanelValue");
const runningValue = document.querySelector("#runningValue");
const toolButtons = document.querySelectorAll("[data-tool]");

const toolLabels = {
    food: "エサ",
    obstacle: "障害物",
    erase: "消す",
    nest: "巣を移動"
};

const sceneLabels = {
    free: "自由配置",
    shortcut: "近道実験",
    maze: "迷路"
};

let displayWidth = 0;
let displayHeight = 0;
let renderScale = 4;
let gridWidth = 0;
let gridHeight = 0;
let homePheromone = new Float32Array(0);
let foodPheromone = new Float32Array(0);
let obstacles = new Uint8Array(0);
let ants = [];
let foods = [];
let nest = { x: 0, y: 0 };
let running = true;
let currentTool = "food";
let currentScene = "free";
let drawing = false;
let delivered = 0;
let statusTimeout = 0;
let animationTimeout = 0;
let panelHidden = false;
let backgroundGradient;
let pheromoneCanvas = document.createElement("canvas");
let pheromoneContext = pheromoneCanvas.getContext("2d");
let pheromoneImageData;

const defaultStatus = "エサをクリックで置くと探索が始まります。障害物や近道実験を入れると、短い道ほど濃くなる理由が見えます。";

class Ant {
    constructor() {
        this.resetAtNest();
    }

    resetAtNest() {
        this.x = nest.x + (Math.random() - 0.5) * 12;
        this.y = nest.y + (Math.random() - 0.5) * 12;
        this.angle = Math.random() * Math.PI * 2;
        this.hasFood = false;
        this.speed = 1.6 + Math.random() * 0.7;
    }

    sense(field) {
        const sensorDistance = 18;
        const sensorAngle = 0.65;
        const angles = [this.angle - sensorAngle, this.angle, this.angle + sensorAngle];
        let bestAngle = this.angle;
        let bestValue = -Infinity;

        angles.forEach((candidateAngle) => {
            const sampleX = this.x + Math.cos(candidateAngle) * sensorDistance;
            const sampleY = this.y + Math.sin(candidateAngle) * sensorDistance;
            const value = sampleField(field, sampleX, sampleY);

            if (value > bestValue) {
                bestValue = value;
                bestAngle = candidateAngle;
            }
        });

        if (bestValue < 0.01) {
            return this.angle + (Math.random() - 0.5) * 0.8;
        }

        return bestAngle;
    }

    isBlocked(x, y) {
        const gridX = Math.floor(x / renderScale);
        const gridY = Math.floor(y / renderScale);

        if (!insideGrid(gridX, gridY)) {
            return true;
        }

        return obstacles[indexOf(gridX, gridY)] === 1;
    }

    deposit() {
        const gridX = Math.floor(this.x / renderScale);
        const gridY = Math.floor(this.y / renderScale);

        if (!insideGrid(gridX, gridY)) {
            return;
        }

        const index = indexOf(gridX, gridY);
        if (this.hasFood) {
            foodPheromone[index] = Math.min(255, foodPheromone[index] + 8);
        } else {
            homePheromone[index] = Math.min(255, homePheromone[index] + 5);
        }
    }

    checkFoodOrNest() {
        if (!this.hasFood) {
            for (let index = foods.length - 1; index >= 0; index -= 1) {
                const food = foods[index];
                if (Math.hypot(this.x - food.x, this.y - food.y) < food.r) {
                    this.hasFood = true;
                    this.angle += Math.PI;
                    food.amount -= 1;
                    if (food.amount <= 0) {
                        foods.splice(index, 1);
                    }
                    break;
                }
            }
        } else if (Math.hypot(this.x - nest.x, this.y - nest.y) < 24) {
            this.hasFood = false;
            delivered += 1;
            this.angle += Math.PI + (Math.random() - 0.5);
        }
    }

    update() {
        const targetPheromone = this.hasFood ? homePheromone : foodPheromone;
        const follow = Number(followSlider.value);
        const randomness = Number(randomnessSlider.value);
        const bestAngle = this.sense(targetPheromone);

        this.angle = mixAngle(this.angle, bestAngle, 0.08 * follow);
        this.angle += (Math.random() - 0.5) * randomness;

        const nextX = this.x + Math.cos(this.angle) * this.speed;
        const nextY = this.y + Math.sin(this.angle) * this.speed;

        if (this.isBlocked(nextX, nextY)) {
            this.angle += Math.PI * (0.6 + Math.random() * 0.8);
            return;
        }

        this.x = nextX;
        this.y = nextY;

        if (this.x < 4 || this.x > displayWidth - 4 || this.y < 4 || this.y > displayHeight - 4) {
            this.angle += Math.PI;
            this.x = clamp(this.x, 4, displayWidth - 4);
            this.y = clamp(this.y, 4, displayHeight - 4);
        }

        this.deposit();
        this.checkFoodOrNest();
    }

    draw() {
        context.save();
        context.translate(this.x, this.y);
        context.rotate(this.angle);
        context.fillStyle = this.hasFood ? "#facc15" : "#e5e7eb";
        context.shadowColor = this.hasFood ? "#facc15" : "rgba(255,255,255,0.45)";
        context.shadowBlur = this.hasFood ? 8 : 3;
        context.beginPath();
        context.ellipse(0, 0, 4.2, 2.1, 0, 0, Math.PI * 2);
        context.fill();
        context.beginPath();
        context.arc(4, 0, 2.2, 0, Math.PI * 2);
        context.fill();
        context.restore();
    }
}

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

const setPanelVisibility = (hidden) => {
    panelHidden = hidden;
    simulationShell?.classList.toggle("is-panel-hidden", hidden);
    simulationPanel?.setAttribute("aria-hidden", hidden ? "true" : "false");
    togglePanelButton?.setAttribute("aria-expanded", hidden ? "false" : "true");
    showPanelButton?.setAttribute("aria-expanded", hidden ? "false" : "true");
};

const indexOf = (x, y) => y * gridWidth + x;

const insideGrid = (x, y) => x >= 0 && x < gridWidth && y >= 0 && y < gridHeight;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const mixAngle = (from, to, amount) => {
    let difference = ((to - from + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    return from + difference * amount;
};

const sampleField = (field, x, y) => {
    const gridX = Math.floor(x / renderScale);
    const gridY = Math.floor(y / renderScale);

    if (!insideGrid(gridX, gridY)) {
        return 0;
    }

    if (obstacles[indexOf(gridX, gridY)]) {
        return 0;
    }

    return field[indexOf(gridX, gridY)];
};

const clearPheromones = (announce = true) => {
    homePheromone.fill(0);
    foodPheromone.fill(0);
    if (announce) {
        setStatus("フェロモンを消去しました。探索が最初からやり直されます。", false);
    }
};

const buildAnts = () => {
    ants = Array.from({ length: Number(antCountSlider.value) }, () => new Ant());
};

const setScene = (sceneKey, announce = true) => {
    currentScene = sceneKey;
    delivered = 0;
    homePheromone = new Float32Array(gridWidth * gridHeight);
    foodPheromone = new Float32Array(gridWidth * gridHeight);
    obstacles = new Uint8Array(gridWidth * gridHeight);

    if (sceneKey === "shortcut") {
        foods = [{ x: displayWidth * 0.82, y: displayHeight * 0.5, r: 22, amount: 1200 }];
        nest = { x: displayWidth * 0.18, y: displayHeight * 0.5 };

        for (let y = Math.floor(gridHeight * 0.18); y < Math.floor(gridHeight * 0.82); y += 1) {
            for (let x = Math.floor(gridWidth * 0.48); x < Math.floor(gridWidth * 0.52); x += 1) {
                if (y > gridHeight * 0.42 && y < gridHeight * 0.52) {
                    continue;
                }
                obstacles[indexOf(x, y)] = 1;
            }
        }
    } else if (sceneKey === "maze") {
        foods = [{ x: displayWidth * 0.82, y: displayHeight * 0.25, r: 22, amount: 1200 }];
        nest = { x: displayWidth * 0.18, y: displayHeight * 0.75 };
        const walls = [
            { x1: 0.15, y1: 0.35, x2: 0.72, y2: 0.39 },
            { x1: 0.28, y1: 0.60, x2: 0.88, y2: 0.64 },
            { x1: 0.48, y1: 0.15, x2: 0.52, y2: 0.60 },
            { x1: 0.68, y1: 0.39, x2: 0.72, y2: 0.88 }
        ];

        walls.forEach((wall) => {
            const x1 = Math.floor(gridWidth * wall.x1);
            const x2 = Math.floor(gridWidth * wall.x2);
            const y1 = Math.floor(gridHeight * wall.y1);
            const y2 = Math.floor(gridHeight * wall.y2);

            for (let y = y1; y <= y2; y += 1) {
                for (let x = x1; x <= x2; x += 1) {
                    if (insideGrid(x, y)) {
                        obstacles[indexOf(x, y)] = 1;
                    }
                }
            }
        });
    } else {
        foods = [{ x: displayWidth * 0.78, y: displayHeight * 0.48, r: 22, amount: 900 }];
        nest = { x: displayWidth * 0.22, y: displayHeight * 0.52 };
    }

    buildAnts();
    updateReadouts();

    if (announce) {
        const messages = {
            free: "基本配置に戻しました。エサや障害物を置いて自由に試せます。",
            shortcut: "近道実験を用意しました。通路の競争で短い道が濃くなる様子が見えます。",
            maze: "迷路を用意しました。探索とフェロモンの両方でルートが絞られていきます。"
        };
        setStatus(messages[sceneKey], false);
    }
};

const syncAntCount = () => {
    const target = Number(antCountSlider.value);
    while (ants.length < target) {
        ants.push(new Ant());
    }
    while (ants.length > target) {
        ants.pop();
    }
};

const paintObstacle = (x, y, radius, value) => {
    const gridX = Math.floor(x / renderScale);
    const gridY = Math.floor(y / renderScale);
    const gridRadius = Math.ceil(radius / renderScale);

    for (let offsetY = -gridRadius; offsetY <= gridRadius; offsetY += 1) {
        for (let offsetX = -gridRadius; offsetX <= gridRadius; offsetX += 1) {
            const nextX = gridX + offsetX;
            const nextY = gridY + offsetY;
            if (!insideGrid(nextX, nextY)) {
                continue;
            }
            if (Math.hypot(offsetX, offsetY) <= gridRadius) {
                obstacles[indexOf(nextX, nextY)] = value;
            }
        }
    }
};

const pointerPosition = (event) => {
    const bounds = canvas.getBoundingClientRect();
    return {
        x: clamp(event.clientX - bounds.left, 0, bounds.width),
        y: clamp(event.clientY - bounds.top, 0, bounds.height)
    };
};

const applyCanvasTool = (event) => {
    const point = pointerPosition(event);

    if (currentTool === "food") {
        foods.push({ x: point.x, y: point.y, r: 22, amount: 700 });
        setStatus("エサを置きました。群れがそこへ伸びるまで少し待つと変化が見えます。", false);
        return;
    }

    if (currentTool === "nest") {
        nest.x = point.x;
        nest.y = point.y;
        ants.forEach((ant) => ant.resetAtNest());
        clearPheromones(false);
        setStatus("巣を移動しました。経路が新しく作り直されます。", false);
        return;
    }

    if (currentTool === "obstacle") {
        paintObstacle(point.x, point.y, 18, 1);
        return;
    }

    if (currentTool === "erase") {
        paintObstacle(point.x, point.y, 26, 0);
        foods = foods.filter((food) => Math.hypot(food.x - point.x, food.y - point.y) > food.r + 18);
    }
};

const updateReadouts = () => {
    antCountValue.textContent = antCountSlider.value;
    evapValue.textContent = Number(evaporationSlider.value).toFixed(3);
    followValue.textContent = Number(followSlider.value).toFixed(2);
    randomValue.textContent = Number(randomnessSlider.value).toFixed(2);
    deliveredSpan.textContent = String(delivered);
    searchingSpan.textContent = String(ants.filter((ant) => !ant.hasFood).length);
    toolValue.textContent = toolLabels[currentTool];
    toolPanelValue.textContent = toolLabels[currentTool];
    sceneValue.textContent = sceneLabels[currentScene];
    scenePanelValue.textContent = sceneLabels[currentScene];
    runningValue.textContent = running ? "再生中" : "停止中";
};

const evaporateAndDiffuse = () => {
    const evaporation = Number(evaporationSlider.value);

    for (let index = 0; index < homePheromone.length; index += 1) {
        homePheromone[index] *= evaporation;
        foodPheromone[index] *= evaporation;
    }

    for (let y = 1; y < gridHeight - 1; y += 2) {
        for (let x = 1; x < gridWidth - 1; x += 2) {
            const index = indexOf(x, y);
            if (obstacles[index]) {
                continue;
            }

            const home = homePheromone[index] * 0.015;
            const food = foodPheromone[index] * 0.015;
            homePheromone[indexOf(x - 1, y)] += home;
            homePheromone[indexOf(x + 1, y)] += home;
            homePheromone[indexOf(x, y - 1)] += home;
            homePheromone[indexOf(x, y + 1)] += home;
            foodPheromone[indexOf(x - 1, y)] += food;
            foodPheromone[indexOf(x + 1, y)] += food;
            foodPheromone[indexOf(x, y - 1)] += food;
            foodPheromone[indexOf(x, y + 1)] += food;
        }
    }
};

const drawBackground = () => {
    context.fillStyle = backgroundGradient;
    context.fillRect(0, 0, displayWidth, displayHeight);
};

const drawPheromones = () => {
    const pixels = pheromoneImageData.data;

    for (let index = 0; index < gridWidth * gridHeight; index += 1) {
        const home = Math.min(255, homePheromone[index]);
        const food = Math.min(255, foodPheromone[index]);
        const pixel = index * 4;
        pixels[pixel] = food;
        pixels[pixel + 1] = home * 0.75 + food * 0.55;
        pixels[pixel + 2] = home;
        pixels[pixel + 3] = Math.min(210, Math.max(home, food) * 1.3);
    }

    pheromoneContext.putImageData(pheromoneImageData, 0, 0);
    context.imageSmoothingEnabled = false;
    context.drawImage(pheromoneCanvas, 0, 0, displayWidth, displayHeight);
};

const drawObstacles = () => {
    context.fillStyle = "rgba(100, 116, 139, 0.95)";

    for (let y = 0; y < gridHeight; y += 1) {
        for (let x = 0; x < gridWidth; x += 1) {
            if (obstacles[indexOf(x, y)]) {
                context.fillRect(x * renderScale, y * renderScale, renderScale + 0.5, renderScale + 0.5);
            }
        }
    }
};

const drawNestAndFood = () => {
    context.save();
    context.beginPath();
    context.arc(nest.x, nest.y, 25, 0, Math.PI * 2);
    context.fillStyle = "#a78bfa";
    context.shadowColor = "#a78bfa";
    context.shadowBlur = 18;
    context.fill();
    context.fillStyle = "white";
    context.font = "700 13px IBM Plex Sans JP";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("巣", nest.x, nest.y);
    context.restore();

    foods.forEach((food) => {
        context.save();
        context.beginPath();
        context.arc(food.x, food.y, food.r, 0, Math.PI * 2);
        context.fillStyle = "#22c55e";
        context.shadowColor = "#22c55e";
        context.shadowBlur = 18;
        context.fill();
        context.fillStyle = "white";
        context.font = "700 12px IBM Plex Sans JP";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText("エサ", food.x, food.y);
        context.restore();
    });
};

const render = () => {
    drawBackground();
    drawPheromones();
    drawObstacles();
    drawNestAndFood();
    ants.forEach((ant) => ant.draw());
    updateReadouts();
};

const animate = () => {
    if (running) {
        evaporateAndDiffuse();
        syncAntCount();
        ants.forEach((ant) => ant.update());
    }

    render();
    animationTimeout = window.setTimeout(animate, 16);
};

const resizeCanvas = () => {
    const bounds = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    displayWidth = Math.max(Math.floor(bounds.width), 1);
    displayHeight = Math.max(Math.floor(bounds.height), 1);
    canvas.width = Math.floor(displayWidth * dpr);
    canvas.height = Math.floor(displayHeight * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderScale = displayWidth < 700 ? 5 : 4;
    gridWidth = Math.ceil(displayWidth / renderScale);
    gridHeight = Math.ceil(displayHeight / renderScale);
    pheromoneCanvas.width = gridWidth;
    pheromoneCanvas.height = gridHeight;
    pheromoneImageData = pheromoneContext.createImageData(gridWidth, gridHeight);
    backgroundGradient = context.createRadialGradient(
        displayWidth * 0.5,
        displayHeight * 0.5,
        displayWidth * 0.08,
        displayWidth * 0.5,
        displayHeight * 0.5,
        Math.max(displayWidth, displayHeight) * 0.72
    );
    backgroundGradient.addColorStop(0, "#182033");
    backgroundGradient.addColorStop(1, "#070b14");
    setScene(currentScene, false);
};

const setTool = (tool) => {
    currentTool = tool;
    toolButtons.forEach((button) => {
        button.classList.toggle("active", button.dataset.tool === tool);
    });
    updateReadouts();
    setStatus(`${toolLabels[tool]} モードに切り替えました。`, false);
};

const toggleRunning = () => {
    running = !running;
    playPauseButton.textContent = running ? "一時停止" : "再生";
    playPauseButton.classList.toggle("green", running);
    updateReadouts();
    setStatus(running ? "再生を再開しました。" : "停止しました。配置を変えてから再開すると比較しやすいです。", false);
};

canvas?.addEventListener("pointerdown", (event) => {
    drawing = true;
    canvas.setPointerCapture?.(event.pointerId);
    applyCanvasTool(event);
});

canvas?.addEventListener("pointermove", (event) => {
    if (!drawing) {
        return;
    }

    if (currentTool === "obstacle" || currentTool === "erase") {
        applyCanvasTool(event);
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

toolButtons.forEach((button) => {
    button.addEventListener("click", () => {
        setTool(button.dataset.tool);
    });
});

playPauseButton?.addEventListener("click", toggleRunning);
togglePanelButton?.addEventListener("click", () => {
    setPanelVisibility(true);
});
showPanelButton?.addEventListener("click", () => {
    setPanelVisibility(false);
});
resetButton?.addEventListener("click", () => setScene("free", true));
clearPheromoneButton?.addEventListener("click", () => clearPheromones(true));
addAntsButton?.addEventListener("click", () => {
    antCountSlider.value = String(Math.min(500, Number(antCountSlider.value) + 60));
    syncAntCount();
    updateReadouts();
    setStatus("アリを追加しました。混み合うと経路の選び方も少し変わります。", false);
});
shortcutExperimentButton?.addEventListener("click", () => setScene("shortcut", true));
mazeExperimentButton?.addEventListener("click", () => setScene("maze", true));

antCountSlider?.addEventListener("input", () => {
    syncAntCount();
    updateReadouts();
});

[evaporationSlider, followSlider, randomnessSlider].forEach((slider) => {
    slider?.addEventListener("input", () => {
        updateReadouts();
    });
});

window.addEventListener("resize", resizeCanvas);

if (canvas && context && pheromoneContext) {
    resizeCanvas();
    setPanelVisibility(false);
    updateReadouts();
    setStatus(defaultStatus, true);
    window.clearTimeout(animationTimeout);
    animate();
}