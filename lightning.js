const DEFAULTS = {
    rodMode: "on",
    branchRate: 25,
    noise: 45
};

const dom = {
    canvas: document.querySelector("#canvas"),
    rodMode: document.querySelector("#rodMode"),
    branchRate: document.querySelector("#branchRate"),
    noise: document.querySelector("#noise"),
    branchText: document.querySelector("#branchText"),
    noiseText: document.querySelector("#noiseText"),
    strikeBtn: document.querySelector("#strikeBtn"),
    clearBtn: document.querySelector("#clearBtn"),
    summaryText: document.querySelector("#summaryText"),
    observeTitle: document.querySelector("#observeTitle"),
    observeText: document.querySelector("#observeText"),
    modeChip: document.querySelector("#modeChip"),
    resultText: document.querySelector("#resultText"),
    hitText: document.querySelector("#hitText"),
    distanceText: document.querySelector("#distanceText"),
    branchCountText: document.querySelector("#branchCountText")
};

const ctx = dom.canvas.getContext("2d");

const state = {
    rodMode: DEFAULTS.rodMode,
    branchRate: DEFAULTS.branchRate,
    noise: DEFAULTS.noise,
    viewport: {
        width: 1000,
        height: 620,
        dpr: 1
    },
    bolt: null,
    lastHit: null,
    mainProgress: 0,
    flashAlpha: 0,
    flashRadius: 48,
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

function randomBetween(min, max) {
    return min + (Math.random() * (max - min));
}

function distanceBetween(x1, y1, x2, y2) {
    return Math.hypot(x2 - x1, y2 - y1);
}

function lerp(from, to, progress) {
    return from + ((to - from) * progress);
}

function easeOutCubic(progress) {
    return 1 - ((1 - progress) ** 3);
}

function formatNumber(value, digits = 1) {
    return value.toFixed(digits).replace(/(?:\.0+|(\.\d*?[1-9]))0+$/, "$1");
}

function getSceneMetrics() {
    const { width, height } = state.viewport;
    const groundY = height * 0.86;
    const buildingWidth = width * 0.2;
    const buildingHeight = height * 0.17;
    const buildingLeft = (width * 0.5) - (buildingWidth * 0.5);
    const roofY = groundY - buildingHeight;

    return {
        width,
        height,
        groundY,
        building: {
            left: buildingLeft,
            width: buildingWidth,
            height: buildingHeight,
            roofY
        },
        rod: {
            x: buildingLeft + (buildingWidth * 0.68),
            baseY: groundY,
            tipY: roofY - (height * 0.13)
        },
        cloudBandY: height * 0.13,
        startY: height * 0.19
    };
}

function resizeCanvas() {
    const shell = dom.canvas.parentElement;
    const bounds = shell.getBoundingClientRect();
    const cssWidth = Math.max(320, Math.round(bounds.width || shell.clientWidth || 960));
    const cssHeight = window.innerWidth <= 780
        ? Math.round(clamp(cssWidth * 0.78, 360, 500))
        : Math.round(clamp(cssWidth * 0.62, 460, 640));
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

function updateControlText() {
    dom.branchText.textContent = String(state.branchRate);
    dom.noiseText.textContent = String(state.noise);

    if (state.rodMode === "on") {
        dom.summaryText.textContent = `避雷針あり / 枝分かれ ${state.branchRate}% / 揺らぎ ${state.noise} / 先端へ向かう横方向の引き寄せを入れています。`;
        dom.observeTitle.textContent = "先端へ引き寄せる簡易モデル";
        dom.observeText.textContent = "避雷針ありでは、主放電が先端付近に入るほど横方向の寄りを強めています。枝分かれは残したまま、主経路が先端へ集まりやすくなります。";
        dom.modeChip.textContent = "避雷針あり / 先端電場 on";
    } else {
        dom.summaryText.textContent = `避雷針なし / 枝分かれ ${state.branchRate}% / 揺らぎ ${state.noise} / 下向き進行とランダムな揺らぎだけで経路を決めます。`;
        dom.observeTitle.textContent = "避雷針なしの基準";
        dom.observeText.textContent = "避雷針なしでは、主放電は下向きの進行と左右の揺らぎで経路を探します。どの場所へ近づくかはその都度かなり変わります。";
        dom.modeChip.textContent = "避雷針なし / 自然落下";
    }
}

function resetStats() {
    dom.resultText.textContent = "---";
    dom.hitText.textContent = "---";
    dom.distanceText.textContent = "---";
    dom.branchCountText.textContent = "---";
}

function updateStats() {
    if (!state.lastHit || !state.bolt) {
        resetStats();
        return;
    }

    const scene = getSceneMetrics();
    const tipDistance = distanceBetween(state.lastHit.x, state.lastHit.y, scene.rod.x, scene.rod.tipY);

    dom.resultText.textContent = state.lastHit.type;
    dom.hitText.textContent = `x=${formatNumber(state.lastHit.x, 0)}, y=${formatNumber(state.lastHit.y, 0)}`;
    dom.distanceText.textContent = state.rodMode === "on" ? `${formatNumber(tipDistance, 1)} px` : "避雷針なし";
    dom.branchCountText.textContent = `${state.bolt.branches.length} 本`;
}

function drawScene() {
    const scene = getSceneMetrics();

    drawSky(scene);
    drawClouds(scene);
    drawGround(scene);
    drawBuilding(scene);
    if (state.rodMode === "on") {
        drawElectricFieldHint(scene);
        drawRod(scene);
    }
    drawLightning(scene);
    drawImpactFlash(scene);
}

function drawSky(scene) {
    const sky = ctx.createLinearGradient(0, 0, 0, scene.height);
    sky.addColorStop(0, "#020617");
    sky.addColorStop(0.55, "#0f172a");
    sky.addColorStop(1, "#1e293b");

    ctx.clearRect(0, 0, scene.width, scene.height);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, scene.width, scene.height);

    for (let index = 0; index < 26; index += 1) {
        const x = ((index * 173) % scene.width) + 18;
        const y = 24 + ((index * 67) % Math.round(scene.height * 0.28));
        const radius = 0.8 + ((index % 3) * 0.45);
        ctx.fillStyle = `rgba(255, 255, 255, ${0.1 + ((index % 4) * 0.05)})`;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawClouds(scene) {
    ctx.fillStyle = "rgba(148, 163, 184, 0.36)";

    for (let index = 0; index < 15; index += 1) {
        const x = (scene.width * 0.08) + (index * scene.width * 0.06) + (Math.sin(index * 1.3) * scene.width * 0.014);
        const y = scene.cloudBandY + (Math.cos(index * 1.8) * scene.height * 0.018);
        ctx.beginPath();
        ctx.ellipse(x, y, scene.width * 0.08, scene.height * 0.05, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.fillStyle = "rgba(226, 232, 240, 0.18)";
    ctx.font = "700 18px IBM Plex Sans JP";
    ctx.fillText("負に帯電した雲", scene.width * 0.04, scene.height * 0.07);

    ctx.font = "700 22px IBM Plex Sans JP";
    for (let index = 0; index < 18; index += 1) {
        ctx.fillStyle = "rgba(147, 197, 253, 0.82)";
        ctx.fillText("−", (scene.width * 0.08) + (index * scene.width * 0.045), scene.cloudBandY + 14 + (Math.sin(index) * scene.height * 0.02));
    }
}

function drawGround(scene) {
    const ground = ctx.createLinearGradient(0, scene.groundY, 0, scene.height);
    ground.addColorStop(0, "#14532d");
    ground.addColorStop(1, "#052e16");
    ctx.fillStyle = ground;
    ctx.fillRect(0, scene.groundY, scene.width, scene.height - scene.groundY);

    ctx.fillStyle = "rgba(187, 247, 208, 0.9)";
    ctx.font = "700 18px IBM Plex Sans JP";
    ctx.fillText("地面", scene.width * 0.024, scene.groundY + 32);

    ctx.fillStyle = "rgba(250, 204, 21, 0.85)";
    ctx.font = "700 22px IBM Plex Sans JP";
    for (let index = 0; index < 16; index += 1) {
        ctx.fillText("＋", (scene.width * 0.08) + (index * scene.width * 0.055), scene.groundY + 34 + (Math.sin(index * 1.3) * 8));
    }
}

function drawBuilding(scene) {
    const { left, width, height, roofY } = scene.building;

    ctx.fillStyle = "#111827";
    ctx.fillRect(left, roofY, width, height);

    ctx.fillStyle = "#1f2937";
    ctx.beginPath();
    ctx.moveTo(left - 10, roofY + 4);
    ctx.lineTo(left + (width * 0.5), roofY - 18);
    ctx.lineTo(left + width + 10, roofY + 4);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(148, 163, 184, 0.2)";
    for (let row = 0; row < 2; row += 1) {
        for (let column = 0; column < 4; column += 1) {
            const windowWidth = width * 0.1;
            const windowHeight = height * 0.18;
            const x = left + (width * 0.14) + (column * width * 0.18);
            const y = roofY + (height * 0.2) + (row * height * 0.28);
            ctx.fillRect(x, y, windowWidth, windowHeight);
        }
    }
}

function drawRod(scene) {
    ctx.strokeStyle = "#f8fafc";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(scene.rod.x, scene.rod.baseY);
    ctx.lineTo(scene.rod.x, scene.rod.tipY);
    ctx.stroke();

    ctx.fillStyle = "#f8fafc";
    ctx.beginPath();
    ctx.moveTo(scene.rod.x, scene.rod.tipY - 20);
    ctx.lineTo(scene.rod.x - 11, scene.rod.tipY + 8);
    ctx.lineTo(scene.rod.x + 11, scene.rod.tipY + 8);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(scene.rod.x, scene.rod.baseY);
    ctx.lineTo(scene.rod.x - (scene.width * 0.06), scene.height);
    ctx.stroke();

    ctx.fillStyle = "rgba(248, 250, 252, 0.9)";
    ctx.font = "700 16px IBM Plex Sans JP";
    ctx.textAlign = "center";
    ctx.fillText("避雷針", scene.rod.x, scene.rod.tipY - 34);
    ctx.textAlign = "left";
}

function drawElectricFieldHint(scene) {
    const radius = scene.height * 0.3;
    const gradient = ctx.createRadialGradient(scene.rod.x, scene.rod.tipY, 6, scene.rod.x, scene.rod.tipY, radius);
    gradient.addColorStop(0, "rgba(250, 204, 21, 0.22)");
    gradient.addColorStop(1, "rgba(250, 204, 21, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(scene.rod.x, scene.rod.tipY, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(250, 204, 21, 0.28)";
    ctx.lineWidth = 1;
    for (let index = -4; index <= 4; index += 1) {
        ctx.beginPath();
        ctx.moveTo(scene.rod.x, scene.rod.tipY);
        ctx.quadraticCurveTo(
            scene.rod.x + (index * scene.width * 0.04),
            scene.rod.tipY - (scene.height * 0.09),
            scene.rod.x + (index * scene.width * 0.065),
            scene.rod.tipY - (scene.height * 0.24)
        );
        ctx.stroke();
    }
}

function generateLightning(scene) {
    const main = [];
    const branches = [];
    const start = {
        x: randomBetween(scene.width * 0.18, scene.width - (scene.width * 0.18)),
        y: scene.startY
    };

    let x = start.x;
    let y = start.y;
    let velocityX = randomBetween(-1.5, 1.5);
    const branchProbability = state.branchRate / 100;
    const noisePower = state.noise;
    const hasRod = state.rodMode === "on";
    let capturedByRod = false;

    main.push(start);

    while (y < scene.groundY && main.length < 56) {
        const step = randomBetween(scene.height * 0.018, scene.height * 0.034);
        let attraction = 0;

        if (hasRod) {
            const distance = Math.max(scene.height * 0.06, distanceBetween(x, y, scene.rod.x, scene.rod.tipY));
            attraction = ((scene.rod.x - x) / distance) * 9.5 * (1 + ((scene.groundY - y) / scene.groundY));

            if (y > scene.rod.tipY - (scene.height * 0.3)) {
                attraction *= 2.2;
            }
        }

        velocityX += (randomBetween(-noisePower, noisePower) * 0.035) + (attraction * 0.18);
        velocityX *= 0.82;

        x += velocityX * step * 0.28;
        y += step;
        x = clamp(x, 20, scene.width - 20);

        if (hasRod && distanceBetween(x, y, scene.rod.x, scene.rod.tipY) < scene.height * 0.03) {
            x = scene.rod.x;
            y = scene.rod.tipY;
            main.push({ x, y });
            capturedByRod = true;
            break;
        }

        main.push({ x, y });

        if (Math.random() < branchProbability && y < scene.groundY - (scene.height * 0.06)) {
            const branch = generateBranch(x, y, velocityX, main.length - 1, scene);

            if (branch.points.length > 1) {
                branches.push(branch);
            }
        }
    }

    const lastPoint = main[main.length - 1];

    if (hasRod && (capturedByRod || (lastPoint.y >= scene.rod.tipY && distanceBetween(lastPoint.x, lastPoint.y, scene.rod.x, scene.rod.tipY) < scene.height * 0.16))) {
        if (distanceBetween(lastPoint.x, lastPoint.y, scene.rod.x, scene.rod.tipY) > 1) {
            main.push({ x: scene.rod.x, y: scene.rod.tipY });
        }

        main.push({ x: scene.rod.x, y: scene.rod.baseY });

        return {
            main,
            branches,
            hit: {
                x: scene.rod.x,
                y: scene.rod.tipY,
                type: "避雷針に落雷"
            }
        };
    }

    if (lastPoint.y < scene.groundY) {
        main.push({ x: lastPoint.x, y: scene.groundY });
    } else {
        lastPoint.y = scene.groundY;
    }

    return {
        main,
        branches,
        hit: {
            x: main[main.length - 1].x,
            y: scene.groundY,
            type: "地面に落雷"
        }
    };
}

function generateBranch(startX, startY, baseVelocity, startIndex, scene) {
    const points = [{ x: startX, y: startY }];
    let x = startX;
    let y = startY;
    let velocityX = (baseVelocity * randomBetween(-0.6, 0.6)) + randomBetween(-1.4, 1.4);
    const branchLength = Math.max(3, Math.round(randomBetween(4, 10) + (state.branchRate * 0.08)));

    for (let stepIndex = 0; stepIndex < branchLength; stepIndex += 1) {
        velocityX += randomBetween(-1.1, 1.1);
        y += randomBetween(scene.height * 0.012, scene.height * 0.022);
        x += velocityX * randomBetween(5, 9);
        x = clamp(x, 16, scene.width - 16);

        if (y > scene.groundY) {
            break;
        }

        points.push({ x, y });
    }

    return { points, startIndex };
}

function drawLightning(scene) {
    if (!state.bolt) {
        return;
    }

    const visibleMainSegments = state.mainProgress;
    const layers = [
        { color: "rgba(250, 204, 21, 0.24)", width: 16 },
        { color: "rgba(96, 165, 250, 0.72)", width: 9 },
        { color: "rgba(255, 255, 255, 0.94)", width: 4 }
    ];

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    layers.forEach((layer) => {
        ctx.strokeStyle = layer.color;
        ctx.lineWidth = layer.width;
        drawPolylinePartial(state.bolt.main, visibleMainSegments);

        ctx.lineWidth = Math.max(1.5, layer.width * 0.42);
        state.bolt.branches.forEach((branch) => {
            const branchVisible = visibleMainSegments - branch.startIndex + 0.4;

            if (branchVisible > 0) {
                drawPolylinePartial(branch.points, branchVisible);
            }
        });
    });

    ctx.restore();
}

function drawPolylinePartial(points, visibleSegments) {
    if (points.length < 2 || visibleSegments <= 0) {
        return;
    }

    const maxSegments = points.length - 1;
    const clampedSegments = Math.min(maxSegments, visibleSegments);
    const completedSegments = Math.floor(clampedSegments);

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let index = 1; index <= completedSegments; index += 1) {
        ctx.lineTo(points[index].x, points[index].y);
    }

    if (clampedSegments < maxSegments) {
        const from = points[completedSegments];
        const to = points[completedSegments + 1];
        const remainder = clampedSegments - completedSegments;

        if (from && to && remainder > 0) {
            ctx.lineTo(
                from.x + ((to.x - from.x) * remainder),
                from.y + ((to.y - from.y) * remainder)
            );
        }
    }

    ctx.stroke();
}

function drawImpactFlash(scene) {
    if (!state.lastHit || state.flashAlpha <= 0) {
        return;
    }

    ctx.save();
    ctx.fillStyle = `rgba(255, 248, 220, ${state.flashAlpha * 0.08})`;
    ctx.fillRect(0, 0, scene.width, scene.height);

    const gradient = ctx.createRadialGradient(
        state.lastHit.x,
        state.lastHit.y,
        10,
        state.lastHit.x,
        state.lastHit.y,
        state.flashRadius
    );

    gradient.addColorStop(0, `rgba(250, 204, 21, ${state.flashAlpha * 0.9})`);
    gradient.addColorStop(0.35, `rgba(250, 204, 21, ${state.flashAlpha * 0.45})`);
    gradient.addColorStop(1, "rgba(250, 204, 21, 0)");

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(state.lastHit.x, state.lastHit.y, state.flashRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function cancelAnimation() {
    if (state.animationId !== null) {
        cancelAnimationFrame(state.animationId);
        state.animationId = null;
    }

    if (state.bolt) {
        state.mainProgress = state.bolt.main.length - 1;
    }

    state.flashAlpha = 0;
}

function animateStrike() {
    if (!state.bolt) {
        return;
    }

    cancelAnimation();

    const totalSegments = Math.max(1, state.bolt.main.length - 1);
    const revealDuration = 760;
    const holdDuration = 120;
    const flashDuration = 440;
    const start = performance.now();

    state.mainProgress = 0;
    state.flashAlpha = 0;
    state.flashRadius = 48;

    const frame = (now) => {
        const elapsed = now - start;
        const revealProgress = clamp(elapsed / revealDuration, 0, 1);
        state.mainProgress = totalSegments * easeOutCubic(revealProgress);

        if (elapsed > revealDuration) {
            const flashElapsed = elapsed - revealDuration;
            const fadeProgress = clamp(Math.max(0, flashElapsed - holdDuration) / flashDuration, 0, 1);
            state.flashAlpha = 0.58 * (1 - fadeProgress);
            state.flashRadius = lerp(40, 120, clamp(flashElapsed / flashDuration, 0, 1));
        } else {
            state.flashAlpha = 0;
            state.flashRadius = 48;
        }

        drawScene();

        if (elapsed < revealDuration + holdDuration + flashDuration) {
            state.animationId = requestAnimationFrame(frame);
        } else {
            state.animationId = null;
            state.mainProgress = totalSegments;
            state.flashAlpha = 0;
            drawScene();
        }
    };

    state.animationId = requestAnimationFrame(frame);
}

function clearStrike() {
    cancelAnimation();
    state.bolt = null;
    state.lastHit = null;
    state.mainProgress = 0;
    resetStats();
    drawScene();
}

function launchStrike() {
    const scene = getSceneMetrics();
    state.bolt = generateLightning(scene);
    state.lastHit = state.bolt.hit;
    updateStats();
    animateStrike();
}

dom.strikeBtn.addEventListener("click", launchStrike);
dom.clearBtn.addEventListener("click", clearStrike);

dom.rodMode.addEventListener("change", () => {
    state.rodMode = dom.rodMode.value;
    updateControlText();
    clearStrike();
});

dom.branchRate.addEventListener("input", () => {
    state.branchRate = Number(dom.branchRate.value);
    updateControlText();
});

dom.noise.addEventListener("input", () => {
    state.noise = Number(dom.noise.value);
    updateControlText();
});

window.addEventListener("resize", () => {
    resizeCanvas();
    drawScene();
});

dom.rodMode.value = state.rodMode;
dom.branchRate.value = String(state.branchRate);
dom.noise.value = String(state.noise);

resizeCanvas();
updateControlText();
resetStats();
drawScene();