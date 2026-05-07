(() => {
    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            }
        }
    }, { threshold: 0.16 });

    document.querySelectorAll('.reveal, .site-footer').forEach((el) => observer.observe(el));

    const canvas = document.getElementById('engineCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const speedRange = document.getElementById('speedRange');
    const speedVal = document.getElementById('speedVal');
    const statPhase = document.getElementById('statPhase');
    const statAngle = document.getElementById('statAngle');
    const statPiston = document.getElementById('statPiston');
    const statValve = document.getElementById('statValve');
    const narration = document.getElementById('demoNarration');
    const presetRow = document.getElementById('presetRow');

    const presets = {
        study: {
            speed: 0.7,
            note: 'まずは遅めにして、吸気と排気でどちらのバルブが開くか、燃焼でどこに火花が出るかを追ってください。'
        },
        normal: {
            speed: 1.4,
            note: '標準速度では 4 工程の切り替わりがテンポよく見えます。工程名とクランク角の対応を確かめやすい設定です。'
        },
        fast: {
            speed: 2.5,
            note: '高速では各工程の切り替わりが速く、実機に近い連続運転の印象が強まります。下の進行バーを見ると迷いにくくなります。'
        }
    };

    const tau = Math.PI * 2;
    const cycleAngleMax = Math.PI * 4;
    let angle = 0;
    let viewport = { width: 820, height: 560, dpr: 1 };

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function roundedRectPathOn(context, x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        context.beginPath();
        context.moveTo(x + r, y);
        context.lineTo(x + width - r, y);
        context.quadraticCurveTo(x + width, y, x + width, y + r);
        context.lineTo(x + width, y + height - r);
        context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
        context.lineTo(x + r, y + height);
        context.quadraticCurveTo(x, y + height, x, y + height - r);
        context.lineTo(x, y + r);
        context.quadraticCurveTo(x, y, x + r, y);
        context.closePath();
    }

    function roundedRectPath(x, y, width, height, radius) {
        roundedRectPathOn(ctx, x, y, width, height, radius);
    }

    function resizeSurface(canvasEl, context, maxWidth, desktopRatio, mobileRatio, minHeight, maxHeight) {
        const parentWidth = canvasEl.parentElement.clientWidth;
        const cssWidth = Math.min(parentWidth, maxWidth);
        const mobile = window.innerWidth < 720;
        const cssHeight = mobile
            ? clamp(window.innerHeight * mobileRatio, minHeight, maxHeight)
            : clamp(cssWidth * desktopRatio, minHeight, maxHeight);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        canvasEl.style.width = `${cssWidth}px`;
        canvasEl.style.height = `${cssHeight}px`;
        canvasEl.width = Math.round(cssWidth * dpr);
        canvasEl.height = Math.round(cssHeight * dpr);
        context.setTransform(dpr, 0, 0, dpr, 0, 0);

        return { width: cssWidth, height: cssHeight, dpr };
    }

    function resizeCanvas() {
        viewport = resizeSurface(canvas, ctx, 820, 0.68, 0.52, 380, 560);
    }

    function currentPhase(cycle) {
        if (cycle < 0.25) {
            return {
                id: 'intake',
                name: '吸気',
                description: '吸気バルブが開き、空気と燃料の混合気を吸い込みます。',
                gasColor: 'rgba(85, 170, 255, 0.34)',
                intakeOpen: true,
                exhaustOpen: false,
                spark: false
            };
        }
        if (cycle < 0.5) {
            return {
                id: 'compression',
                name: '圧縮',
                description: 'バルブを閉じ、混合気を上へ押し上げて圧縮します。',
                gasColor: 'rgba(240, 197, 82, 0.28)',
                intakeOpen: false,
                exhaustOpen: false,
                spark: false
            };
        }
        if (cycle < 0.75) {
            return {
                id: 'power',
                name: '燃焼・膨張',
                description: '上死点付近で点火し、膨張したガスがピストンを押し下げます。',
                gasColor: 'rgba(255, 106, 45, 0.42)',
                intakeOpen: false,
                exhaustOpen: false,
                spark: cycle < 0.56
            };
        }
        return {
            id: 'exhaust',
            name: '排気',
            description: '排気バルブが開き、燃焼後のガスをシリンダー外へ押し出します。',
            gasColor: 'rgba(164, 173, 180, 0.32)',
            intakeOpen: false,
            exhaustOpen: true,
            spark: false
        };
    }

    function pistonDisplacement(theta, crankRadius, rodLength) {
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        const pinDistance = crankRadius * cosTheta + Math.sqrt(Math.max(rodLength * rodLength - (crankRadius * sinTheta) ** 2, 0));
        return (crankRadius + rodLength) - pinDistance;
    }

    function pistonLabel(progress) {
        if (progress < 0.18) return '上死点付近';
        if (progress < 0.4) return '上側';
        if (progress < 0.62) return '中央';
        if (progress < 0.84) return '下側';
        return '下死点付近';
    }

    function valveLabel(phase) {
        const intake = phase.intakeOpen ? '吸気 開' : '吸気 閉';
        const exhaust = phase.exhaustOpen ? '排気 開' : '排気 閉';
        return `${intake} / ${exhaust}`;
    }

    function setStats(phase, cycle, pistonProgress) {
        speedVal.textContent = parseFloat(speedRange.value).toFixed(1);
        statPhase.textContent = phase.name;
        statAngle.textContent = `${Math.round(cycle * 720)}° / 720°`;
        statPiston.textContent = pistonLabel(pistonProgress);
        statValve.textContent = valveLabel(phase);
        narration.textContent = phase.description;
    }

    function drawScene() {
        const width = viewport.width;
        const height = viewport.height;
        const speed = parseFloat(speedRange.value);
        angle += 0.025 * speed;

        const cycleAngle = ((angle % cycleAngleMax) + cycleAngleMax) % cycleAngleMax;
        const cycle = cycleAngle / cycleAngleMax;
        const phase = currentPhase(cycle);
        const titleY = 42;
        const descriptionY = 70;
        const textBandBottom = 90;
        const diagramGap = width < 700 ? 42 : 52;

        const cx = width * 0.49;
        const cylinderTop = Math.max(height * 0.18, textBandBottom + diagramGap);
        const cylinderBottom = height * 0.67;
        const cylinderWidth = width * 0.22;
        const crankCenterY = height * 0.79;
        const crankRadius = Math.min(width, height) * 0.11;
        const rodLength = crankRadius * 2.2;
        const theta = angle;
        const pistonTravel = pistonDisplacement(theta, crankRadius, rodLength);
        const pistonTravelMax = crankRadius * 2;
        const pistonProgress = clamp(pistonTravel / pistonTravelMax, 0, 1);
        const pistonY = lerp(cylinderTop + 24, cylinderBottom - 56, pistonProgress);
        const crankX = cx + Math.sin(theta) * crankRadius;
        const crankY = crankCenterY + Math.cos(theta) * crankRadius;
        const localPhase = (cycle * 4) % 1;

        setStats(phase, cycle, pistonProgress);

        ctx.clearRect(0, 0, width, height);

        const background = ctx.createLinearGradient(0, 0, 0, height);
        background.addColorStop(0, '#171d23');
        background.addColorStop(1, '#0f1318');
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
        for (let x = 0; x < width; x += 28) {
            ctx.fillRect(x, 0, 1, height);
        }

        ctx.fillStyle = '#fff6ef';
        ctx.font = '700 27px IBM Plex Sans JP';
        ctx.fillText(`①②③④ ${phase.name}`, 36, titleY);
        ctx.font = '16px IBM Plex Sans JP';
        ctx.fillStyle = 'rgba(255, 246, 239, 0.82)';
        ctx.fillText(phase.description, 36, descriptionY);

        ctx.strokeStyle = '#d7e0e8';
        ctx.lineWidth = 4;
        roundedRectPath(cx - cylinderWidth / 2, cylinderTop, cylinderWidth, cylinderBottom - cylinderTop, 18);
        ctx.stroke();

        ctx.fillStyle = phase.gasColor;
        roundedRectPath(cx - cylinderWidth / 2 + 6, cylinderTop + 6, cylinderWidth - 12, Math.max(0, pistonY - cylinderTop - 2), 14);
        ctx.fill();

        if (phase.id === 'power') {
            const combustionGlow = ctx.createRadialGradient(cx, cylinderTop + 42, 6, cx, cylinderTop + 42, 76);
            combustionGlow.addColorStop(0, 'rgba(255, 232, 126, 0.72)');
            combustionGlow.addColorStop(0.5, 'rgba(255, 121, 53, 0.28)');
            combustionGlow.addColorStop(1, 'rgba(255, 121, 53, 0)');
            ctx.fillStyle = combustionGlow;
            ctx.fillRect(cx - cylinderWidth / 2, cylinderTop, cylinderWidth, 120);
        }

        ctx.fillStyle = '#a7b2bb';
        roundedRectPath(cx - cylinderWidth * 0.42, pistonY, cylinderWidth * 0.84, 34, 10);
        ctx.fill();
        ctx.fillStyle = '#dfe6ea';
        ctx.fillRect(cx - cylinderWidth * 0.38, pistonY + 7, cylinderWidth * 0.76, 6);

        ctx.strokeStyle = '#d8e1e8';
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.moveTo(cx, pistonY + 34);
        ctx.lineTo(crankX, crankY);
        ctx.stroke();

        ctx.strokeStyle = '#8b98a5';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(cx, crankCenterY, crankRadius, 0, tau);
        ctx.stroke();

        ctx.strokeStyle = '#f0b56d';
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(cx, crankCenterY);
        ctx.lineTo(crankX, crankY);
        ctx.stroke();
        ctx.fillStyle = '#f0b56d';
        ctx.beginPath();
        ctx.arc(crankX, crankY, 8, 0, tau);
        ctx.fill();

        const intakeValveX = cx - cylinderWidth * 0.34;
        const exhaustValveX = cx + cylinderWidth * 0.14;
        const valveBaseY = cylinderTop - 32;
        const valveDrop = phase.intakeOpen || phase.exhaustOpen ? 12 : 0;

        ctx.fillStyle = phase.intakeOpen ? '#55aaff' : '#48535d';
        roundedRectPath(intakeValveX, valveBaseY + (phase.intakeOpen ? 10 : 0), 36, 22, 8);
        ctx.fill();
        ctx.fillStyle = '#fff6ef';
        ctx.font = '13px IBM Plex Sans JP';
        ctx.fillText('吸気', intakeValveX - 2, valveBaseY - 10);

        ctx.fillStyle = phase.exhaustOpen ? '#a4adb4' : '#48535d';
        roundedRectPath(exhaustValveX, valveBaseY + (phase.exhaustOpen ? 10 : 0), 36, 22, 8);
        ctx.fill();
        ctx.fillStyle = '#fff6ef';
        ctx.fillText('排気', exhaustValveX - 2, valveBaseY - 10);

        if (phase.intakeOpen) {
            ctx.strokeStyle = 'rgba(85, 170, 255, 0.88)';
            ctx.lineWidth = 3;
            for (let i = 0; i < 5; i += 1) {
                ctx.beginPath();
                ctx.moveTo(intakeValveX - 48 - i * 14, valveBaseY + 12 + i * 4);
                ctx.lineTo(intakeValveX + 4, valveBaseY + 18 + i * 2 + valveDrop * 0.4);
                ctx.stroke();
            }
        }

        if (phase.exhaustOpen) {
            ctx.strokeStyle = 'rgba(188, 196, 202, 0.85)';
            ctx.lineWidth = 3;
            for (let i = 0; i < 5; i += 1) {
                ctx.beginPath();
                ctx.moveTo(exhaustValveX + 34, valveBaseY + 16 + i * 2 + valveDrop * 0.4);
                ctx.lineTo(exhaustValveX + 84 + i * 14, valveBaseY + 8 + i * 4);
                ctx.stroke();
            }
        }

        ctx.strokeStyle = '#f1efe6';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(cx, valveBaseY - 8);
        ctx.lineTo(cx, cylinderTop + 6);
        ctx.stroke();
        ctx.fillStyle = '#fff6ef';
        ctx.font = '13px IBM Plex Sans JP';
        ctx.fillText('点火プラグ', cx - 34, valveBaseY - 22);

        if (phase.spark && localPhase < 0.22) {
            ctx.strokeStyle = '#fff27c';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(cx - 10, cylinderTop + 18);
            ctx.lineTo(cx + 5, cylinderTop + 34);
            ctx.lineTo(cx - 7, cylinderTop + 49);
            ctx.lineTo(cx + 15, cylinderTop + 67);
            ctx.stroke();
        }

        const barX = width * 0.1;
        const barY = height * 0.91;
        const barW = width * 0.78;
        const barH = 16;

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.88)';
        ctx.lineWidth = 1.2;
        roundedRectPath(barX, barY, barW, barH, 8);
        ctx.stroke();

        const colors = ['#55aaff', '#f0c552', '#ff6a2d', '#a4adb4'];
        for (let i = 0; i < 4; i += 1) {
            ctx.fillStyle = colors[i];
            ctx.fillRect(barX + (barW / 4) * i, barY, barW / 4, barH);
        }

        ctx.fillStyle = '#fff6ef';
        ctx.font = '13px IBM Plex Sans JP';
        ctx.fillText('吸気', barX + 36, barY - 10);
        ctx.fillText('圧縮', barX + barW * 0.25 + 28, barY - 10);
        ctx.fillText('燃焼', barX + barW * 0.5 + 28, barY - 10);
        ctx.fillText('排気', barX + barW * 0.75 + 34, barY - 10);

        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(barX + barW * cycle, barY + barH / 2, 8, 0, tau);
        ctx.fill();

        requestAnimationFrame(drawScene);
    }

    function applyPreset(key) {
        const preset = presets[key];
        if (!preset) return;

        speedRange.value = preset.speed.toFixed(1);
        speedVal.textContent = preset.speed.toFixed(1);
        narration.textContent = preset.note;
        presetRow.querySelectorAll('.preset-chip').forEach((chip) => {
            chip.classList.toggle('is-active', chip.dataset.preset === key);
        });
    }

    presetRow.addEventListener('click', (event) => {
        const target = event.target.closest('[data-preset]');
        if (target) applyPreset(target.dataset.preset);
    });

    speedRange.addEventListener('input', () => {
        speedVal.textContent = parseFloat(speedRange.value).toFixed(1);
        presetRow.querySelectorAll('.preset-chip').forEach((chip) => chip.classList.remove('is-active'));
    });

    function setupStirlingDemo() {
        const stirlingCanvas = document.getElementById('stirlingCanvas');
        if (!stirlingCanvas) return;

        const stirlingCtx = stirlingCanvas.getContext('2d');
        const stirlingSpeedRange = document.getElementById('stirlingSpeedRange');
        const stirlingTempGapRange = document.getElementById('stirlingTempGapRange');
        const stirlingRegenRange = document.getElementById('stirlingRegenRange');
        const stirlingSpeedVal = document.getElementById('stirlingSpeedVal');
        const stirlingTempGapVal = document.getElementById('stirlingTempGapVal');
        const stirlingRegenVal = document.getElementById('stirlingRegenVal');
        const stirlingPhase = document.getElementById('stirlingPhase');
        const stirlingTemp = document.getElementById('stirlingTemp');
        const stirlingPressure = document.getElementById('stirlingPressure');
        const stirlingGasShift = document.getElementById('stirlingGasShift');
        const stirlingPhaseOffset = document.getElementById('stirlingPhaseOffset');
        const stirlingEfficiency = document.getElementById('stirlingEfficiency');
        const stirlingNarration = document.getElementById('stirlingNarration');
        const stirlingPresetRow = document.getElementById('stirlingPresetRow');

        if (
            !stirlingCtx ||
            !stirlingSpeedRange ||
            !stirlingTempGapRange ||
            !stirlingRegenRange ||
            !stirlingSpeedVal ||
            !stirlingTempGapVal ||
            !stirlingRegenVal ||
            !stirlingPhase ||
            !stirlingTemp ||
            !stirlingPressure ||
            !stirlingGasShift ||
            !stirlingPhaseOffset ||
            !stirlingEfficiency ||
            !stirlingNarration ||
            !stirlingPresetRow
        ) {
            return;
        }

        const presets = {
            observe: { speed: 0.8, gap: 260, regen: 76 },
            efficient: { speed: 1.2, gap: 430, regen: 94 },
            'small-gap': { speed: 0.9, gap: 150, regen: 48 }
        };

        const coldTemp = 300;
        const phaseLag = Math.PI / 2;
        let stirlingAngle = 0;
        let stirlingViewport = { width: 820, height: 520, dpr: 1 };

        function resizeStirlingCanvas() {
            stirlingViewport = resizeSurface(stirlingCanvas, stirlingCtx, 820, 0.63, 0.48, 360, 520);
        }

        function currentStirlingPhase(cycle) {
            if (cycle < 0.25) {
                return {
                    name: '熱い側へ移動',
                    shortNote: '気体が熱い側へ寄り、温度と圧力が上がり始めます。',
                    note: 'ディスプレーサが気体を熱い側へ寄せ始めると、有効温度と圧力が上がり、膨張の準備が進みます。',
                    arrowDirection: -1
                };
            }
            if (cycle < 0.5) {
                return {
                    name: '等温膨張に近い押し出し',
                    shortNote: '高温側に寄った気体が膨張し、仕事ピストンを押します。',
                    note: '高温側に寄った気体が膨張し、パワーピストンを押して仕事を取り出します。',
                    arrowDirection: 0
                };
            }
            if (cycle < 0.75) {
                return {
                    name: '冷たい側へ移動',
                    shortNote: '気体が冷たい側へ送られ、圧力が下がる準備に入ります。',
                    note: 'ディスプレーサが気体を冷たい側へ送り、内部圧力が下がる準備に入ります。',
                    arrowDirection: 1
                };
            }
            return {
                name: '等温圧縮に近い戻り',
                shortNote: '冷えた気体が収縮し、フライホイール慣性で戻ります。',
                note: '冷えた気体が収縮し、圧力が下がったところをフライホイール慣性が受け持ってピストンが戻ります。',
                arrowDirection: 0
            };
        }

        function updateStirlingControlLabels() {
            stirlingSpeedVal.textContent = parseFloat(stirlingSpeedRange.value).toFixed(1);
            stirlingTempGapVal.textContent = `${Math.round(parseFloat(stirlingTempGapRange.value))} K`;
            stirlingRegenVal.textContent = `${Math.round(parseFloat(stirlingRegenRange.value))} %`;
        }

        function applyStirlingPreset(key) {
            const preset = presets[key];
            if (!preset) return;

            stirlingSpeedRange.value = preset.speed.toFixed(1);
            stirlingTempGapRange.value = `${preset.gap}`;
            stirlingRegenRange.value = `${preset.regen}`;
            updateStirlingControlLabels();
            stirlingPresetRow.querySelectorAll('.preset-chip').forEach((chip) => {
                chip.classList.toggle('is-active', chip.dataset.stirlingPreset === key);
            });
        }

        function drawStirlingScene() {
            const width = stirlingViewport.width;
            const height = stirlingViewport.height;
            const speed = parseFloat(stirlingSpeedRange.value);
            const tempGap = parseFloat(stirlingTempGapRange.value);
            const regen = parseFloat(stirlingRegenRange.value) / 100;
            stirlingAngle += 0.018 * speed;

            const cycle = ((stirlingAngle % tau) + tau) % tau / tau;
            const phase = currentStirlingPhase(cycle);
            const displacerProgress = 0.5 + 0.5 * Math.sin(stirlingAngle);
            const displacerW = width * 0.16;
            const displacerHotFraction = clamp(1 - displacerProgress * 0.9, 0.08, 0.92);
            const hotTemp = coldTemp + tempGap;
            const thermalRetention = 0.62 + regen * 0.34;
            const effectiveTemp = coldTemp + tempGap * displacerHotFraction * thermalRetention;
            const pistonProgress = 0.5 + 0.5 * Math.sin(stirlingAngle - phaseLag);
            const volumeFactor = 0.82 + pistonProgress * 0.42;
            const pressureRatio = (effectiveTemp / coldTemp) / volumeFactor;
            const pressureNormalized = clamp((pressureRatio - 0.75) / 0.95, 0, 1);
            const efficiency = clamp((1 - coldTemp / hotTemp) * (0.58 + regen * 0.38), 0, 0.85);

            updateStirlingControlLabels();
            stirlingPhase.textContent = phase.name;
            stirlingTemp.textContent = `${Math.round(effectiveTemp)} K`;
            stirlingPressure.textContent = `${pressureRatio.toFixed(2)} ×`;
            stirlingGasShift.textContent = `高温側 ${Math.round(displacerHotFraction * 100)} %`;
            stirlingPhaseOffset.textContent = '90°';
            stirlingEfficiency.textContent = `${Math.round(efficiency * 100)} %`;
            stirlingNarration.textContent = phase.note;

            stirlingCtx.clearRect(0, 0, width, height);

            const background = stirlingCtx.createLinearGradient(0, 0, 0, height);
            background.addColorStop(0, '#171d23');
            background.addColorStop(1, '#0f1318');
            stirlingCtx.fillStyle = background;
            stirlingCtx.fillRect(0, 0, width, height);

            stirlingCtx.fillStyle = 'rgba(255, 255, 255, 0.04)';
            for (let x = 0; x < width; x += 28) {
                stirlingCtx.fillRect(x, 0, 1, height);
            }

            stirlingCtx.fillStyle = '#fff6ef';
            stirlingCtx.font = '700 27px IBM Plex Sans JP';
            stirlingCtx.fillText(`スターリング: ${phase.name}`, 36, 42);
            stirlingCtx.font = '16px IBM Plex Sans JP';
            stirlingCtx.fillStyle = 'rgba(255, 246, 239, 0.82)';
            stirlingCtx.fillText(phase.shortNote, 36, 70);

            const chamberX = width * 0.12;
            const chamberY = Math.max(height * 0.22, 144);
            const chamberW = width * 0.46;
            const chamberH = height * 0.2;
            const regX = chamberX + chamberW * 0.46;
            const regW = chamberW * 0.08;
            const displacerH = chamberH * 0.72;
            const displacerX = lerp(chamberX + 18, chamberX + chamberW - displacerW - 18, displacerProgress);
            const displacerY = chamberY + (chamberH - displacerH) / 2;
            const powerCylinderX = width * 0.71;
            const powerCylinderY = chamberY + 6;
            const powerCylinderW = width * 0.12;
            const powerCylinderH = height * 0.32;
            const pistonY = lerp(powerCylinderY + 18, powerCylinderY + powerCylinderH - 58, pistonProgress);
            const flywheelX = width * 0.73;
            const flywheelY = height * 0.79;
            const flywheelR = Math.min(width, height) * 0.1;
            const powerAngle = stirlingAngle - phaseLag;
            const powerPinX = flywheelX + Math.cos(powerAngle) * flywheelR;
            const powerPinY = flywheelY + Math.sin(powerAngle) * flywheelR;
            const displacerPinX = flywheelX + Math.cos(stirlingAngle) * flywheelR * 0.72;
            const displacerPinY = flywheelY + Math.sin(stirlingAngle) * flywheelR * 0.72;

            roundedRectPathOn(stirlingCtx, chamberX, chamberY, chamberW, chamberH, 24);
            stirlingCtx.fillStyle = 'rgba(24, 30, 37, 0.95)';
            stirlingCtx.fill();

            stirlingCtx.save();
            roundedRectPathOn(stirlingCtx, chamberX, chamberY, chamberW, chamberH, 24);
            stirlingCtx.clip();

            const hotGlow = stirlingCtx.createLinearGradient(chamberX, 0, chamberX + chamberW * 0.5, 0);
            hotGlow.addColorStop(0, `rgba(255, 123, 69, ${0.18 + displacerHotFraction * 0.42})`);
            hotGlow.addColorStop(1, 'rgba(255, 123, 69, 0.02)');
            stirlingCtx.fillStyle = hotGlow;
            stirlingCtx.fillRect(chamberX, chamberY, chamberW * 0.5, chamberH);

            const coldGlow = stirlingCtx.createLinearGradient(chamberX + chamberW, 0, chamberX + chamberW * 0.5, 0);
            coldGlow.addColorStop(0, `rgba(104, 183, 255, ${0.18 + (1 - displacerHotFraction) * 0.42})`);
            coldGlow.addColorStop(1, 'rgba(104, 183, 255, 0.02)');
            stirlingCtx.fillStyle = coldGlow;
            stirlingCtx.fillRect(chamberX + chamberW * 0.5, chamberY, chamberW * 0.5, chamberH);

            stirlingCtx.fillStyle = 'rgba(255, 255, 255, 0.05)';
            for (let i = 0; i < 12; i += 1) {
                const px = chamberX + 28 + (i % 6) * ((chamberW - 56) / 5);
                const py = chamberY + 28 + Math.floor(i / 6) * 40;
                stirlingCtx.beginPath();
                stirlingCtx.arc(px, py, 3 + (i % 3), 0, tau);
                stirlingCtx.fill();
            }
            stirlingCtx.restore();

            roundedRectPathOn(stirlingCtx, regX, chamberY + 8, regW, chamberH - 16, 10);
            stirlingCtx.fillStyle = 'rgba(255, 207, 123, 0.28)';
            stirlingCtx.fill();
            stirlingCtx.strokeStyle = 'rgba(255, 207, 123, 0.6)';
            stirlingCtx.lineWidth = 1.2;
            for (let y = chamberY + 14; y < chamberY + chamberH - 10; y += 10) {
                stirlingCtx.beginPath();
                stirlingCtx.moveTo(regX + 4, y);
                stirlingCtx.lineTo(regX + regW - 4, y);
                stirlingCtx.stroke();
            }

            roundedRectPathOn(stirlingCtx, displacerX, displacerY, displacerW, displacerH, 16);
            stirlingCtx.fillStyle = 'rgba(200, 210, 216, 0.88)';
            stirlingCtx.fill();
            stirlingCtx.fillStyle = 'rgba(27, 35, 41, 0.52)';
            stirlingCtx.fillRect(displacerX + displacerW * 0.18, displacerY + 10, displacerW * 0.64, displacerH - 20);

            stirlingCtx.strokeStyle = '#d7e0e8';
            stirlingCtx.lineWidth = 4;
            roundedRectPathOn(stirlingCtx, powerCylinderX, powerCylinderY, powerCylinderW, powerCylinderH, 18);
            stirlingCtx.stroke();

            stirlingCtx.fillStyle = 'rgba(104, 183, 255, 0.12)';
            stirlingCtx.fillRect(powerCylinderX + 6, powerCylinderY + 6, powerCylinderW - 12, powerCylinderH - 12);

            roundedRectPathOn(stirlingCtx, powerCylinderX + 8, pistonY, powerCylinderW - 16, 34, 10);
            stirlingCtx.fillStyle = '#b4c0c8';
            stirlingCtx.fill();
            stirlingCtx.fillStyle = '#e3eaee';
            stirlingCtx.fillRect(powerCylinderX + 14, pistonY + 8, powerCylinderW - 28, 6);

            stirlingCtx.strokeStyle = '#d8e1e8';
            stirlingCtx.lineWidth = 8;
            stirlingCtx.beginPath();
            stirlingCtx.moveTo(powerCylinderX + powerCylinderW / 2, pistonY + 34);
            stirlingCtx.lineTo(powerPinX, powerPinY);
            stirlingCtx.stroke();

            stirlingCtx.strokeStyle = '#d8e1e8';
            stirlingCtx.lineWidth = 6;
            stirlingCtx.beginPath();
            stirlingCtx.moveTo(displacerX + displacerW / 2, displacerY + displacerH / 2);
            stirlingCtx.lineTo(displacerX + displacerW / 2, chamberY + chamberH + 18);
            stirlingCtx.lineTo(displacerPinX, displacerPinY);
            stirlingCtx.stroke();

            stirlingCtx.strokeStyle = '#8b98a5';
            stirlingCtx.lineWidth = 4;
            stirlingCtx.beginPath();
            stirlingCtx.arc(flywheelX, flywheelY, flywheelR, 0, tau);
            stirlingCtx.stroke();

            stirlingCtx.strokeStyle = '#f0b56d';
            stirlingCtx.lineWidth = 6;
            stirlingCtx.beginPath();
            stirlingCtx.moveTo(flywheelX, flywheelY);
            stirlingCtx.lineTo(powerPinX, powerPinY);
            stirlingCtx.stroke();
            stirlingCtx.fillStyle = '#f0b56d';
            stirlingCtx.beginPath();
            stirlingCtx.arc(powerPinX, powerPinY, 7, 0, tau);
            stirlingCtx.fill();

            stirlingCtx.strokeStyle = '#68b7ff';
            stirlingCtx.lineWidth = 4;
            stirlingCtx.beginPath();
            stirlingCtx.moveTo(flywheelX, flywheelY);
            stirlingCtx.lineTo(displacerPinX, displacerPinY);
            stirlingCtx.stroke();
            stirlingCtx.fillStyle = '#68b7ff';
            stirlingCtx.beginPath();
            stirlingCtx.arc(displacerPinX, displacerPinY, 5, 0, tau);
            stirlingCtx.fill();

            const hotLabelX = chamberX + chamberW * 0.12;
            const coldLabelX = chamberX + chamberW * 0.72;
            stirlingCtx.fillStyle = '#fff6ef';
            stirlingCtx.font = '13px IBM Plex Sans JP';
            stirlingCtx.fillText('高温側', hotLabelX, chamberY - 14);
            stirlingCtx.fillText('低温側', coldLabelX, chamberY - 14);
            stirlingCtx.fillText('レジェネレータ', regX - 18, chamberY + chamberH + 26);
            stirlingCtx.fillText('パワーピストン', powerCylinderX - 8, powerCylinderY - 14);
            stirlingCtx.fillText('位相差 90°', flywheelX - 38, flywheelY + flywheelR + 28);

            stirlingCtx.fillStyle = 'rgba(255, 123, 69, 0.88)';
            stirlingCtx.beginPath();
            stirlingCtx.moveTo(chamberX + 46, chamberY + chamberH + 34);
            stirlingCtx.lineTo(chamberX + 58, chamberY + chamberH + 8);
            stirlingCtx.lineTo(chamberX + 70, chamberY + chamberH + 34);
            stirlingCtx.closePath();
            stirlingCtx.fill();
            stirlingCtx.beginPath();
            stirlingCtx.moveTo(chamberX + 58, chamberY + chamberH + 4);
            stirlingCtx.lineTo(chamberX + 66, chamberY + chamberH - 16);
            stirlingCtx.lineTo(chamberX + 74, chamberY + chamberH + 4);
            stirlingCtx.closePath();
            stirlingCtx.fill();

            stirlingCtx.strokeStyle = 'rgba(104, 183, 255, 0.88)';
            stirlingCtx.lineWidth = 2.2;
            const snowX = chamberX + chamberW - 56;
            const snowY = chamberY + chamberH + 20;
            for (let i = 0; i < 3; i += 1) {
                stirlingCtx.beginPath();
                stirlingCtx.moveTo(snowX - 12 + i * 12, snowY - 12);
                stirlingCtx.lineTo(snowX - 12 + i * 12, snowY + 12);
                stirlingCtx.moveTo(snowX - 24 + i * 12, snowY);
                stirlingCtx.lineTo(snowX + i * 12, snowY);
                stirlingCtx.stroke();
            }

            if (phase.arrowDirection !== 0) {
                stirlingCtx.strokeStyle = 'rgba(255, 244, 214, 0.84)';
                stirlingCtx.lineWidth = 2.4;
                for (let i = 0; i < 3; i += 1) {
                    const baseY = chamberY + 34 + i * 22;
                    const startX = phase.arrowDirection < 0 ? chamberX + chamberW * 0.66 : chamberX + chamberW * 0.2;
                    const endX = phase.arrowDirection < 0 ? chamberX + chamberW * 0.2 : chamberX + chamberW * 0.66;
                    stirlingCtx.beginPath();
                    stirlingCtx.moveTo(startX, baseY);
                    stirlingCtx.lineTo(endX, baseY);
                    stirlingCtx.stroke();
                    stirlingCtx.beginPath();
                    stirlingCtx.moveTo(endX, baseY);
                    stirlingCtx.lineTo(endX - phase.arrowDirection * 10, baseY - 6);
                    stirlingCtx.lineTo(endX - phase.arrowDirection * 10, baseY + 6);
                    stirlingCtx.closePath();
                    stirlingCtx.fillStyle = 'rgba(255, 244, 214, 0.84)';
                    stirlingCtx.fill();
                }
            }

            const pressureBarX = width * 0.1;
            const pressureBarY = height * 0.88;
            const pressureBarW = width * 0.34;
            const pressureBarH = 16;
            roundedRectPathOn(stirlingCtx, pressureBarX, pressureBarY, pressureBarW, pressureBarH, 8);
            stirlingCtx.fillStyle = 'rgba(255, 255, 255, 0.06)';
            stirlingCtx.fill();

            const pressureFill = stirlingCtx.createLinearGradient(pressureBarX, 0, pressureBarX + pressureBarW, 0);
            pressureFill.addColorStop(0, '#68b7ff');
            pressureFill.addColorStop(1, '#ff7b45');
            stirlingCtx.fillStyle = pressureFill;
            roundedRectPathOn(stirlingCtx, pressureBarX, pressureBarY, pressureBarW * pressureNormalized, pressureBarH, 8);
            stirlingCtx.fill();

            stirlingCtx.fillStyle = '#fff6ef';
            stirlingCtx.font = '13px IBM Plex Sans JP';
            stirlingCtx.fillText('内部圧力', pressureBarX, pressureBarY - 10);
            stirlingCtx.fillText(`効率 ≈ ${Math.round(efficiency * 100)} %`, pressureBarX + pressureBarW + 20, pressureBarY + 13);

            requestAnimationFrame(drawStirlingScene);
        }

        stirlingPresetRow.addEventListener('click', (event) => {
            const target = event.target.closest('[data-stirling-preset]');
            if (target) applyStirlingPreset(target.dataset.stirlingPreset);
        });

        [stirlingSpeedRange, stirlingTempGapRange, stirlingRegenRange].forEach((input) => {
            input.addEventListener('input', () => {
                updateStirlingControlLabels();
                stirlingPresetRow.querySelectorAll('.preset-chip').forEach((chip) => chip.classList.remove('is-active'));
            });
        });

        window.addEventListener('resize', resizeStirlingCanvas);

        resizeStirlingCanvas();
        applyStirlingPreset('observe');
        drawStirlingScene();
    }

    window.addEventListener('resize', resizeCanvas);

    resizeCanvas();
    applyPreset('study');
    setupStirlingDemo();
    drawScene();
})();