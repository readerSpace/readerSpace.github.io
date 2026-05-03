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

    const canvas = document.getElementById('entropyCanvas');
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
    const uncertaintyValue = document.getElementById('uncertaintyValue');
    const patternValue = document.getElementById('patternValue');
    const increaseValue = document.getElementById('increaseValue');
    const extremeValue = document.getElementById('extremeValue');
    const statusValue = document.getElementById('statusValue');

    const TAU = Math.PI * 2;

    const modeConfig = {
        chance: {
            primary: {
                label: '表の確率',
                min: 0,
                max: 100,
                step: 1,
                value: 50,
                format: (value) => `${Math.round(value)}%`
            },
            secondary: {
                label: '試行数',
                min: 24,
                max: 120,
                step: 1,
                value: 64,
                format: (value) => `${Math.round(value)} 回`
            }
        },
        mixing: {
            primary: {
                label: '広がり',
                min: 0,
                max: 100,
                step: 1,
                value: 28,
                format: (value) => `${Math.round(value)}%`
            },
            secondary: {
                label: '粒子数',
                min: 20,
                max: 120,
                step: 1,
                value: 72,
                format: (value) => `${Math.round(value)} 個`
            }
        },
        chaos: {
            primary: {
                label: 'Lyapunov',
                min: 0.1,
                max: 1.6,
                step: 0.05,
                value: 0.72,
                format: (value) => value.toFixed(2)
            },
            secondary: {
                label: '観測時間',
                min: 0,
                max: 100,
                step: 1,
                value: 44,
                format: (value) => `${Math.round(value)}%`
            }
        },
        horizon: {
            primary: {
                label: '半径',
                min: 30,
                max: 100,
                step: 1,
                value: 62,
                format: (value) => `${Math.round(value)}`
            },
            secondary: {
                label: '蒸発段階',
                min: 0,
                max: 100,
                step: 1,
                value: 36,
                format: (value) => `${Math.round(value)}%`
            }
        }
    };

    const state = {
        mode: 'chance',
        width: 900,
        height: 520,
        tick: 0,
        lastTime: performance.now()
    };

    let currentView = null;

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function normalize(value, min, max) {
        if (max === min) return 0;
        return (value - min) / (max - min);
    }

    function hash(index, seed = 0) {
        const rawValue = Math.sin(index * 127.1 + seed * 311.7) * 43758.5453;
        return rawValue - Math.floor(rawValue);
    }

    function safeLog2(value) {
        return Math.log2(Math.max(value, 1e-9));
    }

    function binaryEntropy(probability) {
        const headProbability = clamp(probability, 0, 1);
        const tailProbability = 1 - headProbability;
        let entropy = 0;
        if (headProbability > 0) entropy -= headProbability * safeLog2(headProbability);
        if (tailProbability > 0) entropy -= tailProbability * safeLog2(tailProbability);
        return entropy;
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

    function buildChanceView(controls) {
        const headProbability = controls.primary / 100;
        const tailProbability = 1 - headProbability;
        const entropyBits = binaryEntropy(headProbability);
        const trialCount = Math.round(controls.secondary);
        const rareProbability = Math.max(Math.min(headProbability, tailProbability), 0.001);
        const surpriseBits = -safeLog2(rareProbability);
        return {
            kind: 'chance',
            headProbability,
            tailProbability,
            entropyBits,
            trialCount,
            surpriseBits,
            uncertaintyText: `表 ${Math.round(headProbability * 100)}% / 裏 ${Math.round(tailProbability * 100)}% のとき、平均の不確実さは ${entropyBits.toFixed(2)} bit です。`,
            patternText: '同じ 2 通りの結果でも、偏るほど実質的に区別すべき可能性は減っていきます。',
            increaseText: 'シャノンエントロピーは平均の驚きなので、50/50 で最大、0/100 で最小になります。',
            extremeText: `珍しい側が 1 回起きたときの情報量は約 ${surpriseBits.toFixed(2)} bit です。`,
            statusText: 'エントロピーは「結果が何通りあり、どれだけ偏っているか」を要約する量です。',
            narration: 'コインモードでは、確率の偏りを変えたときにシャノンエントロピーがどう変わるかを見てください。'
        };
    }

    function buildMixingView(controls) {
        const spread = controls.primaryNorm;
        const particleCount = Math.round(controls.secondary);
        const binCount = 8;
        const occupancies = new Array(binCount).fill(0);
        const particles = [];

        for (let particleIndex = 0; particleIndex < particleCount; particleIndex += 1) {
            const clusteredX = 0.12 + (hash(particleIndex, 1) - 0.5) * 0.16;
            const mixedX = 0.1 + hash(particleIndex, 2) * 0.8;
            const positionX = clamp((1 - spread) * clusteredX + spread * mixedX + (hash(particleIndex, 3) - 0.5) * 0.08 * spread, 0.05, 0.95);
            const positionY = 0.12 + hash(particleIndex, 4) * 0.76;
            const binIndex = Math.min(binCount - 1, Math.floor(positionX * binCount));
            occupancies[binIndex] += 1;
            particles.push({ positionX, positionY });
        }

        let entropyBits = 0;
        for (const occupancy of occupancies) {
            if (occupancy === 0) continue;
            const probability = occupancy / particleCount;
            entropyBits -= probability * safeLog2(probability);
        }
        const normalizedEntropy = entropyBits / safeLog2(binCount);
        const reverseLikelihood = Math.pow(Math.max(1 - spread * 0.94, 0.01), particleCount);
        return {
            kind: 'mixing',
            spread,
            particleCount,
            particles,
            occupancies,
            normalizedEntropy,
            reverseLikelihood,
            uncertaintyText: `粒子が広がるほど、どの領域に何個あるかの予測は難しくなります。今の粗視化エントロピーは ${normalizedEntropy.toFixed(2)} です。`,
            patternText: '広がった配置の方が、集中した配置よりも圧倒的にたくさんあります。',
            increaseText: '第二法則は命令ではなく、状態数の圧倒的な偏りから見える統計的な流れです。',
            extremeText: reverseLikelihood < 1e-6
                ? '元の一角へ自然に戻る確率は極端に小さく、日常ではまず見えません。'
                : `偶然に元へ戻る確率は約 ${(reverseLikelihood * 100).toFixed(4)}% です。`,
            statusText: 'インクが広がるのは「広がる側が普通だから」であって、不可思議な命令があるからではありません。',
            narration: '拡散モードでは、粒子が広がるほどマクロな状態数が増え、第二法則がどう見えてくるかを見てください。'
        };
    }

    function buildChaosView(controls) {
        const lyapunov = controls.primary;
        const observationFraction = controls.secondaryNorm;
        const observationTime = 0.6 + observationFraction * 8.4;
        const separationGrowth = Math.exp(lyapunov * observationTime);
        const normalizedGrowth = clamp(separationGrowth / 120, 0, 1);
        const predictabilityHorizon = Math.log(1000) / lyapunov;
        const ksEntropy = lyapunov;
        return {
            kind: 'chaos',
            lyapunov,
            observationFraction,
            observationTime,
            separationGrowth,
            normalizedGrowth,
            predictabilityHorizon,
            ksEntropy,
            uncertaintyText: `Lyapunov 指数 ${lyapunov.toFixed(2)} では、初期誤差が e^{λt} の速さで増えます。今の増倍率は約 ${separationGrowth.toFixed(1)} 倍です。`,
            patternText: '未来を言い当てるには、時間が進むほど追加の桁数が必要になります。',
            increaseText: `KS エントロピーはおおまかに ${ksEntropy.toFixed(2)} bit/時間の情報生成率として読めます。`,
            extremeText: `この設定なら予測可能時間の目安は約 ${predictabilityHorizon.toFixed(1)} です。`,
            statusText: 'カオスでエントロピーが意味するのは、熱ではなく「未来予測に必要な情報がどれだけ増えるか」です。',
            narration: 'カオスモードでは、初期値の差が指数的に増えて予測可能時間を削る様子を見てください。'
        };
    }

    function buildHorizonView(controls) {
        const radius = controls.primary;
        const evaporation = controls.secondaryNorm;
        const area = 4 * Math.PI * radius * radius;
        const relativeEntropy = (radius * radius) / (100 * 100);
        const pageEntropy = evaporation < 0.5 ? evaporation * 2 : (1 - evaporation) * 2;
        const recoveryFraction = evaporation <= 0.5 ? 0 : (evaporation - 0.5) * 2;
        const temperatureScale = 100 / radius;
        return {
            kind: 'horizon',
            radius,
            evaporation,
            area,
            relativeEntropy,
            pageEntropy,
            recoveryFraction,
            temperatureScale,
            uncertaintyText: '外から見えるのは質量・電荷・回転だけで、内部の細部は隠れています。',
            patternText: `半径 ${Math.round(radius)} の地平線では、相対的なエントロピー量は ${relativeEntropy.toFixed(2)} です。面積が増えるほど隠せる状態数も増えます。`,
            increaseText: `蒸発段階 ${Math.round(evaporation * 100)}% ではページ曲線の放射エントロピーは ${pageEntropy.toFixed(2)} の位置です。`,
            extremeText: recoveryFraction === 0
                ? 'ページ時間より前では、放射はほぼ熱的に見え、情報回収は目立ちません。'
                : `ページ時間以後は、情報回収の比率が約 ${Math.round(recoveryFraction * 100)}% まで進みます。`,
            statusText: `ブラックホールは温度がおよそ 1 / r に反比例し、エントロピーは r^2 に比例します。温度と情報量が逆向きに動くのが特徴です。`,
            narration: '地平線モードでは、地平線面積、ホーキング放射、ページ曲線がどうつながるかを見てください。'
        };
    }

    function buildView() {
        const controls = readControls();
        updateRangeLabels(controls);
        switch (state.mode) {
            case 'mixing':
                return buildMixingView(controls);
            case 'chaos':
                return buildChaosView(controls);
            case 'horizon':
                return buildHorizonView(controls);
            case 'chance':
            default:
                return buildChanceView(controls);
        }
    }

    function rebuildView() {
        currentView = buildView();
        uncertaintyValue.textContent = currentView.uncertaintyText;
        patternValue.textContent = currentView.patternText;
        increaseValue.textContent = currentView.increaseText;
        extremeValue.textContent = currentView.extremeText;
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

    function roundedRectPath(positionX, positionY, width, height, radius) {
        const safeRadius = Math.min(radius, width * 0.5, height * 0.5);
        context.beginPath();
        context.moveTo(positionX + safeRadius, positionY);
        context.arcTo(positionX + width, positionY, positionX + width, positionY + height, safeRadius);
        context.arcTo(positionX + width, positionY + height, positionX, positionY + height, safeRadius);
        context.arcTo(positionX, positionY + height, positionX, positionY, safeRadius);
        context.arcTo(positionX, positionY, positionX + width, positionY, safeRadius);
        context.closePath();
    }

    function drawPanel(positionX, positionY, width, height, fill = 'rgba(255, 255, 255, 0.045)', stroke = 'rgba(255, 255, 255, 0.1)') {
        roundedRectPath(positionX, positionY, width, height, 24);
        context.fillStyle = fill;
        context.fill();
        context.strokeStyle = stroke;
        context.lineWidth = 1.3;
        context.stroke();
    }

    function drawTag(text, positionX, positionY, fill, stroke, color) {
        context.save();
        context.font = '600 13px IBM Plex Sans JP';
        const width = context.measureText(text).width + 22;
        roundedRectPath(positionX, positionY, width, 30, 15);
        context.fillStyle = fill;
        context.fill();
        if (stroke) {
            context.strokeStyle = stroke;
            context.stroke();
        }
        context.fillStyle = color;
        context.fillText(text, positionX + 11, positionY + 20);
        context.restore();
    }

    function drawBackdrop() {
        const { width, height, tick } = state;
        const gradient = context.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, '#111a18');
        gradient.addColorStop(0.48, '#243732');
        gradient.addColorStop(1, '#476a63');
        context.fillStyle = gradient;
        context.fillRect(0, 0, width, height);

        const glowLeft = context.createRadialGradient(width * 0.18, height * 0.2, 12, width * 0.18, height * 0.2, width * 0.24);
        glowLeft.addColorStop(0, 'rgba(124, 203, 176, 0.18)');
        glowLeft.addColorStop(1, 'rgba(124, 203, 176, 0)');
        context.fillStyle = glowLeft;
        context.fillRect(0, 0, width, height);

        const glowRight = context.createRadialGradient(width * 0.78, height * 0.18, 12, width * 0.78, height * 0.18, width * 0.18);
        glowRight.addColorStop(0, 'rgba(239, 187, 114, 0.16)');
        glowRight.addColorStop(1, 'rgba(239, 187, 114, 0)');
        context.fillStyle = glowRight;
        context.fillRect(0, 0, width, height);

        context.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        context.lineWidth = 1;
        for (let gridX = 0; gridX <= width; gridX += 40) {
            context.beginPath();
            context.moveTo(gridX, 0);
            context.lineTo(gridX, height);
            context.stroke();
        }
        for (let gridY = 0; gridY <= height; gridY += 40) {
            context.beginPath();
            context.moveTo(0, gridY);
            context.lineTo(width, gridY);
            context.stroke();
        }

        for (let pointIndex = 0; pointIndex < 64; pointIndex += 1) {
            const pointX = hash(pointIndex, 1) * width;
            const pointY = hash(pointIndex, 2) * height;
            const pointSize = 0.6 + hash(pointIndex, 3) * 1.4;
            const alpha = 0.18 + hash(pointIndex, 4) * 0.34;
            context.fillStyle = `rgba(255, 255, 255, ${alpha})`;
            context.beginPath();
            context.arc(pointX, pointY + Math.sin(tick * 0.3 + pointIndex) * 0.4, pointSize, 0, TAU);
            context.fill();
        }
    }

    function drawChance(view) {
        const { width, height } = state;
        const coinPanelX = 54;
        const coinPanelY = 74;
        const coinPanelWidth = width * 0.44;
        const coinPanelHeight = height * 0.62;
        drawPanel(coinPanelX, coinPanelY, coinPanelWidth, coinPanelHeight);

        const coinColumns = 8;
        const coinRadius = 18;
        const coinGapX = (coinPanelWidth - 76) / (coinColumns - 1);
        const coinRows = Math.ceil(view.trialCount / coinColumns);
        const coinGapY = Math.min((coinPanelHeight - 92) / Math.max(coinRows - 1, 1), 44);
        let headCount = 0;
        for (let trialIndex = 0; trialIndex < view.trialCount; trialIndex += 1) {
            const randomValue = hash(trialIndex, 7);
            const isHead = randomValue < view.headProbability;
            if (isHead) headCount += 1;
            const columnIndex = trialIndex % coinColumns;
            const rowIndex = Math.floor(trialIndex / coinColumns);
            const centerX = coinPanelX + 38 + columnIndex * coinGapX;
            const centerY = coinPanelY + 52 + rowIndex * coinGapY;
            const gradient = context.createLinearGradient(centerX, centerY - coinRadius, centerX, centerY + coinRadius);
            if (isHead) {
                gradient.addColorStop(0, 'rgba(255, 251, 240, 0.98)');
                gradient.addColorStop(1, 'rgba(124, 203, 176, 0.92)');
            } else {
                gradient.addColorStop(0, 'rgba(255, 250, 235, 0.98)');
                gradient.addColorStop(1, 'rgba(239, 187, 114, 0.92)');
            }
            context.fillStyle = gradient;
            context.beginPath();
            context.arc(centerX, centerY, coinRadius, 0, TAU);
            context.fill();
            context.strokeStyle = 'rgba(255, 255, 255, 0.28)';
            context.lineWidth = 1.4;
            context.stroke();
            context.fillStyle = 'rgba(16, 33, 29, 0.9)';
            context.font = '600 14px IBM Plex Sans JP';
            context.fillText(isHead ? 'H' : 'T', centerX - 5, centerY + 5);
        }

        context.fillStyle = 'rgba(255, 248, 242, 0.88)';
        context.font = '600 14px IBM Plex Sans JP';
        context.fillText(`heads ${headCount}`, coinPanelX + 18, coinPanelY + coinPanelHeight - 16);
        context.fillText(`tails ${view.trialCount - headCount}`, coinPanelX + 138, coinPanelY + coinPanelHeight - 16);

        const curveX = width * 0.58;
        const curveY = 78;
        const curveWidth = width * 0.31;
        const curveHeight = height * 0.48;
        drawPanel(curveX, curveY, curveWidth, curveHeight);

        const originX = curveX + 32;
        const originY = curveY + curveHeight - 30;
        context.strokeStyle = 'rgba(255, 255, 255, 0.18)';
        context.lineWidth = 1.2;
        context.beginPath();
        context.moveTo(originX, curveY + 20);
        context.lineTo(originX, originY);
        context.lineTo(curveX + curveWidth - 16, originY);
        context.stroke();

        context.strokeStyle = 'rgba(124, 203, 176, 0.9)';
        context.lineWidth = 3;
        context.beginPath();
        for (let sampleIndex = 0; sampleIndex <= 120; sampleIndex += 1) {
            const probability = sampleIndex / 120;
            const entropy = binaryEntropy(probability);
            const pointX = originX + probability * (curveWidth - 52);
            const pointY = originY - entropy * (curveHeight - 54);
            if (sampleIndex === 0) {
                context.moveTo(pointX, pointY);
            } else {
                context.lineTo(pointX, pointY);
            }
        }
        context.stroke();

        const markerX = originX + view.headProbability * (curveWidth - 52);
        const markerY = originY - view.entropyBits * (curveHeight - 54);
        context.fillStyle = 'rgba(255, 244, 220, 0.96)';
        context.beginPath();
        context.arc(markerX, markerY, 6, 0, TAU);
        context.fill();

        context.fillStyle = 'rgba(255, 248, 242, 0.88)';
        context.fillText('H(p)', curveX + 12, curveY + 22);
        context.fillText('p', curveX + curveWidth - 22, originY + 20);

        const barX = width * 0.58;
        const barY = height - 74;
        const barWidth = width * 0.28;
        roundedRectPath(barX, barY, barWidth, 18, 9);
        context.fillStyle = 'rgba(255, 255, 255, 0.08)';
        context.fill();
        roundedRectPath(barX, barY, barWidth * view.entropyBits, 18, 9);
        context.fillStyle = 'rgba(239, 187, 114, 0.92)';
        context.fill();

        drawTag(`H = ${view.entropyBits.toFixed(2)} bit`, 54, 30, 'rgba(19, 32, 29, 0.78)', 'rgba(255, 255, 255, 0.14)', '#fff8f2');
        drawTag(`surprise ${view.surpriseBits.toFixed(2)} bit`, width - 178, 30, 'rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.14)', '#243632');
    }

    function drawMixing(view) {
        const { width, height, tick } = state;
        const chamberX = 60;
        const chamberY = 74;
        const chamberWidth = width * 0.62;
        const chamberHeight = height * 0.58;
        drawPanel(chamberX, chamberY, chamberWidth, chamberHeight);

        for (let binIndex = 1; binIndex < 8; binIndex += 1) {
            const binX = chamberX + (binIndex / 8) * chamberWidth;
            context.strokeStyle = 'rgba(255, 255, 255, 0.08)';
            context.lineWidth = 1;
            context.beginPath();
            context.moveTo(binX, chamberY + 12);
            context.lineTo(binX, chamberY + chamberHeight - 12);
            context.stroke();
        }

        const concentratedWidth = chamberWidth * (0.18 + (1 - view.spread) * 0.18);
        context.fillStyle = `rgba(124, 203, 176, ${0.08 + (1 - view.spread) * 0.16})`;
        context.fillRect(chamberX + 12, chamberY + 12, concentratedWidth, chamberHeight - 24);

        for (let particleIndex = 0; particleIndex < view.particles.length; particleIndex += 1) {
            const particle = view.particles[particleIndex];
            const pointX = chamberX + particle.positionX * chamberWidth;
            const pointY = chamberY + particle.positionY * chamberHeight + Math.sin(tick * 2 + particleIndex) * 1.2;
            const particleRadius = 4 + hash(particleIndex, 8) * 2.6;
            context.fillStyle = `rgba(255, ${235 - particleRadius * 6}, ${210 - particleRadius * 8}, 0.92)`;
            context.beginPath();
            context.arc(pointX, pointY, particleRadius, 0, TAU);
            context.fill();
        }

        const histogramX = width * 0.74;
        const histogramY = 80;
        const histogramWidth = width * 0.16;
        const histogramHeight = height * 0.46;
        drawPanel(histogramX, histogramY, histogramWidth, histogramHeight);
        context.fillStyle = 'rgba(255, 248, 242, 0.88)';
        context.font = '600 14px IBM Plex Sans JP';
        context.fillText('macro bins', histogramX + 12, histogramY + 24);

        const maxOccupancy = Math.max(...view.occupancies, 1);
        for (let binIndex = 0; binIndex < view.occupancies.length; binIndex += 1) {
            const occupancy = view.occupancies[binIndex];
            const barHeight = (occupancy / maxOccupancy) * (histogramHeight - 56);
            const barWidth = 12;
            const spacing = 4;
            const barX = histogramX + 12 + binIndex * (barWidth + spacing);
            const barY = histogramY + histogramHeight - 20 - barHeight;
            roundedRectPath(barX, barY, barWidth, barHeight, 6);
            context.fillStyle = 'rgba(239, 187, 114, 0.9)';
            context.fill();
        }

        const entropyBarX = 60;
        const entropyBarY = height - 74;
        const entropyBarWidth = width * 0.34;
        roundedRectPath(entropyBarX, entropyBarY, entropyBarWidth, 18, 9);
        context.fillStyle = 'rgba(255, 255, 255, 0.08)';
        context.fill();
        roundedRectPath(entropyBarX, entropyBarY, entropyBarWidth * view.normalizedEntropy, 18, 9);
        context.fillStyle = 'rgba(124, 203, 176, 0.92)';
        context.fill();

        drawTag(`coarse entropy ${view.normalizedEntropy.toFixed(2)}`, 54, 30, 'rgba(19, 32, 29, 0.78)', 'rgba(255, 255, 255, 0.14)', '#fff8f2');
        drawTag(`particles ${view.particleCount}`, width - 128, 30, 'rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.14)', '#243632');
    }

    function drawChaos(view) {
        const { width, height, tick } = state;
        const trajectoryX = 52;
        const trajectoryY = 80;
        const trajectoryWidth = width * 0.5;
        const trajectoryHeight = height * 0.5;
        drawPanel(trajectoryX, trajectoryY, trajectoryWidth, trajectoryHeight);

        context.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(trajectoryX + 18, trajectoryY + trajectoryHeight * 0.5);
        context.lineTo(trajectoryX + trajectoryWidth - 18, trajectoryY + trajectoryHeight * 0.5);
        context.stroke();

        context.strokeStyle = 'rgba(124, 203, 176, 0.94)';
        context.lineWidth = 2.6;
        context.beginPath();
        for (let sampleIndex = 0; sampleIndex <= 220; sampleIndex += 1) {
            const timeFraction = sampleIndex / 220;
            const localTime = timeFraction * view.observationTime;
            const pointX = trajectoryX + 20 + timeFraction * (trajectoryWidth - 40);
            const baseY = trajectoryY + trajectoryHeight * 0.52 + Math.sin(localTime * 2.7 + tick * 0.4) * 34 + Math.sin(localTime * 0.7 + 0.5) * 18;
            if (sampleIndex === 0) {
                context.moveTo(pointX, baseY);
            } else {
                context.lineTo(pointX, baseY);
            }
        }
        context.stroke();

        context.strokeStyle = 'rgba(239, 187, 114, 0.94)';
        context.lineWidth = 2.6;
        context.beginPath();
        for (let sampleIndex = 0; sampleIndex <= 220; sampleIndex += 1) {
            const timeFraction = sampleIndex / 220;
            const localTime = timeFraction * view.observationTime;
            const pointX = trajectoryX + 20 + timeFraction * (trajectoryWidth - 40);
            const baseY = trajectoryY + trajectoryHeight * 0.52 + Math.sin(localTime * 2.7 + tick * 0.4) * 34 + Math.sin(localTime * 0.7 + 0.5) * 18;
            const offset = clamp(Math.exp(view.lyapunov * localTime) * 0.9, 0, 120);
            const pointY = baseY + offset;
            if (sampleIndex === 0) {
                context.moveTo(pointX, pointY);
            } else {
                context.lineTo(pointX, pointY);
            }
        }
        context.stroke();

        const growthX = width * 0.64;
        const growthY = 82;
        const growthWidth = width * 0.24;
        const growthHeight = height * 0.48;
        drawPanel(growthX, growthY, growthWidth, growthHeight);
        const growthOriginX = growthX + 28;
        const growthOriginY = growthY + growthHeight - 28;
        context.strokeStyle = 'rgba(255, 255, 255, 0.18)';
        context.lineWidth = 1.2;
        context.beginPath();
        context.moveTo(growthOriginX, growthY + 20);
        context.lineTo(growthOriginX, growthOriginY);
        context.lineTo(growthX + growthWidth - 16, growthOriginY);
        context.stroke();

        context.strokeStyle = 'rgba(239, 187, 114, 0.92)';
        context.lineWidth = 3;
        context.beginPath();
        for (let sampleIndex = 0; sampleIndex <= 120; sampleIndex += 1) {
            const timeFraction = sampleIndex / 120;
            const localTime = timeFraction * view.observationTime;
            const growth = clamp(Math.exp(view.lyapunov * localTime) / 120, 0, 1);
            const pointX = growthOriginX + timeFraction * (growthWidth - 48);
            const pointY = growthOriginY - growth * (growthHeight - 52);
            if (sampleIndex === 0) {
                context.moveTo(pointX, pointY);
            } else {
                context.lineTo(pointX, pointY);
            }
        }
        context.stroke();

        const markerX = growthOriginX + (view.observationTime / 9) * (growthWidth - 48);
        const markerY = growthOriginY - view.normalizedGrowth * (growthHeight - 52);
        context.fillStyle = 'rgba(255, 244, 220, 0.96)';
        context.beginPath();
        context.arc(markerX, markerY, 6, 0, TAU);
        context.fill();

        drawTag(`hKS ~ ${view.ksEntropy.toFixed(2)}`, 54, 30, 'rgba(19, 32, 29, 0.78)', 'rgba(255, 255, 255, 0.14)', '#fff8f2');
        drawTag(`growth ${view.separationGrowth.toFixed(1)}x`, width - 154, 30, 'rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.14)', '#243632');
    }

    function drawHorizon(view) {
        const { width, height, tick } = state;
        const horizonCenterX = width * 0.34;
        const horizonCenterY = height * 0.54;
        const horizonRadius = 38 + view.radius * 0.95;

        context.beginPath();
        context.arc(horizonCenterX, horizonCenterY, horizonRadius + 18, 0, TAU);
        const halo = context.createRadialGradient(horizonCenterX, horizonCenterY, 10, horizonCenterX, horizonCenterY, horizonRadius + 24);
        halo.addColorStop(0, 'rgba(239, 187, 114, 0)');
        halo.addColorStop(0.7, 'rgba(239, 187, 114, 0.2)');
        halo.addColorStop(1, 'rgba(239, 187, 114, 0)');
        context.fillStyle = halo;
        context.fill();

        context.beginPath();
        context.arc(horizonCenterX, horizonCenterY, horizonRadius, 0, TAU);
        context.fillStyle = 'rgba(10, 15, 15, 0.98)';
        context.fill();
        context.strokeStyle = 'rgba(255, 233, 196, 0.72)';
        context.lineWidth = 2;
        context.stroke();

        for (let ringIndex = 0; ringIndex < 3; ringIndex += 1) {
            context.beginPath();
            context.arc(horizonCenterX, horizonCenterY, horizonRadius + 10 + ringIndex * 10, 0, TAU);
            context.strokeStyle = `rgba(255, 255, 255, ${0.08 - ringIndex * 0.018})`;
            context.lineWidth = 1;
            context.stroke();
        }

        const infallingBits = 12;
        for (let bitIndex = 0; bitIndex < infallingBits; bitIndex += 1) {
            const offset = (bitIndex / infallingBits) * 120;
            const pointX = horizonCenterX - horizonRadius - 92 + offset;
            const pointY = horizonCenterY - 70 + Math.sin(tick * 1.8 + bitIndex) * 24;
            context.fillStyle = 'rgba(124, 203, 176, 0.94)';
            context.beginPath();
            context.arc(pointX, pointY, 5, 0, TAU);
            context.fill();
        }

        const outgoingCount = 8 + Math.round(view.evaporation * 12);
        for (let radiationIndex = 0; radiationIndex < outgoingCount; radiationIndex += 1) {
            const angle = -0.8 + radiationIndex * 0.18;
            const distance = horizonRadius + 40 + radiationIndex * 8 + Math.sin(tick * 2 + radiationIndex) * 4;
            const pointX = horizonCenterX + Math.cos(angle) * distance;
            const pointY = horizonCenterY + Math.sin(angle) * distance;
            context.fillStyle = radiationIndex % 2 === 0 ? 'rgba(255, 244, 220, 0.96)' : 'rgba(239, 187, 114, 0.92)';
            context.beginPath();
            context.arc(pointX, pointY, 4.4, 0, TAU);
            context.fill();
        }

        const curveX = width * 0.6;
        const curveY = 78;
        const curveWidth = width * 0.3;
        const curveHeight = height * 0.48;
        drawPanel(curveX, curveY, curveWidth, curveHeight);
        const originX = curveX + 30;
        const originY = curveY + curveHeight - 28;
        context.strokeStyle = 'rgba(255, 255, 255, 0.18)';
        context.lineWidth = 1.2;
        context.beginPath();
        context.moveTo(originX, curveY + 18);
        context.lineTo(originX, originY);
        context.lineTo(curveX + curveWidth - 16, originY);
        context.stroke();

        context.strokeStyle = 'rgba(124, 203, 176, 0.92)';
        context.lineWidth = 3;
        context.beginPath();
        for (let sampleIndex = 0; sampleIndex <= 140; sampleIndex += 1) {
            const timeFraction = sampleIndex / 140;
            const pageValue = timeFraction < 0.5 ? timeFraction * 2 : (1 - timeFraction) * 2;
            const pointX = originX + timeFraction * (curveWidth - 48);
            const pointY = originY - pageValue * (curveHeight - 52);
            if (sampleIndex === 0) {
                context.moveTo(pointX, pointY);
            } else {
                context.lineTo(pointX, pointY);
            }
        }
        context.stroke();

        const markerX = originX + view.evaporation * (curveWidth - 48);
        const markerY = originY - view.pageEntropy * (curveHeight - 52);
        context.fillStyle = 'rgba(255, 244, 220, 0.96)';
        context.beginPath();
        context.arc(markerX, markerY, 6, 0, TAU);
        context.fill();

        const barX = width * 0.58;
        const barY = height - 74;
        const barWidth = width * 0.28;
        roundedRectPath(barX, barY, barWidth, 18, 9);
        context.fillStyle = 'rgba(255, 255, 255, 0.08)';
        context.fill();
        roundedRectPath(barX, barY, barWidth * clamp(view.relativeEntropy, 0, 1), 18, 9);
        context.fillStyle = 'rgba(239, 187, 114, 0.92)';
        context.fill();

        drawTag(`area ${Math.round(view.area)}`, 54, 30, 'rgba(19, 32, 29, 0.78)', 'rgba(255, 255, 255, 0.14)', '#fff8f2');
        drawTag(`T ~ ${view.temperatureScale.toFixed(2)}`, width - 132, 30, 'rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.14)', '#243632');
    }

    function drawFrame(timestamp) {
        const deltaTime = clamp((timestamp - state.lastTime) / 1000, 0, 0.04);
        state.lastTime = timestamp;
        state.tick += deltaTime;

        context.clearRect(0, 0, state.width, state.height);
        drawBackdrop();

        if (currentView) {
            if (currentView.kind === 'chance') {
                drawChance(currentView);
            } else if (currentView.kind === 'mixing') {
                drawMixing(currentView);
            } else if (currentView.kind === 'chaos') {
                drawChaos(currentView);
            } else if (currentView.kind === 'horizon') {
                drawHorizon(currentView);
            }
        }

        requestAnimationFrame(drawFrame);
    }

    modeRow.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (!target.matches('.mode-chip')) return;
        setMode(target.dataset.mode || 'chance');
    });

    primaryRange.addEventListener('input', rebuildView);
    secondaryRange.addEventListener('input', rebuildView);
    window.addEventListener('resize', () => {
        resizeCanvas();
    });

    setMode('chance');
    resizeCanvas();
    rebuildView();
    drawFrame(performance.now());
})();