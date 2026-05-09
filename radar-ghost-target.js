(() => {
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
        canvas: document.querySelector("#radarCanvas"),
        simulationShell: document.querySelector(".simulation-shell"),
        simulationPanel: document.querySelector("#simulationPanel"),
        togglePanel: document.querySelector("#togglePanel"),
        showPanel: document.querySelector("#showPanel"),
        playPause: document.querySelector("#playPause"),
        reset: document.querySelector("#reset"),
        calmSea: document.querySelector("#calmSea"),
        roughSea: document.querySelector("#roughSea"),
        noiseRange: document.querySelector("#noiseRange"),
        seaRange: document.querySelector("#seaRange"),
        persistenceRange: document.querySelector("#persistenceRange"),
        sweepRange: document.querySelector("#sweepRange"),
        multipathToggle: document.querySelector("#multipathToggle"),
        ductingToggle: document.querySelector("#ductingToggle"),
        showTrueToggle: document.querySelector("#showTrueToggle"),
        showGuidesToggle: document.querySelector("#showGuidesToggle"),
        noiseValue: document.querySelector("#noiseValue"),
        seaValue: document.querySelector("#seaValue"),
        persistenceValue: document.querySelector("#persistenceValue"),
        sweepRateValue: document.querySelector("#sweepRateValue"),
        realCountValue: document.querySelector("#realCountValue"),
        ghostCountValue: document.querySelector("#ghostCountValue"),
        noiseCountValue: document.querySelector("#noiseCountValue"),
        runningValue: document.querySelector("#runningValue"),
        sweepValue: document.querySelector("#sweepValue"),
        ghostModeValue: document.querySelector("#ghostModeValue"),
        persistenceSummary: document.querySelector("#persistenceSummary"),
        summaryValue: document.querySelector("#summaryValue"),
        panelStatus: document.querySelector("#panelStatus")
    };

    const context = dom.canvas?.getContext("2d", { alpha: false });
    const staticCanvas = document.createElement("canvas");
    const staticContext = staticCanvas.getContext("2d", { alpha: false });

    if (!dom.canvas || !context || !staticContext || !dom.simulationShell) {
        return;
    }

    const TAU = Math.PI * 2;
    const FRAME_INTERVAL = 1000 / 30;
    const UI_INTERVAL = 140;
    const baseStatus = "最初はそのまま 1 周させて、水色の本物の反射の周りにオレンジのゴーストがどのくらい混ざるかを見てください。";

    const state = {
        width: 900,
        height: 600,
        dpr: 1,
        running: true,
        panelHidden: false,
        radarRange: 520,
        seaY: 150,
        sweep: 0,
        lastFrameTime: 0,
        lastUiUpdate: 0,
        motionTime: 0,
        animationId: null,
        readoutSignature: "",
        scene: null,
        noise: Number(dom.noiseRange.value),
        seaReflection: Number(dom.seaRange.value),
        persistence: Number(dom.persistenceRange.value),
        sweepRate: Number(dom.sweepRange.value),
        multipath: dom.multipathToggle.checked,
        ducting: dom.ductingToggle.checked,
        showTrueTargets: dom.showTrueToggle.checked,
        showGuides: dom.showGuidesToggle.checked,
        needsStaticRedraw: true,
        targets: [],
        blips: [],
        blipCounts: {
            realEcho: 0,
            ghost: 0,
            noise: 0
        },
        maxBlips: 220,
        statusTimeout: 0
    };

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function resizeCanvasElement(canvas, targetContext, cssWidth, cssHeight) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.style.height = `${cssHeight}px`;
        canvas.width = Math.round(cssWidth * dpr);
        canvas.height = Math.round(cssHeight * dpr);
        targetContext.setTransform(dpr, 0, 0, dpr, 0, 0);

        return {
            width: cssWidth,
            height: cssHeight,
            dpr
        };
    }

    function resetTargets() {
        state.targets = [
            { x: -220, y: -120, vx: 22, vy: 6, wobble: 0.6, lockout: 0 },
            { x: 260, y: 70, vx: -14, vy: -5, wobble: 1.1, lockout: 0 },
            { x: 60, y: -260, vx: 5, vy: 18, wobble: 2.3, lockout: 0 },
            { x: -90, y: 210, vx: 10, vy: -8, wobble: 3.4, lockout: 0 }
        ];
        state.blips = [];
        state.blipCounts = {
            realEcho: 0,
            ghost: 0,
            noise: 0
        };
        state.sweep = 0;
        state.motionTime = 0;
        state.lastFrameTime = 0;
        state.lastUiUpdate = 0;
        state.readoutSignature = "";
        syncStatusMessage(true);
    }

    function setPanelVisibility(hidden) {
        state.panelHidden = hidden;
        dom.simulationShell.classList.toggle("is-panel-hidden", hidden);
        dom.simulationPanel.setAttribute("aria-hidden", hidden ? "true" : "false");
        dom.togglePanel.setAttribute("aria-expanded", hidden ? "false" : "true");
        dom.showPanel.setAttribute("aria-expanded", hidden ? "false" : "true");
        resizeCanvas();
    }

    function buildScene() {
        const rightInset = window.innerWidth > 980 && !state.panelHidden
            ? Math.min(370, state.width * 0.34)
            : 0;
        const availableWidth = state.width - rightInset;
        const scale = Math.min(
            (availableWidth * 0.82) / (state.radarRange * 2),
            (state.height * 0.78) / (state.radarRange * 2)
        );

        return {
            width: state.width,
            height: state.height,
            centerX: Math.max(availableWidth * 0.52, state.width * 0.34),
            centerY: state.height * 0.54,
            scale,
            ringRadius: state.radarRange * scale
        };
    }

    function resizeCanvas() {
        const bounds = dom.simulationShell.getBoundingClientRect();
        const cssWidth = Math.max(320, Math.round(bounds.width || dom.simulationShell.clientWidth || 960));
        const cssHeight = window.innerWidth <= 840
            ? Math.round(clamp(cssWidth * 0.94, 360, 540))
            : Math.round(clamp(cssWidth * 0.64, 560, 780));

        const viewport = resizeCanvasElement(dom.canvas, context, cssWidth, cssHeight);
        state.width = viewport.width;
        state.height = viewport.height;
        state.dpr = viewport.dpr;

        staticCanvas.width = Math.round(viewport.width * viewport.dpr);
        staticCanvas.height = Math.round(viewport.height * viewport.dpr);
        staticContext.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);

        state.scene = buildScene();
        state.needsStaticRedraw = true;
    }

    function syncStateFromControls() {
        state.noise = Number(dom.noiseRange.value);
        state.seaReflection = Number(dom.seaRange.value);
        state.persistence = Number(dom.persistenceRange.value);
        state.sweepRate = Number(dom.sweepRange.value);
        state.multipath = dom.multipathToggle.checked;
        state.ducting = dom.ductingToggle.checked;
        state.showTrueTargets = dom.showTrueToggle.checked;
        state.showGuides = dom.showGuidesToggle.checked;
    }

    function buildContextMessage(counts = state.blipCounts) {

        if (!state.multipath && !state.ducting) {
            return "今は本物の反射とノイズだけです。多重反射を戻すと、オレンジのゴーストがどこから増えるか比較できます。";
        }

        if (counts.ghost > counts.realEcho + 4) {
            return "ゴーストが本物より目立っています。海面反射か追跡残りを少し下げると、本物との違いが読みやすくなります。";
        }

        if (counts.noise > counts.ghost && state.noise > 0.34) {
            return "いま増えている誤検出の主因はノイズです。単発の黄点が追跡残りで目標っぽく見えている状態です。";
        }

        if (state.ducting && !state.multipath) {
            return "多重反射を切ったので、遠距離側の誤検出はほぼ大気ダクト風の成分です。外周近くのオレンジ点に注目してください。";
        }

        if (state.seaReflection > 0.62) {
            return "海面反射が強く、本物の近くに鏡像っぽいゴーストが増えやすい設定です。上下にずれたオレンジ点を見てください。";
        }

        return baseStatus;
    }

    function syncStatusMessage(force = false) {
        if (state.statusTimeout) {
            return;
        }

        const nextMessage = buildContextMessage(state.blipCounts);
        if (force || dom.panelStatus.textContent !== nextMessage) {
            dom.panelStatus.textContent = nextMessage;
        }
    }

    function setStatus(message) {
        dom.panelStatus.textContent = message;

        if (state.statusTimeout) {
            window.clearTimeout(state.statusTimeout);
            state.statusTimeout = 0;
        }

        state.statusTimeout = window.setTimeout(() => {
            state.statusTimeout = 0;
            syncStatusMessage(true);
        }, 2600);
    }

    function updateReadouts(force = false) {
        const counts = state.blipCounts;
        const angleDegrees = Math.round(((state.sweep * 180) / Math.PI + 360) % 360);
        const ghostModeText = !state.multipath && !state.ducting
            ? "ノイズ中心"
            : state.multipath && state.ducting
                ? "鏡像 + 多重 + ダクト"
                : state.multipath
                    ? "鏡像 + 多重"
                    : "ダクト中心";
        const summaryText = !state.running
            ? "一時停止中"
            : counts.ghost > counts.realEcho + 3
                ? "ゴースト優勢"
                : counts.noise > counts.ghost && state.noise > 0.3
                    ? "ノイズ優勢"
                    : counts.ghost >= Math.max(2, counts.realEcho - 1)
                        ? "誤検出が目立つ"
                        : "本物が優勢";
        const readoutSignature = [
            state.noise.toFixed(2),
            state.seaReflection.toFixed(2),
            state.persistence.toFixed(2),
            state.sweepRate.toFixed(2),
            counts.realEcho,
            counts.ghost,
            counts.noise,
            state.running ? 1 : 0,
            angleDegrees,
            ghostModeText,
            summaryText
        ].join("|");

        if (!force && state.readoutSignature === readoutSignature) {
            syncStatusMessage(false);
            return;
        }

        state.readoutSignature = readoutSignature;

        dom.noiseValue.textContent = state.noise.toFixed(2);
        dom.seaValue.textContent = state.seaReflection.toFixed(2);
        dom.persistenceValue.textContent = state.persistence.toFixed(2);
        dom.sweepRateValue.textContent = `${state.sweepRate.toFixed(2)}x`;
        dom.realCountValue.textContent = String(counts.realEcho);
        dom.ghostCountValue.textContent = String(counts.ghost);
        dom.noiseCountValue.textContent = String(counts.noise);
        dom.runningValue.textContent = state.running ? "再生中" : "停止中";
        dom.sweepValue.textContent = `${angleDegrees}°`;
        dom.persistenceSummary.textContent = state.persistence.toFixed(2);
        dom.ghostModeValue.textContent = ghostModeText;
        dom.summaryValue.textContent = summaryText;
        syncStatusMessage(false);
    }

    function maybeUpdateReadouts(timestamp, force = false) {
        if (!force && timestamp - state.lastUiUpdate < UI_INTERVAL) {
            return;
        }

        state.lastUiUpdate = timestamp;
        updateReadouts(force);
    }

    function worldToCanvas(x, y) {
        return {
            x: state.scene.centerX + (x * state.scene.scale),
            y: state.scene.centerY + (y * state.scene.scale)
        };
    }

    function pointLength(x, y) {
        return Math.hypot(x, y);
    }

    function angleDiff(left, right) {
        return Math.abs(Math.atan2(Math.sin(left - right), Math.cos(left - right)));
    }

    function chance(probability, scale = 1) {
        return Math.random() < clamp(probability * scale, 0, 0.95);
    }

    function addBlip(x, y, type, strength = 1) {
        if (pointLength(x, y) > state.radarRange * 1.04) {
            return;
        }

        state.blips.push({
            x,
            y,
            type,
            strength,
            life: 1
        });
    }

    function updateTargets(dt) {
        const boundaryX = 385;
        const boundaryY = 320;
        const phase = state.motionTime;

        state.targets.forEach((target, index) => {
            target.x += (target.vx + (Math.sin((phase * 1.7) + target.wobble) * 4)) * dt;
            target.y += (target.vy + (Math.cos((phase * 1.35) + target.wobble) * 3)) * dt;
            target.lockout = Math.max(0, target.lockout - dt);

            if (target.x < -boundaryX || target.x > boundaryX) {
                target.vx *= -1;
                target.x = clamp(target.x, -boundaryX, boundaryX);
                target.wobble += 0.3 + (index * 0.1);
            }

            if (target.y < -boundaryY || target.y > boundaryY) {
                target.vy *= -1;
                target.y = clamp(target.y, -boundaryY, boundaryY);
                target.wobble += 0.24 + (index * 0.12);
            }
        });
    }

    function performScan(dt) {
        const frameScale = clamp(dt * 60, 0.2, 2.4);
        const beamWidth = 0.022 + (state.noise * 0.024);

        state.targets.forEach((target) => {
            const targetAngle = Math.atan2(target.y, target.x);
            const radius = pointLength(target.x, target.y);

            if (target.lockout > 0 || angleDiff(targetAngle, state.sweep) > beamWidth) {
                return;
            }

            addBlip(target.x, target.y, "realEcho", 1);
            target.lockout = 0.12;

            if (state.multipath && chance(state.seaReflection * 0.9, frameScale)) {
                const mirroredY = (2 * state.seaY) - target.y;
                const delay = 1.08 + (Math.random() * 0.28);
                addBlip(target.x * delay, mirroredY * delay, "ghost", 0.9);
            }

            if (state.multipath && chance(state.seaReflection * 0.52, frameScale)) {
                const ghostRadius = radius * (1.24 + (Math.random() * 0.56));
                const ghostAngle = targetAngle + ((Math.random() - 0.5) * (0.12 + (state.noise * 0.18)));
                addBlip(Math.cos(ghostAngle) * ghostRadius, Math.sin(ghostAngle) * ghostRadius, "ghost", 0.78);
            }

            if (state.noise > 0.24 && chance(state.noise * 0.16, frameScale)) {
                const jitterRadius = radius * (0.92 + (Math.random() * 0.22));
                const jitterAngle = targetAngle + ((Math.random() - 0.5) * 0.08);
                addBlip(Math.cos(jitterAngle) * jitterRadius, Math.sin(jitterAngle) * jitterRadius, "noise", 0.4);
            }
        });

        if (state.ducting && chance((0.02 + (state.noise * 0.16) + (state.seaReflection * 0.08)), frameScale * 0.28)) {
            const ghostAngle = state.sweep + ((Math.random() - 0.5) * 0.05);
            const ghostRadius = 300 + (Math.random() * 210);
            addBlip(Math.cos(ghostAngle) * ghostRadius, Math.sin(ghostAngle) * ghostRadius, "ghost", 0.68);
        }

        if (chance(state.noise * 0.5, frameScale * 0.45)) {
            const noiseAngle = state.sweep + ((Math.random() - 0.5) * 0.09);
            const noiseRadius = 38 + (Math.random() * state.radarRange);
            addBlip(Math.cos(noiseAngle) * noiseRadius, Math.sin(noiseAngle) * noiseRadius, "noise", 0.5);
        }
    }

    function decayBlips(dt) {
        const fadeFactor = Math.pow(state.persistence, clamp(dt * 60, 0.4, 3));
        const nextBlips = [];
        const nextCounts = {
            realEcho: 0,
            ghost: 0,
            noise: 0
        };

        state.blips.forEach((blip) => {
            blip.life *= fadeFactor;
            if (blip.life > 0.035) {
                nextBlips.push(blip);
            }
        });

        if (nextBlips.length > state.maxBlips) {
            nextBlips.splice(0, nextBlips.length - state.maxBlips);
        }

        nextBlips.forEach((blip) => {
            nextCounts[blip.type] += 1;
        });

        state.blips = nextBlips;
        state.blipCounts = nextCounts;
    }

    function renderStaticLayer() {
        const { width, height, centerX, centerY, ringRadius, scale } = state.scene;
        const background = staticContext.createRadialGradient(centerX, centerY, ringRadius * 0.08, centerX, centerY, ringRadius * 1.18);
        background.addColorStop(0, "#10322a");
        background.addColorStop(0.48, "#081a1e");
        background.addColorStop(1, "#04090e");

        staticContext.clearRect(0, 0, width, height);
        staticContext.fillStyle = background;
        staticContext.fillRect(0, 0, width, height);

        const vignette = staticContext.createLinearGradient(0, 0, 0, height);
        vignette.addColorStop(0, "rgba(255, 255, 255, 0.05)");
        vignette.addColorStop(0.16, "rgba(255, 255, 255, 0)");
        vignette.addColorStop(1, "rgba(0, 0, 0, 0.18)");
        staticContext.fillStyle = vignette;
        staticContext.fillRect(0, 0, width, height);

        if (state.showGuides) {
            staticContext.save();
            staticContext.translate(centerX, centerY);
            staticContext.strokeStyle = "rgba(113, 222, 180, 0.2)";
            staticContext.lineWidth = 1;

            for (let radius = 100; radius <= state.radarRange; radius += 100) {
                staticContext.beginPath();
                staticContext.arc(0, 0, radius * scale, 0, TAU);
                staticContext.stroke();
            }

            for (let angle = 0; angle < TAU; angle += Math.PI / 6) {
                staticContext.beginPath();
                staticContext.moveTo(0, 0);
                staticContext.lineTo(Math.cos(angle) * ringRadius, Math.sin(angle) * ringRadius);
                staticContext.stroke();
            }
            staticContext.restore();

            const seaCanvasY = centerY + (state.seaY * scale);
            staticContext.setLineDash([8, 7]);
            staticContext.strokeStyle = "rgba(71, 199, 255, 0.54)";
            staticContext.lineWidth = 1.4;
            staticContext.beginPath();
            staticContext.moveTo(centerX - ringRadius, seaCanvasY);
            staticContext.lineTo(centerX + ringRadius, seaCanvasY);
            staticContext.stroke();
            staticContext.setLineDash([]);

            staticContext.fillStyle = "rgba(212, 239, 248, 0.82)";
            staticContext.font = "600 12px IBM Plex Sans JP";
            staticContext.fillText("sea surface model", centerX - ringRadius + 12, seaCanvasY - 10);

            for (let radius = 100; radius <= state.radarRange; radius += 100) {
                staticContext.fillStyle = "rgba(192, 231, 213, 0.44)";
                staticContext.font = "500 11px IBM Plex Sans JP";
                staticContext.fillText(`${radius}`, centerX + (radius * scale) + 8, centerY - 8);
            }
        }

        const scopeGlow = staticContext.createRadialGradient(centerX, centerY, 0, centerX, centerY, ringRadius * 0.96);
        scopeGlow.addColorStop(0, "rgba(73, 255, 175, 0.06)");
        scopeGlow.addColorStop(0.78, "rgba(73, 255, 175, 0.02)");
        scopeGlow.addColorStop(1, "rgba(73, 255, 175, 0)");
        staticContext.fillStyle = scopeGlow;
        staticContext.beginPath();
        staticContext.arc(centerX, centerY, ringRadius, 0, TAU);
        staticContext.fill();

        staticContext.strokeStyle = "rgba(141, 235, 191, 0.42)";
        staticContext.lineWidth = 2;
        staticContext.beginPath();
        staticContext.arc(centerX, centerY, ringRadius, 0, TAU);
        staticContext.stroke();

        staticContext.fillStyle = "rgba(219, 250, 236, 0.88)";
        staticContext.font = "700 13px IBM Plex Sans JP";
        staticContext.fillText("radar head", centerX + 12, centerY - 14);
        staticContext.font = "600 11px IBM Plex Sans JP";
        staticContext.fillStyle = "rgba(219, 250, 236, 0.62)";
        staticContext.fillText("returns are inferred distance, not direct ground truth", 18, height - 18);

        state.needsStaticRedraw = false;
    }

    function drawSweep() {
        const { centerX, centerY, ringRadius } = state.scene;
        const beamWidth = 0.18;

        context.save();
        context.translate(centerX, centerY);

        const beamGradient = context.createRadialGradient(0, 0, 0, 0, 0, ringRadius);
        beamGradient.addColorStop(0, "rgba(145, 255, 206, 0.34)");
        beamGradient.addColorStop(1, "rgba(145, 255, 206, 0.02)");
        context.fillStyle = beamGradient;
        context.beginPath();
        context.moveTo(0, 0);
        context.arc(0, 0, ringRadius, state.sweep - beamWidth, state.sweep, false);
        context.closePath();
        context.fill();

        context.strokeStyle = "rgba(232, 255, 242, 0.94)";
        context.lineWidth = 1.8;
        context.beginPath();
        context.moveTo(0, 0);
        context.lineTo(Math.cos(state.sweep) * ringRadius, Math.sin(state.sweep) * ringRadius);
        context.stroke();

        context.fillStyle = "rgba(145, 255, 206, 0.76)";
        context.beginPath();
        context.arc(0, 0, 4, 0, TAU);
        context.fill();

        context.restore();
    }

    function drawTargets() {
        if (!state.showTrueTargets) {
            return;
        }

        state.targets.forEach((target) => {
            const point = worldToCanvas(target.x, target.y);

            context.fillStyle = "rgba(134, 230, 110, 0.95)";
            context.beginPath();
            context.arc(point.x, point.y, 5.5, 0, TAU);
            context.fill();

            context.strokeStyle = "rgba(134, 230, 110, 0.34)";
            context.lineWidth = 1.2;
            context.beginPath();
            context.arc(point.x, point.y, 12, 0, TAU);
            context.stroke();
        });
    }

    function drawBlips() {
        state.blips.forEach((blip) => {
            const point = worldToCanvas(blip.x, blip.y);
            const radius = 2.8 + (4.4 * blip.strength);
            let color = `rgba(71, 199, 255, ${blip.life})`;

            if (blip.type === "ghost") {
                color = `rgba(255, 152, 84, ${blip.life})`;
            } else if (blip.type === "noise") {
                color = `rgba(255, 216, 74, ${blip.life})`;
            }

            context.fillStyle = color;
            context.beginPath();
            context.arc(point.x, point.y, radius, 0, TAU);
            context.fill();

            if (blip.type !== "noise" && blip.life > 0.16) {
                context.strokeStyle = color.replace(/, [0-9.]+\)$/, ", 0.18)");
                context.lineWidth = 1;
                context.beginPath();
                context.arc(point.x, point.y, radius + 5, 0, TAU);
                context.stroke();
            }
        });
    }

    function drawOverlay() {
        context.fillStyle = "rgba(228, 244, 238, 0.78)";
        context.font = "600 12px IBM Plex Sans JP";
        context.fillText("white = scan beam / blue = true echo / orange = ghost / yellow = noise", 18, 24);

        if (!state.showTrueTargets) {
            context.fillStyle = "rgba(255, 239, 198, 0.88)";
            context.fillText("real aircraft markers hidden", 18, 46);
        }
    }

    function renderFrame() {
        if (!state.scene) {
            return;
        }

        if (state.needsStaticRedraw) {
            renderStaticLayer();
        }

        context.clearRect(0, 0, state.width, state.height);
        context.drawImage(staticCanvas, 0, 0, state.width, state.height);
        drawSweep();
        drawBlips();
        drawTargets();
        drawOverlay();
    }

    function requestAnimationLoop() {
        if (state.animationId === null && state.running) {
            state.animationId = window.requestAnimationFrame(animate);
        }
    }

    function stopAnimationLoop() {
        if (state.animationId !== null) {
            window.cancelAnimationFrame(state.animationId);
            state.animationId = null;
        }
    }

    function animate(timestamp) {
        state.animationId = null;

        if (!state.scene) {
            state.scene = buildScene();
        }

        if (!state.running) {
            state.lastFrameTime = 0;
            maybeUpdateReadouts(timestamp, true);
            renderFrame();
            return;
        }

        if (!state.lastFrameTime) {
            state.lastFrameTime = timestamp;
        }

        const elapsed = timestamp - state.lastFrameTime;
        if (elapsed < FRAME_INTERVAL) {
            requestAnimationLoop();
            return;
        }

        const dt = clamp(elapsed / 1000, 0.001, 0.05);
        state.lastFrameTime = timestamp;

        state.motionTime += dt;
        updateTargets(dt * 60);
        performScan(dt);
        decayBlips(dt);
        state.sweep += state.sweepRate * 0.9 * dt;
        if (state.sweep > TAU) {
            state.sweep -= TAU;
        }

        maybeUpdateReadouts(timestamp, false);
        renderFrame();
        requestAnimationLoop();
    }

    function applyPreset(presetName) {
        if (presetName === "calm") {
            dom.noiseRange.value = "0.10";
            dom.seaRange.value = "0.22";
            dom.persistenceRange.value = "0.90";
            dom.sweepRange.value = "1.00";
            dom.multipathToggle.checked = true;
            dom.ductingToggle.checked = false;
            setStatus("海面反射とノイズを抑えたので、本物の反射が見分けやすい穏やかな条件です。");
        } else {
            dom.noiseRange.value = "0.34";
            dom.seaRange.value = "0.78";
            dom.persistenceRange.value = "0.95";
            dom.sweepRange.value = "0.92";
            dom.multipathToggle.checked = true;
            dom.ductingToggle.checked = true;
            setStatus("海面反射とノイズを強めました。鏡像ゴーストと遠距離誤検出が見えやすい条件です。");
        }

        syncStateFromControls();
        state.needsStaticRedraw = true;
        updateReadouts(true);
        renderFrame();
    }

    dom.playPause.addEventListener("click", () => {
        state.running = !state.running;
        dom.playPause.textContent = state.running ? "一時停止" : "再開";
        state.lastFrameTime = 0;
        setStatus(state.running ? "走査を再開しました。反射の残り方に注目してください。" : "走査を止めました。残っている点が追跡の名残です。");

        if (state.running) {
            requestAnimationLoop();
        } else {
            stopAnimationLoop();
            renderFrame();
        }

        updateReadouts(true);
    });

    dom.reset.addEventListener("click", () => {
        resetTargets();
        setStatus("目標配置を初期化しました。1 周まわしてから海面反射やノイズを動かすと差が見えやすいです。");
        updateReadouts(true);
        renderFrame();

        if (state.running) {
            requestAnimationLoop();
        }
    });

    dom.calmSea.addEventListener("click", () => {
        applyPreset("calm");
    });

    dom.roughSea.addEventListener("click", () => {
        applyPreset("rough");
    });

    [dom.noiseRange, dom.seaRange, dom.persistenceRange, dom.sweepRange].forEach((element) => {
        element.addEventListener("input", () => {
            syncStateFromControls();
            updateReadouts(true);
            renderFrame();
        });
    });

    [dom.multipathToggle, dom.ductingToggle, dom.showTrueToggle, dom.showGuidesToggle].forEach((element) => {
        element.addEventListener("change", () => {
            syncStateFromControls();
            if (element === dom.showGuidesToggle) {
                state.needsStaticRedraw = true;
            }
            updateReadouts(true);
            renderFrame();
        });
    });

    dom.togglePanel.addEventListener("click", () => {
        setPanelVisibility(true);
    });

    dom.showPanel.addEventListener("click", () => {
        setPanelVisibility(false);
    });

    window.addEventListener("resize", () => {
        resizeCanvas();
        updateReadouts(true);
        renderFrame();
    });

    document.addEventListener("visibilitychange", () => {
        state.lastFrameTime = 0;

        if (document.hidden) {
            stopAnimationLoop();
            return;
        }

        if (state.running) {
            requestAnimationLoop();
        } else {
            renderFrame();
        }
    });

    syncStateFromControls();
    resizeCanvas();
    resetTargets();
    updateReadouts(true);
    renderFrame();
    requestAnimationLoop();
})();