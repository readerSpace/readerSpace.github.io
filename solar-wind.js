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

const canvas = document.querySelector("#magnetosphereCanvas");
const simulationShell = document.querySelector("#playgroundShell");
const context = canvas?.getContext("2d");

if (!canvas || !simulationShell || !context) {
    throw new Error("Solar wind simulation failed to initialize.");
}

const solarWindSlider = document.querySelector("#solarWind");
const windSpeedSlider = document.querySelector("#windSpeed");
const magStrengthSlider = document.querySelector("#magStrength");
const lineDensitySlider = document.querySelector("#lineDensity");

const quietSunButton = document.querySelector("#quietSun");
const solarStormButton = document.querySelector("#solarStorm");
const resetButton = document.querySelector("#resetSim");

const windScaleText = document.querySelector("#windScaleText");
const windSpeedText = document.querySelector("#windSpeedText");
const magStrengthText = document.querySelector("#magStrengthText");
const fieldLinesText = document.querySelector("#fieldLinesText");

const shieldStat = document.querySelector("#shieldStat");
const entryStat = document.querySelector("#entryStat");
const auroraStat = document.querySelector("#auroraStat");
const protectStat = document.querySelector("#protectStat");
const stateStat = document.querySelector("#stateStat");
const brightnessStat = document.querySelector("#brightnessStat");

const quickWind = document.querySelector("#quickWind");
const quickShield = document.querySelector("#quickShield");
const quickAurora = document.querySelector("#quickAurora");
const quickState = document.querySelector("#quickState");
const panelStatus = document.querySelector("#panelStatus");

let width = 0;
let height = 0;
let widthDpr = 1;
let windParticles = [];
let auroraBands = [];
let starField = [];
let frame = 0;
let lastTime = 0;
let hitCounter = 0;
let protectedCounter = 0;
let statusTimeout = 0;

const defaultStatus = "多くの粒子は磁気圏でそらされますが、一部は磁力線に沿って極へ入り、オーロラを強めます。";

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

function windPower() {
    return Number(solarWindSlider.value) / 100;
}

function windSpeed() {
    return Number(windSpeedSlider.value) / 100;
}

function geomagneticStrength() {
    return Number(magStrengthSlider.value) / 100;
}

function fieldLineDensity() {
    return Number(lineDensitySlider.value) / 100;
}

function getLayout() {
    const compact = width <= 900;
    const narrow = width <= 560;
    const earthRadius = narrow ? clamp(width * 0.09, 32, 42) : compact ? clamp(width * 0.075, 38, 50) : clamp(width * 0.05, 44, 60);
    const earthX = narrow ? width * 0.7 : compact ? width * 0.72 : width * 0.76;
    const earthY = compact ? height * 0.52 : height * 0.53;
    const safeLeft = compact ? 28 : 420;
    const sunRadius = narrow ? 34 : compact ? 42 : 54;
    const sunX = compact ? 62 : safeLeft + 26;
    const sunY = earthY;
    const hudWidth = narrow ? 154 : compact ? 184 : 228;
    const hudX = width - hudWidth - 16;
    const hudY = 16;

    return {
        compact,
        narrow,
        earth: {
            x: earthX,
            y: earthY,
            r: earthRadius
        },
        sun: {
            x: sunX,
            y: sunY,
            r: sunRadius
        },
        spawnX: safeLeft,
        arrowStartX: safeLeft + (compact ? 6 : 14),
        hudBox: {
            x: hudX,
            y: hudY,
            w: hudWidth,
            h: narrow ? 82 : 94
        },
        legendBox: {
            x: hudX,
            y: hudY + (narrow ? 92 : 106),
            w: hudWidth,
            h: narrow ? 76 : 88
        }
    };
}

function magnetopauseRadius(layout) {
    const wind = 0.28 + windPower() * 1.45;
    const magnetic = 0.45 + geomagneticStrength() * 1.4;
    return clamp(layout.earth.r * 3.1 * Math.pow(magnetic / wind, 0.32), layout.earth.r * 1.75, layout.earth.r * 4.25);
}

function auroraIntensity(layout) {
    const compression = clamp((layout.earth.r * 3.2 - magnetopauseRadius(layout)) / (layout.earth.r * 1.45), 0, 1);
    const raw = windPower() * 0.72 + windSpeed() * 0.34 + compression * 0.72;
    return clamp(raw, 0, 1);
}

function stateLabel(layout) {
    const aurora = auroraIntensity(layout);
    const wind = windPower();

    if (wind > 0.82 && aurora > 0.72) {
        return "太陽嵐";
    }

    if (aurora > 0.48) {
        return "活発";
    }

    if (wind < 0.3) {
        return "穏やか";
    }

    return "通常";
}

function quietSunPreset() {
    solarWindSlider.value = 22;
    windSpeedSlider.value = 40;
    magStrengthSlider.value = 78;
    setStatus("穏やかな太陽風にしました。磁気圏が広がり、極へ入る粒子は減ります。", true);
    updateUi();
    draw();
}

function solarStormPreset() {
    solarWindSlider.value = 95;
    windSpeedSlider.value = 92;
    magStrengthSlider.value = 58;
    setStatus("太陽嵐にしました。磁気圏が強く押し込まれ、極地方のオーロラが広がります。", true);
    updateUi();
    draw();
}

function resetSimulation() {
    solarWindSlider.value = 55;
    windSpeedSlider.value = 60;
    magStrengthSlider.value = 70;
    lineDensitySlider.value = 70;
    windParticles = [];
    auroraBands = [];
    hitCounter = 0;
    protectedCounter = 0;
    frame = 0;
    setStatus(defaultStatus);
    updateUi();
    draw();
}

function initStars() {
    const starCount = clamp(Math.floor((width * height) / 5200), 90, 200);
    starField = [];

    for (let index = 0; index < starCount; index += 1) {
        starField.push({
            x: Math.random() * width,
            y: Math.random() * height,
            r: Math.random() * 1.5 + 0.3,
            alpha: Math.random() * 0.6 + 0.2,
            phase: Math.random() * Math.PI * 2
        });
    }
}

function spawnParticles(layout, timeScale) {
    const densityFactor = layout.narrow ? 0.55 : 1;
    const spawnCount = Math.floor((1.2 + windPower() * 7.2) * densityFactor * timeScale);
    const minY = 54;
    const maxY = height - 54;

    for (let index = 0; index < spawnCount; index += 1) {
        windParticles.push({
            x: layout.spawnX + Math.random() * 12,
            y: minY + Math.random() * (maxY - minY),
            vx: 1.7 + windSpeed() * 4.6 + Math.random() * 0.9,
            vy: (Math.random() - 0.5) * 0.5,
            radius: 1.8 + Math.random() * 2.1,
            charge: Math.random() < 0.5 ? 1 : -1,
            state: "wind",
            life: 1,
            trail: []
        });
    }

    const cap = layout.narrow ? 160 : 260;

    if (windParticles.length > cap) {
        windParticles.splice(0, windParticles.length - cap);
    }
}

function magneticFieldAt(x, y, layout) {
    const dx = x - layout.earth.x;
    const dy = y - layout.earth.y;
    const r2 = dx * dx + dy * dy + layout.earth.r * layout.earth.r * 0.35;
    const r = Math.sqrt(r2);
    const nx = dx / r;
    const ny = dy / r;
    const dipoleX = 0;
    const dipoleY = -1;
    const dot = dipoleX * nx + dipoleY * ny;
    const strength = geomagneticStrength() * layout.earth.r * 3600 / (r2 * r);

    return {
        x: strength * (3 * dot * nx - dipoleX),
        y: strength * (3 * dot * ny - dipoleY)
    };
}

function createAurora(layout, north, intensity) {
    const count = Math.floor(4 + intensity * 10);

    for (let index = 0; index < count; index += 1) {
        auroraBands.push({
            x: layout.earth.x + (Math.random() - 0.5) * (layout.earth.r * (0.9 + intensity * 1.2)),
            y: north
                ? layout.earth.y - layout.earth.r - 8 - Math.random() * 16
                : layout.earth.y + layout.earth.r + 8 + Math.random() * 16,
            width: 4 + Math.random() * 8,
            height: layout.earth.r * (0.35 + intensity * 0.9) + Math.random() * 12,
            north,
            alpha: 0.22 + intensity * 0.45,
            life: 1
        });
    }

    const cap = layout.narrow ? 120 : 220;

    if (auroraBands.length > cap) {
        auroraBands.splice(0, auroraBands.length - cap);
    }
}

function updateParticles(layout, timeScale) {
    const magnetosphere = magnetopauseRadius(layout);
    const aurora = auroraIntensity(layout);

    for (const particle of windParticles) {
        particle.trail.push({ x: particle.x, y: particle.y });

        if (particle.trail.length > (layout.narrow ? 6 : 8)) {
            particle.trail.shift();
        }

        const dx = particle.x - layout.earth.x;
        const dy = particle.y - layout.earth.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < magnetosphere + layout.earth.r * 0.8 && particle.state === "wind") {
            const field = magneticFieldAt(particle.x, particle.y, layout);
            const chargeSign = particle.charge;
            particle.vx += -Math.abs(field.y) * 0.18 * chargeSign * timeScale;
            particle.vy += field.x * 0.48 * chargeSign * timeScale;

            const nearPoleLine = Math.abs(dx) < magnetosphere * 0.78 && Math.abs(dy) > layout.earth.r * 0.36;
            const polarChance = (0.004 + aurora * 0.016) * timeScale;

            if (nearPoleLine && Math.random() < polarChance) {
                particle.state = dy < 0 ? "toNorthPole" : "toSouthPole";
            }
        }

        if (particle.state === "toNorthPole" || particle.state === "toSouthPole") {
            const targetY = particle.state === "toNorthPole"
                ? layout.earth.y - layout.earth.r * 0.84
                : layout.earth.y + layout.earth.r * 0.84;
            const targetX = layout.earth.x + Math.sin(frame * 0.05 + particle.y * 0.02) * layout.earth.r * 0.14;

            particle.vx += (targetX - particle.x) * 0.0038 * timeScale;
            particle.vy += (targetY - particle.y) * 0.0046 * timeScale;
        }

        particle.x += particle.vx * timeScale;
        particle.y += particle.vy * timeScale;
        particle.vx *= Math.pow(0.996, timeScale);
        particle.vy *= Math.pow(0.996, timeScale);
        particle.life -= 0.0018 * timeScale;

        const nextDx = particle.x - layout.earth.x;
        const nextDy = particle.y - layout.earth.y;
        const nextDistance = Math.sqrt(nextDx * nextDx + nextDy * nextDy);

        if (nextDistance < layout.earth.r + 7) {
            const polarHit = Math.abs(nextDy) > layout.earth.r * 0.55;

            if (polarHit) {
                createAurora(layout, nextDy < 0, aurora);
                hitCounter += 1;
            } else {
                protectedCounter += 1;
            }

            particle.life = 0;
            continue;
        }

        if (particle.x > width + 80 || particle.y < -90 || particle.y > height + 90 || particle.x < -120) {
            protectedCounter += 1;
            particle.life = 0;
        }
    }

    windParticles = windParticles.filter((particle) => particle.life > 0);

    auroraBands = auroraBands
        .map((band) => ({
            ...band,
            life: band.life - 0.012 * timeScale,
            height: band.height * (1 + 0.01 * timeScale),
            alpha: band.alpha * Math.pow(0.985, timeScale)
        }))
        .filter((band) => band.life > 0 && band.alpha > 0.02);
}

function drawBackground() {
    const sky = context.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "#020817");
    sky.addColorStop(0.4, "#07142a");
    sky.addColorStop(1, "#01040b");
    context.fillStyle = sky;
    context.fillRect(0, 0, width, height);

    for (const star of starField) {
        const twinkle = star.alpha + Math.sin(frame * 0.02 + star.phase) * 0.06;
        context.fillStyle = `rgba(255, 255, 255, ${clamp(twinkle, 0.08, 0.86)})`;
        context.beginPath();
        context.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        context.fill();
    }
}

function drawSun(layout) {
    const glow = context.createRadialGradient(layout.sun.x, layout.sun.y, 12, layout.sun.x, layout.sun.y, layout.sun.r * 2.8);
    glow.addColorStop(0, "rgba(253, 224, 71, 1)");
    glow.addColorStop(0.35, "rgba(249, 115, 22, 0.72)");
    glow.addColorStop(1, "rgba(249, 115, 22, 0)");
    context.fillStyle = glow;
    context.beginPath();
    context.arc(layout.sun.x, layout.sun.y, layout.sun.r * 2.8, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "#f97316";
    context.beginPath();
    context.arc(layout.sun.x, layout.sun.y, layout.sun.r, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "rgba(255, 247, 237, 0.96)";
    context.font = `${layout.narrow ? 12 : 14}px IBM Plex Sans JP`;
    context.textAlign = "center";
    context.fillText("太陽", layout.sun.x, layout.sun.y + layout.sun.r + 20);
}

function drawMagnetosphere(layout) {
    const magnetosphere = magnetopauseRadius(layout);
    const compression = windPower();

    context.save();
    context.translate(layout.earth.x, layout.earth.y);
    context.beginPath();

    for (let angle = 0; angle < Math.PI * 2; angle += 0.026) {
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        let radius = magnetosphere;

        if (cosine < 0) {
            radius *= 0.68 - compression * 0.12;
        } else {
            radius *= 1.2 + compression * 0.75;
        }

        radius *= 1 + 0.05 * Math.sin(3 * angle + frame * 0.03);
        const x = cosine * radius;
        const y = sine * radius * 0.82;

        if (angle === 0) {
            context.moveTo(x, y);
        } else {
            context.lineTo(x, y);
        }
    }

    context.closePath();
    context.fillStyle = "rgba(96, 165, 250, 0.08)";
    context.fill();
    context.strokeStyle = "rgba(125, 211, 252, 0.74)";
    context.lineWidth = 2;
    context.stroke();
    context.restore();
}

function drawFieldLines(layout) {
    if (Number(lineDensitySlider.value) <= 2) {
        return;
    }

    const count = Math.floor(4 + Number(lineDensitySlider.value) / 12);
    context.strokeStyle = "rgba(125, 211, 252, 0.34)";
    context.lineWidth = 1.35;

    for (let index = 1; index <= count; index += 1) {
        const scale = 0.55 + index * 0.18;
        const baseRadius = layout.earth.r * 1.38 * scale;

        context.beginPath();

        for (let angle = -Math.PI * 0.92; angle <= Math.PI * 0.92; angle += 0.035) {
            const radius = baseRadius * Math.sin(angle) * Math.sin(angle);
            const x = layout.earth.x + radius * Math.sin(angle);
            const y = layout.earth.y - radius * Math.cos(angle);

            if (angle === -Math.PI * 0.92) {
                context.moveTo(x, y);
            } else {
                context.lineTo(x, y);
            }
        }

        context.stroke();

        context.beginPath();

        for (let angle = -Math.PI * 0.92; angle <= Math.PI * 0.92; angle += 0.035) {
            const radius = baseRadius * Math.sin(angle) * Math.sin(angle);
            const x = layout.earth.x - radius * Math.sin(angle);
            const y = layout.earth.y - radius * Math.cos(angle);

            if (angle === -Math.PI * 0.92) {
                context.moveTo(x, y);
            } else {
                context.lineTo(x, y);
            }
        }

        context.stroke();
    }
}

function drawAuroras(layout) {
    const intensity = auroraIntensity(layout);

    for (const band of auroraBands) {
        const gradient = context.createLinearGradient(
            band.x,
            band.y,
            band.x,
            band.north ? band.y - band.height : band.y + band.height
        );
        gradient.addColorStop(0, `rgba(34, 197, 94, ${band.alpha})`);
        gradient.addColorStop(0.45, `rgba(56, 189, 248, ${band.alpha * 0.68})`);
        gradient.addColorStop(1, `rgba(168, 85, 247, 0)`);
        context.fillStyle = gradient;
        context.beginPath();
        context.ellipse(
            band.x,
            band.y + (band.north ? -band.height / 2 : band.height / 2),
            band.width,
            band.height,
            Math.sin(frame * 0.03 + band.x * 0.02) * 0.1,
            0,
            Math.PI * 2
        );
        context.fill();
    }

    if (intensity > 0.08) {
        context.strokeStyle = `rgba(34, 197, 94, ${0.18 + intensity * 0.52})`;
        context.lineWidth = 4 + intensity * 5;
        context.beginPath();
        context.ellipse(layout.earth.x, layout.earth.y - layout.earth.r * 0.75, layout.earth.r * (0.45 + intensity * 0.35), 8 + intensity * 12, 0, 0, Math.PI * 2);
        context.stroke();

        context.beginPath();
        context.ellipse(layout.earth.x, layout.earth.y + layout.earth.r * 0.75, layout.earth.r * (0.45 + intensity * 0.35), 8 + intensity * 12, 0, 0, Math.PI * 2);
        context.stroke();
    }
}

function drawParticles() {
    for (const particle of windParticles) {
        for (let index = 0; index < particle.trail.length; index += 1) {
            const trailPoint = particle.trail[index];
            const alpha = (index / Math.max(1, particle.trail.length)) * 0.26;
            context.fillStyle = `rgba(251, 191, 36, ${alpha})`;
            context.beginPath();
            context.arc(trailPoint.x, trailPoint.y, particle.radius * (index / Math.max(1, particle.trail.length)), 0, Math.PI * 2);
            context.fill();
        }

        context.fillStyle = particle.state === "wind" ? "rgba(251, 191, 36, 0.94)" : "rgba(34, 197, 94, 0.96)";
        context.beginPath();
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        context.fill();
    }
}

function drawEarth(layout) {
    const gradient = context.createRadialGradient(
        layout.earth.x - layout.earth.r * 0.3,
        layout.earth.y - layout.earth.r * 0.3,
        5,
        layout.earth.x,
        layout.earth.y,
        layout.earth.r
    );
    gradient.addColorStop(0, "#93c5fd");
    gradient.addColorStop(0.55, "#2563eb");
    gradient.addColorStop(1, "#0f172a");
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(layout.earth.x, layout.earth.y, layout.earth.r, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "rgba(34, 197, 94, 0.8)";
    context.beginPath();
    context.ellipse(layout.earth.x - layout.earth.r * 0.32, layout.earth.y - layout.earth.r * 0.18, layout.earth.r * 0.26, layout.earth.r * 0.42, -0.5, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.ellipse(layout.earth.x + layout.earth.r * 0.35, layout.earth.y + layout.earth.r * 0.2, layout.earth.r * 0.34, layout.earth.r * 0.24, 0.35, 0, Math.PI * 2);
    context.fill();

    context.strokeStyle = "rgba(147, 197, 253, 0.5)";
    context.lineWidth = 5;
    context.beginPath();
    context.arc(layout.earth.x, layout.earth.y, layout.earth.r + 5, 0, Math.PI * 2);
    context.stroke();

    context.fillStyle = "#e0f2fe";
    context.font = `${layout.narrow ? 12 : 14}px IBM Plex Sans JP`;
    context.textAlign = "center";
    context.fillText("地球", layout.earth.x, layout.earth.y + layout.earth.r + 22);
    context.fillText("北極", layout.earth.x, layout.earth.y - layout.earth.r - 12);
    context.fillText("南極", layout.earth.x, layout.earth.y + layout.earth.r + 42);
}

function drawArrow(x, y, length) {
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + length, y);
    context.stroke();
    context.beginPath();
    context.moveTo(x + length, y);
    context.lineTo(x + length - 10, y - 5);
    context.lineTo(x + length - 10, y + 5);
    context.closePath();
    context.fill();
}

function drawAnnotations(layout) {
    const arrowLength = 48 + windPower() * 58;
    const arrowX = layout.arrowStartX;
    const arrowBaseY = layout.earth.y - 86;

    context.strokeStyle = "rgba(251, 191, 36, 0.48)";
    context.fillStyle = "rgba(251, 191, 36, 0.48)";
    context.lineWidth = 2;

    for (let index = 0; index < 4; index += 1) {
        drawArrow(arrowX, arrowBaseY + index * 56, arrowLength);
    }

    context.fillStyle = "rgba(255, 247, 237, 0.84)";
    context.font = `${layout.narrow ? 11 : 12}px IBM Plex Sans JP`;
    context.textAlign = "left";
    context.fillText("太陽風", arrowX, arrowBaseY - 16);
}

function drawHud(layout) {
    const magnetosphere = magnetopauseRadius(layout);
    const aurora = auroraIntensity(layout);
    const total = hitCounter + protectedCounter;
    const protectRatio = total > 0 ? protectedCounter / total : 1;
    const state = stateLabel(layout);

    context.fillStyle = "rgba(6, 12, 24, 0.74)";
    drawRoundedRectPath(layout.hudBox.x, layout.hudBox.y, layout.hudBox.w, layout.hudBox.h, 18);
    context.fill();
    context.strokeStyle = "rgba(148, 163, 184, 0.7)";
    context.lineWidth = 1.2;
    context.stroke();

    context.fillStyle = "#f8fafc";
    context.font = `${layout.narrow ? 12 : 14}px IBM Plex Sans JP`;
    context.fillText(state, layout.hudBox.x + 14, layout.hudBox.y + 24);
    context.fillStyle = "#cbd5e1";
    context.font = `${layout.narrow ? 10 : 12}px IBM Plex Sans JP`;
    context.fillText(`磁気圏 ${magnetosphere.toFixed(0)} px`, layout.hudBox.x + 14, layout.hudBox.y + 48);
    context.fillText(`オーロラ ${(aurora * 100).toFixed(0)} %`, layout.hudBox.x + 14, layout.hudBox.y + 68);
    context.fillText(`防御率 ${(protectRatio * 100).toFixed(0)} %`, layout.hudBox.x + 14, layout.hudBox.y + 88);

    context.fillStyle = "rgba(6, 12, 24, 0.68)";
    drawRoundedRectPath(layout.legendBox.x, layout.legendBox.y, layout.legendBox.w, layout.legendBox.h, 18);
    context.fill();
    context.strokeStyle = "rgba(148, 163, 184, 0.54)";
    context.stroke();

    const legendItems = [
        { color: "#fbbf24", text: "黄色: 太陽風粒子" },
        { color: "#7dd3fc", text: "水色: 磁力線と磁気圏" },
        { color: "#34d399", text: "緑〜紫: 極域オーロラ" }
    ];

    legendItems.forEach((item, index) => {
        const y = layout.legendBox.y + 24 + index * 20;
        context.fillStyle = item.color;
        context.fillRect(layout.legendBox.x + 14, y - 9, 12, 4);
        context.fillStyle = "#dbeafe";
        context.font = `${layout.narrow ? 10 : 11}px IBM Plex Sans JP`;
        context.fillText(item.text, layout.legendBox.x + 32, y - 4);
    });
}

function draw() {
    const layout = getLayout();
    context.clearRect(0, 0, width, height);
    drawBackground();
    drawSun(layout);
    drawMagnetosphere(layout);
    drawFieldLines(layout);
    drawParticles();
    drawAuroras(layout);
    drawEarth(layout);
    drawAnnotations(layout);
    drawHud(layout);
}

function updateUi() {
    const layout = getLayout();
    const wind = Number(solarWindSlider.value);
    const speed = Number(windSpeedSlider.value);
    const magnetic = Number(magStrengthSlider.value);
    const lineDensity = Number(lineDensitySlider.value);
    const magnetosphere = magnetopauseRadius(layout);
    const aurora = auroraIntensity(layout);
    const total = hitCounter + protectedCounter;
    const protectRatio = total > 0 ? protectedCounter / total : 1;
    const state = stateLabel(layout);

    windScaleText.textContent = `${wind.toFixed(0)} %`;
    windSpeedText.textContent = `${speed.toFixed(0)} %`;
    magStrengthText.textContent = `${magnetic.toFixed(0)} %`;
    fieldLinesText.textContent = lineDensity <= 2 ? "OFF" : `${lineDensity.toFixed(0)} %`;

    shieldStat.textContent = `${magnetosphere.toFixed(0)} px`;
    entryStat.textContent = `${hitCounter}`;
    auroraStat.textContent = `${(aurora * 100).toFixed(0)} %`;
    protectStat.textContent = `${(protectRatio * 100).toFixed(0)} %`;
    stateStat.textContent = state;
    brightnessStat.textContent = `${(aurora * 100).toFixed(0)} %`;

    quickWind.textContent = `${wind.toFixed(0)} %`;
    quickShield.textContent = `${magnetosphere.toFixed(0)} px`;
    quickAurora.textContent = `${(aurora * 100).toFixed(0)} %`;
    quickState.textContent = state;
}

function resizeCanvas() {
    const nextWidth = Math.max(320, Math.floor(canvas.clientWidth || simulationShell.clientWidth || 320));
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

    width = nextWidth;

    if (window.matchMedia("(max-width: 900px)").matches) {
        height = Math.max(460, Math.min(620, Math.floor(Math.min(width * 1.08, viewportHeight * 0.62))));
    } else {
        height = Math.max(720, Math.min(860, Math.floor(width * 0.64)));
    }

    widthDpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * widthDpr);
    canvas.height = Math.floor(height * widthDpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(widthDpr, 0, 0, widthDpr, 0, 0);
    initStars();
    windParticles = [];
    auroraBands = [];
}

function loop(timestamp) {
    if (!lastTime) {
        lastTime = timestamp;
    }

    const delta = Math.min(32, timestamp - lastTime);
    lastTime = timestamp;
    const timeScale = delta / 16.6667;
    const layout = getLayout();

    frame += timeScale;
    spawnParticles(layout, timeScale);
    updateParticles(layout, timeScale);
    updateUi();
    draw();
    window.requestAnimationFrame(loop);
}

quietSunButton?.addEventListener("click", quietSunPreset);
solarStormButton?.addEventListener("click", solarStormPreset);
resetButton?.addEventListener("click", resetSimulation);

[solarWindSlider, windSpeedSlider, magStrengthSlider, lineDensitySlider].forEach((slider) => {
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
updateUi();
draw();
window.requestAnimationFrame(loop);