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

const canvas = document.querySelector("#lavaCanvas");
const simulationShell = document.querySelector("#playgroundShell");
const controlPanel = document.querySelector(".panel");
const floatingHint = document.querySelector("#hintText");
const context = canvas?.getContext("2d");

if (!canvas || !simulationShell || !context) {
    throw new Error("Lava solidification simulation failed to initialize.");
}

const coolRateSlider = document.querySelector("#coolRate");
const tempStartSlider = document.querySelector("#tempStart");
const nucleationSlider = document.querySelector("#nucleation");
const growthSlider = document.querySelector("#growth");

const toggleRunningButton = document.querySelector("#toggleRunning");
const quickCoolButton = document.querySelector("#quickCool");
const slowCoolButton = document.querySelector("#slowCool");
const reheatButton = document.querySelector("#reheat");
const resetButton = document.querySelector("#resetSim");

const coolText = document.querySelector("#coolText");
const tempStartText = document.querySelector("#tempStartText");
const nucleationText = document.querySelector("#nucleationText");
const growthText = document.querySelector("#growthText");

const tempStat = document.querySelector("#tempStat");
const stateStat = document.querySelector("#stateStat");
const solidStat = document.querySelector("#solidStat");
const crystalCountStat = document.querySelector("#crystalCountStat");
const avgSizeStat = document.querySelector("#avgSizeStat");
const rockTypeStat = document.querySelector("#rockTypeStat");
const panelStatus = document.querySelector("#panelStatus");

const liquidus = 1050;
const solidus = 720;
const defaults = {
    coolRate: 45,
    tempStart: 1200,
    nucleation: 50,
    growth: 55
};
const defaultStatus = "温度が液相線を下回ると結晶核が生まれ、冷えている時間が長いほど結晶は大きく育ちやすくなります。";

let width = 0;
let height = 0;
let widthDpr = 1;
let running = true;
let temperature = defaults.tempStart;
let reheatPressed = false;
let reheating = false;
let reheatTarget = defaults.tempStart;
let crystals = [];
let bubbles = [];
let sparks = [];
let history = [];
let frame = 0;
let lastTime = 0;
let statusTimeout = 0;
let previousChamber = null;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function drawRoundedRectPath(x, y, boxWidth, boxHeight, radius) {
    const limitedRadius = Math.min(radius, boxWidth / 2, boxHeight / 2);
    context.beginPath();
    context.moveTo(x + limitedRadius, y);
    context.lineTo(x + boxWidth - limitedRadius, y);
    context.quadraticCurveTo(x + boxWidth, y, x + boxWidth, y + limitedRadius);
    context.lineTo(x + boxWidth, y + boxHeight - limitedRadius);
    context.quadraticCurveTo(x + boxWidth, y + boxHeight, x + boxWidth - limitedRadius, y + boxHeight);
    context.lineTo(x + limitedRadius, y + boxHeight);
    context.quadraticCurveTo(x, y + boxHeight, x, y + boxHeight - limitedRadius);
    context.lineTo(x, y + limitedRadius);
    context.quadraticCurveTo(x, y, x + limitedRadius, y);
    context.closePath();
}

function wrapText(text, x, y, maxWidth, lineHeight) {
    let line = "";
    let currentY = y;

    for (const character of text) {
        if (character === "\n") {
            if (line) {
                context.fillText(line, x, currentY);
            }
            line = "";
            currentY += lineHeight;
            continue;
        }

        const candidate = line + character;

        if (context.measureText(candidate).width > maxWidth && line) {
            context.fillText(line, x, currentY);
            line = character === " " ? "" : character;
            currentY += lineHeight;
            continue;
        }

        line = candidate;
    }

    if (line) {
        context.fillText(line, x, currentY);
    }
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
        }, 3400);
    }
}

function coolingRate() {
    return Number(coolRateSlider.value) / 100;
}

function nucleationEase() {
    return Number(nucleationSlider.value) / 100;
}

function growthEase() {
    return Number(growthSlider.value) / 100;
}

function coolingLabel() {
    const cool = Number(coolRateSlider.value);

    if (cool >= 70) {
        return "急冷";
    }

    if (cool <= 25) {
        return "徐冷";
    }

    return "中間";
}

function resetState() {
    temperature = Number(tempStartSlider.value);
    reheatPressed = false;
    reheating = false;
    reheatTarget = temperature;
    crystals = [];
    bubbles = [];
    sparks = [];
    history = [];
    frame = 0;
}

function updateToggleButton() {
    toggleRunningButton.textContent = running ? "一時停止" : "再生";
}

function toggleRunning() {
    running = !running;
    setStatus(running ? "シミュレーションを再開しました。冷却と結晶成長が進みます。" : "シミュレーションを停止しました。現在の結晶サイズと固化率をその場で確認できます。", true);
    updateToggleButton();
    updateUi();
    draw();
}

function resetSimulation() {
    coolRateSlider.value = defaults.coolRate;
    tempStartSlider.value = defaults.tempStart;
    nucleationSlider.value = defaults.nucleation;
    growthSlider.value = defaults.growth;
    running = true;
    resetState();
    setStatus(defaultStatus);
    updateToggleButton();
    updateUi();
    draw();
}

function quickCoolPreset() {
    coolRateSlider.value = 88;
    tempStartSlider.value = 1180;
    nucleationSlider.value = 85;
    growthSlider.value = 38;
    setStatus("急冷寄りの条件に切り替えました。現在の状態を保ったまま、ここから先は細かい結晶が増えやすい条件になります。", true);
    updateUi();
    draw();
}

function slowCoolPreset() {
    coolRateSlider.value = 12;
    tempStartSlider.value = 1240;
    nucleationSlider.value = 35;
    growthSlider.value = 82;
    setStatus("徐冷寄りの条件に切り替えました。現在の状態を保ったまま、ここから先は大きな結晶が育ちやすい条件になります。", true);
    updateUi();
    draw();
}

function startReheat() {
    if (reheatPressed) {
        return;
    }

    running = true;
    reheatPressed = true;
    reheatTarget = Math.max(temperature, Number(tempStartSlider.value));
    reheating = reheatTarget > temperature + 0.5;

    crystals.forEach((crystal) => {
        crystal.melting = Math.max(crystal.melting, 0.4);
    });

    const layout = getLayout();

    for (let index = 0; index < 32; index += 1) {
        sparks.push({
            x: layout.chamber.x + Math.random() * layout.chamber.w,
            y: layout.chamber.y + layout.chamber.h - Math.random() * 50,
            vx: Math.random() * 2.2 - 1.1,
            vy: -1.4 - Math.random() * 2.8,
            life: 1
        });
    }

    setStatus("再加熱しています。ボタンを押している間だけ温度が上がり、結晶は溶けながら小さくなっていきます。");
    updateToggleButton();
    updateUi();
    draw();
}

function stopReheat() {
    if (!reheatPressed && !reheating) {
        return;
    }

    reheatPressed = false;
    reheating = false;
    setStatus("再加熱を止めました。ボタンを離すと、また周囲へ熱を失いながら冷えていきます。", true);
    updateUi();
    draw();
}

function solidFraction() {
    return clamp((liquidus - temperature) / (liquidus - solidus), 0, 1);
}

function averageCrystalSize() {
    if (!crystals.length) {
        return 0;
    }

    return crystals.reduce((sum, crystal) => sum + crystal.r * 2, 0) / crystals.length;
}

function stateName() {
    if (reheating && temperature < liquidus + 25) {
        return "再加熱中";
    }

    if (temperature > liquidus + 25) {
        return "溶融";
    }

    if (temperature > solidus + 20) {
        return "結晶化中";
    }

    return "ほぼ固化";
}

function rockType() {
    const average = averageCrystalSize();

    if (solidFraction() < 0.95) {
        return "形成中";
    }

    if (average < 7) {
        return "ガラス質〜細粒";
    }

    if (average < 16) {
        return "細粒火成岩";
    }

    if (average < 30) {
        return "中粒火成岩";
    }

    return "粗粒火成岩";
}

function getLayout() {
    const compact = width <= 900;
    const narrow = width <= 560;
    const sceneLeft = compact ? 18 : Math.min(380, width * 0.31);
    const sceneRight = width - 22;
    const sceneWidth = sceneRight - sceneLeft;
    const chamberY = compact ? 110 : 144;
    const chamberH = compact ? clamp(height * 0.33, 260, 320) : clamp(height * 0.38, 340, 410);
    const chamberX = sceneLeft;
    const thermometerWidth = narrow ? 18 : 22;
    const chamberW = compact
        ? sceneWidth
        : Math.max(360, sceneWidth - thermometerWidth - 108);
    const thermometerX = compact ? chamberX + chamberW - 34 : chamberX + chamberW + 28;
    const thermometerY = compact ? chamberY + 18 : chamberY + 8;
    const thermometerH = compact ? chamberH - 36 : chamberH - 16;
    const historyY = chamberY + chamberH + 22;
    const historyH = narrow ? 84 : 96;
    const legendY = historyY + historyH + 14;
    const legendH = narrow ? 70 : 76;
    const messageX = chamberX;
    const messageY = compact ? 34 : 42;
    const messageWidth = compact ? sceneWidth : Math.min(390, chamberW);

    return {
        compact,
        narrow,
        chamber: {
            x: chamberX,
            y: chamberY,
            w: chamberW,
            h: chamberH
        },
        thermometer: {
            x: thermometerX,
            y: thermometerY,
            w: thermometerWidth,
            h: thermometerH
        },
        historyBox: {
            x: chamberX,
            y: historyY,
            w: sceneWidth,
            h: historyH
        },
        legendBox: {
            x: chamberX,
            y: legendY,
            w: compact ? sceneWidth : Math.min(248, sceneWidth * 0.44),
            h: legendH
        },
        messageX,
        messageY,
        messageWidth
    };
}

function randomPointInChamber(layout) {
    const margin = layout.narrow ? 18 : 22;

    return {
        x: layout.chamber.x + margin + Math.random() * Math.max(1, layout.chamber.w - margin * 2),
        y: layout.chamber.y + margin + Math.random() * Math.max(1, layout.chamber.h - margin * 2)
    };
}

function canPlaceCrystal(x, y, radius) {
    for (const crystal of crystals) {
        const dx = x - crystal.x;
        const dy = y - crystal.y;
        const minDistance = radius + crystal.r * 0.75;

        if (dx * dx + dy * dy < minDistance * minDistance) {
            return false;
        }
    }

    return true;
}

function nucleateCrystals(layout, timeScale) {
    if (temperature > liquidus || temperature < solidus - 40) {
        return;
    }

    const undercool = clamp((liquidus - temperature) / 260, 0, 1);
    const chance = (0.006 + coolingRate() * 0.032) * nucleationEase() * undercool * timeScale;
    const attempts = Math.max(1, Math.floor((1 + coolingRate() * 6 + undercool * 4) * timeScale));
    const crystalCap = layout.narrow ? 220 : layout.compact ? 320 : 420;

    for (let index = 0; index < attempts; index += 1) {
        if (Math.random() >= chance || crystals.length >= crystalCap) {
            continue;
        }

        const point = randomPointInChamber(layout);
        const radius = 1.6 + Math.random() * 2.6;

        if (!canPlaceCrystal(point.x, point.y, radius)) {
            continue;
        }

        crystals.push({
            x: point.x,
            y: point.y,
            r: radius,
            angle: Math.random() * Math.PI,
            sides: 5 + Math.floor(Math.random() * 4),
            hue: 26 + Math.random() * 34,
            growthBias: 0.72 + Math.random() * 0.85,
            melting: 0
        });
    }
}

function growCrystals(layout, timeScale) {
    if (reheating) {
        const meltProgress = clamp((temperature - 320) / Math.max(1, reheatTarget - 320), 0, 1);
        const meltRate = (0.001 + meltProgress * 0.013) * timeScale;

        crystals.forEach((crystal) => {
            crystal.r *= Math.max(0.82, 1 - meltRate);
            crystal.melting = Math.max(crystal.melting * 0.98, 0.28 + meltProgress * 0.7);
        });

        crystals = crystals.filter((crystal) => crystal.r > 1.05);
        return;
    }

    if (temperature > liquidus + 18) {
        crystals.forEach((crystal) => {
            crystal.r *= 0.988;
            crystal.melting = 1;
        });
        crystals = crystals.filter((crystal) => crystal.r > 1.1);
        return;
    }

    const tempWindow = clamp(1 - Math.abs(temperature - 900) / 260, 0.12, 1);
    const slowFactor = 1.28 - coolingRate() * 0.92;
    const baseGrow = 0.018 * growthEase() * slowFactor * tempWindow * timeScale;
    const activeGrowth = temperature >= solidus - 60;

    crystals.forEach((crystal) => {
        if (activeGrowth) {
            let blocked = false;

            for (const other of crystals) {
                if (other === crystal) {
                    continue;
                }

                const dx = crystal.x - other.x;
                const dy = crystal.y - other.y;
                const limit = crystal.r + other.r * 0.95;

                if (dx * dx + dy * dy < limit * limit) {
                    blocked = true;
                    break;
                }
            }

            if (!blocked) {
                const roomX = Math.min(crystal.x - layout.chamber.x, layout.chamber.x + layout.chamber.w - crystal.x);
                const roomY = Math.min(crystal.y - layout.chamber.y, layout.chamber.y + layout.chamber.h - crystal.y);
                const room = Math.min(roomX, roomY);

                if (crystal.r < room - 5) {
                    crystal.r += baseGrow * crystal.growthBias;
                }
            }
        }

        crystal.melting *= 0.94;
    });
}

function updateBubblesAndSparks(layout, timeScale) {
    const hot = clamp((temperature - 780) / 450, 0, 1);

    if (temperature > 760 && Math.random() < hot * 0.42 * timeScale) {
        bubbles.push({
            x: layout.chamber.x + 26 + Math.random() * Math.max(1, layout.chamber.w - 52),
            y: layout.chamber.y + layout.chamber.h - 12,
            r: 3 + Math.random() * 7,
            vy: (0.7 + Math.random() * 1.8) * timeScale,
            life: 1
        });
    }

    bubbles = bubbles
        .map((bubble) => ({
            ...bubble,
            y: bubble.y - bubble.vy,
            r: bubble.r * (1.0015 + timeScale * 0.0005),
            life: bubble.life - 0.006 * timeScale
        }))
        .filter((bubble) => bubble.life > 0 && bubble.y > layout.chamber.y + 5);

    sparks = sparks
        .map((spark) => ({
            ...spark,
            x: spark.x + spark.vx * timeScale,
            y: spark.y + spark.vy * timeScale,
            vy: spark.vy + 0.04 * timeScale,
            life: spark.life - 0.018 * timeScale
        }))
        .filter((spark) => spark.life > 0);
}

function updateModel(timeScale) {
    const layout = getLayout();

    if (!running) {
        return;
    }

    if (reheatPressed) {
        reheatTarget = Math.max(temperature, Number(tempStartSlider.value));
        const remaining = reheatTarget - temperature;
        reheating = remaining > 0.5;

        if (reheating) {
            const heatingRate = (0.9 + clamp(remaining / 220, 0.18, 2.2)) * timeScale;
            temperature = Math.min(reheatTarget, temperature + heatingRate);
        }
    } else if (temperature > 300) {
        reheating = false;
        const cool = Number(coolRateSlider.value);
        const environmentPull = clamp((temperature - 25) / 1200, 0.08, 1);
        temperature -= (0.035 + cool * 0.0065) * environmentPull * timeScale;
        temperature = Math.max(260, temperature);
    }

    if (!reheating) {
        nucleateCrystals(layout, timeScale);
    }

    growCrystals(layout, timeScale);
    updateBubblesAndSparks(layout, timeScale);

    if (frame % 6 === 0) {
        history.push({
            temp: temperature,
            solid: solidFraction() * 100,
            avg: averageCrystalSize()
        });

        const cap = layout.narrow ? 90 : 130;

        if (history.length > cap) {
            history.shift();
        }
    }
}

function lavaColor() {
    const hot = clamp((temperature - 500) / 800, 0, 1);
    const solid = solidFraction();
    const red = Math.round(70 + hot * 185 - solid * 45);
    const green = Math.round(35 + hot * 90 - solid * 20);
    const blue = Math.round(25 + hot * 15 - solid * 10);

    return `rgb(${clamp(red, 30, 255)}, ${clamp(green, 20, 150)}, ${clamp(blue, 15, 80)})`;
}

function drawBackground(layout) {
    context.clearRect(0, 0, width, height);
    const background = context.createLinearGradient(0, 0, 0, height);
    background.addColorStop(0, "#26110a");
    background.addColorStop(0.55, "#1a0c08");
    background.addColorStop(1, "#080302");
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    context.fillStyle = "rgba(255, 160, 80, 0.035)";
    for (let index = 0; index < 26; index += 1) {
        const x = (index * 97) % width;
        const y = 30 + ((index * 61) % Math.max(120, height - 60));
        context.beginPath();
        context.arc(x, y, 1.2 + (index % 4), 0, Math.PI * 2);
        context.fill();
    }

    const emberGradient = context.createRadialGradient(
        layout.chamber.x + layout.chamber.w * 0.5,
        layout.chamber.y + layout.chamber.h * 0.4,
        20,
        layout.chamber.x + layout.chamber.w * 0.5,
        layout.chamber.y + layout.chamber.h * 0.4,
        layout.chamber.w * 0.8
    );
    emberGradient.addColorStop(0, "rgba(249, 115, 22, 0.14)");
    emberGradient.addColorStop(1, "rgba(249, 115, 22, 0)");
    context.fillStyle = emberGradient;
    context.fillRect(layout.chamber.x - 100, layout.chamber.y - 80, layout.chamber.w + 200, layout.chamber.h + 180);
}

function drawChamber(layout) {
    context.fillStyle = "rgba(0, 0, 0, 0.35)";
    drawRoundedRectPath(layout.chamber.x - 14, layout.chamber.y - 14, layout.chamber.w + 28, layout.chamber.h + 28, 26);
    context.fill();

    const chamberGradient = context.createRadialGradient(
        layout.chamber.x + layout.chamber.w * 0.35,
        layout.chamber.y + layout.chamber.h * 0.28,
        10,
        layout.chamber.x + layout.chamber.w * 0.5,
        layout.chamber.y + layout.chamber.h * 0.52,
        layout.chamber.w * 0.72
    );
    chamberGradient.addColorStop(0, lavaColor());
    chamberGradient.addColorStop(1, temperature > 700 ? "#3b160d" : "#2b2521");
    context.fillStyle = chamberGradient;
    drawRoundedRectPath(layout.chamber.x, layout.chamber.y, layout.chamber.w, layout.chamber.h, 24);
    context.fill();

    const crust = solidFraction();
    context.save();
    drawRoundedRectPath(layout.chamber.x, layout.chamber.y, layout.chamber.w, layout.chamber.h, 24);
    context.clip();

    if (temperature > 740) {
        for (let index = 0; index < 15; index += 1) {
            const x = layout.chamber.x + ((index * 73 + frame * 0.75) % layout.chamber.w);
            const y = layout.chamber.y + 36 + ((index * 41) % Math.max(1, layout.chamber.h - 72));
            context.strokeStyle = `rgba(255, ${120 + index * 5}, 40, ${0.08 + clamp((temperature - 760) / 500, 0, 1) * 0.18})`;
            context.lineWidth = 12;
            context.beginPath();
            context.moveTo(x - 84, y + Math.sin(frame * 0.02 + index) * 12);
            context.quadraticCurveTo(x, y - 30, x + 92, y + 22);
            context.stroke();
        }
    }

    if (crust > 0.06) {
        for (let index = 0; index < 14; index += 1) {
            const band = index / 13;
            const x = layout.chamber.x + band * layout.chamber.w;
            const y = layout.chamber.y + (index % 2 === 0 ? 0 : layout.chamber.h);
            context.fillStyle = `rgba(28, 18, 18, ${crust * 0.18})`;
            context.beginPath();
            context.ellipse(x, y, 30 + crust * 40, 14 + crust * 12, 0, 0, Math.PI * 2);
            context.fill();
        }
    }

    context.restore();

    context.strokeStyle = "rgba(254, 215, 170, 0.42)";
    context.lineWidth = 3;
    drawRoundedRectPath(layout.chamber.x, layout.chamber.y, layout.chamber.w, layout.chamber.h, 24);
    context.stroke();
}

function drawCrystal(x, y, radius, sides, angle, hue, alpha) {
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    context.beginPath();

    for (let index = 0; index < sides; index += 1) {
        const theta = (index / sides) * Math.PI * 2;
        const localRadius = radius * (0.82 + 0.25 * Math.sin(index * 2.1));
        const px = Math.cos(theta) * localRadius;
        const py = Math.sin(theta) * localRadius;

        if (index === 0) {
            context.moveTo(px, py);
        } else {
            context.lineTo(px, py);
        }
    }

    context.closePath();
    context.fillStyle = `hsla(${hue}, 70%, ${55 + radius * 0.5}%, ${alpha})`;
    context.fill();
    context.strokeStyle = `rgba(255,255,255,${0.28 * alpha})`;
    context.lineWidth = 1.1;
    context.stroke();

    context.strokeStyle = `rgba(255,255,255,${0.14 * alpha})`;
    context.beginPath();
    context.moveTo(-radius * 0.42, 0);
    context.lineTo(radius * 0.42, 0);
    context.moveTo(0, -radius * 0.42);
    context.lineTo(0, radius * 0.42);
    context.stroke();
    context.restore();
}

function drawCrystals(layout) {
    context.save();
    drawRoundedRectPath(layout.chamber.x, layout.chamber.y, layout.chamber.w, layout.chamber.h, 24);
    context.clip();

    crystals.forEach((crystal) => {
        const alpha = clamp(0.35 + solidFraction() * 0.65 - crystal.melting * 0.48, 0.1, 1);
        drawCrystal(crystal.x, crystal.y, crystal.r, crystal.sides, crystal.angle, crystal.hue, alpha);
    });

    context.restore();
}

function drawBubblesAndSparks() {
    bubbles.forEach((bubble) => {
        context.strokeStyle = `rgba(255,244,220,${0.45 * bubble.life})`;
        context.lineWidth = 2;
        context.beginPath();
        context.arc(bubble.x, bubble.y, bubble.r, 0, Math.PI * 2);
        context.stroke();
    });

    sparks.forEach((spark) => {
        context.fillStyle = `rgba(251,191,36,${spark.life})`;
        context.beginPath();
        context.arc(spark.x, spark.y, 3, 0, Math.PI * 2);
        context.fill();
    });
}

function drawThermometer(layout) {
    const labelFont = layout.narrow ? 10 : 11;
    const titleFont = layout.narrow ? 12 : 14;
    const thermometerBoxWidth = layout.compact ? 82 : 118;
    const containerX = layout.thermometer.x - 22;
    const containerY = layout.thermometer.y - 18;
    const containerH = layout.thermometer.h + 40;
    const ratio = clamp((temperature - 300) / 1100, 0, 1);

    context.fillStyle = "rgba(255,255,255,0.08)";
    drawRoundedRectPath(containerX, containerY, thermometerBoxWidth, containerH, 16);
    context.fill();

    context.strokeStyle = "#fed7aa";
    context.lineWidth = 3;
    context.strokeRect(layout.thermometer.x, layout.thermometer.y, layout.thermometer.w, layout.thermometer.h);

    context.fillStyle = temperature > liquidus ? "#f97316" : temperature > solidus ? "#facc15" : "#94a3b8";
    context.fillRect(
        layout.thermometer.x + 3,
        layout.thermometer.y + layout.thermometer.h - ratio * layout.thermometer.h,
        layout.thermometer.w - 6,
        ratio * layout.thermometer.h
    );

    context.fillStyle = "#fff7ed";
    context.font = `600 ${titleFont}px IBM Plex Sans JP`;
    context.fillText("温度", containerX + 10, containerY + 16);
    context.font = `600 ${titleFont}px IBM Plex Sans JP`;
    context.fillText(`${temperature.toFixed(0)}℃`, containerX + 10, containerY + containerH - 10);

    const liquidusY = layout.thermometer.y + layout.thermometer.h - clamp((liquidus - 300) / 1100, 0, 1) * layout.thermometer.h;
    const solidusY = layout.thermometer.y + layout.thermometer.h - clamp((solidus - 300) / 1100, 0, 1) * layout.thermometer.h;

    context.strokeStyle = "rgba(255,255,255,0.7)";
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(layout.thermometer.x - 6, liquidusY);
    context.lineTo(layout.thermometer.x + layout.thermometer.w + 8, liquidusY);
    context.moveTo(layout.thermometer.x - 6, solidusY);
    context.lineTo(layout.thermometer.x + layout.thermometer.w + 8, solidusY);
    context.stroke();

    context.fillStyle = "rgba(255,247,237,0.9)";
    context.font = `${labelFont}px IBM Plex Sans JP`;
    const liquidusLabel = layout.narrow ? "開始" : "結晶化開始";
    const solidusLabel = layout.narrow ? "固化" : "ほぼ固化";
    const labelX = layout.compact ? containerX + 10 : layout.thermometer.x + layout.thermometer.w + 14;
    context.fillText(liquidusLabel, labelX, liquidusY + 4);
    context.fillText(solidusLabel, labelX, solidusY + 4);
}

function drawLine(values, box, min, max, color) {
    if (values.length < 2) {
        return;
    }

    const count = Math.max(1, values.length - 1);
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.beginPath();

    values.forEach((value, index) => {
        const px = box.x + 10 + (index / count) * (box.w - 20);
        const py = box.y + box.h - 10 - clamp((value - min) / Math.max(1, max - min), 0, 1) * (box.h - 30);

        if (index === 0) {
            context.moveTo(px, py);
        } else {
            context.lineTo(px, py);
        }
    });

    context.stroke();
}

function drawHistory(layout) {
    context.fillStyle = "rgba(255,255,255,0.07)";
    drawRoundedRectPath(layout.historyBox.x, layout.historyBox.y, layout.historyBox.w, layout.historyBox.h, 16);
    context.fill();
    context.strokeStyle = "rgba(254,215,170,0.22)";
    context.lineWidth = 1.2;
    drawRoundedRectPath(layout.historyBox.x, layout.historyBox.y, layout.historyBox.w, layout.historyBox.h, 16);
    context.stroke();

    context.fillStyle = "#ffedd5";
    context.font = `${layout.narrow ? 11 : 12}px IBM Plex Sans JP`;
    context.fillText("履歴: 温度 / 固化率 / 平均結晶サイズ", layout.historyBox.x + 12, layout.historyBox.y + 18);

    drawLine(history.map((item) => item.temp), layout.historyBox, 300, 1400, "#f97316");
    drawLine(history.map((item) => item.solid), layout.historyBox, 0, 100, "#cbd5e1");
    drawLine(history.map((item) => item.avg), layout.historyBox, 0, 40, "#dbeafe");
}

function drawLegend(layout) {
    context.fillStyle = "rgba(255,255,255,0.07)";
    drawRoundedRectPath(layout.legendBox.x, layout.legendBox.y, layout.legendBox.w, layout.legendBox.h, 16);
    context.fill();

    context.fillStyle = "#fff7ed";
    context.font = `${layout.narrow ? 12 : 13}px IBM Plex Sans JP`;
    context.fillText("見方", layout.legendBox.x + 12, layout.legendBox.y + 20);
    context.fillStyle = "#fed7aa";
    context.font = `${layout.narrow ? 10 : 11}px IBM Plex Sans JP`;
    context.fillText("橙: 熱い溶岩", layout.legendBox.x + 12, layout.legendBox.y + 40);
    context.fillText("明るい多角形: 成長中の結晶", layout.legendBox.x + 12, layout.legendBox.y + 56);

    if (!layout.narrow) {
        context.fillText("グラフ: 温度・固化率・平均サイズ", layout.legendBox.x + 12, layout.legendBox.y + 72);
    }
}

function drawLabels(layout) {
    context.fillStyle = "#fff7ed";
    context.font = `${layout.narrow ? 17 : 20}px IBM Plex Sans JP`;
    context.fillText("冷却速度で結晶サイズが変わる", layout.messageX, layout.messageY);

    context.fillStyle = "#fed7aa";
    context.font = `${layout.narrow ? 12 : 14}px IBM Plex Sans JP`;

    let message = "中くらいの冷却: 細粒から中粒のあいだを行き来しやすい条件です。";

    if (coolingRate() > 0.65) {
        message = "急冷: 核は増えやすいものの成長時間が短く、小さい結晶やガラス質に寄りやすい条件です。";
    } else if (coolingRate() < 0.25) {
        message = "徐冷: 成長時間が長く、少数の結晶が大きく育って粗粒になりやすい条件です。";
    }

    wrapText(message, layout.messageX, layout.messageY + 26, layout.messageWidth, layout.narrow ? 18 : 20);
}

function draw() {
    const layout = getLayout();
    drawBackground(layout);
    drawChamber(layout);
    drawCrystals(layout);
    drawBubblesAndSparks();
    drawThermometer(layout);
    drawHistory(layout);
    drawLegend(layout);
    drawLabels(layout);
}

function updateUi() {
    coolText.textContent = `${Number(coolRateSlider.value).toFixed(0)} %`;
    tempStartText.textContent = `${tempStartSlider.value} ℃`;
    nucleationText.textContent = `${nucleationSlider.value} %`;
    growthText.textContent = `${growthSlider.value} %`;
    tempStat.textContent = `${temperature.toFixed(0)} ℃`;
    stateStat.textContent = stateName();
    solidStat.textContent = `${(solidFraction() * 100).toFixed(0)} %`;
    crystalCountStat.textContent = `${crystals.length}`;
    avgSizeStat.textContent = `${averageCrystalSize().toFixed(1)} px`;
    rockTypeStat.textContent = rockType();
    updateToggleButton();
}

function resizeCanvas() {
    const oldChamber = previousChamber;
    const nextWidth = Math.max(320, Math.floor(canvas.clientWidth || simulationShell.clientWidth || 320));
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const compact = window.matchMedia("(max-width: 900px)").matches;

    width = nextWidth;

    if (compact) {
        height = Math.max(560, Math.min(760, Math.floor(Math.min(width * 1.2, viewportHeight * 0.78))));
    } else {
        height = Math.max(780, Math.min(960, Math.floor(width * 0.74)));

        const overlayHeights = [height];

        for (const element of [controlPanel, floatingHint]) {
            if (!element) {
                continue;
            }

            const styles = window.getComputedStyle(element);

            if (styles.position !== "absolute") {
                continue;
            }

            overlayHeights.push(element.offsetTop + element.scrollHeight + 20);
        }

        height = Math.max(...overlayHeights);
    }

    widthDpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * widthDpr);
    canvas.height = Math.floor(height * widthDpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(widthDpr, 0, 0, widthDpr, 0, 0);

    const nextChamber = getLayout().chamber;

    if (oldChamber && crystals.length) {
        const oldInnerWidth = Math.max(1, oldChamber.w - 44);
        const oldInnerHeight = Math.max(1, oldChamber.h - 44);
        const newInnerWidth = Math.max(1, nextChamber.w - 44);
        const newInnerHeight = Math.max(1, nextChamber.h - 44);
        const scale = Math.min(nextChamber.w / Math.max(1, oldChamber.w), nextChamber.h / Math.max(1, oldChamber.h));

        crystals.forEach((crystal) => {
            const normalizedX = clamp((crystal.x - oldChamber.x - 22) / oldInnerWidth, 0, 1);
            const normalizedY = clamp((crystal.y - oldChamber.y - 22) / oldInnerHeight, 0, 1);
            crystal.x = nextChamber.x + 22 + normalizedX * newInnerWidth;
            crystal.y = nextChamber.y + 22 + normalizedY * newInnerHeight;
            crystal.r *= scale;
        });

        bubbles.forEach((bubble) => {
            const normalizedX = clamp((bubble.x - oldChamber.x) / Math.max(1, oldChamber.w), 0, 1);
            const normalizedY = clamp((bubble.y - oldChamber.y) / Math.max(1, oldChamber.h), 0, 1);
            bubble.x = nextChamber.x + normalizedX * nextChamber.w;
            bubble.y = nextChamber.y + normalizedY * nextChamber.h;
        });
    }

    previousChamber = nextChamber;
}

function loop(timestamp) {
    if (!lastTime) {
        lastTime = timestamp;
    }

    const delta = Math.min(32, timestamp - lastTime);
    lastTime = timestamp;
    const timeScale = delta / 16.6667;

    frame += 1;
    updateModel(timeScale);
    updateUi();
    draw();
    window.requestAnimationFrame(loop);
}

toggleRunningButton?.addEventListener("click", toggleRunning);
quickCoolButton?.addEventListener("click", quickCoolPreset);
slowCoolButton?.addEventListener("click", slowCoolPreset);
resetButton?.addEventListener("click", resetSimulation);

reheatButton?.addEventListener("pointerdown", (event) => {
    if (typeof reheatButton.setPointerCapture === "function") {
        reheatButton.setPointerCapture(event.pointerId);
    }

    startReheat();
});

reheatButton?.addEventListener("pointerup", stopReheat);
reheatButton?.addEventListener("pointercancel", stopReheat);
reheatButton?.addEventListener("lostpointercapture", stopReheat);
reheatButton?.addEventListener("blur", stopReheat);
reheatButton?.addEventListener("keydown", (event) => {
    if ((event.code === "Space" || event.code === "Enter") && !event.repeat) {
        event.preventDefault();
        startReheat();
    }
});
reheatButton?.addEventListener("keyup", (event) => {
    if (event.code === "Space" || event.code === "Enter") {
        stopReheat();
    }
});

window.addEventListener("pointerup", stopReheat);

[coolRateSlider, tempStartSlider, nucleationSlider, growthSlider].forEach((slider) => {
    slider?.addEventListener("input", () => {
        if (slider === tempStartSlider && crystals.length === 0) {
            temperature = Number(tempStartSlider.value);
        }

        updateUi();
        draw();
    });
});

window.addEventListener("resize", () => {
    resizeCanvas();
    draw();
});

resizeCanvas();
resetState();
updateUi();
draw();
window.requestAnimationFrame(loop);