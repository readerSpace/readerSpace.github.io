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

    const canvas = document.getElementById('gpsCanvas');
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
    const timeValue = document.getElementById('timeValue');
    const geometryValue = document.getElementById('geometryValue');
    const relativityValue = document.getElementById('relativityValue');
    const errorValue = document.getElementById('errorValue');
    const statusValue = document.getElementById('statusValue');

    const C = 299792458;
    const GM = 3.986e14;
    const EARTH_RADIUS = 6.378e6;
    const TAU = Math.PI * 2;

    const modeConfig = {
        ranging: {
            primary: {
                label: '伝播時間',
                min: 60,
                max: 90,
                step: 0.5,
                value: 70,
                format: (value) => `${value.toFixed(1)} ms`
            },
            secondary: {
                label: '時計ずれ',
                min: 0,
                max: 120,
                step: 1,
                value: 8,
                format: (value) => `${Math.round(value)} ns`
            }
        },
        geometry: {
            primary: {
                label: '衛星数',
                min: 1,
                max: 4,
                step: 1,
                value: 4,
                format: (value) => `${Math.round(value)} 基`
            },
            secondary: {
                label: '受信機時計ずれ',
                min: 0,
                max: 120,
                step: 1,
                value: 20,
                format: (value) => `${Math.round(value)} ns`
            }
        },
        relativity: {
            primary: {
                label: '軌道高度',
                min: 1000,
                max: 26000,
                step: 100,
                value: 20200,
                format: (value) => `${Math.round(value)} km`
            },
            secondary: {
                label: '経過時間',
                min: 1,
                max: 24,
                step: 1,
                value: 24,
                format: (value) => `${Math.round(value)} h`
            }
        },
        errors: {
            primary: {
                label: '大気ゆらぎ',
                min: 0,
                max: 100,
                step: 1,
                value: 42,
                format: (value) => `${Math.round(value)}%`
            },
            secondary: {
                label: '補正レベル',
                min: 0,
                max: 100,
                step: 1,
                value: 58,
                format: (value) => `${Math.round(value)}%`
            }
        }
    };

    const state = {
        mode: 'ranging',
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

    function formatMeters(meters) {
        if (meters < 1) return `${(meters * 100).toFixed(1)} cm`;
        return `${meters.toFixed(2)} m`;
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

    function buildRangingView(controls) {
        const travelMs = controls.primary;
        const clockBiasNs = controls.secondary;
        const distanceKm = (C * (travelMs / 1000)) / 1000;
        const biasErrorM = C * clockBiasNs * 1e-9;
        return {
            kind: 'ranging',
            travelMs,
            clockBiasNs,
            distanceKm,
            biasErrorM,
            timeText: `伝播時間 ${travelMs.toFixed(1)} ms なら、衛星までの距離は約 ${distanceKm.toFixed(0)} km です。`,
            geometryText: '単独衛星で分かるのは「その距離の球面上にいる」ことまでで、位置はまだ一意に決まりません。',
            relativityText: `受信機時計が ${Math.round(clockBiasNs)} ns ずれるだけで、擬似距離は約 ${biasErrorM.toFixed(2)} m ずれます。`,
            errorText: '時間を直接扱う装置なので、GPS は時計精度の影響をそのまま受けます。',
            statusText: 'GPS の第一原理は「時刻差を距離へ変える」ことで、位置決定はそのあとに来ます。',
            narration: '時間測距モードでは、衛星が送った時刻スタンプが距離へ変換される様子を見てください。'
        };
    }

    function buildGeometryView(controls) {
        const satelliteCount = Math.round(controls.primary);
        const clockBiasNs = controls.secondary;
        const biasMeters = C * clockBiasNs * 1e-9;

        let geometryText = '';
        if (satelliteCount === 1) {
            geometryText = '1 衛星では、候補は球面全体に残ります。';
        } else if (satelliteCount === 2) {
            geometryText = '2 衛星で球面同士の交わりへ絞れますが、まだ位置は決まりません。';
        } else if (satelliteCount === 3) {
            geometryText = '3 衛星で候補は強く絞れますが、受信機時計の誤差を無視しないと確定できません。';
        } else {
            geometryText = '4 衛星で x, y, z と時計補正 cδt を同時に解けます。';
        }

        return {
            kind: 'geometry',
            satelliteCount,
            clockBiasNs,
            biasMeters,
            timeText: '各衛星から得るのは擬似距離 ρ_i であって、幾何学と時計補正を一緒に解く必要があります。',
            geometryText,
            relativityText: `受信機時計の ${Math.round(clockBiasNs)} ns のずれは約 ${biasMeters.toFixed(2)} m の共通シフトとして全式に入ります。`,
            errorText: satelliteCount < 4 ? '衛星数が足りないと、どれだけ時計を精密にしても未知数が残ります。' : '4 本目の式が受信機時計の不完全さを吸収します。',
            statusText: 'GPS 測位は「距離の集合」ではなく、未知数 4 個を持つ連立方程式です。',
            narration: '4衛星モードでは、衛星数が増えるごとに候補がどう絞られ、4 本目で時計誤差まで解けるかを見てください。'
        };
    }

    function buildRelativityView(controls) {
        const heightKm = controls.primary;
        const hours = controls.secondary;
        const radius = EARTH_RADIUS + heightKm * 1000;
        const orbitalSpeed = Math.sqrt(GM / radius);
        const srPerDayUs = -86400 * (orbitalSpeed * orbitalSpeed / (2 * C * C)) * 1e6;
        const grPerDayUs = 86400 * (GM / (C * C)) * (1 / EARTH_RADIUS - 1 / radius) * 1e6;
        const totalPerDayUs = grPerDayUs + srPerDayUs;
        const totalIntervalUs = totalPerDayUs * hours / 24;
        const driftKm = (C * (totalIntervalUs * 1e-6)) / 1000;

        return {
            kind: 'relativity',
            heightKm,
            hours,
            orbitalSpeed,
            srPerDayUs,
            grPerDayUs,
            totalPerDayUs,
            totalIntervalUs,
            driftKm,
            timeText: `高度 ${Math.round(heightKm)} km の軌道では、${Math.round(hours)} 時間で衛星時計は地上に対して ${totalIntervalUs.toFixed(2)} μs ずれます。`,
            geometryText: `補正しなければ光速換算で約 ${driftKm.toFixed(2)} km の距離誤差になります。`,
            relativityText: `SR は ${srPerDayUs.toFixed(1)} μs/day、GR は ${grPerDayUs.toFixed(1)} μs/day、合計は ${totalPerDayUs.toFixed(1)} μs/day です。`,
            errorText: 'GPS は相対論を入れないと精度を維持できません。これは理論上の飾りではなく運用条件です。',
            statusText: '高い場所ほど時計が速く進む一般相対論の効果が、GPS では特殊相対論より大きく効いています。',
            narration: '相対論モードでは、軌道高度と経過時間を動かしながら、衛星時計と地上時計のズレがどれだけ積み上がるかを見てください。'
        };
    }

    function buildErrorsView(controls) {
        const atmosphere = controls.primaryNorm;
        const correction = controls.secondaryNorm;
        const rawErrorM = 1.2 + atmosphere * 6.2 + (1 - correction * 0.25) * 1.8;
        const multipathM = 0.4 + atmosphere * (1.4 + (1 - correction) * 2.2);

        let correctionName = '単独GPS';
        let residualErrorM = rawErrorM;
        if (correction < 0.34) {
            residualErrorM = rawErrorM * (0.82 - correction * 0.18);
        } else if (correction < 0.78) {
            correctionName = 'DGPS';
            residualErrorM = rawErrorM * (0.18 + (0.78 - correction) * 0.14);
        } else {
            correctionName = 'RTK';
            residualErrorM = Math.max(0.02, rawErrorM * (0.01 + (1 - correction) * 0.08));
        }

        return {
            kind: 'errors',
            atmosphere,
            correction,
            rawErrorM,
            residualErrorM,
            multipathM,
            correctionName,
            timeText: `大気と反射を含めた単独測位のズレは約 ${rawErrorM.toFixed(2)} m 規模です。`,
            geometryText: '電離層・対流圏・建物反射・衛星軌道誤差が、理想的な球面交点をにじませます。',
            relativityText: '相対論補正は土台ですが、現場ではさらに大気と環境起因の補正が必要です。',
            errorText: `${correctionName} を使うと残差は ${formatMeters(residualErrorM)} まで下がります。`,
            statusText: 'GPS 精度は「理論補正 + 現場補正」の二段構えで作られています。',
            narration: '誤差補正モードでは、大気やマルチパスで増えた誤差が DGPS や RTK でどれくらい押し下げられるかを見てください。'
        };
    }

    function buildView() {
        const controls = readControls();
        updateRangeLabels(controls);
        switch (state.mode) {
            case 'geometry':
                return buildGeometryView(controls);
            case 'relativity':
                return buildRelativityView(controls);
            case 'errors':
                return buildErrorsView(controls);
            case 'ranging':
            default:
                return buildRangingView(controls);
        }
    }

    function rebuildView() {
        currentView = buildView();
        timeValue.textContent = currentView.timeText;
        geometryValue.textContent = currentView.geometryText;
        relativityValue.textContent = currentView.relativityText;
        errorValue.textContent = currentView.errorText;
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

    function drawPanel(x, y, width, height, active = false) {
        roundedRectPath(x, y, width, height, 24);
        context.fillStyle = 'rgba(255, 255, 255, 0.045)';
        context.fill();
        context.strokeStyle = active ? 'rgba(100, 210, 255, 0.92)' : 'rgba(255, 255, 255, 0.1)';
        context.lineWidth = active ? 2 : 1.2;
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
        gradient.addColorStop(0, '#040b14');
        gradient.addColorStop(0.52, '#0b1a2e');
        gradient.addColorStop(1, '#143152');
        context.fillStyle = gradient;
        context.fillRect(0, 0, width, height);

        const glowA = context.createRadialGradient(width * 0.2, height * 0.18, 12, width * 0.2, height * 0.18, width * 0.24);
        glowA.addColorStop(0, 'rgba(100, 210, 255, 0.18)');
        glowA.addColorStop(1, 'rgba(100, 210, 255, 0)');
        context.fillStyle = glowA;
        context.fillRect(0, 0, width, height);

        const glowB = context.createRadialGradient(width * 0.78, height * 0.2, 12, width * 0.78, height * 0.2, width * 0.18);
        glowB.addColorStop(0, 'rgba(255, 207, 101, 0.12)');
        glowB.addColorStop(1, 'rgba(255, 207, 101, 0)');
        context.fillStyle = glowB;
        context.fillRect(0, 0, width, height);

        context.strokeStyle = 'rgba(255, 255, 255, 0.05)';
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

        for (let index = 0; index < 68; index += 1) {
            const x = hash(index, 1) * width;
            const y = hash(index, 2) * height;
            const size = 0.6 + hash(index, 3) * 1.8;
            const alpha = 0.2 + hash(index, 4) * 0.56;
            context.fillStyle = `rgba(255, 255, 255, ${alpha})`;
            context.beginPath();
            context.arc(x, y + Math.sin(tick * 0.35 + index) * 0.5, size, 0, TAU);
            context.fill();
        }
    }

    function drawSatellite(x, y, scale = 1, color = 'rgba(100, 210, 255, 0.96)') {
        const bodyWidth = 16 * scale;
        const bodyHeight = 10 * scale;
        const panelWidth = 12 * scale;
        const panelHeight = 8 * scale;

        context.fillStyle = 'rgba(232, 242, 255, 0.94)';
        roundedRectPath(x - bodyWidth * 0.5, y - bodyHeight * 0.5, bodyWidth, bodyHeight, 3 * scale);
        context.fill();
        context.fillStyle = color;
        context.fillRect(x - bodyWidth * 0.5 - panelWidth, y - panelHeight * 0.5, panelWidth, panelHeight);
        context.fillRect(x + bodyWidth * 0.5, y - panelHeight * 0.5, panelWidth, panelHeight);
        context.fillStyle = 'rgba(255, 207, 101, 0.86)';
        context.beginPath();
        context.arc(x, y, 2.4 * scale, 0, TAU);
        context.fill();
    }

    function drawReceiver(x, y) {
        context.fillStyle = 'rgba(255, 207, 101, 0.96)';
        context.beginPath();
        context.arc(x, y, 6, 0, TAU);
        context.fill();
        context.fillRect(x - 1.5, y - 18, 3, 12);
        context.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(x - 10, y + 10);
        context.lineTo(x, y - 6);
        context.lineTo(x + 10, y + 10);
        context.stroke();
    }

    function drawClockIcon(x, y, radius, stroke) {
        context.strokeStyle = stroke;
        context.lineWidth = 2.2;
        context.beginPath();
        context.arc(x, y, radius, 0, TAU);
        context.stroke();
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x, y - radius * 0.56);
        context.moveTo(x, y);
        context.lineTo(x + radius * 0.42, y + radius * 0.22);
        context.stroke();
    }

    function drawRanging(view) {
        const { width, height, tick } = state;
        const satX = width * 0.72;
        const satY = height * 0.2;
        const receiverX = width * 0.5;
        const receiverY = height * 0.78;

        context.beginPath();
        context.arc(width * 0.5, height + 190, 310, Math.PI, 0);
        context.fillStyle = 'rgba(28, 116, 162, 0.35)';
        context.fill();
        context.beginPath();
        context.arc(width * 0.5, height + 190, 270, Math.PI, 0);
        context.fillStyle = 'rgba(125, 230, 199, 0.18)';
        context.fill();

        drawSatellite(satX, satY, 1.4);
        drawReceiver(receiverX, receiverY);

        context.strokeStyle = 'rgba(100, 210, 255, 0.9)';
        context.lineWidth = 3;
        context.beginPath();
        context.moveTo(satX, satY);
        context.lineTo(receiverX, receiverY);
        context.stroke();

        const pulseCount = 4;
        for (let index = 0; index < pulseCount; index += 1) {
            const progress = (tick * 0.42 + index / pulseCount) % 1;
            const x = satX + (receiverX - satX) * progress;
            const y = satY + (receiverY - satY) * progress;
            context.fillStyle = 'rgba(255, 248, 224, 0.96)';
            context.beginPath();
            context.arc(x, y, 3.8, 0, TAU);
            context.fill();
        }

        drawPanel(56, 64, width * 0.34, 132, false);
        context.fillStyle = 'rgba(240, 247, 255, 0.92)';
        context.font = '600 16px IBM Plex Sans JP';
        context.fillText('Signal Timing', 78, 94);
        context.font = '500 14px IBM Plex Sans JP';
        context.fillStyle = 'rgba(214, 226, 242, 0.82)';
        context.fillText(`伝播時間: ${view.travelMs.toFixed(1)} ms`, 78, 124);
        context.fillText(`距離: ${view.distanceKm.toFixed(0)} km`, 78, 148);
        context.fillText(`時計ずれ: ${view.clockBiasNs.toFixed(0)} ns`, 78, 172);

        const biasBarX = 56;
        const biasBarY = height - 88;
        const biasBarWidth = width * 0.36;
        roundedRectPath(biasBarX, biasBarY, biasBarWidth, 18, 9);
        context.fillStyle = 'rgba(255, 255, 255, 0.08)';
        context.fill();
        roundedRectPath(biasBarX, biasBarY, Math.min(biasBarWidth, biasBarWidth * (view.biasErrorM / 36)), 18, 9);
        context.fillStyle = 'rgba(255, 207, 101, 0.92)';
        context.fill();

        drawTag('d = c × Δt', 64, height - 134, 'rgba(7, 16, 29, 0.78)', 'rgba(255, 255, 255, 0.14)', '#f4fbff');
        drawTag(`1 ns → ${view.biasErrorM.toFixed(2)} m`, 64, height - 52, 'rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.14)', '#152b45');
        drawTag(`約 ${view.distanceKm.toFixed(0)} km`, width - 170, 48, 'rgba(7, 16, 29, 0.78)', 'rgba(255, 255, 255, 0.14)', '#f4fbff');
    }

    function drawGeometry(view) {
        const { width, height } = state;
        const paddingX = 54;
        const paddingY = 62;
        const gap = 18;
        const panelWidth = (width - paddingX * 2 - gap) / 2;
        const panelHeight = (height - paddingY * 2 - gap) / 2;
        const panelRects = [
            { x: paddingX, y: paddingY },
            { x: paddingX + panelWidth + gap, y: paddingY },
            { x: paddingX, y: paddingY + panelHeight + gap },
            { x: paddingX + panelWidth + gap, y: paddingY + panelHeight + gap }
        ];

        panelRects.forEach((panel, index) => {
            const stage = index + 1;
            drawPanel(panel.x, panel.y, panelWidth, panelHeight, stage === view.satelliteCount);
            context.fillStyle = 'rgba(240, 247, 255, 0.92)';
            context.font = '600 15px IBM Plex Sans JP';
            context.fillText(`${stage} satellite${stage > 1 ? 's' : ''}`, panel.x + 22, panel.y + 28);

            const centerX = panel.x + panelWidth * 0.5;
            const centerY = panel.y + panelHeight * 0.58;

            if (stage === 1) {
                drawSatellite(centerX, panel.y + 54, 1.1);
                context.strokeStyle = 'rgba(100, 210, 255, 0.52)';
                context.lineWidth = 2;
                context.beginPath();
                context.arc(centerX, centerY, 62, 0, TAU);
                context.stroke();
                context.fillStyle = 'rgba(214, 226, 242, 0.82)';
                context.font = '500 13px IBM Plex Sans JP';
                context.fillText('球面上に候補が残る', panel.x + 22, panel.y + panelHeight - 26);
            } else if (stage === 2) {
                drawSatellite(centerX - 48, panel.y + 56, 0.96);
                drawSatellite(centerX + 48, panel.y + 56, 0.96);
                context.strokeStyle = 'rgba(100, 210, 255, 0.54)';
                context.lineWidth = 2;
                context.beginPath();
                context.arc(centerX - 26, centerY, 56, 0, TAU);
                context.stroke();
                context.beginPath();
                context.arc(centerX + 26, centerY, 56, 0, TAU);
                context.stroke();
                context.strokeStyle = 'rgba(255, 207, 101, 0.72)';
                context.beginPath();
                context.arc(centerX, centerY, 20, -1.1, 1.1);
                context.stroke();
                context.fillStyle = 'rgba(214, 226, 242, 0.82)';
                context.font = '500 13px IBM Plex Sans JP';
                context.fillText('候補は円へ絞られる', panel.x + 22, panel.y + panelHeight - 26);
            } else if (stage === 3) {
                drawSatellite(centerX, panel.y + 48, 0.92);
                drawSatellite(centerX - 58, centerY - 8, 0.88);
                drawSatellite(centerX + 58, centerY - 8, 0.88);
                context.strokeStyle = 'rgba(100, 210, 255, 0.42)';
                context.lineWidth = 2;
                context.beginPath();
                context.arc(centerX, centerY + 10, 54, 0, TAU);
                context.stroke();
                context.beginPath();
                context.arc(centerX - 26, centerY + 26, 50, 0, TAU);
                context.stroke();
                context.beginPath();
                context.arc(centerX + 26, centerY + 26, 50, 0, TAU);
                context.stroke();
                context.fillStyle = 'rgba(255, 207, 101, 0.96)';
                context.beginPath();
                context.arc(centerX - 18, centerY + 34, 5, 0, TAU);
                context.fill();
                context.beginPath();
                context.arc(centerX + 18, centerY + 34, 5, 0, TAU);
                context.fill();
                context.fillStyle = 'rgba(214, 226, 242, 0.82)';
                context.font = '500 13px IBM Plex Sans JP';
                context.fillText('候補はまだ複数残る', panel.x + 22, panel.y + panelHeight - 26);
            } else {
                const biasShift = (view.clockBiasNs / 120) * 24;
                drawSatellite(centerX, panel.y + 46, 0.92);
                drawSatellite(centerX - 64, centerY - 10, 0.84);
                drawSatellite(centerX + 64, centerY - 10, 0.84);
                drawSatellite(centerX, centerY + 54, 0.84);
                drawClockIcon(centerX + 62, panel.y + 56, 18, 'rgba(255, 207, 101, 0.92)');
                context.fillStyle = 'rgba(255, 255, 255, 0.16)';
                context.beginPath();
                context.arc(centerX + biasShift * 0.5, centerY + 10, 8, 0, TAU);
                context.fill();
                context.fillStyle = 'rgba(125, 230, 199, 0.96)';
                context.beginPath();
                context.arc(centerX, centerY + 10, 6, 0, TAU);
                context.fill();
                context.strokeStyle = 'rgba(255, 207, 101, 0.72)';
                context.lineWidth = 2;
                context.beginPath();
                context.moveTo(centerX + biasShift * 0.5, centerY + 10);
                context.lineTo(centerX, centerY + 10);
                context.stroke();
                context.fillStyle = 'rgba(214, 226, 242, 0.82)';
                context.font = '500 13px IBM Plex Sans JP';
                context.fillText('時計補正込みで 1 点へ', panel.x + 22, panel.y + panelHeight - 26);
            }
        });

        drawTag('ρ_i = |r - r_i| + cδt', width - 236, 28, 'rgba(7, 16, 29, 0.78)', 'rgba(255, 255, 255, 0.14)', '#f4fbff');
        drawTag(`clock bias ${view.clockBiasNs.toFixed(0)} ns`, 60, 24, 'rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.14)', '#152b45');
    }

    function drawRelativity(view) {
        const { width, height, tick } = state;
        const earthX = width * 0.28;
        const earthY = height * 0.66;
        const earthRadius = 78;
        const orbitRadius = 128 + view.heightKm / 26000 * 58;
        const orbitAngle = -Math.PI * 0.46 + tick * 0.22;
        const satX = earthX + Math.cos(orbitAngle) * orbitRadius;
        const satY = earthY + Math.sin(orbitAngle) * orbitRadius;
        const hoursRatio = view.hours / 24;
        const srHours = view.srPerDayUs * hoursRatio;
        const grHours = view.grPerDayUs * hoursRatio;
        const totalHours = view.totalIntervalUs;

        context.beginPath();
        context.arc(earthX, earthY, earthRadius, 0, TAU);
        context.fillStyle = 'rgba(28, 116, 162, 0.88)';
        context.fill();
        context.fillStyle = 'rgba(125, 230, 199, 0.4)';
        context.beginPath();
        context.arc(earthX - 12, earthY - 8, earthRadius * 0.42, 0, TAU);
        context.fill();

        context.strokeStyle = 'rgba(100, 210, 255, 0.28)';
        context.lineWidth = 2;
        context.beginPath();
        context.arc(earthX, earthY, orbitRadius, 0, TAU);
        context.stroke();

        drawSatellite(satX, satY, 1.25);
        drawClockIcon(earthX - 122, earthY + 26, 22, 'rgba(255, 207, 101, 0.92)');
        drawClockIcon(satX + 52, satY - 8, 18, 'rgba(100, 210, 255, 0.92)');

        context.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        context.lineWidth = 1.6;
        context.beginPath();
        context.moveTo(earthX, earthY);
        context.lineTo(satX, satY);
        context.stroke();

        const panelX = width * 0.56;
        const panelY = 70;
        const panelWidth = width * 0.34;
        const panelHeight = height - 140;
        drawPanel(panelX, panelY, panelWidth, panelHeight, false);
        context.fillStyle = 'rgba(240, 247, 255, 0.92)';
        context.font = '600 16px IBM Plex Sans JP';
        context.fillText('Clock Drift Budget', panelX + 22, panelY + 28);

        const baselineY = panelY + panelHeight * 0.62;
        context.strokeStyle = 'rgba(255, 255, 255, 0.16)';
        context.lineWidth = 1.4;
        context.beginPath();
        context.moveTo(panelX + 24, baselineY);
        context.lineTo(panelX + panelWidth - 24, baselineY);
        context.stroke();

        const scale = 3.4;
        const barWidth = 34;
        const barXs = [panelX + 58, panelX + 118, panelX + 178];
        const values = [grHours, Math.abs(srHours), Math.abs(totalHours)];
        const colors = ['rgba(125, 230, 199, 0.92)', 'rgba(255, 207, 101, 0.92)', 'rgba(100, 210, 255, 0.92)'];
        const directions = [-1, 1, -Math.sign(totalHours || 1)];
        const labels = ['GR', 'SR', 'Net'];

        values.forEach((value, index) => {
            const barHeight = Math.min(126, Math.abs(value) * scale);
            const x = barXs[index];
            const direction = directions[index];
            const y = direction >= 0 ? baselineY : baselineY - barHeight;
            roundedRectPath(x, y, barWidth, barHeight, 12);
            context.fillStyle = colors[index];
            context.fill();
            context.fillStyle = 'rgba(240, 247, 255, 0.88)';
            context.font = '600 13px IBM Plex Sans JP';
            context.fillText(labels[index], x + 4, baselineY + 24);
        });

        context.fillStyle = 'rgba(214, 226, 242, 0.84)';
        context.font = '500 14px IBM Plex Sans JP';
        context.fillText(`speed ≈ ${(view.orbitalSpeed / 1000).toFixed(2)} km/s`, panelX + 22, panelY + panelHeight - 58);
        context.fillText(`drift ≈ ${view.driftKm.toFixed(2)} km / ${Math.round(view.hours)} h`, panelX + 22, panelY + panelHeight - 32);

        drawTag(`height ${Math.round(view.heightKm)} km`, 52, 30, 'rgba(7, 16, 29, 0.78)', 'rgba(255, 255, 255, 0.14)', '#f4fbff');
        drawTag(`${view.totalPerDayUs.toFixed(1)} μs/day`, width - 192, 30, 'rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.14)', '#152b45');
    }

    function drawErrors(view) {
        const { width, height } = state;
        const satX = width * 0.76;
        const satY = 72;
        const receiverX = width * 0.5;
        const receiverY = height * 0.76;
        const buildingHeight = 150 + view.atmosphere * 38;

        context.fillStyle = 'rgba(84, 154, 219, 0.14)';
        context.fillRect(0, 48, width, 64);
        context.fillStyle = 'rgba(255, 207, 101, 0.12)';
        context.fillRect(0, 112, width, 54);

        context.fillStyle = 'rgba(214, 226, 242, 0.82)';
        context.font = '600 13px IBM Plex Sans JP';
        context.fillText('Ionosphere', 36, 86);
        context.fillText('Troposphere', 36, 144);

        drawSatellite(satX, satY, 1.25);
        drawReceiver(receiverX, receiverY);

        context.fillStyle = 'rgba(18, 37, 62, 0.88)';
        context.fillRect(120, height - buildingHeight - 20, 92, buildingHeight);
        context.fillRect(width - 210, height - buildingHeight - 46, 106, buildingHeight + 26);

        context.strokeStyle = 'rgba(100, 210, 255, 0.92)';
        context.lineWidth = 3;
        context.beginPath();
        context.moveTo(satX, satY);
        context.lineTo(receiverX, receiverY);
        context.stroke();

        context.strokeStyle = `rgba(255, 207, 101, ${0.32 + (view.multipathM / 6) * 0.5})`;
        context.lineWidth = 2.4;
        context.beginPath();
        context.moveTo(satX, satY);
        context.lineTo(width - 158, height - buildingHeight - 46);
        context.lineTo(receiverX, receiverY);
        context.stroke();

        const baseX = 66;
        const baseY = height - 72;
        context.fillStyle = 'rgba(125, 230, 199, 0.9)';
        roundedRectPath(baseX, baseY, 64, 28, 14);
        context.fill();
        context.strokeStyle = 'rgba(125, 230, 199, 0.74)';
        context.lineWidth = 2.4;
        context.beginPath();
        context.moveTo(baseX + 64, baseY + 14);
        context.lineTo(receiverX - 18, receiverY + 4);
        context.stroke();

        drawPanel(width * 0.58, height - 170, width * 0.3, 118, false);
        const rawBarWidth = width * 0.22;
        const correctedBarWidth = Math.max(14, rawBarWidth * Math.min(1, view.residualErrorM / Math.max(view.rawErrorM, 0.01)));
        const barX = width * 0.61;
        const rawY = height - 130;
        const correctedY = height - 88;

        roundedRectPath(barX, rawY, rawBarWidth, 16, 8);
        context.fillStyle = 'rgba(255, 207, 101, 0.88)';
        context.fill();
        roundedRectPath(barX, correctedY, correctedBarWidth, 16, 8);
        context.fillStyle = 'rgba(125, 230, 199, 0.9)';
        context.fill();

        context.fillStyle = 'rgba(240, 247, 255, 0.92)';
        context.font = '600 14px IBM Plex Sans JP';
        context.fillText('Raw error', barX, rawY - 8);
        context.fillText(view.correctionName, barX, correctedY - 8);
        context.font = '500 13px IBM Plex Sans JP';
        context.fillStyle = 'rgba(214, 226, 242, 0.84)';
        context.fillText(view.rawErrorM.toFixed(2) + ' m', barX + rawBarWidth + 10, rawY + 13);
        context.fillText(formatMeters(view.residualErrorM), barX + rawBarWidth + 10, correctedY + 13);

        drawTag(view.correctionName, 54, 30, 'rgba(7, 16, 29, 0.78)', 'rgba(255, 255, 255, 0.14)', '#f4fbff');
        drawTag(`multipath ${view.multipathM.toFixed(1)} m`, width - 182, 30, 'rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.14)', '#152b45');
    }

    function drawFrame(timestamp) {
        const deltaTime = clamp((timestamp - state.lastTime) / 1000, 0, 0.04);
        state.lastTime = timestamp;
        state.tick += deltaTime;

        context.clearRect(0, 0, state.width, state.height);
        drawBackdrop();

        if (currentView) {
            if (currentView.kind === 'ranging') {
                drawRanging(currentView);
            } else if (currentView.kind === 'geometry') {
                drawGeometry(currentView);
            } else if (currentView.kind === 'relativity') {
                drawRelativity(currentView);
            } else if (currentView.kind === 'errors') {
                drawErrors(currentView);
            }
        }

        requestAnimationFrame(drawFrame);
    }

    modeRow.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (!target.matches('.mode-chip')) return;
        setMode(target.dataset.mode || 'ranging');
    });

    primaryRange.addEventListener('input', rebuildView);
    secondaryRange.addEventListener('input', rebuildView);
    window.addEventListener('resize', () => {
        resizeCanvas();
    });

    setMode('ranging');
    resizeCanvas();
    rebuildView();
    drawFrame(performance.now());
})();