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

const canvas = document.querySelector("#isingCanvas");
const simulationShell = document.querySelector("#playgroundShell");
const context = canvas?.getContext("2d");

if (!canvas || !simulationShell || !context) {
    throw new Error("Ising model page failed to initialize.");
}

const temperatureSlider = document.querySelector("#temperature");
const fieldSlider = document.querySelector("#field");
const randomizeButton = document.querySelector("#randomizeIsing");
const alignUpButton = document.querySelector("#alignUp");
const alignDownButton = document.querySelector("#alignDown");
const togglePauseButton = document.querySelector("#togglePause");

const tempText = document.querySelector("#tempText");
const fieldText = document.querySelector("#fieldText");
const magStat = document.querySelector("#magStat");
const upStat = document.querySelector("#upStat");
const phaseStat = document.querySelector("#phaseStat");
const runtimeStat = document.querySelector("#runtimeStat");

const quickTemp = document.querySelector("#quickTemp");
const quickField = document.querySelector("#quickField");
const quickMag = document.querySelector("#quickMag");
const quickPhase = document.querySelector("#quickPhase");
const panelStatus = document.querySelector("#panelStatus");

const ISING_SIZE = 56;
const CRITICAL_TEMPERATURE = 2.27;
const magnetizationHistory = [];
let spins = [];
let width = 0;
let height = 0;
let paused = false;
let statusTimeout = 0;

const defaultStatus = "温度を上げると整列が崩れやすくなります。T ≈ 2.27 付近では大きな塊ができたり崩れたりするゆらぎが見えやすくなります。";

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function setStatus(message, reset = false) {
    if (!panelStatus) {
        return;
    }

    panelStatus.textContent = message;
    window.clearTimeout(statusTimeout);

    if (reset) {
        statusTimeout = window.setTimeout(() => {
            panelStatus.textContent = defaultStatus;
        }, 3200);
    }
}

function drawRoundedRectPath(x, y, boxWidth, boxHeight, radius) {
    const r = Math.min(radius, boxWidth / 2, boxHeight / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + boxWidth - r, y);
    context.quadraticCurveTo(x + boxWidth, y, x + boxWidth, y + r);
    context.lineTo(x + boxWidth, y + boxHeight - r);
    context.quadraticCurveTo(x + boxWidth, y + boxHeight, x + boxWidth - r, y + boxHeight);
    context.lineTo(x + r, y + boxHeight);
    context.quadraticCurveTo(x, y + boxHeight, x, y + boxHeight - r);
    context.lineTo(x, y + r);
    context.quadraticCurveTo(x, y, x + r, y);
    context.closePath();
}

function initIsing() {
    spins = Array.from({ length: ISING_SIZE }, () =>
        Array.from({ length: ISING_SIZE }, () => (Math.random() < 0.5 ? 1 : -1))
    );
    magnetizationHistory.length = 0;
}

function randomizeIsing() {
    initIsing();
    setStatus("イジングモデルをランダム初期化しました。低温へ下げると同じ向きの塊が育ちやすくなります。", true);
}

function alignIsing(direction) {
    spins = Array.from({ length: ISING_SIZE }, () =>
        Array.from({ length: ISING_SIZE }, () => direction)
    );
    magnetizationHistory.length = 0;
    setStatus(direction > 0 ? "全スピンを上向きにそろえました。高温にすると整列が崩れていきます。" : "全スピンを下向きにそろえました。外部磁場と温度で偏りの戻り方を見比べられます。", true);
}

function togglePause() {
    paused = !paused;
    updatePauseButton();
    updateUi();
    draw(getLayout());
    setStatus(paused ? "更新を止めました。現在のスピン配置と磁化グラフを静止して観察できます。" : "更新を再開しました。温度と外部磁場で塊の崩れ方がどう変わるかを見てください。", true);
}

function updatePauseButton() {
    if (togglePauseButton) {
        togglePauseButton.textContent = paused ? "再開" : "一時停止";
    }
}

function isingStep() {
    const temperature = Number(temperatureSlider.value);
    const field = Number(fieldSlider.value);
    const coupling = 1;

    for (let trial = 0; trial < ISING_SIZE * ISING_SIZE * 0.35; trial += 1) {
        const row = Math.floor(Math.random() * ISING_SIZE);
        const column = Math.floor(Math.random() * ISING_SIZE);
        const spin = spins[row][column];
        const up = spins[(row - 1 + ISING_SIZE) % ISING_SIZE][column];
        const down = spins[(row + 1) % ISING_SIZE][column];
        const left = spins[row][(column - 1 + ISING_SIZE) % ISING_SIZE];
        const right = spins[row][(column + 1) % ISING_SIZE];
        const neighborSum = up + down + left + right;
        const deltaEnergy = 2 * spin * (coupling * neighborSum + field);

        if (deltaEnergy <= 0 || Math.random() < Math.exp(-deltaEnergy / temperature)) {
            spins[row][column] = -spin;
        }
    }
}

function isingMagnetization() {
    let sum = 0;

    for (let row = 0; row < ISING_SIZE; row += 1) {
        for (let column = 0; column < ISING_SIZE; column += 1) {
            sum += spins[row][column];
        }
    }

    return sum / (ISING_SIZE * ISING_SIZE);
}

function upSpinRatio(magnetization) {
    return (magnetization + 1) / 2;
}

function phaseLabel(magnetization, temperature, field) {
    if (Math.abs(temperature - CRITICAL_TEMPERATURE) < 0.25) {
        return "臨界付近";
    }

    if (temperature > 3.2 && Math.abs(magnetization) < 0.18) {
        return "高温で乱雑";
    }

    if (Math.abs(field) > 0.3 && Math.abs(magnetization) > 0.18) {
        return "外場で偏る";
    }

    if (Math.abs(magnetization) > 0.7) {
        return "強く磁化";
    }

    if (Math.abs(magnetization) > 0.28) {
        return "弱く磁化";
    }

    return "ランダム";
}

function pushHistory() {
    magnetizationHistory.push(isingMagnetization());

    if (magnetizationHistory.length > 220) {
        magnetizationHistory.shift();
    }
}

function getLayout() {
    const compact = width <= 860;

    if (compact) {
        const boardPanel = {
            x: 18,
            y: 18,
            w: width - 36,
            h: Math.min(height * 0.5, width + 34)
        };
        const boardSize = Math.min(boardPanel.w - 34, boardPanel.h - 92);

        return {
            compact,
            boardPanel,
            board: {
                x: boardPanel.x + (boardPanel.w - boardSize) / 2,
                y: boardPanel.y + 56,
                size: boardSize,
                cell: boardSize / ISING_SIZE
            },
            infoPanel: {
                x: 18,
                y: boardPanel.y + boardPanel.h + 16,
                w: width - 36,
                h: height - (boardPanel.y + boardPanel.h + 34)
            }
        };
    }

    const boardSize = Math.min(height - 124, width * 0.46);
    const boardPanel = {
        x: 18,
        y: 18,
        w: boardSize + 34,
        h: height - 36
    };

    return {
        compact,
        boardPanel,
        board: {
            x: boardPanel.x + 17,
            y: boardPanel.y + 62,
            size: boardSize,
            cell: boardSize / ISING_SIZE
        },
        infoPanel: {
            x: boardPanel.x + boardPanel.w + 16,
            y: 18,
            w: width - (boardPanel.x + boardPanel.w + 34),
            h: height - 36
        }
    };
}

function drawPanelBox(panel, tintA, tintB) {
    const gradient = context.createLinearGradient(panel.x, panel.y, panel.x, panel.y + panel.h);
    gradient.addColorStop(0, tintA);
    gradient.addColorStop(1, tintB);
    context.fillStyle = gradient;
    drawRoundedRectPath(panel.x, panel.y, panel.w, panel.h, 24);
    context.fill();
    context.strokeStyle = "rgba(51, 65, 85, 0.12)";
    context.lineWidth = 1.5;
    context.stroke();
}

function drawBoard(layout) {
    const compact = layout.compact;
    const { boardPanel, board } = layout;

    drawPanelBox(boardPanel, "rgba(255, 255, 255, 0.8)", "rgba(255, 244, 244, 0.6)");
    context.fillStyle = "#111827";
    context.font = `${compact ? 16 : 18}px "IBM Plex Sans JP"`;
    context.fillText("スピン配置", boardPanel.x + 16, boardPanel.y + 26);
    context.font = `${compact ? 12 : 13}px "IBM Plex Sans JP"`;
    context.fillStyle = "#475569";
    context.fillText("赤 = 上向き、青 = 下向き", boardPanel.x + 16, boardPanel.y + 46);

    for (let row = 0; row < ISING_SIZE; row += 1) {
        for (let column = 0; column < ISING_SIZE; column += 1) {
            context.fillStyle = spins[row][column] === 1 ? "#ef4444" : "#2563eb";
            context.fillRect(board.x + column * board.cell, board.y + row * board.cell, board.cell + 0.3, board.cell + 0.3);
        }
    }

    context.strokeStyle = "#334155";
    context.lineWidth = 2.5;
    context.strokeRect(board.x, board.y, board.size, board.size);
}

function drawMeter(x, y, widthValue, magnetization) {
    context.fillStyle = "#e5e7eb";
    context.fillRect(x, y, widthValue, 18);
    context.fillStyle = magnetization >= 0 ? "#ef4444" : "#2563eb";
    context.fillRect(x + widthValue / 2, y, (widthValue / 2) * magnetization, 18);
    context.strokeStyle = "#334155";
    context.lineWidth = 1.8;
    context.strokeRect(x, y, widthValue, 18);
}

function drawTemperatureBar(x, y, widthValue, temperature) {
    context.fillStyle = "#e5e7eb";
    context.fillRect(x, y, widthValue, 12);
    context.strokeStyle = "#334155";
    context.lineWidth = 1.5;
    context.strokeRect(x, y, widthValue, 12);

    const markerX = x + ((temperature - 0.5) / 4.5) * widthValue;
    const criticalX = x + ((CRITICAL_TEMPERATURE - 0.5) / 4.5) * widthValue;

    context.fillStyle = "#f97316";
    context.fillRect(markerX - 2, y - 5, 4, 22);
    context.strokeStyle = "#111827";
    context.beginPath();
    context.moveTo(criticalX, y - 7);
    context.lineTo(criticalX, y + 18);
    context.stroke();
}

function drawHistoryGraph(x, y, graphWidth, graphHeight) {
    context.fillStyle = "rgba(248, 250, 252, 0.86)";
    drawRoundedRectPath(x, y, graphWidth, graphHeight, 18);
    context.fill();
    context.strokeStyle = "rgba(148, 163, 184, 0.68)";
    context.lineWidth = 1.2;
    context.stroke();

    const zeroY = y + graphHeight / 2;
    context.strokeStyle = "rgba(148, 163, 184, 0.56)";
    context.beginPath();
    context.moveTo(x + 12, zeroY);
    context.lineTo(x + graphWidth - 12, zeroY);
    context.stroke();

    if (magnetizationHistory.length < 2) {
        return;
    }

    context.strokeStyle = "#0f6ca6";
    context.lineWidth = 2;
    context.beginPath();

    magnetizationHistory.forEach((value, index) => {
        const px = x + 14 + index / (magnetizationHistory.length - 1) * (graphWidth - 28);
        const py = y + graphHeight / 2 - value * (graphHeight * 0.38);

        if (index === 0) {
            context.moveTo(px, py);
        } else {
            context.lineTo(px, py);
        }
    });

    context.stroke();
}

function drawInfoPanel(layout) {
    const compact = layout.compact;
    const panel = layout.infoPanel;
    const magnetization = isingMagnetization();
    const temperature = Number(temperatureSlider.value);
    const field = Number(fieldSlider.value);
    const graphY = compact ? panel.y + 164 : panel.y + 188;
    const graphHeight = compact ? Math.max(110, panel.h - 250) : Math.max(170, panel.h - 286);

    drawPanelBox(panel, "rgba(255, 255, 255, 0.8)", "rgba(241, 245, 255, 0.62)");

    context.fillStyle = "#111827";
    context.font = `${compact ? 16 : 18}px "IBM Plex Sans JP"`;
    context.fillText("磁化の読み取り", panel.x + 16, panel.y + 28);
    context.font = `${compact ? 12 : 13}px "IBM Plex Sans JP"`;
    context.fillStyle = "#475569";
    context.fillText("時間変化・臨界温度・式の対応を同時に見る", panel.x + 16, panel.y + 48);

    context.fillStyle = "#111827";
    context.fillText("磁化 M", panel.x + 16, panel.y + 78);
    drawMeter(panel.x + 16, panel.y + 88, panel.w - 32, magnetization);
    context.fillStyle = "#111827";
    context.fillText(magnetization.toFixed(3), panel.x + panel.w - 62, panel.y + 82);

    context.fillText("温度 T と臨界温度", panel.x + 16, panel.y + 132);
    drawTemperatureBar(panel.x + 16, panel.y + 142, panel.w - 32, temperature);
    context.fillStyle = "#111827";
    context.fillText(`T = ${temperature.toFixed(2)} / h = ${field.toFixed(2)}`, panel.x + 16, panel.y + 170);

    context.fillText("磁化の時間変化", panel.x + 16, graphY - 10);
    drawHistoryGraph(panel.x + 16, graphY, panel.w - 32, graphHeight);

    const footerY = graphY + graphHeight + 28;
    context.fillStyle = "#111827";
    context.font = `${compact ? 12 : 13}px "IBM Plex Sans JP"`;
    context.fillText("H = -J Σ s_i s_j - h Σ s_i", panel.x + 16, footerY);
    context.fillText("M = (1 / N) Σ s_i", panel.x + 16, footerY + 22);
    context.fillText("受理確率 ≈ exp(-ΔE / T)", panel.x + 16, footerY + 44);
}

function draw(layout) {
    context.clearRect(0, 0, width, height);
    drawBoard(layout);
    drawInfoPanel(layout);
}

function updateUi() {
    const temperature = Number(temperatureSlider.value);
    const field = Number(fieldSlider.value);
    const magnetization = isingMagnetization();
    const upRatioValue = upSpinRatio(magnetization);
    const phase = phaseLabel(magnetization, temperature, field);

    tempText.textContent = temperature.toFixed(2);
    fieldText.textContent = field.toFixed(2);
    magStat.textContent = magnetization.toFixed(3);
    upStat.textContent = `${(upRatioValue * 100).toFixed(0)} %`;
    phaseStat.textContent = phase;
    runtimeStat.textContent = paused ? "停止中" : "更新中";

    quickTemp.textContent = temperature.toFixed(2);
    quickField.textContent = field.toFixed(2);
    quickMag.textContent = magnetization.toFixed(3);
    quickPhase.textContent = phase;
}

function resizeCanvas() {
    const nextWidth = Math.max(320, Math.floor(canvas.clientWidth || simulationShell.clientWidth || 320));
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

    width = nextWidth;

    if (window.matchMedia("(max-width: 860px)").matches) {
        height = Math.max(620, Math.min(800, Math.floor(Math.min(width * 1.52, viewportHeight * 0.9))));
    } else {
        height = Math.max(580, Math.min(720, Math.floor(width * 0.56)));
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function loop() {
    if (!paused) {
        for (let step = 0; step < 2; step += 1) {
            isingStep();
        }

        pushHistory();
    }

    updateUi();
    draw(getLayout());
    window.requestAnimationFrame(loop);
}

randomizeButton?.addEventListener("click", randomizeIsing);
alignUpButton?.addEventListener("click", () => alignIsing(1));
alignDownButton?.addEventListener("click", () => alignIsing(-1));
togglePauseButton?.addEventListener("click", togglePause);
temperatureSlider?.addEventListener("input", updateUi);
fieldSlider?.addEventListener("input", updateUi);
window.addEventListener("resize", resizeCanvas);

initIsing();
updatePauseButton();
resizeCanvas();
pushHistory();
updateUi();
loop();