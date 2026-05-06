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

const dom = {
    canvas: document.querySelector("#fossilCanvas"),
    canvasShell: document.querySelector(".canvas-shell"),
    shell: document.querySelector("#simShell"),
    speed: document.querySelector("#speed"),
    sediment: document.querySelector("#sediment"),
    oxygen: document.querySelector("#oxygen"),
    mineral: document.querySelector("#mineral"),
    speedValue: document.querySelector("#speedValue"),
    sedimentValue: document.querySelector("#sedimentValue"),
    oxygenValue: document.querySelector("#oxygenValue"),
    mineralValue: document.querySelector("#mineralValue"),
    toggleButton: document.querySelector("#toggleButton"),
    resetButton: document.querySelector("#resetButton"),
    yearText: document.querySelector("#yearText"),
    stageText: document.querySelector("#stageText"),
    fossilText: document.querySelector("#fossilText"),
    decayText: document.querySelector("#decayText"),
    burialText: document.querySelector("#burialText"),
    rockText: document.querySelector("#rockText"),
    fossilBar: document.querySelector("#fossilBar"),
    decayBar: document.querySelector("#decayBar"),
    burialBar: document.querySelector("#burialBar"),
    rockBar: document.querySelector("#rockBar"),
    observeTitle: document.querySelector("#observeTitle"),
    summaryText: document.querySelector("#summaryText"),
    panelStatus: document.querySelector("#panelStatus"),
    stageCards: Array.from(document.querySelectorAll("[data-stage-card]"))
};

const context = dom.canvas?.getContext("2d");

if (!dom.canvas || !dom.canvasShell || !dom.shell || !context) {
    throw new Error("Fossilization page failed to initialize.");
}

const STAGE_DETAILS = {
    death: {
        label: "死亡直後",
        title: "埋まる前に分解が進むかが最初の分岐",
        summary: "まだ死骸は地表近くにあり、分解と保存の条件が競り合う前段階です。土砂が早く積もらないと、この先の段階へ進みにくくなります。",
        activeCard: null,
        status: "死骸が露出している初期段階です。まずは埋没が間に合うかを見てください。"
    },
    burial: {
        label: "埋没",
        title: "土砂が死骸を地表から切り離し始める",
        summary: "土砂が積もり、死骸が空気や攪乱から少しずつ守られています。土砂量が多いほどこの段階を素早く通過できます。",
        activeCard: "burial",
        status: "埋没が始まりました。土砂を増やすと、分解より先に保存側へ進みやすくなります。"
    },
    oxygen: {
        label: "酸素不足",
        title: "埋まることで酸素が届きにくくなる",
        summary: "地表から離れたぶん、死骸まわりの酸素が減り始めています。酸素不足が強いほど、腐敗は遅くなります。",
        activeCard: "oxygen",
        status: "酸素が届きにくくなっています。ここから分解が鈍るかどうかは酸素不足の強さ次第です。"
    },
    preservation: {
        label: "分解抑制",
        title: "埋没と酸素不足が組み合わさり、残る時間を稼ぐ",
        summary: "死骸の分解速度が落ち、原形をとどめる時間が伸びています。化石化は、まずこの時間稼ぎに成功する必要があります。",
        activeCard: "preservation",
        status: "分解が抑えられています。ここで鉱物化が進めば、保存から化石へ移れます。"
    },
    mineral: {
        label: "鉱物がしみこむ",
        title: "地下水の鉱物が骨や殻に入り始める",
        summary: "地下水中の鉱物が骨や殻の空隙を埋め、少しずつ硬く残る方向へ進んでいます。鉱物量が多いほどここが加速します。",
        activeCard: "mineral",
        status: "鉱物化が進んでいます。保存された骨や殻が、化石として残る形へ近づいています。"
    },
    rock: {
        label: "岩石化",
        title: "地層ごと固まり、化石を含む岩石になる",
        summary: "堆積物が圧密され、化石を包む地層そのものが硬くなっています。この段階まで来ると長期保存がかなり安定します。",
        activeCard: "rock",
        status: "岩石化が進み、化石が地層内で固定されつつあります。次は地表へ現れる段階です。"
    },
    discovery: {
        label: "隆起・侵食で発見",
        title: "長く埋もれていた化石が地表近くへ現れる",
        summary: "地層の隆起や侵食で上の層が削られ、化石が見つかる位置まで近づきました。化石は、できることと見つかることの両方が必要です。",
        activeCard: "discovery",
        status: "発見段階まで進みました。保存だけでなく、露出する地質変化も重要だと分かります。"
    },
    lost: {
        label: "分解されて消失",
        title: "埋没や酸素不足が足りず、分解が先に進んだ",
        summary: "死骸は保存条件が整う前に分解され、化石として残りにくくなっています。土砂量を増やすか酸素不足を強めると結果が変わります。",
        activeCard: null,
        status: "分解が先行しました。保存条件がそろわないと、化石化は途中で終わります。"
    }
};

const state = {
    running: false,
    time: 0,
    decay: 0,
    fossil: 0,
    burial: 0,
    lithification: 0,
    exposure: 0,
    viewport: {
        width: 960,
        height: 620,
        dpr: 1
    },
    sedimentParticles: [],
    lastTime: 0
};

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function lerp(start, end, t) {
    return start + ((end - start) * t);
}

function formatNumber(value, digits = 0) {
    return value.toFixed(digits).replace(/(?:\.0+|(\.\d*?[1-9]))0+$/, "$1");
}

function qualitativeLabel(value) {
    if (value < 35) {
        return "少ない";
    }
    if (value < 70) {
        return "普通";
    }
    return "多い";
}

function shortageLabel(value) {
    if (value < 35) {
        return "弱い";
    }
    if (value < 70) {
        return "普通";
    }
    return "強い";
}

function createSedimentParticles(count) {
    return Array.from({ length: count }, () => ({
        x: Math.random() * state.viewport.width,
        y: Math.random() * state.viewport.height * 0.44,
        size: Math.random() * 2 + 0.8,
        speed: Math.random() * 0.8 + 0.4,
        drift: (Math.random() - 0.5) * 0.3
    }));
}

function resetSimulation() {
    state.time = 0;
    state.decay = 0;
    state.fossil = 0;
    state.burial = 0;
    state.lithification = 0;
    state.exposure = 0;
    state.sedimentParticles = createSedimentParticles(96);
    updateUi();
}

function getMetrics() {
    const sedimentLevel = Number(dom.sediment.value) / 100;
    const oxygenLack = Number(dom.oxygen.value) / 100;
    const mineralLevel = Number(dom.mineral.value) / 100;
    const protection = clamp((state.burial * 0.68) + (sedimentLevel * 0.32), 0, 1);
    const oxygenShield = clamp((oxygenLack * 0.42) + (state.burial * oxygenLack * 0.58), 0, 1);

    return {
        sedimentLevel,
        oxygenLack,
        mineralLevel,
        protection,
        oxygenShield,
        years: Math.floor(state.time * 820)
    };
}

function getStage(metrics) {
    if (state.decay > 92 && state.fossil < 24) {
        return "lost";
    }
    if (state.exposure > 72 && state.fossil > 40 && state.lithification > 42) {
        return "discovery";
    }
    if (state.lithification > 42 && state.fossil > 22) {
        return "rock";
    }
    if (state.fossil > 16) {
        return "mineral";
    }
    if (state.burial > 0.45 && metrics.oxygenShield > 0.58) {
        return "preservation";
    }
    if (state.burial > 0.25 && metrics.oxygenShield > 0.42) {
        return "oxygen";
    }
    if (state.burial > 0.08) {
        return "burial";
    }
    return "death";
}

function updateSimulation() {
    const speed = Number(dom.speed.value);
    const sedimentLevel = Number(dom.sediment.value) / 100;
    const oxygenLack = Number(dom.oxygen.value) / 100;
    const mineralLevel = Number(dom.mineral.value) / 100;

    state.time += speed;
    state.burial = clamp(state.time * (0.00055 + (sedimentLevel * 0.0017)), 0, 1);

    const protection = clamp((state.burial * 0.68) + (sedimentLevel * 0.32), 0, 1);
    const oxygenShield = clamp((oxygenLack * 0.42) + (state.burial * oxygenLack * 0.58), 0, 1);
    const decayRate = (1 - oxygenShield) * (1 - protection * 0.76) * 0.082;

    state.decay = clamp(state.decay + (decayRate * speed), 0, 100);

    if (state.burial > 0.18 && state.decay < 88) {
        const fossilRate = mineralLevel * oxygenShield * clamp((state.burial - 0.18) / 0.82, 0, 1) * 0.18;
        state.fossil = clamp(state.fossil + (fossilRate * speed), 0, 100);
    }

    const rockRate = clamp(((state.fossil / 100) * 0.76) + (protection * 0.36), 0, 1) * 0.034;
    state.lithification = clamp(state.lithification + (rockRate * speed * 1.22), 0, 100);

    const exposureDrive = clamp((state.time - 1280) / 760, 0, 1) * clamp(state.lithification / 68, 0, 1);
    state.exposure = clamp(state.exposure + (exposureDrive * speed * 0.24), 0, 100);

    if (state.decay > 97 && state.fossil < 12) {
        state.running = false;
    }
}

function resizeCanvas() {
    const rect = dom.canvasShell.getBoundingClientRect();
    const cssWidth = Math.max(320, Math.round(rect.width || 760));
    const cssHeight = window.innerWidth < 760
        ? clamp(Math.round(window.innerHeight * 0.47), 320, 460)
        : clamp(Math.round(cssWidth * 0.63), 430, 620);
    const dpr = window.devicePixelRatio || 1;

    dom.canvas.width = Math.round(cssWidth * dpr);
    dom.canvas.height = Math.round(cssHeight * dpr);
    dom.canvas.style.height = `${cssHeight}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    state.viewport = {
        width: cssWidth,
        height: cssHeight,
        dpr
    };

    state.sedimentParticles = createSedimentParticles(96);
}

function getLayout() {
    const width = state.viewport.width;
    const height = state.viewport.height;
    const exposureRatio = state.exposure / 100;
    const rawCover = state.burial * height * 0.33;
    const visibleCover = rawCover * (1 - (exposureRatio * 0.78));
    const floorY = height * 0.7;
    const topY = floorY - visibleCover;

    return {
        width,
        height,
        exposureRatio,
        floorY,
        topY,
        fossilX: width * (width < 720 ? 0.5 : 0.58),
        fossilY: floorY - 22,
        fossilScale: clamp(width / 960, 0.78, 1.08)
    };
}

function drawBackground(layout) {
    const skyMix = clamp(layout.exposureRatio * 1.15, 0, 1);
    const waterAlpha = clamp(1 - (layout.exposureRatio * 1.18), 0, 1);
    const gradient = context.createLinearGradient(0, 0, 0, layout.height);
    gradient.addColorStop(0, `rgba(${Math.round(lerp(144, 204, skyMix))}, ${Math.round(lerp(183, 218, skyMix))}, ${Math.round(lerp(194, 228, skyMix))}, 1)`);
    gradient.addColorStop(0.34, `rgba(${Math.round(lerp(108, 180, skyMix))}, ${Math.round(lerp(149, 203, skyMix))}, ${Math.round(lerp(165, 225, skyMix))}, ${0.95 - (skyMix * 0.1)})`);
    gradient.addColorStop(0.35, `rgba(${Math.round(lerp(176, 193, skyMix))}, ${Math.round(lerp(160, 192, skyMix))}, ${Math.round(lerp(129, 166, skyMix))}, 1)`);
    gradient.addColorStop(1, "rgba(94, 68, 45, 1)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, layout.width, layout.height);

    if (waterAlpha > 0.02) {
        context.strokeStyle = `rgba(255, 255, 255, ${0.16 + (waterAlpha * 0.26)})`;
        for (let index = 0; index < 7; index += 1) {
            const y = 72 + (index * 19) + (Math.sin((state.time * 0.03) + index) * 3);
            context.beginPath();
            context.moveTo(0, y);
            for (let x = 0; x <= layout.width; x += 28) {
                context.lineTo(x, y + (Math.sin((x * 0.02) + index + (state.time * 0.02)) * 3));
            }
            context.stroke();
        }
    }

    if (skyMix > 0.18) {
        const sunGlow = context.createRadialGradient(layout.width * 0.82, 78, 12, layout.width * 0.82, 78, 80);
        sunGlow.addColorStop(0, `rgba(255, 239, 200, ${0.32 * skyMix})`);
        sunGlow.addColorStop(1, "rgba(255, 239, 200, 0)");
        context.fillStyle = sunGlow;
        context.beginPath();
        context.arc(layout.width * 0.82, 78, 82, 0, Math.PI * 2);
        context.fill();
    }
}

function drawSedimentParticles(layout) {
    const sedimentLevel = Number(dom.sediment.value) / 100;
    const waterLimit = lerp(layout.height * 0.18, layout.height * 0.08, layout.exposureRatio);
    const floorLimit = layout.floorY - 2;

    context.fillStyle = "rgba(115, 78, 43, 0.42)";

    state.sedimentParticles.forEach((particle) => {
        particle.y += particle.speed * (0.8 + (sedimentLevel * 1.6));
        particle.x += Math.sin((state.time * 0.02) + particle.y * 0.01) * particle.drift;

        if (particle.y > floorLimit) {
            particle.y = waterLimit + (Math.random() * 60);
            particle.x = Math.random() * layout.width;
        }

        context.beginPath();
        context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        context.fill();
    });
}

function drawLayers(layout) {
    const colors = ["#d1ab74", "#bd8f5c", "#a6774d", "#896241", "#6b4e38"];
    const bandCount = colors.length;
    const bandHeight = Math.max(14, (layout.height - layout.topY) / bandCount);

    for (let index = 0; index < bandCount; index += 1) {
        const y = layout.topY + (index * bandHeight);
        context.fillStyle = colors[index];
        context.fillRect(0, y, layout.width, bandHeight + 1);

        context.strokeStyle = "rgba(77, 51, 28, 0.32)";
        context.beginPath();
        context.moveTo(0, y + (Math.sin((state.time * 0.01) + index) * 2));
        for (let x = 0; x <= layout.width; x += 30) {
            context.lineTo(x, y + (Math.sin((x * 0.018) + index + (state.time * 0.006)) * 4));
        }
        context.stroke();
    }

    context.fillStyle = "rgba(82, 58, 39, 0.92)";
    context.fillRect(0, layout.floorY, layout.width, layout.height - layout.floorY + 2);

    if (layout.exposureRatio > 0.24) {
        const revealY = layout.topY - (layout.exposureRatio * 46);
        context.fillStyle = `rgba(212, 202, 178, ${0.18 * layout.exposureRatio})`;
        context.fillRect(0, revealY, layout.width, 6);
    }
}

function drawMineralFlow(layout) {
    const mineralLevel = Number(dom.mineral.value) / 100;
    const amount = Math.floor(4 + (mineralLevel * 10) + ((state.fossil / 100) * 6));

    context.strokeStyle = `rgba(91, 197, 214, ${0.16 + (mineralLevel * 0.22)})`;
    context.lineWidth = 2;

    for (let index = 0; index < amount; index += 1) {
        const x = ((index * 73) + (state.time * 0.55)) % layout.width;
        const startY = layout.topY - 36 - (Math.sin(index + (state.time * 0.01)) * 8);
        context.beginPath();
        context.moveTo(x, startY);
        context.bezierCurveTo(
            x + 14,
            startY + 54,
            x - 24,
            layout.fossilY - 50,
            x + 6,
            layout.fossilY + 80
        );
        context.stroke();
    }
}

function drawRockHalo(layout) {
    const rockRatio = state.lithification / 100;

    if (rockRatio < 0.08) {
        return;
    }

    const glow = context.createRadialGradient(layout.fossilX, layout.fossilY, 18, layout.fossilX, layout.fossilY, 150 * layout.fossilScale);
    glow.addColorStop(0, `rgba(241, 230, 209, ${0.08 + (rockRatio * 0.18)})`);
    glow.addColorStop(1, "rgba(241, 230, 209, 0)");
    context.fillStyle = glow;
    context.beginPath();
    context.arc(layout.fossilX, layout.fossilY, 150 * layout.fossilScale, 0, Math.PI * 2);
    context.fill();
}

function drawFossil(layout) {
    const buriedAlpha = clamp(1 - (state.burial * 0.82) + (layout.exposureRatio * 0.7), 0.18, 1);
    const mineralRatio = state.fossil / 100;
    const red = Math.round(lerp(62, 239, mineralRatio));
    const green = Math.round(lerp(45, 227, mineralRatio));
    const blue = Math.round(lerp(28, 208, mineralRatio));

    context.save();
    context.translate(layout.fossilX, layout.fossilY);
    context.scale(layout.fossilScale, layout.fossilScale);
    context.globalAlpha = buriedAlpha;
    context.strokeStyle = `rgba(${red}, ${green}, ${blue}, ${0.35 + (mineralRatio * 0.65)})`;
    context.lineWidth = 7;
    context.lineCap = "round";

    context.beginPath();
    context.moveTo(-92, 0);
    context.quadraticCurveTo(-20, -20, 72, 0);
    context.stroke();

    for (let index = -54; index <= 40; index += 18) {
        context.beginPath();
        context.moveTo(index, -4);
        context.quadraticCurveTo(index + 5, 28, index + 28, 36);
        context.stroke();
    }

    context.beginPath();
    context.arc(96, -4, 24, 0, Math.PI * 2);
    context.stroke();

    context.beginPath();
    context.moveTo(-92, 0);
    context.lineTo(-136, 18);
    context.stroke();

    if (state.decay > 55 && state.fossil < 24) {
        context.fillStyle = `rgba(50, 34, 20, ${0.36 + (state.decay / 220)})`;
        context.font = "15px IBM Plex Sans JP";
        context.fillText("分解が進み、残りにくい", -112, -62);
    }

    context.restore();
}

function drawDiscoveryHalo(layout) {
    if (state.exposure < 55 || state.fossil < 42) {
        return;
    }

    const ratio = clamp((state.exposure - 55) / 45, 0, 1);
    const halo = context.createRadialGradient(layout.fossilX, layout.fossilY - 20, 8, layout.fossilX, layout.fossilY - 20, 120 * layout.fossilScale);
    halo.addColorStop(0, `rgba(255, 236, 181, ${0.12 + (ratio * 0.28)})`);
    halo.addColorStop(1, "rgba(255, 236, 181, 0)");
    context.fillStyle = halo;
    context.beginPath();
    context.arc(layout.fossilX, layout.fossilY - 20, 120 * layout.fossilScale, 0, Math.PI * 2);
    context.fill();

    context.strokeStyle = `rgba(255, 233, 167, ${0.24 + (ratio * 0.34)})`;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(layout.fossilX + 12, layout.fossilY - 18, 72 * layout.fossilScale, 0, Math.PI * 2);
    context.stroke();
}

function drawStageBadge(stageKey, layout, years) {
    const details = STAGE_DETAILS[stageKey];
    context.fillStyle = "rgba(255, 248, 232, 0.86)";
    context.fillRect(18, 18, Math.min(392, layout.width - 36), 92);
    context.fillStyle = "#352415";
    context.font = "700 22px IBM Plex Sans JP";
    context.fillText(details.label, 34, 52);
    context.font = "15px IBM Plex Sans JP";
    context.fillText(`${years.toLocaleString()} 年`, 34, 80);
    context.fillText("埋没・酸素不足・鉱物化・岩石化の順に条件が積み重なる", 118, 80);
}

function draw() {
    const layout = getLayout();
    const metrics = getMetrics();
    const stageKey = getStage(metrics);

    drawBackground(layout);
    drawSedimentParticles(layout);
    drawLayers(layout);
    drawMineralFlow(layout);
    drawRockHalo(layout);
    drawFossil(layout);
    drawDiscoveryHalo(layout);
    drawStageBadge(stageKey, layout, metrics.years);
}

function updateUi() {
    const metrics = getMetrics();
    const stageKey = getStage(metrics);
    const details = STAGE_DETAILS[stageKey];

    dom.speedValue.textContent = `${formatNumber(Number(dom.speed.value), 1)}x`;
    dom.sedimentValue.textContent = qualitativeLabel(Number(dom.sediment.value));
    dom.oxygenValue.textContent = shortageLabel(Number(dom.oxygen.value));
    dom.mineralValue.textContent = qualitativeLabel(Number(dom.mineral.value));
    dom.toggleButton.textContent = state.running ? "進行: ON" : "進行: OFF";

    dom.yearText.textContent = `${metrics.years.toLocaleString()} 年`;
    dom.stageText.textContent = details.label;
    dom.fossilText.textContent = `${Math.round(state.fossil)} %`;
    dom.decayText.textContent = `${Math.round(state.decay)} %`;
    dom.burialText.textContent = `${Math.round(state.burial * 100)} %`;
    dom.rockText.textContent = `${Math.round(state.lithification)} %`;

    dom.fossilBar.style.width = `${state.fossil}%`;
    dom.decayBar.style.width = `${state.decay}%`;
    dom.burialBar.style.width = `${state.burial * 100}%`;
    dom.rockBar.style.width = `${state.lithification}%`;

    dom.observeTitle.textContent = details.title;
    dom.summaryText.textContent = details.summary;
    dom.panelStatus.textContent = details.status;

    dom.stageCards.forEach((card) => {
        card.classList.toggle("is-active", card.dataset.stageCard === details.activeCard);
    });
}

function loop(timestamp) {
    if (state.lastTime === 0) {
        state.lastTime = timestamp;
    }

    const delta = timestamp - state.lastTime;
    state.lastTime = timestamp;

    if (state.running && delta < 100) {
        updateSimulation();
    }

    updateUi();
    draw();
    requestAnimationFrame(loop);
}

dom.toggleButton.addEventListener("click", () => {
    state.running = !state.running;
    updateUi();
});

dom.resetButton.addEventListener("click", () => {
    resetSimulation();
});

[dom.speed, dom.sediment, dom.oxygen, dom.mineral].forEach((element) => {
    element.addEventListener("input", updateUi);
});

const resizeObserver = new ResizeObserver(() => {
    resizeCanvas();
});

resizeObserver.observe(dom.canvasShell);
window.addEventListener("resize", resizeCanvas);

resizeCanvas();
resetSimulation();
requestAnimationFrame(loop);