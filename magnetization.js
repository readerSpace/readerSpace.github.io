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

const canvas = document.querySelector("#magnetizationCanvas");
const simulationShell = document.querySelector("#playgroundShell");
const context = canvas?.getContext("2d");

if (!canvas || !simulationShell || !context) {
    throw new Error("Magnetization page failed to initialize.");
}

const temperatureSlider = document.querySelector("#temperature");
const fieldSlider = document.querySelector("#field");
const magnetPowerSlider = document.querySelector("#magnetPower");
const magnetAngleSlider = document.querySelector("#magnetAngle");
const noiseSlider = document.querySelector("#noise");
const couplingSlider = document.querySelector("#coupling");
const randomizeIsingButton = document.querySelector("#randomizeIsing");
const alignUpButton = document.querySelector("#alignUp");
const alignDownButton = document.querySelector("#alignDown");
const randomizeBarsButton = document.querySelector("#randomizeBars");
const toggleFieldButton = document.querySelector("#toggleField");

const tempText = document.querySelector("#tempText");
const fieldText = document.querySelector("#fieldText");
const magnetPowerText = document.querySelector("#magnetPowerText");
const magnetAngleText = document.querySelector("#magnetAngleText");
const noiseText = document.querySelector("#noiseText");
const couplingText = document.querySelector("#couplingText");

const isingMagStat = document.querySelector("#isingMagStat");
const phaseStat = document.querySelector("#phaseStat");
const barAlignStat = document.querySelector("#barAlignStat");
const distanceStat = document.querySelector("#distanceStat");

const quickTemp = document.querySelector("#quickTemp");
const quickMag = document.querySelector("#quickMag");
const quickAlign = document.querySelector("#quickAlign");
const quickField = document.querySelector("#quickField");
const panelStatus = document.querySelector("#panelStatus");

const ISING_SIZE = 56;
const CRITICAL_TEMPERATURE = 2.27;
const bars = [];
let spins = [];
let width = 0;
let height = 0;
let showField = true;
let statusTimeout = 0;

const defaultStatus = "左の温度を上げると整列が崩れやすくなり、右の外部磁石を近づけると棒磁石の向きが少しずつそろいます。";
const externalMagnet = {
    u: 0.88,
    v: 0.52,
    angle: Math.PI,
    dragging: false
};

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
        }, 3000);
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
}

function randomizeIsing() {
    initIsing();
    setStatus("イジングモデルをランダム初期化しました。低温へ下げると同じ向きの島が育ちやすくなります。", true);
}

function alignIsing(direction) {
    spins = Array.from({ length: ISING_SIZE }, () =>
        Array.from({ length: ISING_SIZE }, () => direction)
    );
    setStatus(direction > 0 ? "全スピンを上向きにそろえました。高温にすると整列が崩れていきます。" : "全スピンを下向きにそろえました。外部磁場や温度で偏りの戻り方を見比べられます。", true);
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

function initBars() {
    bars.length = 0;
    const columns = 11;
    const rows = 11;

    for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
            bars.push({
                u: column / (columns - 1),
                v: row / (rows - 1),
                angle: Math.random() * Math.PI * 2,
                omega: 0
            });
        }
    }
}

function randomizeBars() {
    for (const bar of bars) {
        bar.angle = Math.random() * Math.PI * 2;
        bar.omega = 0;
    }

    setStatus("棒磁石集団をランダム化しました。外部磁石を近づけると再び平均方向が立ち上がります。", true);
}

function toggleFieldLines() {
    showField = !showField;
    updateToggleButton();
    setStatus(showField ? "磁力線表示を ON にしました。外部磁石がつくる場の向きが矢印で見えます。" : "磁力線表示を OFF にしました。棒磁石自身の向きだけを見たいときに使えます。", true);
}

function updateToggleButton() {
    if (toggleFieldButton) {
        toggleFieldButton.textContent = showField ? "磁力線を隠す" : "磁力線を表示";
    }
}

function getRegions() {
    const compact = width <= 860;
    const outerPadding = compact ? 18 : 24;
    const topOffset = compact ? 18 : 20;
    const gap = compact ? 22 : 24;

    if (compact) {
        const zoneWidth = width - outerPadding * 2;
        const zoneHeight = (height - topOffset * 2 - gap) / 2;

        return {
            compact,
            ising: {
                x: outerPadding,
                y: topOffset,
                w: zoneWidth,
                h: zoneHeight
            },
            bars: {
                x: outerPadding,
                y: topOffset + zoneHeight + gap,
                w: zoneWidth,
                h: zoneHeight
            }
        };
    }

    const zoneWidth = (width - outerPadding * 2 - gap) / 2;
    const zoneHeight = height - topOffset * 2;

    return {
        compact,
        ising: {
            x: outerPadding,
            y: topOffset,
            w: zoneWidth,
            h: zoneHeight
        },
        bars: {
            x: outerPadding + zoneWidth + gap,
            y: topOffset,
            w: zoneWidth,
            h: zoneHeight
        }
    };
}

function getIsingBoard(region) {
    const labelSpace = width <= 860 ? 60 : 68;
    const footerSpace = width <= 860 ? 82 : 96;
    const boardSize = Math.max(120, Math.min(region.w - 22, region.h - labelSpace - footerSpace));

    return {
        x: region.x + (region.w - boardSize) / 2,
        y: region.y + labelSpace,
        size: boardSize,
        cell: boardSize / ISING_SIZE
    };
}

function getBarArea(region) {
    const topPad = width <= 860 ? 56 : 64;
    const bottomPad = width <= 860 ? 52 : 64;
    const sidePad = width <= 860 ? 16 : 18;

    return {
        x: region.x + sidePad,
        y: region.y + topPad,
        w: region.w - sidePad * 2,
        h: region.h - topPad - bottomPad
    };
}

function barPosition(bar, area) {
    const padX = 24;
    const padY = 24;

    return {
        x: area.x + padX + bar.u * Math.max(1, area.w - padX * 2),
        y: area.y + padY + bar.v * Math.max(1, area.h - padY * 2)
    };
}

function externalMagnetPosition(area) {
    return {
        x: area.x + externalMagnet.u * area.w,
        y: area.y + externalMagnet.v * area.h
    };
}

function syncExternalMagnet() {
    const area = getBarArea(getRegions().bars);
    externalMagnet.u = clamp(externalMagnet.u, -0.12, 1.12);
    externalMagnet.v = clamp(externalMagnet.v, -0.12, 1.12);
    const magnetPosition = externalMagnetPosition(area);

    if (!Number.isFinite(magnetPosition.x) || !Number.isFinite(magnetPosition.y)) {
        externalMagnet.u = 0.88;
        externalMagnet.v = 0.52;
    }
}

function angleDiff(a, b) {
    let difference = a - b;

    while (difference > Math.PI) {
        difference -= Math.PI * 2;
    }

    while (difference < -Math.PI) {
        difference += Math.PI * 2;
    }

    return difference;
}

function vecFromAngle(angle) {
    return {
        x: Math.cos(angle),
        y: Math.sin(angle)
    };
}

function externalFieldAt(x, y, area) {
    const magnetPosition = externalMagnetPosition(area);
    const dx = x - magnetPosition.x;
    const dy = y - magnetPosition.y;
    const r2 = dx * dx + dy * dy + 900;
    const r = Math.sqrt(r2);
    const nx = dx / r;
    const ny = dy / r;
    const magnetVector = vecFromAngle(externalMagnet.angle);
    const dot = magnetVector.x * nx + magnetVector.y * ny;
    const strength = Number(magnetPowerSlider.value) * 52000 / (r2 * r);

    return {
        x: strength * (3 * dot * nx - magnetVector.x),
        y: strength * (3 * dot * ny - magnetVector.y)
    };
}

function neighborFieldAt(index, area) {
    const target = barPosition(bars[index], area);
    const coupling = Number(couplingSlider.value);
    let fx = 0;
    let fy = 0;

    for (let i = 0; i < bars.length; i += 1) {
        if (i === index) {
            continue;
        }

        const source = barPosition(bars[i], area);
        const dx = source.x - target.x;
        const dy = source.y - target.y;
        const r2 = dx * dx + dy * dy + 1200;

        if (r2 > 5000) {
            continue;
        }

        const direction = vecFromAngle(bars[i].angle);
        const scale = coupling * 18 / r2;
        fx += direction.x * scale;
        fy += direction.y * scale;
    }

    return { x: fx, y: fy };
}

function updateBars(area) {
    const noise = Number(noiseSlider.value);

    for (let index = 0; index < bars.length; index += 1) {
        const position = barPosition(bars[index], area);
        const externalField = externalFieldAt(position.x, position.y, area);
        const neighborField = neighborFieldAt(index, area);
        const fx = externalField.x + neighborField.x;
        const fy = externalField.y + neighborField.y;
        const targetAngle = Math.abs(fx) + Math.abs(fy) > 1e-12 ? Math.atan2(fy, fx) : bars[index].angle;
        const difference = angleDiff(targetAngle, bars[index].angle);
        const torque = Math.sin(difference);

        bars[index].omega += torque * 0.055;
        bars[index].omega += (Math.random() - 0.5) * noise * 0.16;
        bars[index].omega *= 0.9;
        bars[index].angle += bars[index].omega;
    }
}

function barAlignment() {
    let sx = 0;
    let sy = 0;

    for (const bar of bars) {
        sx += Math.cos(bar.angle);
        sy += Math.sin(bar.angle);
    }

    return Math.sqrt(sx * sx + sy * sy) / bars.length;
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

function updateUi(regions) {
    const temperature = Number(temperatureSlider.value);
    const field = Number(fieldSlider.value);
    const magnetization = isingMagnetization();
    const alignment = barAlignment();
    const barArea = getBarArea(regions.bars);
    const magnetPosition = externalMagnetPosition(barArea);
    const centerX = barArea.x + barArea.w / 2;
    const centerY = barArea.y + barArea.h / 2;
    const distance = Math.hypot(magnetPosition.x - centerX, magnetPosition.y - centerY);
    const angleDegrees = Math.round((externalMagnet.angle * 180) / Math.PI) % 360;

    tempText.textContent = temperature.toFixed(2);
    fieldText.textContent = field.toFixed(2);
    magnetPowerText.textContent = Number(magnetPowerSlider.value).toFixed(2);
    magnetAngleText.textContent = `${((angleDegrees + 360) % 360).toFixed(0)}°`;
    noiseText.textContent = Number(noiseSlider.value).toFixed(2);
    couplingText.textContent = Number(couplingSlider.value).toFixed(2);

    isingMagStat.textContent = magnetization.toFixed(3);
    phaseStat.textContent = phaseLabel(magnetization, temperature, field);
    barAlignStat.textContent = `${(alignment * 100).toFixed(0)} %`;
    distanceStat.textContent = `${distance.toFixed(0)} px`;

    quickTemp.textContent = temperature.toFixed(2);
    quickMag.textContent = magnetization.toFixed(3);
    quickAlign.textContent = `${(alignment * 100).toFixed(0)} %`;
    quickField.textContent = showField ? "ON" : "OFF";
}

function drawArrow(x, y, angle, length, color, lineWidth = 2) {
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = lineWidth;
    context.beginPath();
    context.moveTo(-length * 0.4, 0);
    context.lineTo(length * 0.6, 0);
    context.stroke();
    context.beginPath();
    context.moveTo(length * 0.6, 0);
    context.lineTo(length * 0.25, -5);
    context.lineTo(length * 0.25, 5);
    context.closePath();
    context.fill();
    context.restore();
}

function drawBarMagnet(x, y, angle, length, barWidth = 8, alpha = 1) {
    context.save();
    context.translate(x, y);
    context.rotate(angle);

    context.fillStyle = `rgba(220, 38, 38, ${alpha})`;
    context.fillRect(0, -barWidth / 2, length / 2, barWidth);
    context.fillStyle = `rgba(37, 99, 235, ${alpha})`;
    context.fillRect(-length / 2, -barWidth / 2, length / 2, barWidth);
    context.strokeStyle = `rgba(17, 24, 39, ${0.45 * alpha})`;
    context.lineWidth = 1.4;
    context.strokeRect(-length / 2, -barWidth / 2, length, barWidth);
    context.fillStyle = `rgba(255, 255, 255, ${0.9 * alpha})`;
    context.font = `${Math.max(7, Math.floor(barWidth * 0.9))}px "IBM Plex Sans JP"`;
    context.fillText("N", length / 4 - 3, 3);
    context.fillText("S", -length / 4 - 3, 3);
    context.restore();
}

function drawRegionBackground(region, tintA, tintB) {
    const gradient = context.createLinearGradient(region.x, region.y, region.x, region.y + region.h);
    gradient.addColorStop(0, tintA);
    gradient.addColorStop(1, tintB);
    context.fillStyle = gradient;
    drawRoundedRectPath(region.x, region.y, region.w, region.h, 24);
    context.fill();
    context.strokeStyle = "rgba(51, 65, 85, 0.12)";
    context.lineWidth = 1.5;
    context.stroke();
}

function drawIsing(region) {
    const compact = width <= 860;
    const board = getIsingBoard(region);
    const magnetization = isingMagnetization();
    const meterX = board.x;
    const meterY = board.y + board.size + 18;
    const meterWidth = board.size;
    const meterHeight = 18;
    const tempBarY = meterY + 34;
    const temp = Number(temperatureSlider.value);

    drawRegionBackground(region, "rgba(255, 255, 255, 0.78)", "rgba(255, 245, 245, 0.58)");

    context.fillStyle = "#111827";
    context.font = `${compact ? 16 : 18}px "IBM Plex Sans JP"`;
    context.fillText("イジングモデル", region.x + 16, region.y + 24);
    context.font = `${compact ? 12 : 13}px "IBM Plex Sans JP"`;
    context.fillStyle = "#475569";
    context.fillText("低温ではそろい、高温では熱ゆらぎでほどける", region.x + 16, region.y + 44);

    for (let row = 0; row < ISING_SIZE; row += 1) {
        for (let column = 0; column < ISING_SIZE; column += 1) {
            context.fillStyle = spins[row][column] === 1 ? "#ef4444" : "#2563eb";
            context.fillRect(board.x + column * board.cell, board.y + row * board.cell, board.cell + 0.3, board.cell + 0.3);
        }
    }

    context.strokeStyle = "#334155";
    context.lineWidth = 2.5;
    context.strokeRect(board.x, board.y, board.size, board.size);

    context.fillStyle = "#e5e7eb";
    context.fillRect(meterX, meterY, meterWidth, meterHeight);
    context.fillStyle = magnetization >= 0 ? "#ef4444" : "#2563eb";
    context.fillRect(meterX + meterWidth / 2, meterY, (meterWidth / 2) * magnetization, meterHeight);
    context.strokeStyle = "#334155";
    context.strokeRect(meterX, meterY, meterWidth, meterHeight);
    context.fillStyle = "#111827";
    context.font = `${compact ? 12 : 13}px "IBM Plex Sans JP"`;
    context.fillText("磁化 M", meterX, meterY - 8);
    context.fillText(magnetization.toFixed(3), meterX + meterWidth / 2 - 18, meterY + 34);

    context.fillStyle = "#e5e7eb";
    context.fillRect(meterX, tempBarY, meterWidth, 12);
    context.strokeStyle = "#334155";
    context.strokeRect(meterX, tempBarY, meterWidth, 12);

    const tempX = meterX + ((temp - 0.5) / 4.5) * meterWidth;
    const criticalX = meterX + ((CRITICAL_TEMPERATURE - 0.5) / 4.5) * meterWidth;
    context.fillStyle = "#f97316";
    context.fillRect(tempX - 2, tempBarY - 5, 4, 22);
    context.strokeStyle = "#111827";
    context.beginPath();
    context.moveTo(criticalX, tempBarY - 7);
    context.lineTo(criticalX, tempBarY + 18);
    context.stroke();
    context.fillStyle = "#111827";
    context.fillText("T", meterX, tempBarY - 8);
    if (!compact) {
        context.fillText("臨界付近", criticalX - 25, tempBarY + 34);
    }
}

function drawFieldLines(area) {
    if (!showField) {
        return;
    }

    const step = width <= 860 ? 36 : 42;

    for (let y = area.y + 20; y < area.y + area.h; y += step) {
        for (let x = area.x + 20; x < area.x + area.w; x += step) {
            const field = externalFieldAt(x, y, area);
            const length = Math.min(24, Math.sqrt(field.x * field.x + field.y * field.y) * 20);
            const angle = Math.atan2(field.y, field.x);
            drawArrow(x, y, angle, length, "rgba(99, 102, 241, 0.34)");
        }
    }
}

function drawBarsSimulation(region) {
    const compact = width <= 860;
    const area = getBarArea(region);
    const magnetPosition = externalMagnetPosition(area);
    const alignment = barAlignment();
    const averageX = bars.reduce((sum, bar) => sum + Math.cos(bar.angle), 0);
    const averageY = bars.reduce((sum, bar) => sum + Math.sin(bar.angle), 0);
    const averageAngle = Math.atan2(averageY, averageX);
    const barLength = clamp(area.w / 14, 16, 24);

    drawRegionBackground(region, "rgba(255, 255, 255, 0.78)", "rgba(245, 240, 255, 0.6)");

    context.fillStyle = "#111827";
    context.font = `${compact ? 16 : 18}px "IBM Plex Sans JP"`;
    context.fillText("棒磁石の集団", region.x + 16, region.y + 24);
    context.font = `${compact ? 12 : 13}px "IBM Plex Sans JP"`;
    context.fillStyle = "#475569";
    context.fillText("外部磁石を動かすと局所磁場へ少しずつ回る", region.x + 16, region.y + 44);

    context.fillStyle = "rgba(248, 250, 252, 0.82)";
    drawRoundedRectPath(area.x, area.y, area.w, area.h, 18);
    context.fill();
    context.strokeStyle = "#cbd5e1";
    context.lineWidth = 2;
    context.stroke();

    drawFieldLines(area);

    for (const bar of bars) {
        const position = barPosition(bar, area);
        const field = externalFieldAt(position.x, position.y, area);
        const fieldStrength = Math.min(1, Math.sqrt(field.x * field.x + field.y * field.y) * 2.4);
        drawBarMagnet(position.x, position.y, bar.angle, barLength, Math.max(6, barLength * 0.34), 0.55 + fieldStrength * 0.45);
    }

    drawBarMagnet(magnetPosition.x, magnetPosition.y, externalMagnet.angle, Math.max(74, barLength * 3.8), Math.max(20, barLength * 1.1), 1);
    context.fillStyle = "#111827";
    context.font = `${compact ? 12 : 13}px "IBM Plex Sans JP"`;
    context.fillText("外部磁石", magnetPosition.x - 24, magnetPosition.y - 34);

    drawArrow(area.x + area.w / 2, region.y + region.h - 28, averageAngle, 30 + alignment * 76, "rgba(124, 58, 237, 0.84)", 2.4);
    context.fillStyle = "#111827";
    context.fillText("集団の平均磁化方向", area.x + area.w / 2 - 56, region.y + region.h - 8);
}

function draw(regions) {
    context.clearRect(0, 0, width, height);

    drawIsing(regions.ising);
    drawBarsSimulation(regions.bars);

    context.fillStyle = "#111827";
    context.font = `${width <= 860 ? 12 : 13}px "IBM Plex Sans JP"`;

    if (width <= 860) {
        context.fillText("左: イジング模型 / 右: 棒磁石集団", 20, height - 12);
    } else {
        context.fillText("左: 温度と外部磁場で変わる磁化", 20, height - 12);
        context.fillText("右: 外部磁石と近傍相互作用でそろう棒磁石集団", width / 2 + 8, height - 12);
    }
}

function resizeCanvas() {
    const nextWidth = Math.max(320, Math.floor(canvas.clientWidth || simulationShell.clientWidth || 320));
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

    width = nextWidth;

    if (window.matchMedia("(max-width: 860px)").matches) {
        height = Math.max(640, Math.min(820, Math.floor(Math.min(width * 1.95, viewportHeight * 0.9))));
    } else {
        height = Math.max(680, Math.min(780, Math.floor(width * 0.62)));
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    syncExternalMagnet();
}

function loop() {
    const regions = getRegions();

    for (let step = 0; step < 2; step += 1) {
        isingStep();
    }

    updateBars(getBarArea(regions.bars));
    updateUi(regions);
    draw(regions);
    window.requestAnimationFrame(loop);
}

function getPointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;

    return {
        x: (event.clientX - rect.left) * scaleX,
        y: (event.clientY - rect.top) * scaleY
    };
}

canvas.addEventListener("pointerdown", (event) => {
    const point = getPointerPosition(event);
    const area = getBarArea(getRegions().bars);
    const magnetPosition = externalMagnetPosition(area);

    if (Math.hypot(point.x - magnetPosition.x, point.y - magnetPosition.y) < 64) {
        externalMagnet.dragging = true;
        canvas.setPointerCapture(event.pointerId);
    }
});

canvas.addEventListener("pointermove", (event) => {
    if (!externalMagnet.dragging) {
        return;
    }

    const point = getPointerPosition(event);
    const area = getBarArea(getRegions().bars);
    const margin = 42;
    const clampedX = clamp(point.x, area.x - margin, area.x + area.w + margin);
    const clampedY = clamp(point.y, area.y - margin, area.y + area.h + margin);

    externalMagnet.u = (clampedX - area.x) / area.w;
    externalMagnet.v = (clampedY - area.y) / area.h;
});

function stopDragging(pointerId) {
    externalMagnet.dragging = false;

    try {
        canvas.releasePointerCapture(pointerId);
    } catch (_) {
        return;
    }
}

canvas.addEventListener("pointerup", (event) => {
    stopDragging(event.pointerId);
});

canvas.addEventListener("pointercancel", (event) => {
    stopDragging(event.pointerId);
});

randomizeIsingButton?.addEventListener("click", randomizeIsing);
alignUpButton?.addEventListener("click", () => alignIsing(1));
alignDownButton?.addEventListener("click", () => alignIsing(-1));
randomizeBarsButton?.addEventListener("click", randomizeBars);
toggleFieldButton?.addEventListener("click", toggleFieldLines);

temperatureSlider?.addEventListener("input", () => updateUi(getRegions()));
fieldSlider?.addEventListener("input", () => updateUi(getRegions()));
magnetPowerSlider?.addEventListener("input", () => updateUi(getRegions()));
noiseSlider?.addEventListener("input", () => updateUi(getRegions()));
couplingSlider?.addEventListener("input", () => updateUi(getRegions()));
magnetAngleSlider?.addEventListener("input", () => {
    externalMagnet.angle = (Number(magnetAngleSlider.value) * Math.PI) / 180;
    updateUi(getRegions());
});

window.addEventListener("resize", resizeCanvas);

initIsing();
initBars();
updateToggleButton();
resizeCanvas();
updateUi(getRegions());
loop();