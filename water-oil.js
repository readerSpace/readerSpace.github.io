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

const canvas = document.querySelector("#separationCanvas");
const simulationShell = document.querySelector("#playgroundShell");
const context = canvas?.getContext("2d");

if (!canvas || !simulationShell || !context) {
    throw new Error("Water oil page failed to initialize.");
}

const addAmountSlider = document.querySelector("#addAmount");
const shakePowerSlider = document.querySelector("#shakePower");
const addWaterButton = document.querySelector("#addWater");
const addOilButton = document.querySelector("#addOil");
const startShakeButton = document.querySelector("#startShake");
const stopShakeButton = document.querySelector("#stopShake");
const resetButton = document.querySelector("#resetSim");
const addAmountText = document.querySelector("#addAmountText");
const shakePowerText = document.querySelector("#shakePowerText");
const waterStat = document.querySelector("#waterStat");
const oilStat = document.querySelector("#oilStat");
const totalStat = document.querySelector("#totalStat");
const mixStat = document.querySelector("#mixStat");
const oilDropStat = document.querySelector("#oilDropStat");
const waterDropStat = document.querySelector("#waterDropStat");
const quickTotal = document.querySelector("#quickTotal");
const quickMix = document.querySelector("#quickMix");
const quickState = document.querySelector("#quickState");
const panelStatus = document.querySelector("#panelStatus");

let width = 0;
let height = 0;
let waterVolume = 0;
let oilVolume = 0;
let mixLevel = 0;
let shaking = false;
let shakeTimer = 0;
let particles = [];
let pourDrops = [];
let statusTimeout = 0;
let particleSeed = 0;

const maxVolume = 1000;
const defaultStatus = "油は上、水は下。振ると細かい液滴が増えて一時的に白っぽく混ざります。";

function totalVolume() {
    return waterVolume + oilVolume;
}

function currentStateLabel() {
    if (totalVolume() <= 0) {
        return "空";
    }

    if (shaking) {
        return "振とう中";
    }

    if (mixLevel > 0.42) {
        return "乳化状態";
    }

    if (mixLevel > 0.12) {
        return "分離中";
    }

    if (waterVolume > 0 && oilVolume > 0) {
        return "二層";
    }

    return waterVolume > 0 ? "水だけ" : "油だけ";
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

function updateUi() {
    const oilDrops = particles.filter((particle) => particle.type === "oil").length;
    const waterDrops = particles.filter((particle) => particle.type === "water").length;

    addAmountText.textContent = `${addAmountSlider.value} mL`;
    shakePowerText.textContent = shakePowerSlider.value;
    waterStat.textContent = `${waterVolume.toFixed(0)} mL`;
    oilStat.textContent = `${oilVolume.toFixed(0)} mL`;
    totalStat.textContent = `${totalVolume().toFixed(0)} mL`;
    mixStat.textContent = `${(mixLevel * 100).toFixed(0)} %`;
    oilDropStat.textContent = `${oilDrops}`;
    waterDropStat.textContent = `${waterDrops}`;
    quickTotal.textContent = `${totalVolume().toFixed(0)} mL`;
    quickMix.textContent = `${(mixLevel * 100).toFixed(0)} %`;
    quickState.textContent = currentStateLabel();
    stopShakeButton.disabled = !shaking;
}

function getBeakerGeometry() {
    if (width <= 640) {
        const beakerWidth = Math.min(220, Math.max(188, width * 0.56));
        const beakerHeight = Math.min(228, Math.max(172, height * 0.48));
        const x = Math.max(34, Math.min(width * 0.18, width - beakerWidth - 86));
        const y = Math.max(112, height * 0.3);

        return {
            x,
            y,
            w: beakerWidth,
            h: beakerHeight
        };
    }

    const beakerWidth = width > 980 ? width * 0.32 : width * 0.36;
    const beakerHeight = height * 0.6;
    const x = width > 980 ? width * 0.39 : width * 0.31;
    const y = height * 0.16;

    return {
        x,
        y,
        w: Math.min(380, Math.max(250, beakerWidth)),
        h: Math.min(410, Math.max(250, beakerHeight))
    };
}

function liquidBounds(beaker) {
    const fillRatio = Math.min(1, totalVolume() / maxVolume);
    const liquidHeight = beaker.h * fillRatio;
    const liquidBottom = beaker.y + beaker.h;
    const liquidTop = liquidBottom - liquidHeight;

    return {
        liquidHeight,
        liquidTop,
        liquidBottom
    };
}

function randomInsideLiquid(beaker) {
    const bounds = liquidBounds(beaker);
    const margin = Math.max(22, beaker.w * 0.11);
    return {
        x: beaker.x + margin + Math.random() * Math.max(1, beaker.w - margin * 2),
        y: bounds.liquidTop + 14 + Math.random() * Math.max(1, bounds.liquidHeight - 28)
    };
}

function addPourDrops(type, amount, beaker) {
    const count = Math.min(24, Math.max(6, Math.floor(amount / 8)));
    const startX = beaker.x + beaker.w * 0.52;

    for (let i = 0; i < count; i += 1) {
        pourDrops.push({
            type,
            x: startX + Math.random() * 70 - 35,
            y: beaker.y - 48 + Math.random() * 26,
            vy: 2.2 + Math.random() * 2.8,
            r: 3.5 + Math.random() * 5.5
        });
    }
}

function createParticles(type, count, beaker) {
    if (totalVolume() <= 0 || count <= 0) {
        return;
    }

    for (let i = 0; i < count; i += 1) {
        const position = randomInsideLiquid(beaker);
        particleSeed += 1;
        particles.push({
            type,
            x: position.x,
            y: position.y,
            vx: Math.random() * 2 - 1,
            vy: Math.random() * 2 - 1,
            r: 3 + Math.random() * 7,
            life: 1,
            seed: particleSeed
        });
    }

    if (particles.length > 520) {
        particles.splice(0, particles.length - 520);
    }
}

function addLiquid(type) {
    const requested = Number(addAmountSlider.value);
    const available = Math.max(0, maxVolume - totalVolume());
    const added = Math.min(requested, available);

    if (added <= 0) {
        setStatus("容器がいっぱいです。少し減らすにはリセットして最初から試してください。", true);
        return;
    }

    if (type === "water") {
        waterVolume += added;
    } else {
        oilVolume += added;
    }

    const beaker = getBeakerGeometry();
    addPourDrops(type, added, beaker);
    createParticles(type, Math.max(4, Math.floor(added / 14)), beaker);

    if (waterVolume > 0 && oilVolume > 0) {
        mixLevel = Math.min(1, mixLevel + 0.04);
    }

    setStatus(type === "water" ? `水を ${added.toFixed(0)} mL 入れました。両方そろうと、静置時は水が下の層を作ります。` : `油を ${added.toFixed(0)} mL 入れました。両方そろうと、静置時は油が上の層を作ります。`, true);
}

function startShake() {
    if (totalVolume() <= 0) {
        setStatus("先に水か油を入れてください。", true);
        return;
    }

    if (waterVolume <= 0 || oilVolume <= 0) {
        setStatus("二層の分離を見るには、水と油の両方を入れてください。", true);
        return;
    }

    const power = Number(shakePowerSlider.value);
    shaking = true;
    shakeTimer = Math.round(54 + power * 0.7);
    mixLevel = Math.min(1, mixLevel + 0.08 + power / 600);
    setStatus("容器を振っています。界面が崩れて細かい液滴が増え、白っぽい混合状態になります。", true);
}

function stopShake() {
    if (!shaking) {
        return;
    }

    shaking = false;
    setStatus("振るのを止めました。時間がたつと油は上へ、水は下へ戻っていきます。", true);
}

function resetSimulation() {
    waterVolume = 0;
    oilVolume = 0;
    mixLevel = 0;
    shaking = false;
    shakeTimer = 0;
    particles = [];
    pourDrops = [];
    updateUi();
    setStatus("シミュレーションをリセットしました。水や油を入れて最初から試せます。", true);
}

function physicsStep() {
    const total = totalVolume();
    const power = Number(shakePowerSlider.value) / 100;
    const beaker = getBeakerGeometry();
    const bounds = liquidBounds(beaker);

    if (shaking && total > 0) {
        mixLevel = Math.min(1, mixLevel + 0.018 + power * 0.05);
        createParticles("oil", Math.max(1, Math.floor(2 + power * 7)), beaker);
        createParticles("water", Math.max(1, Math.floor(2 + power * 5)), beaker);
        shakeTimer -= 1;

        if (shakeTimer <= 0) {
            shaking = false;
        }
    } else if (total > 0) {
        mixLevel *= 0.992;
    } else {
        mixLevel *= 0.94;
    }

    if (mixLevel < 0.002) {
        mixLevel = 0;
    }

    const waterRatio = total > 0 ? waterVolume / total : 0;
    const waterTop = bounds.liquidBottom - bounds.liquidHeight * waterRatio;
    const oilTop = bounds.liquidTop;
    const oilBottom = waterTop;

    for (const particle of particles) {
        if (shaking) {
            const force = 1.8 + power * 5.8;
            particle.vx += (Math.random() - 0.5) * force;
            particle.vy += (Math.random() - 0.5) * force;
        } else if (particle.type === "oil") {
            const targetY = oilTop + Math.random() * Math.max(1, oilBottom - oilTop - 12);
            particle.vy += (targetY - particle.y) * 0.0018 - 0.014;
            particle.vx += Math.sin((particle.seed + performance.now() * 0.0012)) * 0.02;
        } else {
            const targetY = waterTop + Math.random() * Math.max(1, bounds.liquidBottom - waterTop - 12);
            particle.vy += (targetY - particle.y) * 0.0018 + 0.014;
            particle.vx += Math.cos((particle.seed + performance.now() * 0.0012)) * 0.02;
        }

        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vx *= 0.91;
        particle.vy *= 0.91;

        const left = beaker.x + 34;
        const right = beaker.x + beaker.w - 34;

        if (particle.x < left) {
            particle.x = left;
            particle.vx *= -0.55;
        }

        if (particle.x > right) {
            particle.x = right;
            particle.vx *= -0.55;
        }

        if (particle.y < bounds.liquidTop + 8) {
            particle.y = bounds.liquidTop + 8;
            particle.vy *= -0.4;
        }

        if (particle.y > bounds.liquidBottom - 8) {
            particle.y = bounds.liquidBottom - 8;
            particle.vy *= -0.4;
        }

        particle.life -= shaking ? 0.0005 : 0.0026;
        particle.r *= shaking ? 0.998 : 0.999;
    }

    particles = particles.filter((particle) => particle.life > 0.12 && particle.r > 1.2);

    pourDrops = pourDrops
        .map((drop) => ({
            ...drop,
            y: drop.y + drop.vy,
            vy: drop.vy + 0.06
        }))
        .filter((drop) => drop.y < bounds.liquidBottom);
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
    context.strokeStyle = "rgba(148, 163, 184, 0.72)";

    for (let index = 1; index <= 5; index += 1) {
        const markerY = beaker.y + beaker.h - index * beaker.h / 6;
        context.beginPath();
        context.moveTo(beaker.x + 28, markerY);
        context.lineTo(beaker.x + 54, markerY);
        context.stroke();
    }
}

function drawLiquidLayers(beaker) {
    const total = totalVolume();

    if (total <= 0) {
        return;
    }

    const bounds = liquidBounds(beaker);
    const waterRatio = waterVolume / total;
    const oilRatio = oilVolume / total;
    const waterHeight = bounds.liquidHeight * waterRatio;
    const oilHeight = bounds.liquidHeight * oilRatio;
    const waterY = bounds.liquidBottom - waterHeight;
    const oilY = waterY - oilHeight;
    const time = performance.now();
    const wave = shaking ? Math.sin(time * 0.018) * 7 : Math.sin(time * 0.0025) * 2.2;

    if (waterVolume > 0) {
        context.fillStyle = mixLevel > 0.35 ? "rgba(125, 211, 252, 0.78)" : "rgba(14, 165, 233, 0.68)";
        context.beginPath();
        context.moveTo(beaker.x + 35, bounds.liquidBottom);
        context.lineTo(beaker.x + beaker.w - 35, bounds.liquidBottom);
        context.lineTo(beaker.x + beaker.w - 35 + 25 * waterRatio, waterY + wave * 0.35);
        context.quadraticCurveTo(beaker.x + beaker.w / 2, waterY - wave, beaker.x + 35 - 25 * waterRatio, waterY + wave * 0.35);
        context.closePath();
        context.fill();
    }

    if (oilVolume > 0) {
        const alpha = mixLevel > 0.45 ? 0.58 : 0.75;
        context.fillStyle = `rgba(245, 158, 11, ${alpha})`;
        context.beginPath();
        context.moveTo(beaker.x + 35 - 25 * waterRatio, waterY + wave * 0.35);
        context.quadraticCurveTo(beaker.x + beaker.w / 2, waterY - wave, beaker.x + beaker.w - 35 + 25 * waterRatio, waterY + wave * 0.35);
        context.lineTo(beaker.x + beaker.w - 10, oilY + wave * 0.8);
        context.quadraticCurveTo(beaker.x + beaker.w / 2, oilY + Math.sin(time * 0.003) * 4, beaker.x + 10, oilY + wave * 0.8);
        context.closePath();
        context.fill();
    }

    if (mixLevel > 0.2) {
        context.fillStyle = `rgba(255, 255, 255, ${0.12 + mixLevel * 0.22})`;
        drawRoundedRectPath(beaker.x + 44, bounds.liquidTop + 8, beaker.w - 88, Math.max(18, bounds.liquidHeight - 16), 18);
        context.fill();
    }
}

function drawParticles() {
    for (const particle of particles) {
        if (particle.type === "oil") {
            context.fillStyle = `rgba(251, 191, 36, ${0.35 + mixLevel * 0.55})`;
            context.strokeStyle = "rgba(146, 64, 14, 0.25)";
        } else {
            context.fillStyle = `rgba(56, 189, 248, ${0.25 + mixLevel * 0.45})`;
            context.strokeStyle = "rgba(12, 74, 110, 0.18)";
        }

        context.beginPath();
        context.arc(particle.x, particle.y, particle.r, 0, Math.PI * 2);
        context.fill();
        context.stroke();
    }
}

function drawPourDrops() {
    for (const drop of pourDrops) {
        context.fillStyle = drop.type === "oil" ? "rgba(245, 158, 11, 0.85)" : "rgba(14, 165, 233, 0.75)";
        context.beginPath();
        context.arc(drop.x, drop.y, drop.r, 0, Math.PI * 2);
        context.fill();
    }
}

function drawLayerLabels(beaker) {
    if (width <= 640 || totalVolume() <= 0) {
        return;
    }

    const bounds = liquidBounds(beaker);
    const total = totalVolume();
    const waterRatio = waterVolume / total;
    const waterY = bounds.liquidBottom - bounds.liquidHeight * waterRatio;
    const labelX = Math.min(width - 210, beaker.x + beaker.w + 34);

    if (oilVolume > 0) {
        context.fillStyle = "#92400e";
        context.font = '15px "IBM Plex Sans JP"';
        context.fillText("油: 軽いので上", labelX, Math.max(bounds.liquidTop + 34, waterY - 40));
    }

    if (waterVolume > 0) {
        context.fillStyle = "#075985";
        context.font = '15px "IBM Plex Sans JP"';
        context.fillText("水: 重いので下", labelX, Math.min(bounds.liquidBottom - 30, waterY + 62));
    }
}

function drawMixMeter() {
    const isCompact = width <= 640;
    const meterWidth = isCompact ? Math.min(170, width - 48) : 220;
    const meterX = 24;
    const meterY = height - 28;

    context.fillStyle = "#e5e7eb";
    context.fillRect(meterX, meterY, meterWidth, 14);
    context.fillStyle = "#7c3aed";
    context.fillRect(meterX, meterY, meterWidth * mixLevel, 14);
    context.strokeStyle = "#334155";
    context.strokeRect(meterX, meterY, meterWidth, 14);
    context.fillStyle = "#111827";
    context.font = `${isCompact ? 12 : 13}px "IBM Plex Sans JP"`;
    context.fillText("混ざり具合", meterX, meterY - 8);
}

function draw() {
    context.clearRect(0, 0, width, height);

    const beaker = getBeakerGeometry();
    const power = Number(shakePowerSlider.value) / 100;
    const isCompact = width <= 640;
    const wobble = shaking ? Math.sin(performance.now() * 0.03) * Math.min(10, 4 + power * 10) : 0;

    context.save();
    context.translate(wobble, 0);
    drawLiquidLayers(beaker);
    drawParticles();
    drawBeaker(beaker);
    drawPourDrops();
    context.restore();

    let status = "静置中: 油が上、水が下に分離";

    if (shaking) {
        status = "振っている: 小さな液滴に分かれて一時的に混ざる";
    } else if (mixLevel > 0.35) {
        status = "白っぽい混合状態: 少しずつ分離中";
    } else if (waterVolume > 0 && oilVolume > 0) {
        status = "二層が見える: 油は上、水は下";
    }

    context.fillStyle = "#111827";
    context.font = `${isCompact ? 14 : 16}px "IBM Plex Sans JP"`;
    const statusEndY = drawWrappedText(status, 24, isCompact ? 34 : 40, width - 48, isCompact ? 18 : 22);

    context.fillStyle = "#475569";
    context.font = `${isCompact ? 12 : 14}px "IBM Plex Sans JP"`;
    drawWrappedText("ポイント: 水は極性分子、油は非極性分子なので、互いに混ざりにくい", 24, statusEndY + 14, width - 48, isCompact ? 16 : 18);

    drawLayerLabels(beaker);
    drawMixMeter();
}

function resizeCanvas() {
    const rect = simulationShell.getBoundingClientRect();

    if (!rect.width) {
        return;
    }

    width = Math.max(320, Math.floor(rect.width));

    if (window.matchMedia("(max-width: 900px)").matches) {
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        height = Math.max(360, Math.min(460, Math.floor(Math.min(width * 0.92, viewportHeight * 0.52))));
    } else {
        height = Math.max(520, Math.floor(rect.height || 820));
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function loop() {
    physicsStep();
    updateUi();
    draw();
    window.requestAnimationFrame(loop);
}

addWaterButton?.addEventListener("click", () => addLiquid("water"));
addOilButton?.addEventListener("click", () => addLiquid("oil"));
startShakeButton?.addEventListener("click", startShake);
stopShakeButton?.addEventListener("click", stopShake);
resetButton?.addEventListener("click", resetSimulation);

[addAmountSlider, shakePowerSlider].forEach((slider) => {
    slider?.addEventListener("input", updateUi);
});

window.addEventListener("resize", resizeCanvas);

resizeCanvas();
updateUi();
loop();