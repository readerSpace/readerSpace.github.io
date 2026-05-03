(() => {
    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            }
        }
    }, { threshold: 0.18 });

    document.querySelectorAll('.reveal, .site-footer').forEach((element) => observer.observe(element));

    const canvas = document.getElementById('microwaveCanvas');
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    const modeRow = document.getElementById('modeRow');
    const primaryRange = document.getElementById('primaryRange');
    const secondaryRange = document.getElementById('secondaryRange');
    const primaryLabel = document.getElementById('primaryLabel');
    const secondaryLabel = document.getElementById('secondaryLabel');
    const primaryValue = document.getElementById('primaryValue');
    const secondaryValue = document.getElementById('secondaryValue');
    const demoNarration = document.getElementById('demoNarration');
    const fieldValue = document.getElementById('fieldValue');
    const materialValue = document.getElementById('materialValue');
    const heatValue = document.getElementById('heatValue');
    const cavityValue = document.getElementById('cavityValue');
    const statusValue = document.getElementById('statusValue');

    const TAU = Math.PI * 2;

    const modeConfig = {
        source: {
            primary: {
                label: '周波数',
                min: 2.0,
                max: 3.2,
                step: 0.05,
                value: 2.45,
                format: (value) => `${value.toFixed(2)} GHz`
            },
            secondary: {
                label: '出力',
                min: 20,
                max: 100,
                step: 1,
                value: 72,
                format: (value) => `${Math.round(value)}%`
            }
        },
        dipole: {
            primary: {
                label: '電場の強さ',
                min: 0,
                max: 100,
                step: 1,
                value: 64,
                format: (value) => `${Math.round(value)}%`
            },
            secondary: {
                label: '位相遅れ',
                min: 0,
                max: 90,
                step: 1,
                value: 34,
                format: (value) => `${Math.round(value)}°`
            }
        },
        loss: {
            primary: {
                label: 'ωτ',
                min: 0.1,
                max: 3.0,
                step: 0.05,
                value: 1.0,
                format: (value) => value.toFixed(2)
            },
            secondary: {
                label: '液体らしさ',
                min: 0,
                max: 100,
                step: 1,
                value: 78,
                format: (value) => `${Math.round(value)}%`
            }
        },
        cavity: {
            primary: {
                label: '皿の回転',
                min: 0,
                max: 100,
                step: 1,
                value: 58,
                format: (value) => `${Math.round(value)}%`
            },
            secondary: {
                label: '金属の反射',
                min: 0,
                max: 100,
                step: 1,
                value: 18,
                format: (value) => `${Math.round(value)}%`
            }
        }
    };

    const state = {
        mode: 'source',
        width: 900,
        height: 520,
        tick: 0,
        lastTime: performance.now()
    };

    let currentView = null;

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function hash(index, seed = 0) {
        const value = Math.sin(index * 127.1 + seed * 311.7) * 43758.5453;
        return value - Math.floor(value);
    }

    function normalize(value, min, max) {
        if (max === min) return 0;
        return (value - min) / (max - min);
    }

    function configureRange(range, config) {
        range.min = config.min;
        range.max = config.max;
        range.step = config.step;
        range.value = config.value;
    }

    function setMode(mode) {
        if (!modeConfig[mode]) return;
        state.mode = mode;
        const config = modeConfig[mode];
        primaryLabel.textContent = config.primary.label;
        secondaryLabel.textContent = config.secondary.label;
        configureRange(primaryRange, config.primary);
        configureRange(secondaryRange, config.secondary);
        modeRow.querySelectorAll('.mode-chip').forEach((chip) => {
            chip.classList.toggle('is-active', chip.dataset.mode === mode);
        });
        rebuildView();
    }

    function readControls() {
        const config = modeConfig[state.mode];
        const primary = parseFloat(primaryRange.value);
        const secondary = parseFloat(secondaryRange.value);
        return {
            primary,
            secondary,
            primaryNorm: normalize(primary, config.primary.min, config.primary.max),
            secondaryNorm: normalize(secondary, config.secondary.min, config.secondary.max)
        };
    }

    function updateRangeLabels(controls) {
        const config = modeConfig[state.mode];
        primaryValue.textContent = config.primary.format(controls.primary);
        secondaryValue.textContent = config.secondary.format(controls.secondary);
    }

    function buildSourceView(controls) {
        const frequencyGHz = controls.primary;
        const powerPercent = controls.secondary;
        const wavelengthCm = 29.9792458 / frequencyGHz;
        return {
            kind: 'source',
            frequencyGHz,
            powerPercent,
            powerNorm: controls.secondaryNorm,
            wavelengthCm,
            fieldText: `マグネトロンが ${frequencyGHz.toFixed(2)} GHz、波長約 ${wavelengthCm.toFixed(1)} cm のマイクロ波を作ります。`,
            materialText: '食品へ最初に届くのは熱ではなく、時間変化する電場です。',
            heatText: `出力 ${Math.round(powerPercent)}% では、加熱室内の場の強さが上がり、分子へ渡るエネルギーも増えます。`,
            cavityText: '金属箱は波を閉じ込めるので、導波管から入った電磁波が内部で反射しながら広がります。',
            statusText: '電子レンジは火を当てる装置ではなく、電磁場を食品へ注ぎ込む装置です。',
            narration: 'マイクロ波モードでは、マグネトロンから発生した GHz 帯の電磁波が加熱室へ入り、食品へ届く流れを見てください。'
        };
    }

    function buildDipoleView(controls) {
        const fieldStrength = controls.primaryNorm;
        const lagDeg = controls.secondary;
        const lagRad = lagDeg * Math.PI / 180;
        const heatIndex = fieldStrength * Math.sin(lagRad);
        return {
            kind: 'dipole',
            fieldStrength,
            lagDeg,
            lagRad,
            heatIndex,
            fieldText: `電場強度 ${Math.round(fieldStrength * 100)}% で、水分子へかかる回転トルクも大きくなります。`,
            materialText: '水分子は双極子なので、電場の向きに合わせて回ろうとします。',
            heatText: `位相遅れ ${Math.round(lagDeg)}° により、回転運動が衝突で崩れて熱になりやすい状態です。`,
            cavityText: 'これは鋭い共鳴というより、追従の遅れでエネルギーを吸い込む誘電緩和の像です。',
            statusText: '電子レンジ加熱は「向きをそろえる運動」が「乱雑な熱運動」へ崩れる過程だと見ると分かりやすくなります。',
            narration: '双極子モードでは、電場の揺れに対して水分子が少し遅れて向きを変えようとし、その遅れが熱化へつながる様子を見てください。'
        };
    }

    function buildLossView(controls) {
        const x = controls.primary;
        const liquidness = controls.secondaryNorm;
        const baseLoss = x / (1 + x * x);
        const loss = liquidness * baseLoss;
        const heatingPercent = clamp(loss / 0.5, 0, 1) * 100;
        const iceLike = liquidness < 0.35;
        return {
            kind: 'loss',
            x,
            liquidness,
            loss,
            heatingPercent,
            iceLike,
            fieldText: `損失項 ε'' は ωτ ≈ 1 付近で大きくなります。今の設定は ωτ = ${x.toFixed(2)} です。`,
            materialText: iceLike
                ? '氷のように分子が縛られると回転自由度が小さく、誘電緩和は弱くなります。'
                : '液体水では分子が回りやすく、電場への遅れが大きな損失として現れます。',
            heatText: `相対的な加熱しやすさは約 ${Math.round(heatingPercent)}% です。低すぎても高すぎても吸収は落ちます。`,
            cavityText: '2.45GHz は損失と浸透深さ、装置の作りやすさを同時に満たす妥協点です。',
            statusText: "電子レンジの本質は「水の共鳴」ではなく、複素誘電率の虚部 ε'' が仕事をすることです。",
            narration: '誘電損失モードでは、Debye 型の損失曲線のどこにいるかと、液体水か氷に近いかで吸収がどう変わるかを見てください。'
        };
    }

    function buildCavityView(controls) {
        const turntable = controls.primaryNorm;
        const metal = controls.secondaryNorm;
        const uniformity = 0.3 + turntable * 0.6;
        const sparkRisk = metal > 0.72;
        return {
            kind: 'cavity',
            turntable,
            metal,
            uniformity,
            sparkRisk,
            fieldText: '加熱室の中では反射した波が重なり、定在波の腹と節が空間的に固定されます。',
            materialText: `皿の回転 ${Math.round(turntable * 100)}% で、食品は強い場所と弱い場所を往復し、平均化が進みます。`,
            heatText: `回転込みの平均化は約 ${Math.round(uniformity * 100)}% で、止めるとムラが強く残ります。`,
            cavityText: sparkRisk
                ? '金属反射が強いので、端で表面電流と放電が起きやすい危険な状態です。'
                : '金属を避ければ、主な課題は火花ではなく定在波由来の加熱ムラです。',
            statusText: '「中から温まる」ように見えても、実際には定在波・浸透深さ・熱伝導の組み合わせで温度分布が決まります。',
            narration: '定在波モードでは、箱の中の腹と節、ターンテーブルによる平均化、金属反射が強いときの火花リスクを見てください。'
        };
    }

    function buildView() {
        const controls = readControls();
        updateRangeLabels(controls);
        switch (state.mode) {
            case 'dipole':
                return buildDipoleView(controls);
            case 'loss':
                return buildLossView(controls);
            case 'cavity':
                return buildCavityView(controls);
            case 'source':
            default:
                return buildSourceView(controls);
        }
    }

    function rebuildView() {
        currentView = buildView();
        fieldValue.textContent = currentView.fieldText;
        materialValue.textContent = currentView.materialText;
        heatValue.textContent = currentView.heatText;
        cavityValue.textContent = currentView.cavityText;
        statusValue.textContent = currentView.statusText;
        demoNarration.textContent = currentView.narration;
    }

    function resizeCanvas() {
        const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const width = canvas.clientWidth || 900;
        const height = Math.max(400, Math.round(width * 0.58));
        canvas.width = Math.round(width * devicePixelRatio);
        canvas.height = Math.round(height * devicePixelRatio);
        canvas.style.height = `${height}px`;
        context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        state.width = width;
        state.height = height;
    }

    function roundedRectPath(x, y, width, height, radius) {
        const effectiveRadius = Math.min(radius, width * 0.5, height * 0.5);
        context.beginPath();
        context.moveTo(x + effectiveRadius, y);
        context.arcTo(x + width, y, x + width, y + height, effectiveRadius);
        context.arcTo(x + width, y + height, x, y + height, effectiveRadius);
        context.arcTo(x, y + height, x, y, effectiveRadius);
        context.arcTo(x, y, x + width, y, effectiveRadius);
        context.closePath();
    }

    function drawPanel(x, y, width, height, fill = 'rgba(255, 255, 255, 0.045)', stroke = 'rgba(255, 255, 255, 0.1)') {
        roundedRectPath(x, y, width, height, 24);
        context.fillStyle = fill;
        context.fill();
        context.strokeStyle = stroke;
        context.lineWidth = 1.3;
        context.stroke();
    }

    function drawTag(text, x, y, fill, stroke, color) {
        context.save();
        context.font = '600 13px IBM Plex Sans JP';
        const width = context.measureText(text).width + 22;
        roundedRectPath(x, y, width, 30, 15);
        context.fillStyle = fill;
        context.fill();
        if (stroke) {
            context.strokeStyle = stroke;
            context.stroke();
        }
        context.fillStyle = color;
        context.fillText(text, x + 11, y + 20);
        context.restore();
    }

    function drawBackdrop() {
        const { width, height, tick } = state;
        const gradient = context.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, '#140f0b');
        gradient.addColorStop(0.5, '#2b1d15');
        gradient.addColorStop(1, '#4e2f1f');
        context.fillStyle = gradient;
        context.fillRect(0, 0, width, height);

        const glowA = context.createRadialGradient(width * 0.18, height * 0.2, 12, width * 0.18, height * 0.2, width * 0.24);
        glowA.addColorStop(0, 'rgba(94, 214, 223, 0.18)');
        glowA.addColorStop(1, 'rgba(94, 214, 223, 0)');
        context.fillStyle = glowA;
        context.fillRect(0, 0, width, height);

        const glowB = context.createRadialGradient(width * 0.76, height * 0.2, 12, width * 0.76, height * 0.2, width * 0.18);
        glowB.addColorStop(0, 'rgba(255, 179, 103, 0.14)');
        glowB.addColorStop(1, 'rgba(255, 179, 103, 0)');
        context.fillStyle = glowB;
        context.fillRect(0, 0, width, height);

        context.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        context.lineWidth = 1;
        for (let x = 0; x <= width; x += 40) {
            context.beginPath();
            context.moveTo(x, 0);
            context.lineTo(x, height);
            context.stroke();
        }
        for (let y = 0; y <= height; y += 40) {
            context.beginPath();
            context.moveTo(0, y);
            context.lineTo(width, y);
            context.stroke();
        }

        for (let index = 0; index < 60; index += 1) {
            const x = hash(index, 1) * width;
            const y = hash(index, 2) * height;
            const size = 0.6 + hash(index, 3) * 1.6;
            const alpha = 0.18 + hash(index, 4) * 0.38;
            context.fillStyle = `rgba(255, 255, 255, ${alpha})`;
            context.beginPath();
            context.arc(x, y + Math.sin(tick * 0.3 + index) * 0.4, size, 0, TAU);
            context.fill();
        }
    }

    function drawSineLine(x, y, width, amplitude, cycles, phase, color, lineWidth = 3) {
        context.strokeStyle = color;
        context.lineWidth = lineWidth;
        context.beginPath();
        for (let dx = 0; dx <= width; dx += 2) {
            const px = x + dx;
            const py = y + Math.sin((dx / width) * cycles * TAU + phase) * amplitude;
            if (dx === 0) {
                context.moveTo(px, py);
            } else {
                context.lineTo(px, py);
            }
        }
        context.stroke();
    }

    function drawMicrowaveOven(x, y, width, height, mealGlow = 0.6) {
        roundedRectPath(x, y, width, height, 30);
        context.fillStyle = 'rgba(31, 23, 19, 0.96)';
        context.fill();
        context.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        context.lineWidth = 1.6;
        context.stroke();

        const cavityX = x + 26;
        const cavityY = y + 22;
        const cavityWidth = width * 0.72;
        const cavityHeight = height - 44;
        roundedRectPath(cavityX, cavityY, cavityWidth, cavityHeight, 22);
        const cavityGradient = context.createLinearGradient(cavityX, cavityY, cavityX, cavityY + cavityHeight);
        cavityGradient.addColorStop(0, 'rgba(14, 20, 26, 0.98)');
        cavityGradient.addColorStop(1, 'rgba(29, 42, 54, 0.96)');
        context.fillStyle = cavityGradient;
        context.fill();

        context.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        context.stroke();

        const panelX = cavityX + cavityWidth + 18;
        const panelWidth = width - (panelX - x) - 18;
        roundedRectPath(panelX, cavityY, panelWidth, cavityHeight, 20);
        context.fillStyle = 'rgba(255, 255, 255, 0.04)';
        context.fill();
        context.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        context.stroke();

        for (let index = 0; index < 2; index += 1) {
            const knobY = cavityY + 38 + index * 68;
            context.beginPath();
            context.arc(panelX + panelWidth * 0.5, knobY, 21, 0, TAU);
            context.fillStyle = 'rgba(214, 224, 233, 0.92)';
            context.fill();
            context.strokeStyle = 'rgba(89, 102, 121, 0.8)';
            context.lineWidth = 1.4;
            context.stroke();
            context.beginPath();
            context.moveTo(panelX + panelWidth * 0.5, knobY);
            context.lineTo(panelX + panelWidth * 0.5 + 8, knobY - 12);
            context.stroke();
        }

        roundedRectPath(panelX + 12, cavityY + cavityHeight - 42, panelWidth - 24, 16, 8);
        context.fillStyle = 'rgba(94, 214, 223, 0.7)';
        context.fill();

        context.beginPath();
        context.ellipse(cavityX + cavityWidth * 0.5, cavityY + cavityHeight * 0.8, cavityWidth * 0.28, cavityHeight * 0.1, 0, 0, TAU);
        context.fillStyle = 'rgba(228, 237, 246, 0.84)';
        context.fill();

        context.beginPath();
        context.ellipse(cavityX + cavityWidth * 0.5, cavityY + cavityHeight * 0.7, cavityWidth * 0.14, cavityHeight * 0.08, 0.12, 0, TAU);
        const mealGradient = context.createRadialGradient(cavityX + cavityWidth * 0.46, cavityY + cavityHeight * 0.66, 4, cavityX + cavityWidth * 0.5, cavityY + cavityHeight * 0.7, cavityWidth * 0.18);
        mealGradient.addColorStop(0, `rgba(255, 211, 153, ${0.8 + mealGlow * 0.18})`);
        mealGradient.addColorStop(1, `rgba(255, 110, 95, ${0.36 + mealGlow * 0.32})`);
        context.fillStyle = mealGradient;
        context.fill();

        return { cavityX, cavityY, cavityWidth, cavityHeight };
    }

    function drawMagnetron(x, y, radius) {
        const gradient = context.createRadialGradient(x, y, 6, x, y, radius + 18);
        gradient.addColorStop(0, 'rgba(255, 213, 155, 0.96)');
        gradient.addColorStop(0.45, 'rgba(255, 110, 95, 0.84)');
        gradient.addColorStop(1, 'rgba(255, 110, 95, 0)');
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(x, y, radius + 16, 0, TAU);
        context.fill();

        context.strokeStyle = 'rgba(255, 244, 236, 0.3)';
        context.lineWidth = 2;
        context.beginPath();
        context.arc(x, y, radius, 0, TAU);
        context.stroke();
        context.beginPath();
        context.arc(x, y, radius * 0.58, 0, TAU);
        context.stroke();
    }

    function drawWaterMolecule(x, y, angle, scale, energy = 0) {
        context.save();
        context.translate(x, y);
        context.rotate(angle);

        context.strokeStyle = `rgba(255, 255, 255, ${0.4 + energy * 0.35})`;
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(0, 0);
        context.lineTo(-18 * scale, -10 * scale);
        context.moveTo(0, 0);
        context.lineTo(18 * scale, -10 * scale);
        context.stroke();

        context.fillStyle = 'rgba(255, 110, 95, 0.95)';
        context.beginPath();
        context.arc(0, 0, 7 * scale, 0, TAU);
        context.fill();

        context.fillStyle = 'rgba(245, 248, 252, 0.96)';
        context.beginPath();
        context.arc(-20 * scale, -11 * scale, 4.2 * scale, 0, TAU);
        context.fill();
        context.beginPath();
        context.arc(20 * scale, -11 * scale, 4.2 * scale, 0, TAU);
        context.fill();

        context.strokeStyle = 'rgba(94, 214, 223, 0.8)';
        context.beginPath();
        context.moveTo(0, 12 * scale);
        context.lineTo(0, -18 * scale);
        context.lineTo(-3 * scale, -12 * scale);
        context.moveTo(0, -18 * scale);
        context.lineTo(3 * scale, -12 * scale);
        context.stroke();

        context.restore();
    }

    function drawSource(view) {
        const { width, height, tick } = state;
        const oven = drawMicrowaveOven(170, 126, width * 0.62, height * 0.46, view.powerNorm);
        const magnetronX = 92;
        const magnetronY = oven.cavityY + oven.cavityHeight * 0.48;
        drawMagnetron(magnetronX, magnetronY, 26);

        context.fillStyle = 'rgba(255, 240, 232, 0.88)';
        context.font = '600 14px IBM Plex Sans JP';
        context.fillText('Magnetron', 46, magnetronY - 44);

        const amplitude = 8 + view.powerNorm * 18;
        const waveWidth = oven.cavityX - 34 - magnetronX;
        drawSineLine(magnetronX + 24, magnetronY - 24, waveWidth, amplitude * 0.45, 2.2 + view.frequencyGHz * 0.55, tick * 8, 'rgba(94, 214, 223, 0.92)', 2.8);
        drawSineLine(magnetronX + 24, magnetronY, waveWidth, amplitude * 0.52, 2.0 + view.frequencyGHz * 0.5, tick * 8 + 0.6, 'rgba(94, 214, 223, 0.96)', 3.2);
        drawSineLine(magnetronX + 24, magnetronY + 24, waveWidth, amplitude * 0.45, 2.2 + view.frequencyGHz * 0.55, tick * 8 + 1.2, 'rgba(94, 214, 223, 0.88)', 2.8);

        for (let index = 0; index < 5; index += 1) {
            const stripeX = oven.cavityX + 24 + index * (oven.cavityWidth - 48) / 4;
            const alpha = 0.08 + (0.12 + view.powerNorm * 0.18) * (index % 2 === 0 ? 1 : 0.8);
            context.fillStyle = `rgba(94, 214, 223, ${alpha})`;
            context.fillRect(stripeX, oven.cavityY + 6, 18, oven.cavityHeight - 12);
        }

        drawTag(`${view.frequencyGHz.toFixed(2)} GHz`, 42, 34, 'rgba(28, 19, 15, 0.78)', 'rgba(255, 255, 255, 0.14)', '#fff8f2');
        drawTag(`λ ≈ ${view.wavelengthCm.toFixed(1)} cm`, width - 166, 34, 'rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.14)', '#4a2c20');
        drawTag(`power ${Math.round(view.powerPercent)}%`, 42, height - 54, 'rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.14)', '#4a2c20');
    }

    function drawDipole(view) {
        const { width, height, tick } = state;
        const graphX = 54;
        const graphY = 70;
        const graphWidth = width * 0.42;
        const graphHeight = height * 0.4;
        drawPanel(graphX, graphY, graphWidth, graphHeight);

        const midY = graphY + graphHeight * 0.58;
        context.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(graphX + 18, midY);
        context.lineTo(graphX + graphWidth - 18, midY);
        context.stroke();

        const amplitude = 26 + view.fieldStrength * 34;
        drawSineLine(graphX + 18, midY, graphWidth - 36, amplitude, 1.6, tick * 4.2, 'rgba(94, 214, 223, 0.96)', 3.1);
        drawSineLine(graphX + 18, midY, graphWidth - 36, amplitude * 0.82, 1.6, tick * 4.2 - view.lagRad, 'rgba(255, 179, 103, 0.94)', 3.1);
        context.fillStyle = 'rgba(255, 248, 242, 0.88)';
        context.font = '600 14px IBM Plex Sans JP';
        context.fillText('E field', graphX + 22, graphY + 28);
        context.fillText('polarization', graphX + 110, graphY + 28);

        const moleculeX = width * 0.58;
        const moleculeY = 82;
        const moleculeWidth = width * 0.34;
        const moleculeHeight = height * 0.52;
        drawPanel(moleculeX, moleculeY, moleculeWidth, moleculeHeight);

        const fieldPhase = Math.sin(tick * 4.2) * 0.92;
        const fieldAngle = fieldPhase * 0.85;
        context.strokeStyle = 'rgba(94, 214, 223, 0.34)';
        context.lineWidth = 2;
        for (let row = 0; row < 4; row += 1) {
            const y = moleculeY + 48 + row * 56;
            context.beginPath();
            context.moveTo(moleculeX + 24, y);
            context.lineTo(moleculeX + moleculeWidth - 24, y);
            context.stroke();
            const arrowX = moleculeX + moleculeWidth * 0.5;
            const arrowLength = fieldPhase * 74;
            context.beginPath();
            context.moveTo(arrowX, y);
            context.lineTo(arrowX + arrowLength, y);
            context.stroke();
        }

        for (let row = 0; row < 3; row += 1) {
            for (let col = 0; col < 3; col += 1) {
                const x = moleculeX + 66 + col * 88;
                const y = moleculeY + 88 + row * 82;
                const jitter = view.heatIndex * 8;
                const angle = fieldAngle * (0.55 + view.fieldStrength * 0.45) - Math.sign(fieldPhase || 1) * view.lagRad * 0.38 + (hash(row * 5 + col, 2) - 0.5) * 0.22;
                drawWaterMolecule(x + Math.sin(tick * 5 + row + col) * jitter * 0.2, y + Math.cos(tick * 4 + row * 0.7 + col) * jitter * 0.2, angle, 0.85, view.heatIndex);
                if (view.heatIndex > 0.18) {
                    context.fillStyle = 'rgba(255, 207, 143, 0.68)';
                    context.beginPath();
                    context.arc(x + 20 + Math.sin(tick * 7 + row + col) * jitter, y + 8 + Math.cos(tick * 6 + col) * jitter, 2.2, 0, TAU);
                    context.fill();
                }
            }
        }

        const heatBarX = 54;
        const heatBarY = height - 74;
        const heatBarWidth = width * 0.34;
        roundedRectPath(heatBarX, heatBarY, heatBarWidth, 18, 9);
        context.fillStyle = 'rgba(255, 255, 255, 0.08)';
        context.fill();
        roundedRectPath(heatBarX, heatBarY, heatBarWidth * view.heatIndex, 18, 9);
        context.fillStyle = 'rgba(255, 179, 103, 0.92)';
        context.fill();

        drawTag(`lag ${Math.round(view.lagDeg)}°`, width - 142, 36, 'rgba(28, 19, 15, 0.78)', 'rgba(255, 255, 255, 0.14)', '#fff8f2');
        drawTag(`heat index ${Math.round(view.heatIndex * 100)}%`, 54, height - 114, 'rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.14)', '#4a2c20');
    }

    function drawLoss(view) {
        const { width, height } = state;
        const graphX = 58;
        const graphY = 74;
        const graphWidth = width * 0.48;
        const graphHeight = height * 0.48;
        drawPanel(graphX, graphY, graphWidth, graphHeight);

        const maxX = 3.1;
        const maxY = 0.52;
        const originX = graphX + 38;
        const originY = graphY + graphHeight - 36;
        context.strokeStyle = 'rgba(255, 255, 255, 0.18)';
        context.lineWidth = 1.4;
        context.beginPath();
        context.moveTo(originX, graphY + 20);
        context.lineTo(originX, originY);
        context.lineTo(graphX + graphWidth - 18, originY);
        context.stroke();

        context.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        context.setLineDash([6, 6]);
        const optimumX = originX + (1 / maxX) * (graphWidth - 64);
        context.beginPath();
        context.moveTo(optimumX, graphY + 22);
        context.lineTo(optimumX, originY);
        context.stroke();
        context.setLineDash([]);

        context.strokeStyle = 'rgba(94, 214, 223, 0.86)';
        context.lineWidth = 3;
        context.beginPath();
        for (let step = 0; step <= 160; step += 1) {
            const x = maxX * (step / 160);
            const y = x / (1 + x * x);
            const px = originX + (x / maxX) * (graphWidth - 64);
            const py = originY - (y / maxY) * (graphHeight - 62);
            if (step === 0) {
                context.moveTo(px, py);
            } else {
                context.lineTo(px, py);
            }
        }
        context.stroke();

        context.strokeStyle = 'rgba(255, 179, 103, 0.9)';
        context.lineWidth = 3;
        context.beginPath();
        for (let step = 0; step <= 160; step += 1) {
            const x = maxX * (step / 160);
            const y = view.liquidness * (x / (1 + x * x));
            const px = originX + (x / maxX) * (graphWidth - 64);
            const py = originY - (y / maxY) * (graphHeight - 62);
            if (step === 0) {
                context.moveTo(px, py);
            } else {
                context.lineTo(px, py);
            }
        }
        context.stroke();

        const markerX = originX + (view.x / maxX) * (graphWidth - 64);
        const markerY = originY - (view.loss / maxY) * (graphHeight - 62);
        context.fillStyle = 'rgba(255, 207, 143, 0.96)';
        context.beginPath();
        context.arc(markerX, markerY, 6, 0, TAU);
        context.fill();

        context.fillStyle = 'rgba(255, 248, 242, 0.88)';
        context.font = '600 14px IBM Plex Sans JP';
        context.fillText("ε''", graphX + 16, graphY + 24);
        context.fillText('ωτ', graphX + graphWidth - 38, originY + 22);
        context.fillText('optimum', optimumX - 26, graphY + 22);

        const panelX = width * 0.62;
        const panelY = 78;
        const panelWidth = width * 0.28;
        const panelHeight = height * 0.5;
        drawPanel(panelX, panelY, panelWidth, panelHeight);

        context.fillStyle = 'rgba(255, 248, 242, 0.88)';
        context.font = '600 15px IBM Plex Sans JP';
        context.fillText(view.iceLike ? 'ice-like' : 'liquid-like', panelX + 20, panelY + 28);
        context.font = '500 13px IBM Plex Sans JP';
        context.fillStyle = 'rgba(235, 224, 214, 0.78)';
        context.fillText(view.iceLike ? 'molecules locked' : 'molecules can rotate', panelX + 20, panelY + 52);

        for (let row = 0; row < 3; row += 1) {
            for (let col = 0; col < 3; col += 1) {
                const x = panelX + 58 + col * 72;
                const y = panelY + 112 + row * 76;
                const angle = view.iceLike
                    ? (row + col) % 2 === 0 ? -0.35 : 0.35
                    : (hash(row * 3 + col, 4) - 0.5) * 1.5;
                drawWaterMolecule(x, y, angle, 0.78, view.liquidness * 0.8);
                if (view.iceLike) {
                    context.strokeStyle = 'rgba(255, 255, 255, 0.18)';
                    context.lineWidth = 1.2;
                    context.beginPath();
                    context.moveTo(x - 26, y);
                    context.lineTo(x + 26, y);
                    context.moveTo(x, y - 26);
                    context.lineTo(x, y + 26);
                    context.stroke();
                }
            }
        }

        const barX = panelX + 20;
        const barY = panelY + panelHeight - 44;
        const barWidth = panelWidth - 40;
        roundedRectPath(barX, barY, barWidth, 18, 9);
        context.fillStyle = 'rgba(255, 255, 255, 0.08)';
        context.fill();
        roundedRectPath(barX, barY, barWidth * (view.heatingPercent / 100), 18, 9);
        context.fillStyle = 'rgba(255, 179, 103, 0.92)';
        context.fill();
        context.fillStyle = 'rgba(255, 248, 242, 0.88)';
        context.fillText('heating', barX, barY - 10);

        drawTag(`ωτ = ${view.x.toFixed(2)}`, 52, 32, 'rgba(28, 19, 15, 0.78)', 'rgba(255, 255, 255, 0.14)', '#fff8f2');
        drawTag(`${Math.round(view.heatingPercent)}%`, width - 112, 32, 'rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.14)', '#4a2c20');
    }

    function drawCavity(view) {
        const { width, height, tick } = state;
        const cavityX = 86;
        const cavityY = 70;
        const cavityWidth = width * 0.62;
        const cavityHeight = height * 0.58;
        drawPanel(cavityX, cavityY, cavityWidth, cavityHeight);

        for (let band = 0; band < 7; band += 1) {
            const x = cavityX + band * cavityWidth / 6;
            const intensity = Math.sin((band / 6) * Math.PI * 3.1) ** 2;
            context.fillStyle = `rgba(94, 214, 223, ${0.08 + intensity * (0.18 + view.metal * 0.14)})`;
            context.fillRect(x - cavityWidth / 12, cavityY + 12, cavityWidth / 6, cavityHeight - 24);
        }

        const plateX = cavityX + cavityWidth * 0.5;
        const plateY = cavityY + cavityHeight * 0.58;
        const plateRadius = Math.min(cavityWidth, cavityHeight) * 0.24;
        context.beginPath();
        context.arc(plateX, plateY, plateRadius, 0, TAU);
        context.fillStyle = 'rgba(230, 237, 244, 0.86)';
        context.fill();
        context.strokeStyle = 'rgba(255, 255, 255, 0.16)';
        context.stroke();

        const angle = tick * (0.35 + view.turntable * 1.1);
        const dotCount = 14;
        for (let index = 0; index < dotCount; index += 1) {
            const localAngle = angle + index * TAU / dotCount;
            const radius = plateRadius * (0.35 + 0.55 * hash(index, 2));
            const x = plateX + Math.cos(localAngle) * radius;
            const y = plateY + Math.sin(localAngle) * radius;
            const standing = Math.sin(((x - cavityX) / cavityWidth) * Math.PI * 3.2) ** 2;
            const averaged = standing * (1 - view.turntable * 0.72) + 0.46 * view.turntable;
            const heat = clamp(averaged, 0, 1);
            context.fillStyle = `rgba(${Math.round(255 - heat * 30)}, ${Math.round(196 - heat * 70)}, ${Math.round(120 - heat * 50)}, ${0.78 + heat * 0.22})`;
            context.beginPath();
            context.arc(x, y, 7, 0, TAU);
            context.fill();
        }

        context.strokeStyle = 'rgba(255, 207, 143, 0.8)';
        context.lineWidth = 2;
        context.beginPath();
        context.arc(plateX, plateY, plateRadius + 14, -0.8, 0.9);
        context.stroke();
        context.beginPath();
        context.moveTo(plateX + plateRadius + 18, plateY - 10);
        context.lineTo(plateX + plateRadius + 6, plateY - 16);
        context.lineTo(plateX + plateRadius + 10, plateY - 2);
        context.stroke();

        if (view.sparkRisk) {
            const forkX = cavityX + cavityWidth * 0.72;
            const forkY = cavityY + cavityHeight * 0.28;
            context.strokeStyle = 'rgba(215, 225, 234, 0.92)';
            context.lineWidth = 4;
            context.beginPath();
            context.moveTo(forkX - 16, forkY + 16);
            context.lineTo(forkX + 18, forkY - 20);
            context.stroke();
            for (let tine = -1; tine <= 1; tine += 1) {
                context.beginPath();
                context.moveTo(forkX + 18 + tine * 7, forkY - 20);
                context.lineTo(forkX + 26 + tine * 7, forkY - 34);
                context.stroke();
            }
            for (let spark = 0; spark < 6; spark += 1) {
                const sx = forkX + 20 + spark * 4;
                const sy = forkY - 36 - (spark % 2) * 10;
                context.strokeStyle = 'rgba(255, 240, 208, 0.94)';
                context.lineWidth = 2;
                context.beginPath();
                context.moveTo(sx, sy);
                context.lineTo(sx + (spark % 2 === 0 ? 10 : -8), sy - 8);
                context.lineTo(sx + (spark % 2 === 0 ? 18 : -14), sy + 4);
                context.stroke();
            }
        }

        const sideX = width * 0.76;
        const sideY = 82;
        const sideWidth = width * 0.16;
        const sideHeight = height * 0.46;
        drawPanel(sideX, sideY, sideWidth, sideHeight);
        context.fillStyle = 'rgba(255, 248, 242, 0.88)';
        context.font = '600 14px IBM Plex Sans JP';
        context.fillText('node / antinode', sideX + 12, sideY + 26);

        context.strokeStyle = 'rgba(94, 214, 223, 0.9)';
        context.lineWidth = 2.8;
        context.beginPath();
        for (let step = 0; step <= 100; step += 1) {
            const t = step / 100;
            const x = sideX + 16 + t * (sideWidth - 32);
            const y = sideY + sideHeight * 0.65 - Math.sin(t * Math.PI * 3.2) * (sideHeight * 0.2);
            if (step === 0) {
                context.moveTo(x, y);
            } else {
                context.lineTo(x, y);
            }
        }
        context.stroke();

        drawTag(`turntable ${Math.round(view.turntable * 100)}%`, 54, 32, 'rgba(28, 19, 15, 0.78)', 'rgba(255, 255, 255, 0.14)', '#fff8f2');
        drawTag(view.sparkRisk ? 'spark risk' : 'metal low', width - 126, 32, 'rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.14)', '#4a2c20');
    }

    function drawFrame(timestamp) {
        const deltaTime = clamp((timestamp - state.lastTime) / 1000, 0, 0.04);
        state.lastTime = timestamp;
        state.tick += deltaTime;

        context.clearRect(0, 0, state.width, state.height);
        drawBackdrop();

        if (currentView) {
            if (currentView.kind === 'source') {
                drawSource(currentView);
            } else if (currentView.kind === 'dipole') {
                drawDipole(currentView);
            } else if (currentView.kind === 'loss') {
                drawLoss(currentView);
            } else if (currentView.kind === 'cavity') {
                drawCavity(currentView);
            }
        }

        requestAnimationFrame(drawFrame);
    }

    modeRow.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (!target.matches('.mode-chip')) return;
        setMode(target.dataset.mode || 'source');
    });

    primaryRange.addEventListener('input', rebuildView);
    secondaryRange.addEventListener('input', rebuildView);
    window.addEventListener('resize', () => {
        resizeCanvas();
    });

    setMode('source');
    resizeCanvas();
    rebuildView();
    drawFrame(performance.now());
})();