const DEFAULTS = {
    ghg: 1,
    distance: 1,
    cloud: 40,
    ocean: 70
};

const PRESETS = {
    earth: DEFAULTS,
    snowball: {
        ghg: 0.2,
        distance: 1.4,
        cloud: 65,
        ocean: 60
    },
    hot: {
        ghg: 4.2,
        distance: 0.72,
        cloud: 18,
        ocean: 35
    },
    venus: {
        ghg: 5,
        distance: 0.72,
        cloud: 92,
        ocean: 0
    },
    mars: {
        ghg: 0.15,
        distance: 1.52,
        cloud: 12,
        ocean: 0
    }
};

const SIGMA = 5.670374419e-8;

const CONTINENTS = [
    { phase: 0.1, offsetY: -0.18, size: 0.24, squish: 0.92 },
    { phase: 1.36, offsetY: -0.02, size: 0.22, squish: 1.06 },
    { phase: 2.42, offsetY: 0.18, size: 0.18, squish: 0.84 },
    { phase: 3.82, offsetY: 0.03, size: 0.2, squish: 1.12 },
    { phase: 4.78, offsetY: -0.22, size: 0.16, squish: 0.88 }
];

const dom = {
    canvas: document.querySelector("#canvas"),
    ghg: document.querySelector("#ghg"),
    distance: document.querySelector("#distance"),
    cloud: document.querySelector("#cloud"),
    ocean: document.querySelector("#ocean"),
    ghgText: document.querySelector("#ghgText"),
    distanceText: document.querySelector("#distanceText"),
    cloudText: document.querySelector("#cloudText"),
    oceanText: document.querySelector("#oceanText"),
    tempStat: document.querySelector("#tempStat"),
    climateStat: document.querySelector("#climateStat"),
    solarStat: document.querySelector("#solarStat"),
    iceStat: document.querySelector("#iceStat"),
    albedoStat: document.querySelector("#albedoStat"),
    greenhouseStat: document.querySelector("#greenhouseStat"),
    summaryText: document.querySelector("#summaryText"),
    observeTitle: document.querySelector("#observeTitle"),
    observeText: document.querySelector("#observeText"),
    modeChip: document.querySelector("#modeChip"),
    earthBtn: document.querySelector("#earthBtn"),
    snowBtn: document.querySelector("#snowBtn"),
    hotBtn: document.querySelector("#hotBtn"),
    venusBtn: document.querySelector("#venusBtn"),
    marsBtn: document.querySelector("#marsBtn")
};

const ctx = dom.canvas.getContext("2d");

const state = {
    ghg: DEFAULTS.ghg,
    distance: DEFAULTS.distance,
    cloud: DEFAULTS.cloud,
    ocean: DEFAULTS.ocean,
    rotation: 0,
    viewport: {
        width: 760,
        height: 620,
        dpr: 1
    },
    latestClimate: null,
    animationId: null
};

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

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function lerp(from, to, progress) {
    return from + ((to - from) * progress);
}

function formatNumber(value, digits = 1) {
    return value.toFixed(digits).replace(/(?:\.0+|(\.\d*?[1-9]))0+$/, "$1");
}

function mixChannels(from, to, progress) {
    return from.map((channel, index) => Math.round(lerp(channel, to[index], progress)));
}

function toRgb(channels) {
    return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
}

function toRgba(channels, alpha) {
    return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha})`;
}

function climateName(temp) {
    if (temp < -30) {
        return "全球凍結";
    }
    if (temp < -8) {
        return "氷河世界";
    }
    if (temp < 10) {
        return "寒冷";
    }
    if (temp < 26) {
        return "温暖";
    }
    if (temp < 42) {
        return "高温";
    }
    return "灼熱";
}

function syncInputsFromState() {
    dom.ghg.value = String(state.ghg);
    dom.distance.value = String(state.distance);
    dom.cloud.value = String(state.cloud);
    dom.ocean.value = String(state.ocean);
}

function syncStateFromInputs() {
    state.ghg = Number(dom.ghg.value);
    state.distance = Number(dom.distance.value);
    state.cloud = Number(dom.cloud.value);
    state.ocean = Number(dom.ocean.value);
}

function computeClimate() {
    const ghgLevel = state.ghg;
    const distanceAU = state.distance;
    const cloudiness = state.cloud / 100;
    const oceanRatio = state.ocean / 100;
    const landRatio = 1 - oceanRatio;
    const solar = 1361 / (distanceAU * distanceAU);
    const baselineAlbedo = clamp(0.18 + (landRatio * 0.08) + (cloudiness * 0.22), 0.08, 0.72);
    const greenhouseBoost = 33 * ((1 - Math.exp(-ghgLevel * 0.85)) / (1 - Math.exp(-0.85)));
    const dryPenalty = clamp(landRatio - 0.45, 0, 0.55) * 5.5;

    let temp = Math.pow((solar * (1 - baselineAlbedo)) / (4 * SIGMA), 0.25) - 273.15;
    temp += greenhouseBoost - dryPenalty;

    const iceEstimate = clamp((6 - temp) / 36, 0, 1);
    const albedo = clamp(baselineAlbedo + (iceEstimate * 0.24), 0.08, 0.9);

    temp = Math.pow((solar * (1 - albedo)) / (4 * SIGMA), 0.25) - 273.15;
    temp += greenhouseBoost - dryPenalty;
    temp = lerp(temp, 15, oceanRatio * 0.16);

    const ice = clamp((5 - temp) / 36, 0, 1);
    const dryness = clamp(clamp((temp - 24) / 30, 0, 1) * lerp(0.45, 1.05, landRatio) * (1 - (cloudiness * 0.18)), 0, 1);
    const vegetation = clamp((1 - (ice * 0.92)) * (1 - (dryness * 0.78)) * clamp((temp + 10) / 32, 0, 1) * lerp(0.55, 1, oceanRatio), 0, 1);

    return {
        temp,
        solar,
        ice,
        cloudiness,
        oceanRatio,
        landRatio,
        ghgLevel,
        albedo,
        greenhouseBoost,
        dryness,
        vegetation,
        label: climateName(temp)
    };
}

function describeClimate(climate) {
    if (climate.temp < -20) {
        return {
            summary: `太陽からの受熱が弱く、氷と雪が広がって反射率 ${formatNumber(climate.albedo, 2)} まで上がっています。温室効果はあるものの、日射不足と氷-アルベドで冷却が優勢です。`,
            title: "白さが冷却を強める",
            text: "寒くなると氷が広がり、さらに光を反射して冷えやすくなります。日射の減少だけでなく、氷そのものが冷却を押している点が重要です。"
        };
    }

    if (climate.temp < 12) {
        return {
            summary: `雲と反射率がやや高く、平均気温は低めです。海が残っているため極端な暴走は抑えられていますが、寒冷側へ傾いた状態です。`,
            title: "冷えているが、まだ全面凍結ではない",
            text: "この帯域では日射、温室効果、海の緩和が競り合っています。少し条件を変えると氷の割合が大きく増えやすい境目です。"
        };
    }

    if (climate.temp < 28) {
        return {
            summary: `日射、反射率、温室効果のバランスが比較的取れており、平均気温は居住可能帯に近い範囲です。植生も残りやすく、海が温度変化を和らげています。`,
            title: "つり合いが見えやすい帯域",
            text: "温室効果を少し増やすと暖まり、雲や距離を増やすと冷える、という基本の押し引きが最も分かりやすい領域です。"
        };
    }

    if (climate.temp < 45) {
        return {
            summary: `温室効果と強い日射の影響で高温側へ寄り、氷はかなり減っています。陸は乾きやすく、海が少ないほど極端な暑さが出やすくなります。`,
            title: "乾燥と高温が前面に出る",
            text: "高温側では雪の反射よりも、温室効果と受熱の強さが支配的です。海が少ない条件を組み合わせると、見た目も赤茶けていきます。"
        };
    }

    return {
        summary: `強い日射と温室効果で、地表は灼熱側まで押し上げられています。氷はほぼ消え、海が少ないと緩和も弱く、極端な高温が続きます。`,
        title: "放射の押し引きが高温側へ崩れている",
        text: "この領域では、冷却に効く雲や反射率を増やしても追いつきにくくなります。温室効果と受熱が非常に強い、教材としての極端ケースです。"
    };
}

function updateInterface(climate) {
    dom.ghgText.textContent = `${formatNumber(state.ghg, 2)} × 現代地球`;
    dom.distanceText.textContent = `${formatNumber(state.distance, 2)} AU`;
    dom.cloudText.textContent = `${formatNumber(state.cloud, 0)}%`;
    dom.oceanText.textContent = `${formatNumber(state.ocean, 0)}%`;

    dom.tempStat.textContent = `${formatNumber(climate.temp, 1)}°C`;
    dom.climateStat.textContent = climate.label;
    dom.solarStat.textContent = `${formatNumber(climate.solar, 0)} W/m²`;
    dom.iceStat.textContent = `${formatNumber(climate.ice * 100, 0)}%`;
    dom.albedoStat.textContent = formatNumber(climate.albedo, 2);
    dom.greenhouseStat.textContent = `+${formatNumber(climate.greenhouseBoost, 1)}°C`;

    const description = describeClimate(climate);
    dom.summaryText.textContent = description.summary;
    dom.observeTitle.textContent = description.title;
    dom.observeText.textContent = description.text;

    dom.modeChip.textContent = `${climate.label} / ${formatNumber(climate.temp, 1)}°C`;
    dom.modeChip.className = "canvas-chip";
    if (climate.temp < 10) {
        dom.modeChip.classList.add("is-cold");
    } else if (climate.temp < 30) {
        dom.modeChip.classList.add("is-temperate");
    } else {
        dom.modeChip.classList.add("is-hot");
    }
}

function resizeCanvas() {
    const shell = dom.canvas.parentElement;
    const bounds = shell.getBoundingClientRect();
    const cssWidth = Math.max(320, Math.round(bounds.width || shell.clientWidth || 760));
    const cssHeight = window.innerWidth <= 780
        ? Math.round(clamp(cssWidth * 0.92, 360, 540))
        : Math.round(clamp(cssWidth * 0.72, 470, 660));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    dom.canvas.style.height = `${cssHeight}px`;
    dom.canvas.width = Math.round(cssWidth * dpr);
    dom.canvas.height = Math.round(cssHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    state.viewport = {
        width: cssWidth,
        height: cssHeight,
        dpr
    };
}

function getSceneMetrics() {
    const { width, height } = state.viewport;
    return {
        width,
        height,
        sunX: width * 0.14,
        sunY: height * 0.22,
        planetX: width * 0.68,
        planetY: height * 0.55,
        planetRadius: Math.min(width, height) * 0.245
    };
}

function drawBackdrop(scene) {
    const sky = ctx.createLinearGradient(0, 0, 0, scene.height);
    sky.addColorStop(0, "#02060c");
    sky.addColorStop(0.55, "#071525");
    sky.addColorStop(1, "#0a2133");
    ctx.clearRect(0, 0, scene.width, scene.height);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, scene.width, scene.height);

    for (let index = 0; index < 140; index += 1) {
        const x = ((index * 173.7) % scene.width);
        const y = ((index * 97.3) % scene.height);
        const twinkle = 0.16 + (0.12 * (0.5 + (0.5 * Math.sin((index * 1.73) + (state.rotation * 22)))));
        const radius = 0.6 + ((index % 3) * 0.55);
        ctx.fillStyle = `rgba(255, 255, 255, ${twinkle})`;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawSunlight(scene, climate) {
    const beamAlpha = clamp((climate.solar - 400) / 2000, 0.12, 0.42);
    for (let index = 0; index < 4; index += 1) {
        const offset = (index - 1.5) * scene.planetRadius * 0.36;
        const gradient = ctx.createLinearGradient(scene.sunX, 0, scene.planetX, 0);
        gradient.addColorStop(0, `rgba(255, 214, 102, ${beamAlpha})`);
        gradient.addColorStop(1, "rgba(255, 214, 102, 0)");
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 8 + (index * 2);
        ctx.beginPath();
        ctx.moveTo(scene.sunX + (scene.width * 0.05), scene.sunY + offset);
        ctx.lineTo(scene.planetX - (scene.planetRadius * 0.9), scene.planetY + offset * 0.8);
        ctx.stroke();
    }
}

function drawSun(scene, climate) {
    const radius = clamp((scene.width * 0.075) / state.distance, 38, 92);
    const glow = ctx.createRadialGradient(scene.sunX, scene.sunY, radius * 0.1, scene.sunX, scene.sunY, radius * 2.6);
    glow.addColorStop(0, "rgba(255, 242, 165, 0.98)");
    glow.addColorStop(0.4, "rgba(255, 197, 87, 0.42)");
    glow.addColorStop(1, "rgba(255, 197, 87, 0)");

    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(scene.sunX, scene.sunY, radius * 2.6, 0, Math.PI * 2);
    ctx.fill();

    const solarColor = climate.temp > 35 ? [255, 190, 100] : [255, 221, 119];
    ctx.fillStyle = toRgb(solarColor);
    ctx.beginPath();
    ctx.arc(scene.sunX, scene.sunY, radius, 0, Math.PI * 2);
    ctx.fill();
}

function drawPlanetBase(scene, climate) {
    const coldSea = [126, 191, 245];
    const temperateSea = [37, 126, 196];
    const hotSea = [13, 82, 132];
    const warmth = clamp((climate.temp - 12) / 32, 0, 1);
    const coldness = clamp((12 - climate.temp) / 36, 0, 1);
    let oceanColor = mixChannels(temperateSea, hotSea, warmth);
    oceanColor = mixChannels(oceanColor, coldSea, coldness);
    oceanColor = mixChannels(oceanColor, [225, 241, 255], climate.ice * 0.28);

    const gradient = ctx.createRadialGradient(
        scene.planetX - (scene.planetRadius * 0.55),
        scene.planetY - (scene.planetRadius * 0.58),
        scene.planetRadius * 0.15,
        scene.planetX,
        scene.planetY,
        scene.planetRadius
    );

    gradient.addColorStop(0, toRgb(mixChannels(oceanColor, [210, 232, 255], 0.55)));
    gradient.addColorStop(0.42, toRgb(oceanColor));
    gradient.addColorStop(1, toRgb(mixChannels(oceanColor, [6, 28, 54], 0.72)));

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(scene.planetX, scene.planetY, scene.planetRadius, 0, Math.PI * 2);
    ctx.fill();
}

function drawContinents(scene, climate) {
    const landScale = lerp(1.22, 0.68, climate.oceanRatio);
    const vegetationColor = mixChannels([88, 145, 75], [54, 176, 96], climate.vegetation);
    const desertColor = mixChannels([191, 154, 88], [174, 87, 55], climate.dryness);
    const landColor = mixChannels(desertColor, vegetationColor, climate.vegetation);
    const coastColor = mixChannels(landColor, [233, 244, 255], climate.ice * 0.38);

    ctx.fillStyle = toRgb(landColor);
    CONTINENTS.forEach((continent, index) => {
        const phase = continent.phase + (state.rotation * 0.45);
        const baseX = scene.planetX + Math.cos(phase) * scene.planetRadius * 0.38;
        const baseY = scene.planetY + (continent.offsetY * scene.planetRadius) + (Math.sin((phase * 1.4) + (index * 0.6)) * scene.planetRadius * 0.05);
        const width = scene.planetRadius * continent.size * landScale * continent.squish;
        const height = scene.planetRadius * continent.size * landScale;

        ctx.beginPath();
        ctx.moveTo(baseX - (width * 0.7), baseY - (height * 0.35));
        ctx.bezierCurveTo(baseX - width, baseY - height, baseX + (width * 0.6), baseY - (height * 1.05), baseX + (width * 0.72), baseY - (height * 0.1));
        ctx.bezierCurveTo(baseX + width, baseY + (height * 0.35), baseX + (width * 0.3), baseY + height, baseX - (width * 0.42), baseY + (height * 0.82));
        ctx.bezierCurveTo(baseX - width, baseY + (height * 0.15), baseX - (width * 0.95), baseY - (height * 0.08), baseX - (width * 0.7), baseY - (height * 0.35));
        ctx.fill();

        ctx.strokeStyle = toRgba(coastColor, 0.18);
        ctx.lineWidth = 1.5;
        ctx.stroke();
    });

    if (climate.dryness > 0.16) {
        ctx.fillStyle = toRgba([215, 116, 73], 0.22 + (climate.dryness * 0.22));
        for (let index = 0; index < 6; index += 1) {
            const phase = (index * 1.02) + (state.rotation * 0.33);
            const x = scene.planetX + Math.cos(phase) * scene.planetRadius * 0.35;
            const y = scene.planetY + Math.sin((phase * 1.6) + 0.4) * scene.planetRadius * 0.2;
            ctx.beginPath();
            ctx.ellipse(x, y, scene.planetRadius * 0.12, scene.planetRadius * 0.05, phase, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function drawIce(scene, climate) {
    if (climate.ice <= 0.01) {
        return;
    }

    const capHeight = scene.planetRadius * clamp(climate.ice * 0.9, 0.08, 0.72);
    ctx.fillStyle = `rgba(244, 250, 255, ${0.28 + (climate.ice * 0.55)})`;

    ctx.beginPath();
    ctx.ellipse(scene.planetX, scene.planetY - scene.planetRadius + (capHeight * 0.62), scene.planetRadius * 0.92, capHeight, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(scene.planetX, scene.planetY + scene.planetRadius - (capHeight * 0.62), scene.planetRadius * 0.92, capHeight, 0, 0, Math.PI * 2);
    ctx.fill();

    if (climate.ice > 0.36) {
        ctx.fillStyle = `rgba(255, 255, 255, ${0.12 + (climate.ice * 0.28)})`;
        for (let index = 0; index < 12; index += 1) {
            const phase = (index * 0.52) + (state.rotation * 0.2);
            const x = scene.planetX + Math.cos(phase) * scene.planetRadius * 0.44;
            const y = scene.planetY + Math.sin((phase * 1.8) + 0.3) * scene.planetRadius * 0.36;
            ctx.beginPath();
            ctx.arc(x, y, scene.planetRadius * (0.035 + (climate.ice * 0.04)), 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function drawClouds(scene, climate) {
    const alpha = 0.08 + (climate.cloudiness * 0.42);
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;

    for (let index = 0; index < 24; index += 1) {
        const phase = (index * 0.41) + (state.rotation * 0.6);
        const radial = scene.planetRadius * (0.24 + ((index % 6) * 0.09));
        const x = scene.planetX + Math.cos((phase * 1.22) + 0.2) * radial;
        const y = scene.planetY + Math.sin((phase * 1.86) + 0.4) * radial * 0.66;
        const width = scene.planetRadius * (0.08 + (climate.cloudiness * 0.08) + ((index % 3) * 0.01));
        const height = width * 0.42;
        ctx.beginPath();
        ctx.ellipse(x, y, width, height, phase, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawAtmosphere(scene, climate) {
    const coldTint = [120, 197, 255];
    const temperateTint = [92, 204, 247];
    const hotTint = [255, 139, 92];
    const warmth = clamp((climate.temp - 18) / 28, 0, 1);
    const coldness = clamp((8 - climate.temp) / 28, 0, 1);
    let tint = mixChannels(temperateTint, hotTint, warmth);
    tint = mixChannels(tint, coldTint, coldness);

    ctx.strokeStyle = toRgba(tint, 0.2 + (climate.ghgLevel * 0.03));
    ctx.lineWidth = 18 + (climate.ghgLevel * 1.2);
    ctx.beginPath();
    ctx.arc(scene.planetX, scene.planetY, scene.planetRadius + 10, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = toRgba(tint, 0.08);
    ctx.lineWidth = 30 + (climate.ghgLevel * 2);
    ctx.beginPath();
    ctx.arc(scene.planetX, scene.planetY, scene.planetRadius + 18, 0, Math.PI * 2);
    ctx.stroke();
}

function drawTerminator(scene) {
    const shadow = ctx.createLinearGradient(
        scene.planetX - (scene.planetRadius * 0.4),
        scene.planetY,
        scene.planetX + scene.planetRadius,
        scene.planetY
    );
    shadow.addColorStop(0, "rgba(4, 16, 28, 0)");
    shadow.addColorStop(0.7, "rgba(4, 16, 28, 0.24)");
    shadow.addColorStop(1, "rgba(4, 16, 28, 0.6)");
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(scene.planetX, scene.planetY, scene.planetRadius, 0, Math.PI * 2);
    ctx.fill();
}

function drawPlanet(scene, climate) {
    drawPlanetBase(scene, climate);

    ctx.save();
    ctx.beginPath();
    ctx.arc(scene.planetX, scene.planetY, scene.planetRadius, 0, Math.PI * 2);
    ctx.clip();

    drawContinents(scene, climate);
    drawIce(scene, climate);
    drawClouds(scene, climate);
    drawTerminator(scene);

    ctx.restore();

    drawAtmosphere(scene, climate);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(scene.planetX, scene.planetY, scene.planetRadius, 0, Math.PI * 2);
    ctx.stroke();
}

function drawScene(climate) {
    const scene = getSceneMetrics();
    drawBackdrop(scene);
    drawSunlight(scene, climate);
    drawSun(scene, climate);
    drawPlanet(scene, climate);
}

function renderAll() {
    const climate = computeClimate();
    state.latestClimate = climate;
    updateInterface(climate);
    drawScene(climate);
}

function setPreset(preset) {
    state.ghg = preset.ghg;
    state.distance = preset.distance;
    state.cloud = preset.cloud;
    state.ocean = preset.ocean;
    syncInputsFromState();
    renderAll();
}

function animate() {
    state.rotation += 0.0036;
    if (state.latestClimate) {
        drawScene(state.latestClimate);
    }
    state.animationId = window.requestAnimationFrame(animate);
}

dom.ghg.addEventListener("input", () => {
    syncStateFromInputs();
    renderAll();
});

dom.distance.addEventListener("input", () => {
    syncStateFromInputs();
    renderAll();
});

dom.cloud.addEventListener("input", () => {
    syncStateFromInputs();
    renderAll();
});

dom.ocean.addEventListener("input", () => {
    syncStateFromInputs();
    renderAll();
});

dom.earthBtn.addEventListener("click", () => {
    setPreset(PRESETS.earth);
});

dom.snowBtn.addEventListener("click", () => {
    setPreset(PRESETS.snowball);
});

dom.hotBtn.addEventListener("click", () => {
    setPreset(PRESETS.hot);
});

dom.venusBtn.addEventListener("click", () => {
    setPreset(PRESETS.venus);
});

dom.marsBtn.addEventListener("click", () => {
    setPreset(PRESETS.mars);
});

window.addEventListener("resize", () => {
    resizeCanvas();
    renderAll();
});

syncInputsFromState();
resizeCanvas();
renderAll();
animate();