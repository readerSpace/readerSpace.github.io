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

const canvas = document.querySelector("#lifeCanvas");
const context = canvas?.getContext("2d");

const playPauseButton = document.querySelector("#playPause");
const stepButton = document.querySelector("#step");
const drawModeButton = document.querySelector("#drawMode");
const eraseModeButton = document.querySelector("#eraseMode");
const speedSlider = document.querySelector("#speed");
const cellSizeSlider = document.querySelector("#cellSize");
const speedValue = document.querySelector("#speedValue");
const cellSizeValue = document.querySelector("#cellSizeValue");
const randomButton = document.querySelector("#random");
const clearButton = document.querySelector("#clear");
const generationSpan = document.querySelector("#generation");
const aliveCountSpan = document.querySelector("#aliveCount");
const panelStatus = document.querySelector("#panelStatus");
const patternValue = document.querySelector("#patternValue");
const toolValue = document.querySelector("#toolValue");
const selectedPatternValue = document.querySelector("#selectedPatternValue");
const runningValue = document.querySelector("#runningValue");
const patternButtons = document.querySelectorAll("[data-pattern]");

const patternLabels = {
    glider: "グライダー",
    lwss: "宇宙船",
    pulsar: "パルサー",
    gosper: "グライダー銃",
    diehard: "Diehard",
    acorn: "Acorn"
};

const patterns = {
    glider: {
        width: 3,
        height: 3,
        cells: [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]]
    },
    lwss: {
        width: 5,
        height: 4,
        cells: [[1, 0], [2, 0], [3, 0], [4, 0], [0, 1], [4, 1], [4, 2], [0, 3], [3, 3]]
    },
    pulsar: {
        width: 13,
        height: 13,
        cells: [
            [2, 0], [3, 0], [4, 0], [8, 0], [9, 0], [10, 0],
            [0, 2], [5, 2], [7, 2], [12, 2],
            [0, 3], [5, 3], [7, 3], [12, 3],
            [0, 4], [5, 4], [7, 4], [12, 4],
            [2, 5], [3, 5], [4, 5], [8, 5], [9, 5], [10, 5],
            [2, 7], [3, 7], [4, 7], [8, 7], [9, 7], [10, 7],
            [0, 8], [5, 8], [7, 8], [12, 8],
            [0, 9], [5, 9], [7, 9], [12, 9],
            [0, 10], [5, 10], [7, 10], [12, 10],
            [2, 12], [3, 12], [4, 12], [8, 12], [9, 12], [10, 12]
        ]
    },
    gosper: {
        width: 36,
        height: 9,
        cells: [
            [24, 0],
            [22, 1], [24, 1],
            [12, 2], [13, 2], [20, 2], [21, 2], [34, 2], [35, 2],
            [11, 3], [15, 3], [20, 3], [21, 3], [34, 3], [35, 3],
            [0, 4], [1, 4], [10, 4], [16, 4], [20, 4], [21, 4],
            [0, 5], [1, 5], [10, 5], [14, 5], [16, 5], [17, 5], [22, 5], [24, 5],
            [10, 6], [16, 6], [24, 6],
            [11, 7], [15, 7],
            [12, 8], [13, 8]
        ]
    },
    diehard: {
        width: 8,
        height: 3,
        cells: [[6, 0], [0, 1], [1, 1], [1, 2], [5, 2], [6, 2], [7, 2]]
    },
    acorn: {
        width: 7,
        height: 3,
        cells: [[1, 0], [3, 1], [0, 2], [1, 2], [4, 2], [5, 2], [6, 2]]
    }
};

let width = 0;
let height = 0;
let cellSize = 10;
let cols = 0;
let rows = 0;
let grid = [];
let nextGrid = [];
let running = true;
let drawing = false;
let drawState = 1;
let generation = 0;
let lastUpdate = 0;
let selectedPattern = null;
let lastMouseCell = { x: 0, y: 0 };
let statusTimeout = 0;

const createGrid = (columnCount, rowCount) => Array.from(
    { length: rowCount },
    () => new Uint8Array(columnCount)
);

const setStatus = (message, persist = false) => {
    panelStatus.textContent = message;

    if (statusTimeout) {
        window.clearTimeout(statusTimeout);
        statusTimeout = 0;
    }

    if (!persist) {
        statusTimeout = window.setTimeout(() => {
            panelStatus.textContent = "キャンバスにドラッグすると自分で初期条件を描けます。パターンを選んだら、次のクリックで配置されます。";
        }, 2600);
    }
};

const updateReadouts = (aliveCount = 0) => {
    generationSpan.textContent = String(generation);
    aliveCountSpan.textContent = String(aliveCount);
    speedValue.textContent = `${speedSlider.value} 世代/秒`;
    cellSizeValue.textContent = `${cellSize}px`;
    toolValue.textContent = drawState === 1 ? "描く" : "消す";
    selectedPatternValue.textContent = selectedPattern ? patternLabels[selectedPattern] : "なし";
    patternValue.textContent = selectedPattern ? patternLabels[selectedPattern] : "未選択";
    runningValue.textContent = running ? "再生中" : "停止中";
};

const clearPatternSelection = () => {
    selectedPattern = null;
    patternButtons.forEach((button) => {
        button.classList.remove("active");
    });
    updateReadouts();
};

const rebuildGrid = (keepOld) => {
    const oldGrid = grid;
    const oldRows = rows;
    const oldCols = cols;

    cellSize = Number(cellSizeSlider.value);
    cols = Math.ceil(width / cellSize);
    rows = Math.ceil(height / cellSize);
    grid = createGrid(cols, rows);
    nextGrid = createGrid(cols, rows);

    if (keepOld && oldGrid.length) {
        const minRows = Math.min(rows, oldRows);
        const minCols = Math.min(cols, oldCols);

        for (let y = 0; y < minRows; y += 1) {
            for (let x = 0; x < minCols; x += 1) {
                grid[y][x] = oldGrid[y][x];
            }
        }
    }
};

const resizeCanvas = () => {
    const dpr = window.devicePixelRatio || 1;
    width = Math.max(canvas.clientWidth, 1);
    height = Math.max(canvas.clientHeight, 1);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    rebuildGrid(true);
};

const randomize = () => {
    generation = 0;

    for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < cols; x += 1) {
            grid[y][x] = Math.random() < 0.18 ? 1 : 0;
        }
    }

    clearPatternSelection();
    setStatus("ランダムな初期配置を作りました。", false);
};

const clearGrid = () => {
    generation = 0;

    for (let y = 0; y < rows; y += 1) {
        grid[y].fill(0);
    }

    clearPatternSelection();
    setStatus("セルをすべて消しました。", false);
};

const countNeighbors = (x, y) => {
    let sum = 0;

    for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) {
                continue;
            }

            const nx = (x + dx + cols) % cols;
            const ny = (y + dy + rows) % rows;
            sum += grid[ny][nx];
        }
    }

    return sum;
};

const stepSimulation = () => {
    for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < cols; x += 1) {
            const alive = grid[y][x];
            const neighbors = countNeighbors(x, y);

            if (alive && (neighbors === 2 || neighbors === 3)) {
                nextGrid[y][x] = 1;
            } else if (!alive && neighbors === 3) {
                nextGrid[y][x] = 1;
            } else {
                nextGrid[y][x] = 0;
            }
        }
    }

    const temp = grid;
    grid = nextGrid;
    nextGrid = temp;
    generation += 1;
};

const drawPatternPreview = () => {
    if (!selectedPattern) {
        return;
    }

    const pattern = patterns[selectedPattern];
    context.fillStyle = "rgba(250, 204, 21, 0.38)";

    pattern.cells.forEach(([x, y]) => {
        context.fillRect(
            (lastMouseCell.x + x) * cellSize + 1,
            (lastMouseCell.y + y) * cellSize + 1,
            cellSize - 2,
            cellSize - 2
        );
    });
};

const drawGrid = () => {
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#020617";
    context.fillRect(0, 0, width, height);

    let aliveCount = 0;

    for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < cols; x += 1) {
            if (!grid[y][x]) {
                continue;
            }

            aliveCount += 1;
            const px = x * cellSize;
            const py = y * cellSize;
            const alpha = 0.55 + 0.35 * Math.sin((x + y + generation) * 0.05);

            context.fillStyle = `rgba(94, 234, 212, ${alpha})`;
            context.fillRect(px + 1, py + 1, cellSize - 2, cellSize - 2);
        }
    }

    if (cellSize >= 9) {
        context.strokeStyle = "rgba(148, 163, 184, 0.12)";
        context.lineWidth = 1;

        for (let x = 0; x <= cols; x += 1) {
            context.beginPath();
            context.moveTo(x * cellSize, 0);
            context.lineTo(x * cellSize, height);
            context.stroke();
        }

        for (let y = 0; y <= rows; y += 1) {
            context.beginPath();
            context.moveTo(0, y * cellSize);
            context.lineTo(width, y * cellSize);
            context.stroke();
        }
    }

    drawPatternPreview();
    updateReadouts(aliveCount);
};

const animate = (timestamp) => {
    const fps = Number(speedSlider.value);
    const interval = 1000 / fps;

    if (running && timestamp - lastUpdate > interval) {
        stepSimulation();
        lastUpdate = timestamp;
    }

    drawGrid();
    window.requestAnimationFrame(animate);
};

const cellFromEvent = (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / cellSize);
    const y = Math.floor((event.clientY - rect.top) / cellSize);

    return { x, y };
};

const paintCell = (x, y) => {
    if (x < 0 || x >= cols || y < 0 || y >= rows) {
        return;
    }

    grid[y][x] = drawState;
};

const paintFromEvent = (event) => {
    const cell = cellFromEvent(event);
    lastMouseCell = cell;
    paintCell(cell.x, cell.y);
};

const placePattern = (name, startX, startY) => {
    const pattern = patterns[name];

    pattern.cells.forEach(([x, y]) => {
        const gx = startX + x;
        const gy = startY + y;

        if (gx >= 0 && gx < cols && gy >= 0 && gy < rows) {
            grid[gy][gx] = 1;
        }
    });
};

const setDrawTool = (nextDrawState) => {
    drawState = nextDrawState;
    drawModeButton.classList.toggle("active", drawState === 1);
    eraseModeButton.classList.toggle("active", drawState === 0);

    if (selectedPattern) {
        clearPatternSelection();
    } else {
        updateReadouts();
    }

    setStatus(drawState === 1 ? "描くモードに切り替えました。" : "消すモードに切り替えました。", false);
};

const toggleRunning = () => {
    running = !running;
    playPauseButton.textContent = running ? "一時停止" : "再生";
    playPauseButton.classList.toggle("green", running);
    lastUpdate = performance.now();
    updateReadouts();
    setStatus(running ? "再生を再開しました。" : "一時停止しました。1 ステップで手動更新もできます。", false);
};

canvas.addEventListener("pointerdown", (event) => {
    const cell = cellFromEvent(event);
    lastMouseCell = cell;

    if (selectedPattern) {
        placePattern(selectedPattern, cell.x, cell.y);
        setStatus(`${patternLabels[selectedPattern]} を配置しました。`, false);
        clearPatternSelection();
        return;
    }

    drawing = true;
    paintFromEvent(event);
});

canvas.addEventListener("pointermove", (event) => {
    lastMouseCell = cellFromEvent(event);

    if (drawing) {
        paintFromEvent(event);
    }
});

window.addEventListener("pointerup", () => {
    drawing = false;
});

playPauseButton.addEventListener("click", toggleRunning);

stepButton.addEventListener("click", () => {
    stepSimulation();
    lastUpdate = performance.now();
    setStatus("1 ステップ進めました。", false);
});

drawModeButton.addEventListener("click", () => {
    setDrawTool(1);
});

eraseModeButton.addEventListener("click", () => {
    setDrawTool(0);
});

patternButtons.forEach((button) => {
    button.addEventListener("click", () => {
        const nextPattern = button.dataset.pattern;

        if (selectedPattern === nextPattern) {
            clearPatternSelection();
            setStatus("パターン選択を解除しました。", false);
            return;
        }

        selectedPattern = nextPattern;
        patternButtons.forEach((otherButton) => {
            otherButton.classList.toggle("active", otherButton === button);
        });
        updateReadouts();
        setStatus(`${patternLabels[nextPattern]} を選択しました。次のクリックで配置されます。`, false);
    });
});

randomButton.addEventListener("click", randomize);
clearButton.addEventListener("click", clearGrid);

cellSizeSlider.addEventListener("input", () => {
    rebuildGrid(true);
    updateReadouts();
    setStatus(`セルサイズを ${cellSizeSlider.value}px に変更しました。`, false);
});

speedSlider.addEventListener("input", () => {
    updateReadouts();
});

window.addEventListener("resize", resizeCanvas);

if (canvas && context) {
    resizeCanvas();
    randomize();
    updateReadouts();
    window.requestAnimationFrame(animate);
}