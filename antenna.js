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

const canvas = document.querySelector("#antennaCanvas");
const shell = document.querySelector("#antennaShell");
const stageStats = document.querySelector(".stage-stats");
const context = canvas?.getContext("2d");

if (!canvas || !shell || !context) {
    throw new Error("Antenna page failed to initialize.");
}

const frequencySlider = document.querySelector("#freq");
const powerSlider = document.querySelector("#power");
const lengthSlider = document.querySelector("#length");
const angleSlider = document.querySelector("#angle");
const modeSelect = document.querySelector("#mode");
const pauseButton = document.querySelector("#pauseBtn");
const resetButton = document.querySelector("#resetBtn");

const freqValue = document.querySelector("#freqVal");
const powerValue = document.querySelector("#powerVal");
const lengthValue = document.querySelector("#lenVal");
const angleValue = document.querySelector("#angleVal");
const modeLabel = document.querySelector("#modeLabel");

const quickMode = document.querySelector("#quickMode");
const quickSignal = document.querySelector("#quickSignal");
const quickMatch = document.querySelector("#quickMatch");
const waveStat = document.querySelector("#waveStat");
const halfWaveStat = document.querySelector("#halfWaveStat");
const resonanceStat = document.querySelector("#resonanceStat");
const polarizationStat = document.querySelector("#polarizationStat");
const signalStat = document.querySelector("#signalStat");
const couplingStat = document.querySelector("#couplingStat");
const panelStatus = document.querySelector("#panelStatus");
const hintText = document.querySelector("#hintText");

let viewWidth = 0;
let viewHeight = 0;
let time = 0;
let paused = false;
let lastFrameTime = performance.now();

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function roundedRectPath(ctx, x, y, width, height, radius) {
    const actualRadius = Math.min(radius, width / 2, height / 2);

    ctx.beginPath();
    ctx.moveTo(x + actualRadius, y);
    ctx.lineTo(x + width - actualRadius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + actualRadius);
    ctx.lineTo(x + width, y + height - actualRadius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - actualRadius, y + height);
    ctx.lineTo(x + actualRadius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - actualRadius);
    ctx.lineTo(x, y + actualRadius);
    ctx.quadraticCurveTo(x, y, x + actualRadius, y);
    ctx.closePath();
}

function drawRoundedRect(ctx, x, y, width, height, radius, fillStyle, strokeStyle = null, lineWidth = 1) {
    roundedRectPath(ctx, x, y, width, height, radius);

    if (fillStyle) {
        ctx.fillStyle = fillStyle;
        ctx.fill();
    }

    if (strokeStyle) {
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = strokeStyle;
        ctx.stroke();
    }
}

function drawArrow(x1, y1, x2, y2, color, width = 2) {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const head = 8;

    context.save();
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = width;
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
    context.beginPath();
    context.moveTo(x2, y2);
    context.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
    context.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
    context.closePath();
    context.fill();
    context.restore();
}

function drawBadge(x, y, text, fillStyle, strokeStyle, textColor) {
    const compact = viewWidth < 640;
    const fontSize = compact ? 12 : 13;
    const paddingX = compact ? 24 : 28;
    const badgeHeight = compact ? 30 : 32;
    const radius = compact ? 15 : 16;

    context.save();
    context.font = `600 ${fontSize}px "IBM Plex Sans JP", sans-serif`;
    const width = context.measureText(text).width + paddingX;
    const clampedX = clamp(x, width / 2 + 8, viewWidth - width / 2 - 8);

    drawRoundedRect(context, clampedX - width / 2, y - badgeHeight / 2, width, badgeHeight, radius, fillStyle, strokeStyle, 1);
    context.fillStyle = textColor;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, clampedX, y + 1);
    context.restore();
}

function modeLabelText() {
    switch (modeSelect.value) {
    case "electric":
        return "電場 E だけ";
    case "magnetic":
        return "磁場 B だけ";
    case "energy":
        return "エネルギーの流れ";
    default:
        return "電場 E と磁場 B";
    }
}

function resizeCanvas() {
    const shellWidth = shell.clientWidth;
    const targetHeight = window.innerWidth < 900
        ? clamp(window.innerHeight * 0.6, 460, 680)
        : clamp(shellWidth * 0.66, 580, 780);

    canvas.style.height = `${Math.round(targetHeight)}px`;

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    viewWidth = rect.width;
    viewHeight = rect.height;
}

function computeLayout() {
    const compact = viewWidth < 640;
    const statsAreOverlay = stageStats && window.getComputedStyle(stageStats).position !== "static";
    const overlayHeight = statsAreOverlay ? stageStats.getBoundingClientRect().height : 0;
    const topSafe = overlayHeight + (compact ? 56 : 96);
    const bottomSafe = compact ? 136 : 160;
    const availableHeight = Math.max(compact ? 180 : 260, viewHeight - topSafe - bottomSafe);
    const baseLength = Math.min(availableHeight * (compact ? 0.46 : 0.55), compact ? 138 : 172);
    const antennaLength = clamp(baseLength * Number(lengthSlider.value), compact ? 88 : 120, availableHeight * (compact ? 0.78 : 0.92));
    const cy = clamp(
        viewHeight * (compact ? 0.48 : 0.53),
        topSafe + antennaLength / 2 + 8,
        viewHeight - bottomSafe - antennaLength / 2 - (compact ? 8 : 16)
    );

    return {
        tx: viewWidth * (compact ? 0.24 : 0.18),
        rx: viewWidth * (compact ? 0.76 : 0.82),
        cy,
        topSafe,
        bottomSafe,
        antennaLength,
        compact
    };
}

function computeState(layout) {
    const frequency = Number(frequencySlider.value);
    const power = Number(powerSlider.value);
    const angleDeg = Number(angleSlider.value);
    const angleRad = angleDeg * Math.PI / 180;
    const omega = 2 * Math.PI * frequency;
    const waveLength = 220 / frequency;
    const halfWave = waveLength / 2;
    const resonance = Math.exp(-Math.pow((layout.antennaLength - halfWave) / (Math.max(halfWave, 1) * 0.55), 2));
    const polarization = Math.abs(Math.cos(angleRad));
    const txCurrent = Math.sin(omega * time);
    const rxPhase = omega * time - ((layout.rx - layout.tx) / waveLength) * 2 * Math.PI;
    const rxCurrent = Math.sin(rxPhase) * power * resonance * polarization;
    const receivedAmplitude = power * resonance * polarization;
    const coupling = resonance * polarization;

    return {
        mode: modeSelect.value,
        frequency,
        power,
        angleDeg,
        angleRad,
        omega,
        waveLength,
        halfWave,
        resonance,
        polarization,
        txCurrent,
        rxCurrent,
        receivedAmplitude,
        coupling,
        antennaLength: layout.antennaLength,
        waveAmplitude: (layout.compact ? 34 : 44) * power
    };
}

function updateLabels() {
    freqValue.textContent = Number(frequencySlider.value).toFixed(2);
    powerValue.textContent = Number(powerSlider.value).toFixed(2);
    lengthValue.textContent = Number(lengthSlider.value).toFixed(2);
    angleValue.textContent = `${angleSlider.value}°`;
    modeLabel.textContent = modeLabelText();
}

function updateDashboard(state) {
    quickMode.textContent = modeLabelText();
    quickSignal.textContent = state.receivedAmplitude.toFixed(2);
    quickMatch.textContent = `${Math.round(state.coupling * 100)} %`;
    waveStat.textContent = `${state.waveLength.toFixed(0)} px`;
    halfWaveStat.textContent = `${state.halfWave.toFixed(0)} px`;
    resonanceStat.textContent = `${Math.round(state.resonance * 100)} %`;
    polarizationStat.textContent = `${Math.round(state.polarization * 100)} %`;
    signalStat.textContent = state.rxCurrent.toFixed(2);
    couplingStat.textContent = `${Math.round(state.coupling * 100)} %`;
}

function refreshNarration() {
    const layout = computeLayout();
    const state = computeState(layout);
    const modeText = modeLabelText();
    let status = `表示モードは「${modeText}」です。`;

    if (state.polarization < 0.2) {
        status += " 受信アンテナがほぼ横向きで、偏波が合わず受信しにくい設定です。";
    } else if (state.resonance < 0.45) {
        status += " アンテナ長が半波長から外れていて、共振効率がかなり落ちています。";
    } else {
        status += " 偏波と長さの条件が比較的そろっていて、受信しやすい側の設定です。";
    }

    if (state.mode === "energy") {
        hintText.textContent = "緑の矢印はポインティングベクトルの向きを模式的に表し、電磁波のエネルギーが送信側から受信側へ運ばれる向きを示しています。";
    } else if (state.mode === "magnetic") {
        hintText.textContent = "桃の表示は磁場 B の変化です。電場だけでなく磁場も一緒に変化しないと、空間を進む電磁波にはなりません。";
    } else if (state.mode === "electric") {
        hintText.textContent = "青の矢印は電場 E の向きです。受信アンテナは、この電場の向きに沿って電子が動けるときほど強く応答します。";
    } else {
        hintText.textContent = "青は電場 E、桃は磁場 B、緑は電流またはエネルギーの向きを表します。受信アンテナを横向きにすると偏波がずれて信号が弱くなります。";
    }

    panelStatus.textContent = status;
}

function drawBackdrop(layout) {
    const background = context.createLinearGradient(0, 0, 0, viewHeight);
    background.addColorStop(0, "#020814");
    background.addColorStop(0.55, "#06101d");
    background.addColorStop(1, "#081524");
    context.fillStyle = background;
    context.fillRect(0, 0, viewWidth, viewHeight);

    const glowLeft = context.createRadialGradient(layout.tx, layout.cy, 20, layout.tx, layout.cy, 160);
    glowLeft.addColorStop(0, "rgba(96, 165, 250, 0.22)");
    glowLeft.addColorStop(1, "rgba(96, 165, 250, 0)");
    context.fillStyle = glowLeft;
    context.beginPath();
    context.arc(layout.tx, layout.cy, 160, 0, Math.PI * 2);
    context.fill();

    const glowRight = context.createRadialGradient(layout.rx, layout.cy, 18, layout.rx, layout.cy, 150);
    glowRight.addColorStop(0, "rgba(250, 204, 21, 0.22)");
    glowRight.addColorStop(1, "rgba(250, 204, 21, 0)");
    context.fillStyle = glowRight;
    context.beginPath();
    context.arc(layout.rx, layout.cy, 150, 0, Math.PI * 2);
    context.fill();

    context.save();
    context.strokeStyle = "rgba(148, 163, 184, 0.09)";
    context.lineWidth = 1;
    const step = viewWidth < 720 ? 32 : 40;

    for (let x = 0; x <= viewWidth; x += step) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, viewHeight);
        context.stroke();
    }

    for (let y = 0; y <= viewHeight; y += step) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(viewWidth, y);
        context.stroke();
    }

    context.restore();

    context.setLineDash([8, 10]);
    context.strokeStyle = "rgba(134, 239, 172, 0.16)";
    context.beginPath();
    context.moveTo(layout.tx + 42, layout.cy);
    context.lineTo(layout.rx - 42, layout.cy);
    context.stroke();
    context.setLineDash([]);
}

function drawDipole(x, y, length, current, title, rotation, responseStrength) {
    context.save();
    context.translate(x, y);
    context.rotate(rotation);

    const half = length / 2;
    const glow = clamp(responseStrength, 0.18, 1);

    context.shadowColor = `rgba(68, 196, 255, ${0.18 + glow * 0.18})`;
    context.shadowBlur = 18;
    context.lineCap = "round";
    context.lineWidth = 8;
    context.strokeStyle = "rgba(226, 232, 240, 0.95)";
    context.beginPath();
    context.moveTo(0, -half);
    context.lineTo(0, -14);
    context.moveTo(0, 14);
    context.lineTo(0, half);
    context.stroke();

    context.shadowBlur = 0;
    context.lineWidth = 2;
    context.strokeStyle = "rgba(68, 196, 255, 0.75)";
    context.beginPath();
    context.arc(0, 0, 12, 0, Math.PI * 2);
    context.stroke();

    const chargeOffset = current * half * 0.3;
    const topColor = current >= 0 ? "#f87171" : "#93c5fd";
    const bottomColor = current >= 0 ? "#93c5fd" : "#f87171";

    context.fillStyle = topColor;
    context.beginPath();
    context.arc(0, -half + 18 + chargeOffset, 8, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = bottomColor;
    context.beginPath();
    context.arc(0, half - 18 + chargeOffset, 8, 0, Math.PI * 2);
    context.fill();

    const arrowLength = 42 * Math.abs(current) * clamp(responseStrength, 0.2, 1);
    if (arrowLength > 2) {
        const direction = current >= 0 ? -1 : 1;
        drawArrow(0, 18 * direction, 0, (18 + arrowLength) * direction, "rgba(134, 239, 172, 0.92)", 3);
    }

    context.restore();
    drawBadge(
        x,
        y + length / 2 + (viewWidth < 640 ? 26 : 34),
        title,
        "rgba(7, 18, 34, 0.78)",
        "rgba(255, 255, 255, 0.12)",
        "#eff8ff"
    );
}

function drawWave(layout, state) {
    const start = layout.tx + 55;
    const end = layout.rx - 55;
    const k = 2 * Math.PI / state.waveLength;
    const centerY = layout.cy;

    context.save();
    context.lineWidth = 3;

    if (state.mode === "both" || state.mode === "electric") {
        context.strokeStyle = "rgba(96, 165, 250, 0.96)";
        context.beginPath();

        for (let x = start; x <= end; x += 3) {
            const phase = k * (x - start) - state.omega * time;
            const decay = 0.86 - 0.2 * ((x - start) / Math.max(1, end - start));
            const y = centerY - Math.sin(phase) * state.waveAmplitude * decay;
            if (x === start) {
                context.moveTo(x, y);
            } else {
                context.lineTo(x, y);
            }
        }

        context.stroke();

        for (let x = start + 18; x < end; x += 48) {
            const phase = k * (x - start) - state.omega * time;
            const electric = Math.sin(phase) * state.waveAmplitude * 0.78;
            drawArrow(x, centerY, x, centerY - electric, "rgba(96, 165, 250, 0.78)", 2);
        }
    }

    if (state.mode === "both" || state.mode === "magnetic") {
        const magneticOffset = layout.compact ? 56 : 74;
        context.strokeStyle = "rgba(244, 114, 182, 0.88)";
        context.beginPath();

        for (let x = start; x <= end; x += 3) {
            const phase = k * (x - start) - state.omega * time - Math.PI / 2;
            const decay = 0.86 - 0.2 * ((x - start) / Math.max(1, end - start));
            const y = centerY + Math.sin(phase) * state.waveAmplitude * 0.55 * decay;
            if (x === start) {
                context.moveTo(x, y);
            } else {
                context.lineTo(x, y);
            }
        }

        context.stroke();

        for (let x = start + (layout.compact ? 34 : 44); x < end; x += (layout.compact ? 54 : 62)) {
            const phase = k * (x - start) - state.omega * time - Math.PI / 2;
            const magnetic = Math.sin(phase);
            context.fillStyle = magnetic >= 0 ? "rgba(244, 114, 182, 0.92)" : "rgba(244, 114, 182, 0.38)";
            context.beginPath();
            context.arc(x, centerY + magneticOffset, (layout.compact ? 7 : 9) + Math.abs(magnetic) * (layout.compact ? 4 : 6), 0, Math.PI * 2);
            context.fill();
            context.strokeStyle = "rgba(244, 114, 182, 0.42)";
            context.stroke();
            context.fillStyle = "rgba(255, 255, 255, 0.84)";
            context.font = `${layout.compact ? 11 : 12}px "IBM Plex Sans JP", sans-serif`;
            context.textAlign = "center";
            context.textBaseline = "middle";
            context.fillText(magnetic >= 0 ? "⊙" : "⊗", x, centerY + magneticOffset + 1);
        }
    }

    if (state.mode === "energy") {
        context.strokeStyle = "rgba(134, 239, 172, 0.22)";
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(start, centerY);
        context.lineTo(end, centerY);
        context.stroke();

        for (let x = start + 20; x < end; x += 42) {
            const phase = k * (x - start) - state.omega * time;
            const strength = Math.max(0.25, Math.abs(Math.sin(phase)));
            drawArrow(
                x - 14,
                centerY,
                x + 18 + strength * 18,
                centerY,
                `rgba(134, 239, 172, ${0.36 + strength * 0.58})`,
                2 + strength * 2
            );
        }
    }

    context.restore();
}

function drawMeter(x, y, width, height, value, label, color) {
    drawRoundedRect(context, x, y, width, height, 14, "rgba(7, 18, 34, 0.82)", "rgba(255, 255, 255, 0.12)", 1);
    context.fillStyle = "rgba(226, 232, 240, 0.92)";
    context.font = '13px "IBM Plex Sans JP", sans-serif';
    context.textAlign = "left";
    context.fillText(label, x + 12, y + 21);
    context.fillText(`${Math.round(value * 100)}%`, x + width - 48, y + 21);

    drawRoundedRect(context, x + 12, y + height - 22, width - 24, 12, 7, "rgba(30, 41, 59, 0.9)");
    drawRoundedRect(context, x + 12, y + height - 22, (width - 24) * clamp(value, 0, 1), 12, 7, color);
}

function drawStatusBoxes(layout, state) {
    if (layout.compact) {
        drawBadge(
            viewWidth * 0.5,
            layout.topSafe - 20,
            state.mode === "energy" ? "送信→受信: エネルギー輸送" : "送信→受信: 電磁波で結ぶ",
            "rgba(9, 18, 33, 0.84)",
            state.mode === "energy" ? "rgba(134, 239, 172, 0.22)" : "rgba(96, 165, 250, 0.2)",
            state.mode === "energy" ? "#d6ffea" : "#d8f1ff"
        );
        return;
    }

    drawBadge(
        layout.tx,
        layout.cy - layout.antennaLength / 2 - 34,
        "送信: 交流電流で電荷が加速",
        "rgba(9, 18, 33, 0.84)",
        "rgba(96, 165, 250, 0.2)",
        "#d8f1ff"
    );
    drawBadge(
        layout.rx,
        layout.cy - layout.antennaLength / 2 - 34,
        "受信: 到来した電場で電流が生じる",
        "rgba(9, 18, 33, 0.84)",
        "rgba(250, 204, 21, 0.22)",
        "#fff7cf"
    );

    if (state.mode === "energy") {
        drawBadge(viewWidth * 0.5, layout.topSafe + 18, "エネルギーの流れ S = E × B", "rgba(15, 35, 34, 0.84)", "rgba(134, 239, 172, 0.2)", "#d6ffea");
    }
}

function drawFooterMetrics(state, layout) {
    if (layout.compact) {
        const gutter = 12;
        const meterWidth = (viewWidth - gutter * 3) / 2;
        const meterY = viewHeight - 70;

        drawBadge(
            viewWidth * 0.5,
            meterY - 22,
            `受信 ${state.rxCurrent.toFixed(2)} / λ ${state.waveLength.toFixed(0)} px`,
            "rgba(7, 18, 34, 0.84)",
            "rgba(255, 255, 255, 0.12)",
            "#eff8ff"
        );
        drawMeter(gutter, meterY, meterWidth, 50, state.resonance, "長さ整合", "rgba(134, 239, 172, 0.92)");
        drawMeter(gutter * 2 + meterWidth, meterY, meterWidth, 50, state.polarization, "偏波一致", "rgba(96, 165, 250, 0.92)");
        return;
    }

    drawMeter(18, viewHeight - 148, 240, 62, state.resonance, "アンテナ長と波長の相性", "rgba(134, 239, 172, 0.92)");
    drawMeter(18, viewHeight - 80, 240, 62, state.polarization, "偏波の向きの一致", "rgba(96, 165, 250, 0.92)");

    const boxWidth = 260;
    const boxX = viewWidth - boxWidth - 18;
    const boxY = viewHeight - 112;
    drawRoundedRect(context, boxX, boxY, boxWidth, 94, 16, "rgba(7, 18, 34, 0.84)", "rgba(255, 255, 255, 0.12)", 1);
    context.fillStyle = "rgba(226, 232, 240, 0.94)";
    context.font = '13px "IBM Plex Sans JP", sans-serif';
    context.textAlign = "left";
    context.fillText(`受信信号 ≈ ${state.rxCurrent.toFixed(2)}`, boxX + 16, boxY + 28);
    context.fillText(`波長スケール ≈ ${state.waveLength.toFixed(0)} px`, boxX + 16, boxY + 54);
    context.fillText(`半波長 ≈ ${state.halfWave.toFixed(0)} px`, boxX + 16, boxY + 80);
}

function renderFrame(state, layout) {
    context.clearRect(0, 0, viewWidth, viewHeight);
    drawBackdrop(layout);
    drawWave(layout, state);
    drawDipole(layout.tx, layout.cy, layout.antennaLength, state.txCurrent, "送信アンテナ", 0, 1);
    drawDipole(layout.rx, layout.cy, layout.antennaLength, state.rxCurrent, "受信アンテナ", state.angleRad, Math.max(0.16, state.coupling));
    drawStatusBoxes(layout, state);
    drawFooterMetrics(state, layout);
}

function animate(now) {
    const deltaTime = Math.min(0.04, (now - lastFrameTime) / 1000);
    lastFrameTime = now;

    if (!paused) {
        time += deltaTime;
    }

    const layout = computeLayout();
    const state = computeState(layout);
    updateDashboard(state);
    renderFrame(state, layout);
    requestAnimationFrame(animate);
}

function handleControlChange() {
    updateLabels();
    refreshNarration();
}

[frequencySlider, powerSlider, lengthSlider, angleSlider, modeSelect].forEach((element) => {
    element.addEventListener("input", handleControlChange);
    element.addEventListener("change", handleControlChange);
});

pauseButton.addEventListener("click", () => {
    paused = !paused;
    pauseButton.textContent = paused ? "再開" : "一時停止";
});

resetButton.addEventListener("click", () => {
    time = 0;
    paused = false;
    pauseButton.textContent = "一時停止";
    refreshNarration();
});

window.addEventListener("resize", () => {
    resizeCanvas();
    refreshNarration();
});

resizeCanvas();
updateLabels();
refreshNarration();
requestAnimationFrame(animate);