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

const canvas = document.querySelector("#simCanvas");
const shell = document.querySelector("#simShell");
const stageStats = document.querySelector(".stage-stats");
const context = canvas?.getContext("2d");

if (!canvas || !shell || !context) {
    throw new Error("Pet bottle bike page failed to initialize.");
}

const controlIds = [
    "riderMass",
    "bikeMass",
    "bottleVolume",
    "bottleMass",
    "pedalForce",
    "drag",
    "frontLeft",
    "frontRight",
    "midLeft",
    "midRight",
    "rearLeft",
    "rearRight"
];

const elements = Object.fromEntries(
    controlIds.map((id) => [id, document.querySelector(`#${id}`)])
);

const labels = {
    riderMass: document.querySelector("#riderMassLabel"),
    bikeMass: document.querySelector("#bikeMassLabel"),
    bottleVolume: document.querySelector("#bottleVolumeLabel"),
    bottleMass: document.querySelector("#bottleMassLabel"),
    pedalForce: document.querySelector("#pedalForceLabel"),
    drag: document.querySelector("#dragLabel")
};

const stats = {
    weight: document.querySelector("#weightStat"),
    buoy: document.querySelector("#buoyStat"),
    margin: document.querySelector("#marginStat"),
    speed: document.querySelector("#speedStat"),
    pitch: document.querySelector("#pitchStat"),
    roll: document.querySelector("#rollStat"),
    quickCount: document.querySelector("#quickCount"),
    quickSpeed: document.querySelector("#quickSpeed"),
    quickState: document.querySelector("#quickState"),
    status: document.querySelector("#statusMessage")
};

const resetButton = document.querySelector("#reset");
const balanceButton = document.querySelector("#balance");
const trimButton = document.querySelector("#trimSymmetry");

const g = 9.81;
const rhoWater = 1000;

const slots = [
    { id: "frontLeft", longitudinal: 1, lateral: -1, visualX: 94, visualY: 70, weight: 0.9 },
    { id: "frontRight", longitudinal: 1, lateral: 1, visualX: 100, visualY: 86, weight: 0.9 },
    { id: "midLeft", longitudinal: 0, lateral: -1, visualX: -4, visualY: 80, weight: 1 },
    { id: "midRight", longitudinal: 0, lateral: 1, visualX: 2, visualY: 96, weight: 1 },
    { id: "rearLeft", longitudinal: -1, lateral: -1, visualX: -98, visualY: 70, weight: 1.15 },
    { id: "rearRight", longitudinal: -1, lateral: 1, visualX: -92, visualY: 86, weight: 1.15 }
];

const defaultSummary = "2 L ボトル 1 本で約 2 kg 分の浮力です。55 kg の人と 16 kg の自転車なら、最低でも約 36 本以上が必要になります。";

let viewWidth = 0;
let viewHeight = 0;
let bikeX = 180;
let speed = 0;
let time = 0;
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

function valueOf(id) {
    return Number(elements[id].value);
}

function sanitizeCountInput(input) {
    const min = Number(input.min || 0);
    const max = Number(input.max || 80);
    const nextValue = clamp(Math.round(Number(input.value) || 0), min, max);

    input.value = String(nextValue);
}

function resizeCanvas() {
    const shellWidth = shell.clientWidth;
    const targetHeight = window.innerWidth < 900
        ? clamp(window.innerHeight * 0.54, 430, 620)
        : clamp(shellWidth * 0.7, 580, 760);

    canvas.style.height = `${Math.round(targetHeight)}px`;

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    viewWidth = rect.width;
    viewHeight = rect.height;
    bikeX = clamp(bikeX, -180, viewWidth + 180);
}

function distributeBottles(totalCount) {
    const normalizedTotal = Math.max(0, Math.round(totalCount));
    const totalWeight = slots.reduce((sum, slot) => sum + slot.weight, 0);
    const result = {};
    let assigned = 0;

    slots.forEach((slot) => {
        const amount = Math.floor(normalizedTotal * slot.weight / totalWeight);
        result[slot.id] = amount;
        assigned += amount;
    });

    let remainder = normalizedTotal - assigned;
    const order = ["rearLeft", "rearRight", "midLeft", "midRight", "frontLeft", "frontRight"];
    let index = 0;

    while (remainder > 0) {
        const slotId = order[index % order.length];
        result[slotId] += 1;
        remainder -= 1;
        index += 1;
    }

    return result;
}

function model() {
    const riderMass = valueOf("riderMass");
    const bikeMass = valueOf("bikeMass");
    const bottleVolumeL = valueOf("bottleVolume");
    const bottleMass = valueOf("bottleMass");
    const pedalForce = valueOf("pedalForce");
    const drag = valueOf("drag");

    const counts = Object.fromEntries(
        slots.map((slot) => [slot.id, clamp(Number(elements[slot.id].value) || 0, 0, 80)])
    );

    const bottleCount = Object.values(counts).reduce((sum, current) => sum + current, 0);
    const bottleVolumeM3 = bottleVolumeL / 1000;
    const supportMassPerBottle = rhoWater * bottleVolumeM3;
    const totalMass = riderMass + bikeMass + bottleCount * bottleMass;
    const totalWeightN = totalMass * g;
    const maxBuoyancyN = bottleCount * supportMassPerBottle * g;
    const marginN = maxBuoyancyN - totalWeightN;
    const floatRatio = totalWeightN > 0 ? maxBuoyancyN / totalWeightN : 0;
    const recommendedBottleCount = Math.max(0, Math.ceil((riderMass + bikeMass) / Math.max(0.1, bottleVolumeL - bottleMass)));

    const frontSupport = counts.frontLeft + counts.frontRight + 0.5 * (counts.midLeft + counts.midRight);
    const rearSupport = counts.rearLeft + counts.rearRight + 0.5 * (counts.midLeft + counts.midRight);
    const leftSupport = counts.frontLeft + counts.midLeft + counts.rearLeft;
    const rightSupport = counts.frontRight + counts.midRight + counts.rearRight;
    const pitchBalance = (frontSupport - rearSupport) / Math.max(1, bottleCount);
    const rollBalance = (leftSupport - rightSupport) / Math.max(1, bottleCount);
    const stability = clamp(1 - Math.abs(pitchBalance) * 1.4 - Math.abs(rollBalance) * 1.8, 0, 1);

    return {
        riderMass,
        bikeMass,
        bottleVolumeL,
        bottleMass,
        pedalForce,
        drag,
        counts,
        bottleCount,
        totalMass,
        totalWeightN,
        maxBuoyancyN,
        marginN,
        floatRatio,
        recommendedBottleCount,
        pitchBalance,
        rollBalance,
        stability,
        floating: marginN >= 0
    };
}

function updatePhysics(currentModel, deltaTime) {
    const step = clamp(deltaTime, 1 / 120, 0.05);
    const travelScale = viewWidth < 720 ? 44 : 56;

    if (!currentModel.floating) {
        speed = Math.max(0, speed - 1.3 * step);
        bikeX += speed * travelScale * step;
        time += step;
        return;
    }

    const balancePenalty = clamp(1 - Math.abs(currentModel.pitchBalance) * 1.5 - Math.abs(currentModel.rollBalance) * 1.8, 0.08, 1);
    const flotationPenalty = clamp((currentModel.floatRatio - 0.85) / 0.35, 0.24, 1);
    const effectiveForce = currentModel.pedalForce * balancePenalty * flotationPenalty;
    const dragForce = currentModel.drag * speed * Math.abs(speed);
    const acceleration = (effectiveForce - dragForce) / Math.max(currentModel.totalMass, 1);

    speed = clamp(speed + acceleration * step, 0, 8);
    bikeX += speed * travelScale * step;
    time += step;

    if (bikeX > viewWidth + 180) {
        bikeX = -180;
    }
}

function formatSigned(value, suffix) {
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(1)} ${suffix}`;
}

function describeBalance(value, negativeLabel, positiveLabel) {
    if (Math.abs(value) < 0.06) {
        return `ほぼ中央 ${value.toFixed(2)}`;
    }

    return `${value < 0 ? negativeLabel : positiveLabel} ${Math.abs(value).toFixed(2)}`;
}

function updateUi(currentModel) {
    labels.riderMass.textContent = `${currentModel.riderMass.toFixed(0)} kg`;
    labels.bikeMass.textContent = `${currentModel.bikeMass.toFixed(0)} kg`;
    labels.bottleVolume.textContent = `${currentModel.bottleVolumeL.toFixed(1)} L`;
    labels.bottleMass.textContent = `${currentModel.bottleMass.toFixed(3)} kg`;
    labels.pedalForce.textContent = `${currentModel.pedalForce.toFixed(0)} N`;
    labels.drag.textContent = `${currentModel.drag.toFixed(0)}`;

    stats.weight.textContent = `${currentModel.totalMass.toFixed(1)} kg`;
    stats.buoy.textContent = `${(currentModel.maxBuoyancyN / g).toFixed(1)} kg`;
    stats.margin.textContent = formatSigned(currentModel.marginN / g, "kg");
    stats.speed.textContent = `${speed.toFixed(2)} m/s`;
    stats.pitch.textContent = describeBalance(currentModel.pitchBalance, "後寄り", "前寄り");
    stats.roll.textContent = describeBalance(currentModel.rollBalance, "右寄り", "左寄り");
    stats.quickCount.textContent = `${currentModel.bottleCount} 本`;
    stats.quickSpeed.textContent = `${speed.toFixed(2)} m/s`;

    if (!currentModel.floating) {
        stats.quickState.textContent = "沈む";
    } else if (currentModel.stability < 0.45) {
        stats.quickState.textContent = "浮くが不安定";
    } else if (speed > 2.5) {
        stats.quickState.textContent = "浮いて前進";
    } else {
        stats.quickState.textContent = "浮く";
    }

    let summary = `必要本数の目安は ${currentModel.recommendedBottleCount} 本以上です。`;

    if (!currentModel.floating) {
        summary += " 今の設定では総浮力が足りず、水面より沈みます。";
    } else if (currentModel.floatRatio < 1.08) {
        summary += " 浮きますが余裕浮力がかなり小さく、波や体重移動で沈みやすい条件です。";
    } else {
        summary += " 静かな水面なら浮く側の条件です。";
    }

    if (Math.abs(currentModel.pitchBalance) > 0.25) {
        summary += " 前後バランスが大きく崩れていて、姿勢が安定しません。";
    }

    if (Math.abs(currentModel.rollBalance) > 0.18) {
        summary += " 左右差が大きく、横転しやすい配置です。";
    }

    if (currentModel.floating && speed > 3.5) {
        summary += " 速度が上がるほど水抵抗は急増するので、これ以上の加速は鈍くなります。";
    }

    stats.status.textContent = summary || defaultSummary;
}

function drawBackdrop() {
    const waterY = viewHeight * 0.58;
    const skyGradient = context.createLinearGradient(0, 0, 0, waterY);

    skyGradient.addColorStop(0, "#dff5ff");
    skyGradient.addColorStop(0.6, "#eef8ff");
    skyGradient.addColorStop(1, "#ffffff");
    context.fillStyle = skyGradient;
    context.fillRect(0, 0, viewWidth, waterY);

    const waterGradient = context.createLinearGradient(0, waterY, 0, viewHeight);
    waterGradient.addColorStop(0, "#5db8e5");
    waterGradient.addColorStop(0.4, "#2078b6");
    waterGradient.addColorStop(1, "#0c466b");
    context.fillStyle = waterGradient;
    context.fillRect(0, waterY, viewWidth, viewHeight - waterY);

    const sunX = viewWidth * 0.82;
    const sunY = viewHeight * 0.16;
    const sunGradient = context.createRadialGradient(sunX, sunY, 4, sunX, sunY, 78);

    sunGradient.addColorStop(0, "rgba(255, 245, 182, 0.96)");
    sunGradient.addColorStop(0.4, "rgba(255, 223, 130, 0.55)");
    sunGradient.addColorStop(1, "rgba(255, 223, 130, 0)");
    context.fillStyle = sunGradient;
    context.beginPath();
    context.arc(sunX, sunY, 78, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "rgba(245, 208, 129, 0.38)";
    context.fillRect(0, waterY - 10, viewWidth, 22);

    for (let index = 0; index < 3; index += 1) {
        const amplitude = 5 + index * 4;
        const offset = index * 18;
        context.beginPath();

        for (let x = 0; x <= viewWidth; x += 10) {
            const y = waterY + offset + Math.sin(x * (0.014 + index * 0.005) + time * (1.7 + index * 0.35)) * amplitude;
            if (x === 0) {
                context.moveTo(x, y);
            } else {
                context.lineTo(x, y);
            }
        }

        context.lineTo(viewWidth, viewHeight);
        context.lineTo(0, viewHeight);
        context.closePath();
        context.fillStyle = index === 0 ? "rgba(255, 255, 255, 0.3)" : index === 1 ? "rgba(87, 195, 236, 0.18)" : "rgba(7, 52, 81, 0.1)";
        context.fill();
    }
}

function drawBottleCluster(count, centerX, centerY) {
    const visible = Math.min(count, 24);

    for (let index = 0; index < visible; index += 1) {
        const column = index % 4;
        const row = Math.floor(index / 4);
        const x = centerX + (column - 1.5) * 12;
        const y = centerY + row * 11;

        drawRoundedRect(context, x - 5, y - 16, 10, 28, 4, "rgba(173, 232, 255, 0.92)", "#0d6f95", 1);
        drawRoundedRect(context, x - 3, y - 20, 6, 6, 3, "rgba(10, 96, 127, 0.95)");
    }

    if (count > visible) {
        context.fillStyle = "#07334f";
        context.font = '600 12px "IBM Plex Sans JP", sans-serif';
        context.fillText(`+${count - visible}`, centerX + 30, centerY + 14);
    }
}

function drawWake(waterY) {
    if (speed < 0.2) {
        return;
    }

    const wakeLength = clamp(speed * 44, 18, 120);
    const wakeAlpha = clamp(speed / 5, 0.1, 0.45);

    context.save();
    context.strokeStyle = `rgba(255, 255, 255, ${wakeAlpha})`;
    context.lineWidth = 2;

    for (let index = 0; index < 3; index += 1) {
        const y = waterY + 12 + index * 12;
        context.beginPath();
        context.moveTo(bikeX - 64 - index * 6, y);
        context.quadraticCurveTo(bikeX - 98 - wakeLength * 0.2, y + 6, bikeX - 78 - wakeLength, y + 2);
        context.stroke();
    }

    context.restore();
}

function drawGauge(currentModel) {
    const x = 24;
    const overlayHeight = stageStats ? stageStats.getBoundingClientRect().height : 82;
    const y = 24 + overlayHeight + 18;
    const width = Math.min(292, viewWidth * 0.42);

    drawRoundedRect(context, x - 12, y - 12, width + 24, 114, 18, "rgba(255, 255, 255, 0.74)", "rgba(23, 50, 76, 0.08)", 1);

    drawRoundedRect(context, x, y + 8, width, 16, 9, "rgba(219, 232, 239, 0.85)");
    drawRoundedRect(
        context,
        x,
        y + 8,
        Math.min(width, width * clamp(currentModel.floatRatio, 0, 1.6)),
        16,
        9,
        currentModel.floating ? "#1b9f73" : "#d44c64"
    );

    drawRoundedRect(context, x, y + 56, width, 12, 7, "rgba(219, 232, 239, 0.85)");
    drawRoundedRect(context, x, y + 56, width * currentModel.stability, 12, 7, "#147eb0");

    context.fillStyle = "#17324c";
    context.font = '600 14px "IBM Plex Sans JP", sans-serif';
    context.fillText(`浮力 / 重量 = ${currentModel.floatRatio.toFixed(2)}`, x, y + 44);
    context.fillText(`安定度 = ${(currentModel.stability * 100).toFixed(0)} %`, x, y + 88);
}

function drawBike(currentModel) {
    const waterY = viewHeight * 0.58;
    const floatPenalty = clamp((1.08 - clamp(currentModel.floatRatio, 0, 1.08)) * 58, 0, 58);
    const sink = currentModel.floating
        ? floatPenalty
        : clamp((-currentModel.marginN / Math.max(currentModel.totalWeightN, 1)) * 140 + 34, 34, 128);
    const bob = Math.sin(time * 2.8) * 4 + Math.sin(time * 1.1) * 2;
    const bikeY = waterY - 110 + sink + bob;
    const tilt = clamp(-currentModel.pitchBalance * 0.34, -0.22, 0.22);
    const rollShift = clamp(currentModel.rollBalance * 34, -40, 40);

    drawWake(waterY);

    context.save();
    context.translate(bikeX, bikeY);
    context.rotate(tilt);

    context.strokeStyle = "rgba(8, 56, 82, 0.35)";
    context.lineWidth = 10;
    context.beginPath();
    context.moveTo(-124, 76);
    context.lineTo(120, 76);
    context.stroke();

    slots.forEach((slot) => {
        const count = currentModel.counts[slot.id];
        const offsetY = slot.visualY + rollShift * (slot.lateral < 0 ? -0.22 : 0.22);
        drawBottleCluster(count, slot.visualX, offsetY);
    });

    context.strokeStyle = "#1f2a36";
    context.lineWidth = 5;
    context.beginPath();
    context.arc(-82, 50, 36, 0, Math.PI * 2);
    context.arc(84, 50, 36, 0, Math.PI * 2);
    context.stroke();

    context.strokeStyle = "#284257";
    context.lineWidth = 6;
    context.beginPath();
    context.moveTo(-82, 50);
    context.lineTo(-18, -10);
    context.lineTo(34, 50);
    context.lineTo(-82, 50);
    context.moveTo(34, 50);
    context.lineTo(84, 50);
    context.lineTo(20, -22);
    context.lineTo(-18, -10);
    context.stroke();

    context.beginPath();
    context.moveTo(20, -22);
    context.lineTo(44, -48);
    context.lineTo(72, -44);
    context.moveTo(-18, -10);
    context.lineTo(-28, -35);
    context.lineTo(-54, -35);
    context.stroke();

    context.fillStyle = "#efb07c";
    context.beginPath();
    context.arc(-14, -76, 16, 0, Math.PI * 2);
    context.fill();

    context.strokeStyle = "#335e95";
    context.lineWidth = 8;
    context.beginPath();
    context.moveTo(-14, -60);
    context.lineTo(-8, -18);
    context.lineTo(24, 18);
    context.moveTo(-8, -18);
    context.lineTo(-44, 18);
    context.moveTo(-12, -46);
    context.lineTo(48, -43);
    context.stroke();

    if (speed > 0.2) {
        context.strokeStyle = "rgba(255, 255, 255, 0.78)";
        context.lineWidth = 3;
        context.beginPath();
        context.moveTo(104, -6);
        context.lineTo(136 + clamp(speed * 8, 0, 26), -6);
        context.moveTo(128 + clamp(speed * 8, 0, 26), -12);
        context.lineTo(136 + clamp(speed * 8, 0, 26), -6);
        context.lineTo(128 + clamp(speed * 8, 0, 26), 0);
        context.stroke();
    }

    context.restore();

    context.setLineDash([8, 8]);
    context.strokeStyle = "rgba(255, 255, 255, 0.8)";
    context.beginPath();
    context.moveTo(0, waterY);
    context.lineTo(viewWidth, waterY);
    context.stroke();
    context.setLineDash([]);
}

function render(currentModel) {
    context.clearRect(0, 0, viewWidth, viewHeight);
    drawBackdrop();
    drawBike(currentModel);
    drawGauge(currentModel);
}

function syncSymmetry() {
    elements.frontRight.value = elements.frontLeft.value;
    elements.midRight.value = elements.midLeft.value;
    elements.rearRight.value = elements.rearLeft.value;
}

function resetPosition() {
    speed = 0;
    bikeX = viewWidth > 0 ? viewWidth * 0.28 : 180;
}

function animate(timestamp) {
    const deltaTime = (timestamp - lastFrameTime) / 1000;
    lastFrameTime = timestamp;

    const currentModel = model();
    updatePhysics(currentModel, deltaTime);
    updateUi(currentModel);
    render(currentModel);
    requestAnimationFrame(animate);
}

Object.values(elements).forEach((element) => {
    if (!element) {
        return;
    }

    const eventName = element.type === "number" ? "change" : "input";
    element.addEventListener(eventName, () => {
        if (element.type === "number") {
            sanitizeCountInput(element);
        }
    });
});

resetButton?.addEventListener("click", () => {
    resetPosition();
});

balanceButton?.addEventListener("click", () => {
    const needed = model().recommendedBottleCount + 6;
    const distribution = distributeBottles(needed);

    Object.entries(distribution).forEach(([id, amount]) => {
        elements[id].value = String(amount);
    });

    resetPosition();
});

trimButton?.addEventListener("click", () => {
    syncSymmetry();
    resetPosition();
});

window.addEventListener("resize", resizeCanvas);

resizeCanvas();
resetPosition();
updateUi(model());
requestAnimationFrame(animate);