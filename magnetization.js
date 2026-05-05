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

const magnetPowerSlider = document.querySelector("#magnetPower");
const magnetAngleSlider = document.querySelector("#magnetAngle");
const noiseSlider = document.querySelector("#noise");
const couplingSlider = document.querySelector("#coupling");
const randomizeBarsButton = document.querySelector("#randomizeBars");
const toggleFieldButton = document.querySelector("#toggleField");

const magnetPowerText = document.querySelector("#magnetPowerText");
const magnetAngleText = document.querySelector("#magnetAngleText");
const noiseText = document.querySelector("#noiseText");
const couplingText = document.querySelector("#couplingText");

const barAlignStat = document.querySelector("#barAlignStat");
const distanceStat = document.querySelector("#distanceStat");
const meanDirectionStat = document.querySelector("#meanDirectionStat");
const stateStat = document.querySelector("#stateStat");

const quickPower = document.querySelector("#quickPower");
const quickAlign = document.querySelector("#quickAlign");
const quickDistance = document.querySelector("#quickDistance");
const quickField = document.querySelector("#quickField");
const panelStatus = document.querySelector("#panelStatus");

const bars = [];
let width = 0;
let height = 0;
let showField = true;
let statusTimeout = 0;

const defaultStatus = "外部磁石を近づけると、近い場所の棒磁石ほど向きをそろえやすくなります。ノイズを強めると整列が崩れます。";
const externalMagnet = {
    u: 0.84,
    v: 0.46,
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

function initBars() {
    bars.length = 0;
    const columns = 12;
    const rows = 10;

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

    setStatus("棒磁石集団をランダム化しました。外部磁石を近づけると、平均方向がもう一度立ち上がります。", true);
}

function toggleFieldLines() {
    showField = !showField;
    updateToggleButton();
    updateUi();
    draw();
    setStatus(showField ? "磁力線表示を ON にしました。外部磁石がつくる場の向きが矢印で見えます。" : "磁力線表示を OFF にしました。棒磁石自身の向きだけを見たいときに使えます。", true);
}

function updateToggleButton() {
    if (toggleFieldButton) {
        toggleFieldButton.textContent = showField ? "磁力線を隠す" : "磁力線を表示";
    }
}

function getSceneRegion() {
    return {
        x: 18,
        y: 18,
        w: width - 36,
        h: height - 36
    };
}

function getBarArea() {
    const region = getSceneRegion();
    const compact = width <= 860;
    const topPad = compact ? 60 : 64;
    const bottomPad = compact ? 86 : 92;
    const sidePad = compact ? 14 : 18;

    return {
        x: region.x + sidePad,
        y: region.y + topPad,
        w: region.w - sidePad * 2,
        h: region.h - topPad - bottomPad
    };
}

function barPosition(bar, area) {
    const padX = 24;
    const padY = 22;

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
    const area = getBarArea();
    externalMagnet.u = clamp(externalMagnet.u, -0.12, 1.12);
    externalMagnet.v = clamp(externalMagnet.v, -0.12, 1.12);
    const magnetPosition = externalMagnetPosition(area);

    if (!Number.isFinite(magnetPosition.x) || !Number.isFinite(magnetPosition.y)) {
        externalMagnet.u = 0.84;
        externalMagnet.v = 0.46;
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

        if (r2 > 5200) {
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

function getAverageVector() {
    let sx = 0;
    let sy = 0;

    for (const bar of bars) {
        sx += Math.cos(bar.angle);
        sy += Math.sin(bar.angle);
    }

    return {
        x: sx,
        y: sy,
        magnitude: Math.sqrt(sx * sx + sy * sy) / bars.length
    };
}

function barAlignment() {
    return getAverageVector().magnitude;
}

function meanDirectionDegrees() {
    const average = getAverageVector();

    if (average.magnitude < 0.08) {
        return null;
    }

    return ((Math.atan2(average.y, average.x) * 180) / Math.PI + 360) % 360;
}

function alignmentLabel(alignment) {
    if (alignment > 0.78) {
        return "強く整列";
    }

    if (alignment > 0.48) {
        return "かなり整列";
    }

    if (alignment > 0.24) {
        return "ゆるく整列";
    }

    return "ばらばら";
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

function drawSceneBackground(region) {
    const gradient = context.createLinearGradient(region.x, region.y, region.x, region.y + region.h);
    gradient.addColorStop(0, "rgba(255, 255, 255, 0.8)");
    gradient.addColorStop(1, "rgba(245, 240, 255, 0.62)");
    context.fillStyle = gradient;
    drawRoundedRectPath(region.x, region.y, region.w, region.h, 24);
    context.fill();
    context.strokeStyle = "rgba(51, 65, 85, 0.12)";
    context.lineWidth = 1.5;
    context.stroke();
}

function drawFieldLines(area) {
    if (!showField) {
        return;
    }

    const step = width <= 860 ? 34 : 40;

    for (let y = area.y + 18; y < area.y + area.h; y += step) {
        for (let x = area.x + 18; x < area.x + area.w; x += step) {
            const field = externalFieldAt(x, y, area);
            const length = Math.min(24, Math.sqrt(field.x * field.x + field.y * field.y) * 20);
            const angle = Math.atan2(field.y, field.x);
            drawArrow(x, y, angle, length, "rgba(99, 102, 241, 0.34)");
        }
    }
}

function drawAlignmentMeter(x, y, meterWidth, alignment) {
    context.fillStyle = "#e5e7eb";
    context.fillRect(x, y, meterWidth, 16);
    context.fillStyle = "#7c3aed";
    context.fillRect(x, y, meterWidth * alignment, 16);
    context.strokeStyle = "#334155";
    context.lineWidth = 1.5;
    context.strokeRect(x, y, meterWidth, 16);
}

function drawBarsSimulation() {
    const compact = width <= 860;
    const region = getSceneRegion();
    const area = getBarArea();
    const magnetPosition = externalMagnetPosition(area);
    const average = getAverageVector();
    const averageAngle = Math.atan2(average.y, average.x);
    const alignment = average.magnitude;
    const barLength = clamp(area.w / 15, 16, 24);

    drawSceneBackground(region);

    context.fillStyle = "#111827";
    context.font = `${compact ? 16 : 18}px "IBM Plex Sans JP"`;
    context.fillText("棒磁石の集団", region.x + 16, region.y + 26);
    context.font = `${compact ? 12 : 13}px "IBM Plex Sans JP"`;
    context.fillStyle = "#475569";
    context.fillText("外部磁石と近傍相互作用で平均磁化が立ち上がる", region.x + 16, region.y + 46);

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

    drawBarMagnet(magnetPosition.x, magnetPosition.y, externalMagnet.angle, Math.max(78, barLength * 3.9), Math.max(20, barLength * 1.1), 1);
    context.fillStyle = "#111827";
    context.font = `${compact ? 12 : 13}px "IBM Plex Sans JP"`;
    context.fillText("外部磁石", magnetPosition.x - 24, magnetPosition.y - 34);

    if (alignment > 0.08) {
        drawArrow(area.x + area.w / 2, area.y + area.h + 26, averageAngle, 30 + alignment * 78, "rgba(124, 58, 237, 0.84)", 2.4);
        context.fillStyle = "#111827";
        context.fillText("集団の平均磁化方向", area.x + area.w / 2 - 56, area.y + area.h + 48);
    } else {
        context.fillStyle = "#111827";
        context.fillText("平均方向はまだ立っていません", area.x + area.w / 2 - 66, area.y + area.h + 38);
    }

    context.fillStyle = "#111827";
    context.fillText("整列度", area.x, region.y + region.h - 16);
    drawAlignmentMeter(area.x + 48, region.y + region.h - 28, area.w - 48, alignment);
}

function draw() {
    context.clearRect(0, 0, width, height);
    drawBarsSimulation();
}

function updateUi() {
    const power = Number(magnetPowerSlider.value);
    const angleDegrees = ((Math.round((externalMagnet.angle * 180) / Math.PI) % 360) + 360) % 360;
    const alignment = barAlignment();
    const meanDirection = meanDirectionDegrees();
    const area = getBarArea();
    const magnetPosition = externalMagnetPosition(area);
    const centerX = area.x + area.w / 2;
    const centerY = area.y + area.h / 2;
    const distance = Math.hypot(magnetPosition.x - centerX, magnetPosition.y - centerY);
    const state = alignmentLabel(alignment);

    magnetPowerText.textContent = power.toFixed(2);
    magnetAngleText.textContent = `${angleDegrees.toFixed(0)}°`;
    noiseText.textContent = Number(noiseSlider.value).toFixed(2);
    couplingText.textContent = Number(couplingSlider.value).toFixed(2);

    barAlignStat.textContent = `${(alignment * 100).toFixed(0)} %`;
    distanceStat.textContent = `${distance.toFixed(0)} px`;
    meanDirectionStat.textContent = meanDirection === null ? "---" : `${meanDirection.toFixed(0)}°`;
    stateStat.textContent = state;

    quickPower.textContent = power.toFixed(2);
    quickAlign.textContent = `${(alignment * 100).toFixed(0)} %`;
    quickDistance.textContent = `${distance.toFixed(0)} px`;
    quickField.textContent = showField ? "ON" : "OFF";
}

function resizeCanvas() {
    const nextWidth = Math.max(320, Math.floor(canvas.clientWidth || simulationShell.clientWidth || 320));
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

    width = nextWidth;

    if (window.matchMedia("(max-width: 860px)").matches) {
        height = Math.max(460, Math.min(620, Math.floor(Math.min(width * 1.26, viewportHeight * 0.72))));
    } else {
        height = Math.max(520, Math.min(640, Math.floor(width * 0.54)));
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
    const area = getBarArea();
    updateBars(area);
    updateUi();
    draw();
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
    const area = getBarArea();
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
    const area = getBarArea();
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

randomizeBarsButton?.addEventListener("click", randomizeBars);
toggleFieldButton?.addEventListener("click", toggleFieldLines);
magnetPowerSlider?.addEventListener("input", updateUi);
noiseSlider?.addEventListener("input", updateUi);
couplingSlider?.addEventListener("input", updateUi);
magnetAngleSlider?.addEventListener("input", () => {
    externalMagnet.angle = (Number(magnetAngleSlider.value) * Math.PI) / 180;
    updateUi();
});

window.addEventListener("resize", resizeCanvas);

initBars();
updateToggleButton();
resizeCanvas();
updateUi();
loop();