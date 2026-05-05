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

const canvas = document.querySelector("#phCanvas");
const simulationShell = document.querySelector("#playgroundShell");
const context = canvas?.getContext("2d");

if (!canvas || !simulationShell || !context) {
    throw new Error("pH page failed to initialize.");
}

const amountSlider = document.querySelector("#amount");
const acidPhSlider = document.querySelector("#acidPh");
const basePhSlider = document.querySelector("#basePh");
const addAcidButton = document.querySelector("#addAcid");
const addBaseButton = document.querySelector("#addBase");
const addWaterButton = document.querySelector("#addWater");
const resetButton = document.querySelector("#resetSim");
const amountText = document.querySelector("#amountText");
const acidPhText = document.querySelector("#acidPhText");
const basePhText = document.querySelector("#basePhText");
const volumeStat = document.querySelector("#volumeStat");
const phStat = document.querySelector("#phStat");
const typeStat = document.querySelector("#typeStat");
const neutralStat = document.querySelector("#neutralStat");
const hStat = document.querySelector("#hStat");
const ohStat = document.querySelector("#ohStat");
const quickVolume = document.querySelector("#quickVolume");
const quickPh = document.querySelector("#quickPh");
const quickState = document.querySelector("#quickState");
const panelStatus = document.querySelector("#panelStatus");

let width = 0;
let height = 0;
let volumeL = 0;
let hMol = 0;
let ohMol = 0;
let neutralizedMol = 0;
let particles = [];
let drops = [];
let reactionFlashes = [];
let statusTimeout = 0;

const maxVolumeL = 1.4;
const defaultStatus = "酸と塩基を混ぜると、H+ と OH- が中和して水になり、残ったイオンの量で pH が決まります。";

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function currentPH() {
    if (volumeL <= 0) {
        return 7;
    }

    const excessH = hMol - ohMol;
    const excessOH = ohMol - hMol;

    if (Math.abs(excessH) < 1e-18 && Math.abs(excessOH) < 1e-18) {
        return 7;
    }

    if (excessH > 0) {
        const hConc = Math.max(excessH / volumeL, 1e-14);
        return clamp(-Math.log10(hConc), 0, 14);
    }

    const ohConc = Math.max(excessOH / volumeL, 1e-14);
    const pOH = -Math.log10(ohConc);
    return clamp(14 - pOH, 0, 14);
}

function liquidType(phValue) {
    if (phValue < 6.8) {
        return "酸性";
    }

    if (phValue > 7.2) {
        return "アルカリ性";
    }

    return "ほぼ中性";
}

function neutralizationRatio() {
    const totalIon = neutralizedMol + hMol + ohMol;
    return totalIon > 0 ? neutralizedMol / totalIon : 0;
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

function colorForPH(phValue, alpha = 0.75) {
    let red;
    let green;
    let blue;

    if (phValue < 7) {
        const ratio = phValue / 7;
        red = 239;
        green = Math.round(68 + 145 * ratio);
        blue = Math.round(68 + 72 * ratio);
    } else {
        const ratio = (phValue - 7) / 7;
        red = Math.round(34 + 65 * ratio);
        green = Math.round(197 - 95 * ratio);
        blue = Math.round(94 + 141 * ratio);
    }

    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function updateUi() {
    const phValue = currentPH();

    amountText.textContent = `${amountSlider.value} mL`;
    acidPhText.textContent = `pH ${Number(acidPhSlider.value).toFixed(1)}`;
    basePhText.textContent = `pH ${Number(basePhSlider.value).toFixed(1)}`;
    volumeStat.textContent = `${(volumeL * 1000).toFixed(0)} mL`;
    phStat.textContent = phValue.toFixed(2);
    typeStat.textContent = volumeL > 0 ? liquidType(phValue) : "中性";
    neutralStat.textContent = `${(neutralizationRatio() * 100).toFixed(0)} %`;
    hStat.textContent = `${hMol.toExponential(2)} mol`;
    ohStat.textContent = `${ohMol.toExponential(2)} mol`;
    quickVolume.textContent = `${(volumeL * 1000).toFixed(0)} mL`;
    quickPh.textContent = phValue.toFixed(2);
    quickState.textContent = volumeL > 0 ? liquidType(phValue) : "中性";
}

function getBeakerGeometry() {
    if (width <= 640) {
        const beakerWidth = Math.min(210, Math.max(178, width * 0.5));
        const beakerHeight = Math.min(236, Math.max(172, height * 0.5));
        const x = Math.max(102, Math.min(width * 0.33, width - beakerWidth - 40));
        const y = Math.max(116, height * 0.29);

        return {
            x,
            y,
            w: beakerWidth,
            h: beakerHeight
        };
    }

    const beakerWidth = width > 980 ? width * 0.3 : width * 0.34;
    const beakerHeight = height * 0.6;
    const x = width > 980 ? width * 0.38 : width * 0.31;
    const y = height * 0.16;

    return {
        x,
        y,
        w: Math.min(380, Math.max(250, beakerWidth)),
        h: Math.min(410, Math.max(250, beakerHeight))
    };
}

function liquidBounds(beaker) {
    const fillRatio = Math.min(1, volumeL / maxVolumeL);
    const liquidHeight = beaker.h * fillRatio;
    const liquidTop = beaker.y + beaker.h - liquidHeight;
    return {
        liquidTop,
        liquidBottom: beaker.y + beaker.h,
        liquidHeight
    };
}

function randomInsideLiquid(beaker) {
    const bounds = liquidBounds(beaker);
    return {
        x: beaker.x + 48 + Math.random() * Math.max(1, beaker.w - 96),
        y: bounds.liquidTop + 15 + Math.random() * Math.max(1, bounds.liquidHeight - 30)
    };
}

function makeDrops(kind, phValue, count, beaker) {
    const totalCount = Math.min(24, Math.max(4, count));
    const startX = beaker.x + beaker.w * 0.52;

    for (let index = 0; index < totalCount; index += 1) {
        drops.push({
            kind,
            ph: phValue,
            x: startX + Math.random() * 90 - 45,
            y: beaker.y - 56 + Math.random() * 28,
            vy: 2 + Math.random() * 3,
            r: 3 + Math.random() * 5,
            life: 1
        });
    }

    if (drops.length > 160) {
        drops.splice(0, drops.length - 160);
    }
}

function makeParticles(kind, phValue, count, beaker) {
    if (volumeL <= 0 || count <= 0) {
        return;
    }

    for (let index = 0; index < count; index += 1) {
        const point = randomInsideLiquid(beaker);
        particles.push({
            kind,
            ph: phValue,
            x: point.x,
            y: point.y,
            vx: Math.random() * 2 - 1,
            vy: Math.random() * 2 - 1,
            r: 2 + Math.random() * 4,
            life: 1
        });
    }

    if (particles.length > 450) {
        particles.splice(0, particles.length - 450);
    }
}

function makeReactionFlashes(count, beaker) {
    if (count <= 0) {
        return;
    }

    const bounds = liquidBounds(beaker);

    for (let index = 0; index < count; index += 1) {
        reactionFlashes.push({
            x: beaker.x + 60 + Math.random() * Math.max(1, beaker.w - 120),
            y: bounds.liquidTop + 20 + Math.random() * Math.max(1, bounds.liquidHeight - 40),
            r: 8 + Math.random() * 18,
            alpha: 0.45
        });
    }
}

function neutralize() {
    const reacted = Math.min(hMol, ohMol);
    hMol -= reacted;
    ohMol -= reacted;
    neutralizedMol += reacted;
}

function addLiquid(volumeToAdd, addH, addOH, kind, phValue) {
    const allowed = Math.max(0, maxVolumeL - volumeL);
    const ratio = volumeToAdd > 0 ? Math.min(1, allowed / volumeToAdd) : 0;
    const adjustedVolume = volumeToAdd * ratio;
    const adjustedH = addH * ratio;
    const adjustedOH = addOH * ratio;

    if (adjustedVolume <= 0) {
        setStatus("容器がいっぱいです。リセットして最初から試してください。", true);
        return;
    }

    const beforeNeutralized = neutralizedMol;
    volumeL += adjustedVolume;
    hMol += adjustedH;
    ohMol += adjustedOH;
    neutralize();

    const beaker = getBeakerGeometry();
    const reactedNow = neutralizedMol - beforeNeutralized;
    makeDrops(kind, phValue, Math.floor(adjustedVolume * 220), beaker);
    makeParticles(kind, phValue, Math.floor(adjustedVolume * 350), beaker);
    makeReactionFlashes(Math.min(20, Math.floor(4 + reactedNow * 200000)), beaker);

    if (kind === "acid") {
        setStatus(`酸性液体を ${(adjustedVolume * 1000).toFixed(0)} mL 入れました。H+ が増え、pH は酸性側へ動きます。`, true);
    } else if (kind === "base") {
        setStatus(`アルカリ性液体を ${(adjustedVolume * 1000).toFixed(0)} mL 入れました。OH- が増え、pH はアルカリ性側へ動きます。`, true);
    } else {
        setStatus(`中性の水を ${(adjustedVolume * 1000).toFixed(0)} mL 入れました。イオン濃度が薄まり、pH は 7 に近づきます。`, true);
    }
}

function addAcid() {
    const volumeMl = Number(amountSlider.value);
    const phValue = Number(acidPhSlider.value);
    const volumeToAdd = volumeMl / 1000;
    const addH = Math.pow(10, -phValue) * volumeToAdd;
    addLiquid(volumeToAdd, addH, 0, "acid", phValue);
}

function addBase() {
    const volumeMl = Number(amountSlider.value);
    const phValue = Number(basePhSlider.value);
    const volumeToAdd = volumeMl / 1000;
    const pOH = 14 - phValue;
    const addOH = Math.pow(10, -pOH) * volumeToAdd;
    addLiquid(volumeToAdd, 0, addOH, "base", phValue);
}

function addWater() {
    const volumeMl = Number(amountSlider.value);
    const volumeToAdd = volumeMl / 1000;
    addLiquid(volumeToAdd, 0, 0, "water", 7);
}

function resetSimulation() {
    volumeL = 0;
    hMol = 0;
    ohMol = 0;
    neutralizedMol = 0;
    particles = [];
    drops = [];
    reactionFlashes = [];
    updateUi();
    setStatus("シミュレーションをリセットしました。酸、塩基、水を入れて最初から試せます。", true);
}

function updatePhysics() {
    neutralize();
    const beaker = getBeakerGeometry();
    const bounds = liquidBounds(beaker);
    const phValue = currentPH();

    for (const particle of particles) {
        particle.vx += (Math.random() - 0.5) * 0.14;
        particle.vy += (Math.random() - 0.5) * 0.14;
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vx *= 0.96;
        particle.vy *= 0.96;
        particle.ph += (phValue - particle.ph) * 0.012;
        particle.life -= 0.0015;

        const left = beaker.x + 42;
        const right = beaker.x + beaker.w - 42;

        if (particle.x < left) {
            particle.x = left;
            particle.vx *= -0.6;
        }

        if (particle.x > right) {
            particle.x = right;
            particle.vx *= -0.6;
        }

        if (particle.y < bounds.liquidTop + 8) {
            particle.y = bounds.liquidTop + 8;
            particle.vy *= -0.5;
        }

        if (particle.y > bounds.liquidBottom - 8) {
            particle.y = bounds.liquidBottom - 8;
            particle.vy *= -0.5;
        }
    }

    particles = particles.filter((particle) => particle.life > 0.18);

    drops = drops
        .map((drop) => ({
            ...drop,
            y: drop.y + drop.vy,
            vy: drop.vy + 0.06,
            life: drop.life - 0.002
        }))
        .filter((drop) => drop.y < bounds.liquidBottom && drop.life > 0);

    reactionFlashes = reactionFlashes
        .map((flash) => ({
            ...flash,
            r: flash.r * 1.025,
            alpha: flash.alpha - 0.012
        }))
        .filter((flash) => flash.alpha > 0);
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

function drawWrappedText(text, x, y, maxWidth, lineHeight) {
    let line = "";
    let currentY = y;

    for (const character of text) {
        const trial = line + character;

        if (line && context.measureText(trial).width > maxWidth) {
            context.fillText(line, x, currentY);
            line = character;
            currentY += lineHeight;
        } else {
            line = trial;
        }
    }

    if (line) {
        context.fillText(line, x, currentY);
    }

    return currentY;
}

function drawBeaker(beaker) {
    context.lineWidth = 5;
    context.strokeStyle = "rgba(30, 41, 59, 0.72)";
    context.beginPath();
    context.moveTo(beaker.x, beaker.y);
    context.lineTo(beaker.x + 35, beaker.y + beaker.h);
    context.lineTo(beaker.x + beaker.w - 35, beaker.y + beaker.h);
    context.lineTo(beaker.x + beaker.w, beaker.y);
    context.stroke();

    context.lineWidth = 3;
    context.strokeStyle = "rgba(148, 163, 184, 0.7)";

    for (let index = 1; index <= 5; index += 1) {
        const markerY = beaker.y + beaker.h - index * beaker.h / 6;
        context.beginPath();
        context.moveTo(beaker.x + 28, markerY);
        context.lineTo(beaker.x + 54, markerY);
        context.stroke();
    }
}

function drawLiquid(beaker) {
    if (volumeL <= 0) {
        return;
    }

    const bounds = liquidBounds(beaker);
    const phValue = currentPH();
    const wave = Math.sin(performance.now() * 0.003) * 5;
    const gradient = context.createLinearGradient(0, bounds.liquidTop, 0, bounds.liquidBottom);

    gradient.addColorStop(0, colorForPH(phValue, 0.68));
    gradient.addColorStop(1, colorForPH(phValue, 0.88));

    context.fillStyle = gradient;
    context.beginPath();
    context.moveTo(beaker.x + 35, bounds.liquidBottom);
    context.lineTo(beaker.x + beaker.w - 35, bounds.liquidBottom);
    context.lineTo(beaker.x + beaker.w - 15, bounds.liquidTop + wave);
    context.quadraticCurveTo(beaker.x + beaker.w / 2, bounds.liquidTop - wave, beaker.x + 15, bounds.liquidTop + wave);
    context.closePath();
    context.fill();

    context.fillStyle = "rgba(255, 255, 255, 0.22)";
    context.beginPath();
    context.ellipse(beaker.x + beaker.w / 2, bounds.liquidTop, Math.min(145, beaker.w * 0.42), 10, 0, 0, Math.PI * 2);
    context.fill();
}

function drawParticles() {
    for (const particle of particles) {
        context.fillStyle = colorForPH(particle.ph, 0.55);
        context.strokeStyle = "rgba(255, 255, 255, 0.35)";
        context.beginPath();
        context.arc(particle.x, particle.y, particle.r, 0, Math.PI * 2);
        context.fill();
        context.stroke();
    }
}

function drawDrops() {
    for (const drop of drops) {
        context.fillStyle = colorForPH(drop.ph, 0.82);
        context.beginPath();
        context.arc(drop.x, drop.y, drop.r, 0, Math.PI * 2);
        context.fill();
    }
}

function drawFlashes() {
    for (const flash of reactionFlashes) {
        context.strokeStyle = `rgba(255, 255, 255, ${flash.alpha})`;
        context.lineWidth = 3;
        context.beginPath();
        context.arc(flash.x, flash.y, flash.r, 0, Math.PI * 2);
        context.stroke();
    }
}

function drawPHScale() {
    const compact = width <= 640;
    const scaleX = compact ? 24 : 62;
    const scaleY = compact ? 112 : 115;
    const scaleWidth = compact ? 28 : 36;
    const scaleHeight = compact ? 250 : 340;
    const phValue = currentPH();

    for (let index = 0; index < scaleHeight; index += 1) {
        const scalePH = 14 - index / scaleHeight * 14;
        context.fillStyle = colorForPH(scalePH, 1);
        context.fillRect(scaleX, scaleY + index, scaleWidth, 1);
    }

    context.strokeStyle = "#334155";
    context.lineWidth = 2;
    context.strokeRect(scaleX, scaleY, scaleWidth, scaleHeight);

    context.fillStyle = "#111827";
    context.font = `${compact ? 12 : 13}px "IBM Plex Sans JP"`;
    context.fillText("pH", scaleX + 4, scaleY - 12);
    context.fillText("14", scaleX + scaleWidth + 10, scaleY + 5);
    context.fillText("7", scaleX + scaleWidth + 10, scaleY + scaleHeight / 2 + 4);
    context.fillText("0", scaleX + scaleWidth + 10, scaleY + scaleHeight + 4);

    const markerY = scaleY + scaleHeight - phValue / 14 * scaleHeight;
    context.fillStyle = "#111827";
    context.beginPath();
    context.moveTo(scaleX - 10, markerY);
    context.lineTo(scaleX - 2, markerY - 7);
    context.lineTo(scaleX - 2, markerY + 7);
    context.closePath();
    context.fill();
    context.font = `${compact ? 12 : 14}px "IBM Plex Sans JP"`;
    context.fillText(phValue.toFixed(2), scaleX - (compact ? 46 : 52), markerY + 5);
}

function drawEquationFooter() {
    const compact = width <= 640;
    context.fillStyle = "#111827";
    context.font = `${compact ? 14 : 16}px "IBM Plex Sans JP"`;
    drawWrappedText("中和反応: H+ + OH- → H2O", compact ? 24 : width - 310, compact ? height - 62 : height - 46, compact ? width - 48 : 280, compact ? 18 : 20);
}

function drawNeutralNotice(beaker) {
    if (volumeL <= 0 || Math.abs(currentPH() - 7) >= 0.15) {
        return;
    }

    const compact = width <= 640;
    const noticeWidth = compact ? Math.min(220, width - 52) : 310;
    const noticeHeight = compact ? 74 : 80;
    const noticeX = beaker.x + beaker.w / 2 - noticeWidth / 2;
    const noticeY = compact ? beaker.y + 18 : beaker.y + 64;

    context.fillStyle = "rgba(34, 197, 94, 0.12)";
    drawRoundedRectPath(noticeX, noticeY, noticeWidth, noticeHeight, 18);
    context.fill();
    context.fillStyle = "#166534";
    context.textAlign = "center";
    context.font = `${compact ? 16 : 18}px "IBM Plex Sans JP"`;
    context.fillText("ほぼ中性になりました", noticeX + noticeWidth / 2, noticeY + noticeHeight / 2 + 6);
    context.textAlign = "left";
}

function draw() {
    context.clearRect(0, 0, width, height);

    const beaker = getBeakerGeometry();
    const compact = width <= 640;
    const phValue = currentPH();

    drawLiquid(beaker);
    drawParticles();
    drawFlashes();
    drawBeaker(beaker);
    drawDrops();
    drawPHScale();
    drawNeutralNotice(beaker);
    drawEquationFooter();

    context.fillStyle = "#111827";
    context.font = `${compact ? 15 : 17}px "IBM Plex Sans JP"`;
    let status = "液体を入れてください";

    if (volumeL > 0) {
        status = `現在は ${liquidType(phValue)}: pH ${phValue.toFixed(2)}`;
    }

    const statusEndY = drawWrappedText(status, 24, compact ? 34 : 38, width - 48, compact ? 18 : 22);

    context.fillStyle = "#475569";
    context.font = `${compact ? 12 : 13}px "IBM Plex Sans JP"`;
    drawWrappedText("ポイント: 単純な pH 平均ではなく、残った H+ / OH- の濃度で最終 pH が決まる", 24, statusEndY + 14, width - 48, compact ? 16 : 18);
}

function resizeCanvas() {
    const rect = simulationShell.getBoundingClientRect();

    if (!rect.width) {
        return;
    }

    width = Math.max(320, Math.floor(rect.width));

    if (window.matchMedia("(max-width: 900px)").matches) {
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        height = Math.max(360, Math.min(470, Math.floor(Math.min(width * 0.94, viewportHeight * 0.55))));
    } else {
        height = Math.max(540, Math.floor(rect.height || 840));
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function loop() {
    updatePhysics();
    updateUi();
    draw();
    window.requestAnimationFrame(loop);
}

addAcidButton?.addEventListener("click", addAcid);
addBaseButton?.addEventListener("click", addBase);
addWaterButton?.addEventListener("click", addWater);
resetButton?.addEventListener("click", resetSimulation);

[amountSlider, acidPhSlider, basePhSlider].forEach((slider) => {
    slider?.addEventListener("input", updateUi);
});

window.addEventListener("resize", resizeCanvas);

resizeCanvas();
updateUi();
loop();