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

const canvas = document.querySelector("#plantCanvas");
const simulationShell = document.querySelector("#playgroundShell");
const context = canvas?.getContext("2d");

if (!canvas || !simulationShell || !context) {
    throw new Error("Plant growth page failed to initialize.");
}

const sunlightSlider = document.querySelector("#sunlight");
const co2Slider = document.querySelector("#co2");
const o2Slider = document.querySelector("#o2");
const setDayButton = document.querySelector("#setDay");
const setNightButton = document.querySelector("#setNight");
const addNutrientsButton = document.querySelector("#addNutrients");
const resetButton = document.querySelector("#resetSim");

const sunText = document.querySelector("#sunText");
const co2Text = document.querySelector("#co2Text");
const o2Text = document.querySelector("#o2Text");
const modeStat = document.querySelector("#modeStat");
const sizeStat = document.querySelector("#sizeStat");
const nutrientStat = document.querySelector("#nutrientStat");
const healthStat = document.querySelector("#healthStat");
const photoRateStat = document.querySelector("#photoRateStat");
const respRateStat = document.querySelector("#respRateStat");

const quickSun = document.querySelector("#quickSun");
const quickCo2 = document.querySelector("#quickCo2");
const quickNutrients = document.querySelector("#quickNutrients");
const quickMode = document.querySelector("#quickMode");
const panelStatus = document.querySelector("#panelStatus");

let width = 0;
let height = 0;
let nutrients = 45;
let plantSize = 1;
let health = 100;
let alive = true;
let particles = [];
let history = [];
let tick = 0;
let widthDpr = 1;
let statusTimeout = 0;
let lastTime = 0;
let historyAccumulator = 0;

const defaultStatus = "昼は CO2 を使って栄養と O2 を作り、夜は O2 と栄養を使って CO2 を出します。栄養が余ると成長し、尽きると枯れます。";

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

function modeLabel() {
    if (!alive) {
        return "枯死";
    }

    return Number(sunlightSlider.value) > 5 ? "光合成" : "呼吸";
}

function photosynthesisRate() {
    if (!alive) {
        return 0;
    }

    const light = Number(sunlightSlider.value) / 100;
    const co2 = Number(co2Slider.value) / 100;
    const leafFactor = Math.min(2.2, plantSize);
    const healthFactor = health / 100;
    return light * co2 * leafFactor * healthFactor;
}

function respirationRate() {
    if (!alive) {
        return 0;
    }

    const light = Number(sunlightSlider.value) / 100;
    const darkness = 1 - light;
    const o2 = Number(o2Slider.value) / 100;
    const sizeFactor = 0.4 + plantSize * 0.55;
    return (0.18 + darkness * 0.75) * o2 * sizeFactor;
}

function getLayout() {
    const compact = width <= 820;
    const narrow = width <= 560;
    const skyHeight = compact ? height * 0.6 : height * 0.68;
    const soilTop = skyHeight;
    const boxY = compact ? (narrow ? height * 0.68 : height * 0.76) : height * 0.72;
    const boxH = height - boxY - (narrow ? 16 : compact ? 18 : 26);
    const graphWidth = compact ? (narrow ? width * 0.43 : width * 0.44) : 300;
    const barWidth = compact ? (narrow ? width * 0.43 : width * 0.44) : 300;
    const leftPadding = compact ? 16 : 22;
    const gap = compact ? (narrow ? 12 : 14) : 20;
    const barBox = {
        x: leftPadding,
        y: boxY,
        w: Math.min(barWidth, width * 0.48 - leftPadding),
        h: boxH
    };
    const graphBox = {
        x: compact ? width - graphWidth - 16 : width - graphWidth - 22,
        y: compact ? boxY : height * 0.705,
        w: Math.min(graphWidth, width - barBox.x - barBox.w - gap - leftPadding),
        h: compact ? boxH : height - height * 0.705 - 26
    };

    return {
        compact,
        narrow,
        soilTop,
        baseX: compact ? width * 0.5 : width * 0.54,
        baseY: soilTop + (compact ? 8 : 14),
        scale: compact ? clamp(width / 780, 0.74, 0.94) : clamp(width / 1180, 0.82, 1.08),
        leafTarget: {
            x: compact ? width * 0.5 : width * 0.54,
            y: compact ? height * 0.28 : height * 0.33
        },
        equationCard: {
            x: compact ? width - 190 : (width <= 900 ? width - 248 : width - 284),
            y: compact ? 16 : 24,
            w: compact ? 170 : (width <= 900 ? 228 : 260),
            h: compact ? 80 : 92
        },
        barBox,
        graphBox
    };
}

function setDay() {
    sunlightSlider.value = 82;
    setStatus("昼にしました。CO2 があれば、光合成で栄養と O2 が増えやすくなります。", true);
    updateUi();
    draw();
}

function setNight() {
    sunlightSlider.value = 0;
    setStatus("夜にしました。これ以降は呼吸が主になり、O2 と栄養を消費して CO2 を出します。", true);
    updateUi();
    draw();
}

function addNutrients() {
    if (!alive) {
        health = Math.max(26, health);
    }

    alive = true;
    nutrients = clamp(nutrients + 25, 0, 100);
    setStatus("栄養を追加しました。十分な光と CO2 があれば、再び成長へ向かいます。", true);
    updateUi();
    draw();
}

function resetSim() {
    nutrients = 45;
    plantSize = 1;
    health = 100;
    alive = true;
    sunlightSlider.value = 70;
    co2Slider.value = 55;
    o2Slider.value = 45;
    particles = [];
    history = [];
    tick = 0;
    historyAccumulator = 0;
    setStatus(defaultStatus);
    updateUi();
    draw();
}

function pushHistory() {
    history.push({
        co2: Number(co2Slider.value),
        o2: Number(o2Slider.value),
        nutrients,
        size: plantSize,
        health
    });

    if (history.length > 120) {
        history.shift();
    }
}

function makeParticles(photo, resp, timeScale, layout) {
    const sun = Number(sunlightSlider.value);
    const leafTarget = layout.leafTarget;
    const mobile = width <= 560;
    const photoBurst = mobile ? 2 : 4;
    const photoRateScale = mobile ? 8 : 12;
    const sunBurst = mobile ? 1 : 2;
    const sunRateScale = mobile ? 65 : 40;
    const respBurst = mobile ? 2 : 3;
    const respRateScale = mobile ? 7 : 10;
    const particleCap = mobile ? 30 : 140;

    if (photo > 0.01) {
        for (let index = 0; index < Math.min(photoBurst, Math.floor(photo * photoRateScale * timeScale) + 1); index += 1) {
            particles.push({
                type: Math.random() < 0.55 ? "co2_in" : "o2_out",
                x: Math.random() * width,
                y: 90 + Math.random() * Math.max(80, layout.soilTop * 0.42),
                vx: 0,
                vy: 0,
                life: 1,
                r: 4 + Math.random() * 4,
                targetX: leafTarget.x,
                targetY: leafTarget.y
            });
        }

        for (let index = 0; index < Math.min(sunBurst, Math.floor((sun / sunRateScale) * timeScale) + 1); index += 1) {
            particles.push({
                type: "sun",
                x: 60 + Math.random() * 260,
                y: 36 + Math.random() * 10,
                vx: 1.1 + Math.random() * 1.4,
                vy: 1.1 + Math.random() * 1.2,
                life: 1,
                r: 5,
                targetX: leafTarget.x,
                targetY: leafTarget.y
            });
        }
    }

    if (resp > 0.01) {
        for (let index = 0; index < Math.min(respBurst, Math.floor(resp * respRateScale * timeScale) + 1); index += 1) {
            particles.push({
                type: Math.random() < 0.5 ? "o2_in" : "co2_out",
                x: leafTarget.x + Math.random() * 160 - 80,
                y: leafTarget.y + 30 + Math.random() * 90,
                vx: 0,
                vy: 0,
                life: 1,
                r: 4 + Math.random() * 4,
                targetX: leafTarget.x,
                targetY: leafTarget.y
            });
        }
    }

    if (particles.length > particleCap) {
        particles.splice(0, particles.length - particleCap);
    }
}

function updateModel(timeScale) {
    tick += 0.035 * timeScale;
    const wasAlive = alive;

    if (!alive) {
        health = Math.max(0, health - 0.02 * timeScale);
        return;
    }

    let co2 = Number(co2Slider.value);
    let o2 = Number(o2Slider.value);
    const photoRate = photosynthesisRate();
    const respRate = respirationRate();

    const photo = Math.min(co2, photoRate * 0.16 * timeScale);
    co2 -= photo;
    o2 += photo * 0.95;
    nutrients += photo * 0.75;

    const resp = Math.min(o2, nutrients, respRate * 0.12 * timeScale);
    o2 -= resp;
    co2 += resp * 0.95;
    nutrients -= resp * 0.9;

    if (nutrients > 35 && health > 40) {
        const growth = Math.min(nutrients - 35, 0.018 * plantSize * (0.5 + health / 100) * timeScale);
        nutrients -= growth * 1.9;
        plantSize += growth * 0.018;
    }

    if (nutrients < 8) {
        health -= 0.16 * timeScale;
    } else if (nutrients < 18) {
        health -= 0.045 * timeScale;
    } else {
        health += 0.025 * timeScale;
    }

    if (o2 < 2 && Number(sunlightSlider.value) < 10) {
        health -= 0.08 * timeScale;
    }

    if (co2 < 2 && Number(sunlightSlider.value) > 30) {
        health -= 0.04 * timeScale;
    }

    nutrients = clamp(nutrients, 0, 100);
    plantSize = clamp(plantSize, 0.7, 2.4);
    health = clamp(health, 0, 100);
    co2 = clamp(co2, 0, 100);
    o2 = clamp(o2, 0, 100);

    co2Slider.value = co2.toFixed(2);
    o2Slider.value = o2.toFixed(2);

    if (health <= 0 || nutrients <= 0.2) {
        alive = false;
        health = 0;
    }

    historyAccumulator += timeScale;

    if (historyAccumulator >= 8) {
        pushHistory();
        historyAccumulator = 0;
    }

    makeParticles(photo, resp, timeScale, getLayout());

    if (wasAlive && !alive) {
        setStatus("栄養が尽きて枯れてしまいました。栄養を追加すると、弱った状態から再開できます。", true);
    }
}

function updateParticles(timeScale) {
    const targetLeaf = getLayout().leafTarget;

    for (const particle of particles) {
        if (particle.type === "co2_in" || particle.type === "o2_in") {
            const dx = targetLeaf.x - particle.x;
            const dy = targetLeaf.y - particle.y;
            particle.vx += dx * 0.0009 * timeScale;
            particle.vy += dy * 0.0009 * timeScale;
        } else if (particle.type === "o2_out" || particle.type === "co2_out") {
            particle.vx += (particle.x < targetLeaf.x ? -0.035 : 0.035) * timeScale;
            particle.vy -= 0.025 * timeScale;
        }

        particle.x += particle.vx * timeScale;
        particle.y += particle.vy * timeScale;
        particle.vx *= Math.pow(0.98, timeScale);
        particle.vy *= Math.pow(0.98, timeScale);
        particle.life -= 0.008 * timeScale;
    }

    particles = particles.filter((particle) => (
        particle.life > 0 &&
        particle.x > -40 && particle.x < width + 40 &&
        particle.y > -40 && particle.y < height + 40
    ));
}

function drawBackground(layout) {
    const sun = Number(sunlightSlider.value) / 100;
    const skyGrad = context.createLinearGradient(0, 0, 0, layout.soilTop);

    if (sun > 0.05) {
        skyGrad.addColorStop(0, `rgba(191, 219, 254, ${0.45 + sun * 0.55})`);
        skyGrad.addColorStop(1, "#f0fdf4");
    } else {
        skyGrad.addColorStop(0, "#111827");
        skyGrad.addColorStop(1, "#334155");
    }

    context.fillStyle = skyGrad;
    context.fillRect(0, 0, width, layout.soilTop);

    if (sun <= 0.05) {
        context.fillStyle = "rgba(226, 232, 240, 0.9)";

        for (let index = 0; index < 24; index += 1) {
            context.beginPath();
            context.arc((index * 73) % width, 24 + (index * 47) % Math.max(60, layout.soilTop - 120), 1.2 + (index % 3) * 0.6, 0, Math.PI * 2);
            context.fill();
        }
    }

    context.fillStyle = "#9a6a3a";
    context.fillRect(0, layout.soilTop, width, height - layout.soilTop);
    context.fillStyle = "rgba(80, 47, 25, 0.25)";

    for (let index = 0; index < 80; index += 1) {
        context.beginPath();
        context.arc((index * 97) % width, layout.soilTop + 10 + ((index * 43) % Math.max(30, height - layout.soilTop - 20)), 1.5, 0, Math.PI * 2);
        context.fill();
    }

    if (sun > 0.05) {
        context.fillStyle = `rgba(250, 204, 21, ${0.35 + sun * 0.65})`;
        context.beginPath();
        context.arc(92, 86, 36 + sun * 8, 0, Math.PI * 2);
        context.fill();
    } else {
        context.fillStyle = "rgba(226, 232, 240, 0.9)";
        context.beginPath();
        context.arc(92, 86, 31, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#111827";
        context.beginPath();
        context.arc(105, 78, 30, 0, Math.PI * 2);
        context.fill();
    }
}

function drawLeaf(x, y, angle, leafWidth, leafHeight, color) {
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    context.fillStyle = color;
    context.beginPath();
    context.ellipse(0, 0, leafWidth, leafHeight, 0, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "rgba(22, 101, 52, 0.45)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(-leafWidth * 0.75, 0);
    context.lineTo(leafWidth * 0.75, 0);
    context.stroke();
    context.restore();
}

function drawPlant(layout) {
    const baseX = layout.baseX;
    const baseY = layout.baseY;
    const scale = plantSize * layout.scale;
    const wilt = alive ? 0 : 28 * layout.scale;
    const healthFactor = health / 100;
    const stemColor = alive ? `rgb(${70 + (1 - healthFactor) * 80}, ${130 + healthFactor * 70}, 60)` : "#7c5c3e";
    const leafColor = alive ? `rgb(${35 + (1 - healthFactor) * 90}, ${120 + healthFactor * 90}, 50)` : "#8b7355";

    context.lineCap = "round";
    context.strokeStyle = stemColor;
    context.lineWidth = 10 + scale * 3;
    context.beginPath();
    context.moveTo(baseX, baseY);
    context.quadraticCurveTo(baseX + 5 * layout.scale, baseY - 90 * scale, baseX - 4 * layout.scale, baseY - 165 * scale + wilt);
    context.stroke();

    const leafPositions = [
        { x: -42, y: -78, a: -0.45, scale: 1.0 },
        { x: 46, y: -105, a: 0.55, scale: 1.1 },
        { x: -48, y: -138, a: -0.65, scale: 0.95 },
        { x: 42, y: -165, a: 0.7, scale: 0.85 },
        { x: 0, y: -195, a: -0.05, scale: 0.75 }
    ];

    for (const leaf of leafPositions) {
        const sway = alive ? Math.sin(tick + leaf.x * 0.03) * 0.05 : 0.6;
        drawLeaf(
            baseX + leaf.x * scale,
            baseY + leaf.y * scale + wilt,
            leaf.a + sway,
            44 * scale * leaf.scale,
            22 * scale * leaf.scale,
            leafColor
        );
    }

    if (alive && plantSize > 1.25) {
        context.fillStyle = "rgba(250, 204, 21, 0.9)";
        context.beginPath();
        context.arc(baseX + 6 * layout.scale, baseY - 202 * scale, 7 * layout.scale, 0, Math.PI * 2);
        context.fill();
    }

    context.strokeStyle = "#6b4423";
    context.lineWidth = 3;

    for (let index = -3; index <= 3; index += 1) {
        context.beginPath();
        context.moveTo(baseX, baseY);
        context.quadraticCurveTo(baseX + index * 18 * scale, baseY + 22 * layout.scale, baseX + index * 30 * scale, baseY + 50 * layout.scale + Math.abs(index) * 5 * layout.scale);
        context.stroke();
    }

    if (!alive) {
        context.fillStyle = "rgba(120, 53, 15, 0.16)";
        context.beginPath();
        context.arc(baseX, baseY - 80 * layout.scale, 120 * Math.min(1.4, scale), 0, Math.PI * 2);
        context.fill();
    }
}

function drawParticles() {
    for (const particle of particles) {
        let color = "#ffffff";
        let text = "";

        if (particle.type === "co2_in" || particle.type === "co2_out") {
            color = `rgba(75, 85, 99, ${0.25 + particle.life * 0.6})`;
            text = "CO2";
        } else if (particle.type === "o2_in" || particle.type === "o2_out") {
            color = `rgba(56, 189, 248, ${0.25 + particle.life * 0.6})`;
            text = "O2";
        } else if (particle.type === "sun") {
            color = `rgba(250, 204, 21, ${0.25 + particle.life * 0.7})`;
            text = "光";
        }

        context.fillStyle = color;
        context.beginPath();
        context.arc(particle.x, particle.y, particle.r + 7, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#111827";
        context.font = `${width <= 820 ? 10 : 11}px "IBM Plex Sans JP"`;
        context.fillText(text, particle.x - 10, particle.y + 4);
    }
}

function drawBars(layout) {
    const box = layout.barBox;
    const items = [
        { name: "CO2", value: Number(co2Slider.value), color: "#4b5563" },
        { name: "O2", value: Number(o2Slider.value), color: "#38bdf8" },
        { name: "栄養", value: nutrients, color: "#22c55e" },
        { name: "元気", value: health, color: "#f97316" }
    ];
    const gap = 10;
    const innerX = box.x + 12;
    const headerOffset = layout.narrow ? 46 : 34;
    const innerY = box.y + headerOffset;
    const barWidth = (box.w - 24 - gap * 3) / 4;
    const barHeight = box.h - (layout.narrow ? 68 : 58);

    context.fillStyle = "rgba(255, 255, 255, 0.76)";
    drawRoundedRectPath(box.x, box.y, box.w, box.h, 16);
    context.fill();
    context.strokeStyle = "rgba(148, 163, 184, 0.72)";
    context.lineWidth = 1.4;
    context.stroke();

    context.fillStyle = "#111827";
    context.font = `${width <= 560 ? 11 : width <= 820 ? 12 : 13}px "IBM Plex Sans JP"`;
    context.fillText("環境と内部状態", box.x + 12, box.y + 22);

    items.forEach((item, index) => {
        const x = innerX + index * (barWidth + gap);
        const fillHeight = (item.value / 100) * Math.max(10, barHeight - 26);

        context.fillStyle = "rgba(248, 250, 252, 0.92)";
        context.fillRect(x, innerY, barWidth, barHeight - 22);
        context.strokeStyle = "#cbd5e1";
        context.strokeRect(x, innerY, barWidth, barHeight - 22);
        context.fillStyle = item.color;
        context.fillRect(x, innerY + (barHeight - 22) - fillHeight, barWidth, fillHeight);
        context.fillStyle = "#111827";
        context.font = `${width <= 560 ? 10 : width <= 820 ? 11 : 12}px "IBM Plex Sans JP"`;
        context.fillText(item.name, x + Math.max(4, barWidth * 0.22), innerY - (layout.narrow ? 12 : 8));
        context.fillText(`${item.value.toFixed(0)}%`, x + Math.max(4, barWidth * 0.16), box.y + box.h - 10);
    });
}

function drawLine(values, box, color) {
    if (values.length < 2) {
        return;
    }

    context.strokeStyle = color;
    context.lineWidth = 2;
    context.beginPath();

    values.forEach((value, index) => {
        const px = box.x + 10 + index / (values.length - 1) * (box.w - 20);
        const py = box.y + box.h - 14 - (value / 100) * (box.h - 38);

        if (index === 0) {
            context.moveTo(px, py);
        } else {
            context.lineTo(px, py);
        }
    });

    context.stroke();
}

function drawGraph(layout) {
    const box = layout.graphBox;
    const chart = {
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h
    };

    context.fillStyle = "rgba(255, 255, 255, 0.76)";
    drawRoundedRectPath(chart.x, chart.y, chart.w, chart.h, 16);
    context.fill();
    context.strokeStyle = "rgba(148, 163, 184, 0.72)";
    context.lineWidth = 1.4;
    context.stroke();

    context.fillStyle = "#111827";
    context.font = `${width <= 820 ? 12 : 13}px "IBM Plex Sans JP"`;
    context.fillText("履歴", chart.x + 12, chart.y + 22);

    if (history.length < 2) {
        context.fillStyle = "#64748b";
        context.fillText("数秒待つと CO2 / O2 / 栄養の履歴が出ます。", chart.x + 12, chart.y + 48);
        return;
    }

    const graphBox = {
        x: chart.x + 10,
        y: chart.y + 34,
        w: chart.w - 20,
        h: chart.h - 48
    };

    context.strokeStyle = "rgba(148, 163, 184, 0.42)";
    context.beginPath();
    context.moveTo(graphBox.x, graphBox.y + graphBox.h);
    context.lineTo(graphBox.x + graphBox.w, graphBox.y + graphBox.h);
    context.stroke();

    drawLine(history.map((point) => point.co2), graphBox, "#4b5563");
    drawLine(history.map((point) => point.o2), graphBox, "#38bdf8");
    drawLine(history.map((point) => point.nutrients), graphBox, "#22c55e");

    const legend = [
        { label: "CO2", color: "#4b5563" },
        { label: "O2", color: "#38bdf8" },
        { label: "栄養", color: "#22c55e" }
    ];

    legend.forEach((item, index) => {
        const legendX = chart.x + 14 + index * 66;
        const legendY = chart.y + chart.h - 12;
        context.fillStyle = item.color;
        context.fillRect(legendX, legendY - 8, 14, 4);
        context.fillStyle = "#111827";
        context.font = `${width <= 820 ? 10 : 11}px "IBM Plex Sans JP"`;
        context.fillText(item.label, legendX + 18, legendY - 4);
    });
}

function drawEquationCard(layout) {
    const box = layout.equationCard;
    const sun = Number(sunlightSlider.value);
    const photoRate = photosynthesisRate();
    const respRate = respirationRate();
    const title = !alive ? "枯死" : (sun > 5 ? "昼の光合成" : "夜の呼吸");
    const equation = !alive ? "栄養不足で代謝停止" : (sun > 5 ? "CO2 + 光 -> 栄養 + O2" : "栄養 + O2 -> CO2");

    context.fillStyle = "rgba(255, 255, 255, 0.78)";
    drawRoundedRectPath(box.x, box.y, box.w, box.h, 18);
    context.fill();
    context.strokeStyle = "rgba(148, 163, 184, 0.72)";
    context.lineWidth = 1.2;
    context.stroke();

    context.fillStyle = "#111827";
    context.font = `${width <= 900 ? 14 : 16}px "IBM Plex Sans JP"`;
    context.fillText(title, box.x + 14, box.y + 24);
    context.font = `${width <= 900 ? 12 : 13}px "IBM Plex Sans JP"`;
    context.fillStyle = "#475569";
    context.fillText(equation, box.x + 14, box.y + 48);
    context.fillText(`光合成 ${photoRate.toFixed(2)} / 呼吸 ${respRate.toFixed(2)}`, box.x + 14, box.y + 70);
}

function draw() {
    const layout = getLayout();
    context.clearRect(0, 0, width, height);
    drawBackground(layout);
    drawParticles();
    drawPlant(layout);
    drawBars(layout);
    drawGraph(layout);
    drawEquationCard(layout);
}

function updateUi() {
    const sunlight = Number(sunlightSlider.value);
    const co2 = Number(co2Slider.value);
    const o2 = Number(o2Slider.value);
    const photoRate = photosynthesisRate();
    const respRate = respirationRate();
    const mode = modeLabel();

    sunText.textContent = `${sunlight.toFixed(0)} %`;
    co2Text.textContent = `${co2.toFixed(0)} %`;
    o2Text.textContent = `${o2.toFixed(0)} %`;
    modeStat.textContent = mode;
    sizeStat.textContent = plantSize.toFixed(2);
    nutrientStat.textContent = `${nutrients.toFixed(0)} %`;
    healthStat.textContent = `${health.toFixed(0)} %`;
    photoRateStat.textContent = photoRate.toFixed(2);
    respRateStat.textContent = respRate.toFixed(2);

    quickSun.textContent = `${sunlight.toFixed(0)} %`;
    quickCo2.textContent = `${co2.toFixed(0)} %`;
    quickNutrients.textContent = `${nutrients.toFixed(0)} %`;
    quickMode.textContent = mode;
}

function resizeCanvas() {
    const nextWidth = Math.max(320, Math.floor(canvas.clientWidth || simulationShell.clientWidth || 320));
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

    width = nextWidth;

    if (window.matchMedia("(max-width: 900px)").matches) {
        height = Math.max(430, Math.min(560, Math.floor(Math.min(width * 1.08, viewportHeight * 0.54))));
    } else {
        height = Math.max(700, Math.min(860, Math.floor(width * 0.66)));
    }

    widthDpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * widthDpr);
    canvas.height = Math.floor(height * widthDpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(widthDpr, 0, 0, widthDpr, 0, 0);
}

function loop(timestamp) {
    if (!lastTime) {
        lastTime = timestamp;
    }

    const delta = Math.min(32, timestamp - lastTime);
    lastTime = timestamp;
    const timeScale = delta / 16.6667;

    updateModel(timeScale);
    updateParticles(timeScale);
    updateUi();
    draw();
    window.requestAnimationFrame(loop);
}

setDayButton?.addEventListener("click", setDay);
setNightButton?.addEventListener("click", setNight);
addNutrientsButton?.addEventListener("click", addNutrients);
resetButton?.addEventListener("click", resetSim);

[sunlightSlider, co2Slider, o2Slider].forEach((slider) => {
    slider?.addEventListener("input", () => {
        updateUi();
        draw();
    });
});

window.addEventListener("resize", () => {
    resizeCanvas();
    draw();
});

resizeCanvas();
pushHistory();
updateUi();
draw();
window.requestAnimationFrame(loop);