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

    const canvas = document.getElementById('timeCanvas');
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
    const coordinateValue = document.getElementById('coordinateValue');
    const arrowValue = document.getElementById('arrowValue');
    const correlationValue = document.getElementById('correlationValue');
    const recordValue = document.getElementById('recordValue');
    const statusValue = document.getElementById('statusValue');

    const TAU = Math.PI * 2;

    const modeConfig = {
        coordinate: {
            primary: {
                label: '観測者の傾き',
                min: -55,
                max: 55,
                step: 1,
                value: 20,
                format: (value) => `${Math.round(value)}°`
            },
            secondary: {
                label: '現在の幅',
                min: 12,
                max: 100,
                step: 1,
                value: 46,
                format: (value) => `${Math.round(value)}%`
            }
        },
        arrow: {
            primary: {
                label: '整列度',
                min: 0,
                max: 100,
                step: 1,
                value: 78,
                format: (value) => `${Math.round(value)}%`
            },
            secondary: {
                label: '混ざりやすさ',
                min: 0,
                max: 100,
                step: 1,
                value: 56,
                format: (value) => `${Math.round(value)}%`
            }
        },
        correlation: {
            primary: {
                label: '相関の強さ',
                min: 0,
                max: 100,
                step: 1,
                value: 74,
                format: (value) => `${Math.round(value)}%`
            },
            secondary: {
                label: '時計の精度',
                min: 0,
                max: 100,
                step: 1,
                value: 62,
                format: (value) => `${Math.round(value)}%`
            }
        },
        memory: {
            primary: {
                label: '記録コスト',
                min: 0,
                max: 100,
                step: 1,
                value: 60,
                format: (value) => `${Math.round(value)}%`
            },
            secondary: {
                label: '未来の分岐',
                min: 0,
                max: 100,
                step: 1,
                value: 70,
                format: (value) => `${Math.round(value)}%`
            }
        }
    };

    const state = {
        mode: 'coordinate',
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

    function buildCoordinateView(controls) {
        const tiltDeg = controls.primary;
        const tiltRad = tiltDeg * Math.PI / 180;
        const sliceNorm = controls.secondaryNorm;
        const sliceThickness = 10 + sliceNorm * 26;
        const relativityShift = Math.abs(tiltDeg) / 55;
        return {
            kind: 'coordinate',
            tiltDeg,
            tiltRad,
            sliceNorm,
            sliceThickness,
            relativityShift,
            coordinateText: `観測者の傾き ${Math.round(tiltDeg)}° では、同時刻の切り方も傾き、絶対的な「今」は消えます。`,
            arrowText: `現在の厚みを ${Math.round(sliceNorm * 100)}% に広げても、それは観測者が選ぶ切り口であって宇宙に埋め込まれた一枚板ではありません。`,
            correlationText: 'ニュートン力学では t は外から与える変数でしたが、相対論では時間は空間と一体の時空座標になります。',
            recordText: 'ブロック宇宙像では、過去・現在・未来が同じ時空の中にあり、私たちはその一部を体験しているだけだと読めます。',
            statusText: '相対論が壊したのは「宇宙に一つだけ共通の今がある」という直感です。',
            narration: '座標モードでは、観測者によって「同時」の切り方が変わり、絶対的な今が消える様子を見てください。'
        };
    }

    function buildArrowView(controls) {
        const order = controls.primaryNorm;
        const mixing = controls.secondaryNorm;
        const entropyLevel = clamp(0.18 + (1 - order) * 0.52 + mixing * 0.3, 0, 1);
        const predictability = clamp(order * (1 - mixing * 0.7), 0, 1);
        const diffusion = 0.1 + mixing * 0.5;
        return {
            kind: 'arrow',
            order,
            mixing,
            entropyLevel,
            predictability,
            diffusion,
            coordinateText: '基本法則は時間反転に近い対称性を持つのに、マクロ世界では一方向の矢が見えます。',
            arrowText: `整列度 ${Math.round(order * 100)}% と混ざりやすさ ${Math.round(mixing * 100)}% から、時間の矢の強さは約 ${Math.round(entropyLevel * 100)}% です。`,
            correlationText: 'カオスは微小差を増幅し、粗い観測では情報が失われたように見えるため、不可逆性を強めます。',
            recordText: `予測可能性は約 ${Math.round(predictability * 100)}% で、エントロピーが上がるほど未来は粗くしか読めません。`,
            statusText: '時間の矢は「未来へ進む法則」よりも、状態数の圧倒的な偏りから生まれる見え方です。',
            narration: '時間の矢モードでは、整った状態が崩れて多数派の配置へ流れることで、向きがどう現れるかを見てください。'
        };
    }

    function buildCorrelationView(controls) {
        const entanglement = controls.primaryNorm;
        const clockPrecision = controls.secondaryNorm;
        const emergence = clamp(0.18 + entanglement * (0.48 + clockPrecision * 0.34), 0, 1);
        const drift = (1 - clockPrecision) * 0.6;
        return {
            kind: 'correlation',
            entanglement,
            clockPrecision,
            emergence,
            drift,
            coordinateText: '宇宙全体では静止した状態でも、時計と系を分けると内部時間が現れます。',
            arrowText: `相関の強さ ${Math.round(entanglement * 100)}% では、時計が指す t と系の状態 ψ(t) の対応が ${Math.round(emergence * 100)}% まで見えてきます。`,
            correlationText: `時計の精度 ${Math.round(clockPrecision * 100)}% は、条件付き状態がどれだけはっきり読めるかを決めます。`,
            recordText: drift > 0.28
                ? '時計が粗いと、時間発展はにじんだ相関としてしか読めません。'
                : '時計が十分に鋭いと、条件付き状態は通常の時間発展のようにはっきり並びます。',
            statusText: 'Page–Wootters の核心は「時間が変化を生む」のではなく、「相関が時間に見える」という逆向きの発想です。',
            narration: '内部時間モードでは、静止した全体状態の中から、時計と系の相関だけで時間発展がどう復元されるかを見てください。'
        };
    }

    function buildMemoryView(controls) {
        const recordCost = controls.primaryNorm;
        const futureBranching = controls.secondaryNorm;
        const recordStrength = clamp(0.24 + recordCost * 0.58, 0, 1);
        const branchCount = 3 + Math.round(futureBranching * 5);
        const irreversibility = clamp(0.2 + recordCost * 0.42 + futureBranching * 0.28, 0, 1);
        return {
            kind: 'memory',
            recordCost,
            futureBranching,
            recordStrength,
            branchCount,
            irreversibility,
            coordinateText: '記憶は心理以前に、脳や紙や磁化に残る物理的な記録です。',
            arrowText: `記録コスト ${Math.round(recordCost * 100)}% では、局所秩序を作る代わりに環境へ熱とエントロピーを押し出します。`,
            correlationText: `未来の分岐は ${branchCount} 本ぶんに広がるので、未来は一つの記録として固定できません。`,
            recordText: '記録は原因の痕跡なので、過去とは相関できますが、まだ分岐中の未来とは強く相関できません。',
            statusText: `私たちが過去だけ覚えるのは、時間の向きが「記録が作られる向き」として現れているからです。不可逆性の強さは約 ${Math.round(irreversibility * 100)}% です。`,
            narration: '記憶モードでは、記録が過去側にだけ残り、未来側は枝分かれした可能性として開いている様子を見てください。'
        };
    }

    function buildView() {
        const controls = readControls();
        updateRangeLabels(controls);
        switch (state.mode) {
            case 'arrow':
                return buildArrowView(controls);
            case 'correlation':
                return buildCorrelationView(controls);
            case 'memory':
                return buildMemoryView(controls);
            case 'coordinate':
            default:
                return buildCoordinateView(controls);
        }
    }

    function rebuildView() {
        currentView = buildView();
        coordinateValue.textContent = currentView.coordinateText;
        arrowValue.textContent = currentView.arrowText;
        correlationValue.textContent = currentView.correlationText;
        recordValue.textContent = currentView.recordText;
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
        gradient.addColorStop(0, '#131722');
        gradient.addColorStop(0.48, '#253046');
        gradient.addColorStop(1, '#4d5d7e');
        context.fillStyle = gradient;
        context.fillRect(0, 0, width, height);

        const glowLeft = context.createRadialGradient(width * 0.18, height * 0.2, 12, width * 0.18, height * 0.2, width * 0.24);
        glowLeft.addColorStop(0, 'rgba(134, 208, 218, 0.18)');
        glowLeft.addColorStop(1, 'rgba(134, 208, 218, 0)');
        context.fillStyle = glowLeft;
        context.fillRect(0, 0, width, height);

        const glowRight = context.createRadialGradient(width * 0.8, height * 0.18, 12, width * 0.8, height * 0.18, width * 0.18);
        glowRight.addColorStop(0, 'rgba(240, 194, 119, 0.16)');
        glowRight.addColorStop(1, 'rgba(240, 194, 119, 0)');
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

    function drawCoordinate(view) {
        const { width, height } = state;
        const panelX = 54;
        const panelY = 74;
        const panelWidth = width * 0.6;
        const panelHeight = height * 0.62;
        drawPanel(panelX, panelY, panelWidth, panelHeight);

        for (let gridX = 0; gridX <= 10; gridX += 1) {
            const x = panelX + 18 + gridX * (panelWidth - 36) / 10;
            context.strokeStyle = 'rgba(255, 255, 255, 0.08)';
            context.lineWidth = 1;
            context.beginPath();
            context.moveTo(x, panelY + 12);
            context.lineTo(x, panelY + panelHeight - 12);
            context.stroke();
        }
        for (let gridY = 0; gridY <= 8; gridY += 1) {
            const y = panelY + 16 + gridY * (panelHeight - 32) / 8;
            context.beginPath();
            context.moveTo(panelX + 12, y);
            context.lineTo(panelX + panelWidth - 12, y);
            context.stroke();
        }

        const centerX = panelX + panelWidth * 0.5;
        const centerY = panelY + panelHeight * 0.5;
        context.save();
        context.translate(centerX, centerY);
        context.rotate(view.tiltRad);
        context.fillStyle = 'rgba(134, 208, 218, 0.18)';
        context.fillRect(-panelWidth * 0.42, -view.sliceThickness * 0.5, panelWidth * 0.84, view.sliceThickness);
        context.restore();

        context.strokeStyle = 'rgba(240, 194, 119, 0.92)';
        context.lineWidth = 2.4;
        context.beginPath();
        context.moveTo(panelX + 18, centerY);
        context.lineTo(panelX + panelWidth - 18, centerY);
        context.stroke();

        context.save();
        context.translate(centerX, centerY);
        context.rotate(view.tiltRad);
        context.strokeStyle = 'rgba(134, 208, 218, 0.94)';
        context.lineWidth = 2.6;
        context.beginPath();
        context.moveTo(-panelWidth * 0.42, 0);
        context.lineTo(panelWidth * 0.42, 0);
        context.stroke();
        context.restore();

        context.strokeStyle = 'rgba(255, 247, 232, 0.76)';
        context.lineWidth = 2.2;
        const worldXs = [0.24, 0.5, 0.76];
        worldXs.forEach((fraction, index) => {
            const x = panelX + panelWidth * fraction;
            context.beginPath();
            context.moveTo(x, panelY + panelHeight - 18);
            context.lineTo(x + (index - 1) * 12, panelY + 18);
            context.stroke();
        });

        context.fillStyle = 'rgba(255, 248, 242, 0.88)';
        context.font = '600 14px IBM Plex Sans JP';
        context.fillText('rest frame now', panelX + 18, centerY - 10);
        context.fillText('moving frame now', panelX + panelWidth * 0.52, centerY - 34);

        const sideX = width * 0.71;
        const sideY = 82;
        const sideWidth = width * 0.19;
        const sideHeight = height * 0.48;
        drawPanel(sideX, sideY, sideWidth, sideHeight);
        context.fillStyle = 'rgba(255, 248, 242, 0.88)';
        context.fillText('block slices', sideX + 14, sideY + 24);
        for (let index = 0; index < 4; index += 1) {
            const x = sideX + 20 + index * 18;
            const y = sideY + 72 + index * 20;
            context.save();
            context.translate(x, y);
            context.rotate(-0.18 + index * 0.02);
            roundedRectPath(-4, -24, 82, 48, 12);
            context.fillStyle = `rgba(255, 255, 255, ${0.08 + index * 0.04})`;
            context.fill();
            context.strokeStyle = 'rgba(255, 255, 255, 0.12)';
            context.stroke();
            context.restore();
        }
        drawTag(`tilt ${Math.round(view.tiltDeg)}°`, 54, 30, 'rgba(23, 27, 38, 0.78)', 'rgba(255, 255, 255, 0.14)', '#fff8f2');
        drawTag(`shift ${Math.round(view.relativityShift * 100)}%`, width - 128, 30, 'rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.14)', '#2b3246');
    }

    function drawArrow(view) {
        const { width, height, tick } = state;
        const chamberX = 58;
        const chamberY = 74;
        const chamberWidth = width * 0.6;
        const chamberHeight = height * 0.58;
        drawPanel(chamberX, chamberY, chamberWidth, chamberHeight);

        const dividerX = chamberX + chamberWidth * 0.48;
        context.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        context.lineWidth = 1.2;
        context.beginPath();
        context.moveTo(dividerX, chamberY + 16);
        context.lineTo(dividerX, chamberY + chamberHeight - 16);
        context.stroke();

        context.fillStyle = `rgba(134, 208, 218, ${0.08 + view.order * 0.14})`;
        context.fillRect(chamberX + 16, chamberY + 16, chamberWidth * 0.22, chamberHeight - 32);

        const particleCount = 72;
        for (let particleIndex = 0; particleIndex < particleCount; particleIndex += 1) {
            const clusterX = 0.12 + (hash(particleIndex, 1) - 0.5) * (0.08 + (1 - view.order) * 0.1);
            const spreadX = 0.08 + hash(particleIndex, 2) * 0.84;
            const positionX = chamberX + chamberWidth * ((1 - view.entropyLevel) * clusterX + view.entropyLevel * spreadX);
            const positionY = chamberY + 24 + hash(particleIndex, 3) * (chamberHeight - 48) + Math.sin(tick * 1.8 + particleIndex) * 1.5;
            const radius = 4 + hash(particleIndex, 4) * 2;
            context.fillStyle = particleIndex % 3 === 0 ? 'rgba(240, 194, 119, 0.92)' : 'rgba(255, 247, 232, 0.92)';
            context.beginPath();
            context.arc(positionX, positionY, radius, 0, TAU);
            context.fill();
        }

        context.strokeStyle = 'rgba(240, 194, 119, 0.86)';
        context.lineWidth = 2.8;
        context.beginPath();
        context.moveTo(chamberX + chamberWidth * 0.34, chamberY + chamberHeight * 0.24);
        context.lineTo(chamberX + chamberWidth * 0.58, chamberY + chamberHeight * 0.24);
        context.lineTo(chamberX + chamberWidth * 0.54, chamberY + chamberHeight * 0.18);
        context.moveTo(chamberX + chamberWidth * 0.58, chamberY + chamberHeight * 0.24);
        context.lineTo(chamberX + chamberWidth * 0.54, chamberY + chamberHeight * 0.30);
        context.stroke();

        const curveX = width * 0.72;
        const curveY = 82;
        const curveWidth = width * 0.18;
        const curveHeight = height * 0.46;
        drawPanel(curveX, curveY, curveWidth, curveHeight);
        const originX = curveX + 24;
        const originY = curveY + curveHeight - 24;
        context.strokeStyle = 'rgba(255, 255, 255, 0.18)';
        context.lineWidth = 1.2;
        context.beginPath();
        context.moveTo(originX, curveY + 18);
        context.lineTo(originX, originY);
        context.lineTo(curveX + curveWidth - 14, originY);
        context.stroke();

        context.strokeStyle = 'rgba(134, 208, 218, 0.92)';
        context.lineWidth = 3;
        context.beginPath();
        for (let sampleIndex = 0; sampleIndex <= 100; sampleIndex += 1) {
            const t = sampleIndex / 100;
            const y = 1 - Math.exp(-t * (1.2 + view.mixing * 2.8));
            const pointX = originX + t * (curveWidth - 40);
            const pointY = originY - y * (curveHeight - 44);
            if (sampleIndex === 0) {
                context.moveTo(pointX, pointY);
            } else {
                context.lineTo(pointX, pointY);
            }
        }
        context.stroke();

        const markerY = originY - view.entropyLevel * (curveHeight - 44);
        context.fillStyle = 'rgba(255, 247, 232, 0.96)';
        context.beginPath();
        context.arc(originX + (curveWidth - 40) * 0.7, markerY, 6, 0, TAU);
        context.fill();

        const barX = 58;
        const barY = height - 74;
        const barWidth = width * 0.34;
        roundedRectPath(barX, barY, barWidth, 18, 9);
        context.fillStyle = 'rgba(255, 255, 255, 0.08)';
        context.fill();
        roundedRectPath(barX, barY, barWidth * view.entropyLevel, 18, 9);
        context.fillStyle = 'rgba(240, 194, 119, 0.92)';
        context.fill();

        drawTag(`ΔS ${Math.round(view.entropyLevel * 100)}%`, 54, 30, 'rgba(23, 27, 38, 0.78)', 'rgba(255, 255, 255, 0.14)', '#fff8f2');
        drawTag(`predict ${Math.round(view.predictability * 100)}%`, width - 154, 30, 'rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.14)', '#2b3246');
    }

    function drawCorrelation(view) {
        const { width, height, tick } = state;
        const panelX = 54;
        const panelY = 74;
        const panelWidth = width * 0.58;
        const panelHeight = height * 0.58;
        drawPanel(panelX, panelY, panelWidth, panelHeight);

        const topY = panelY + 90;
        const bottomY = panelY + panelHeight - 90;
        const slots = 5;
        const activeSlot = Math.floor((tick * (0.8 + view.clockPrecision * 1.2)) % slots);
        for (let slotIndex = 0; slotIndex < slots; slotIndex += 1) {
            const x = panelX + 68 + slotIndex * (panelWidth - 136) / (slots - 1);
            const boxWidth = 52;
            const topOffset = (hash(slotIndex, 5) - 0.5) * view.drift * 12;
            const bottomOffset = (hash(slotIndex, 6) - 0.5) * view.drift * 16;

            roundedRectPath(x - boxWidth * 0.5, topY - 18 + topOffset, boxWidth, 36, 12);
            context.fillStyle = slotIndex === activeSlot ? 'rgba(240, 194, 119, 0.92)' : 'rgba(255, 255, 255, 0.12)';
            context.fill();
            context.strokeStyle = 'rgba(255, 255, 255, 0.18)';
            context.stroke();
            context.fillStyle = slotIndex === activeSlot ? 'rgba(23, 27, 38, 0.9)' : 'rgba(255, 248, 242, 0.86)';
            context.font = '600 13px IBM Plex Sans JP';
            context.fillText(`t${slotIndex}`, x - 10, topY + 5 + topOffset);

            roundedRectPath(x - boxWidth * 0.5, bottomY - 20 + bottomOffset, boxWidth, 40, 12);
            context.fillStyle = 'rgba(134, 208, 218, 0.18)';
            context.fill();
            context.strokeStyle = 'rgba(255, 255, 255, 0.18)';
            context.stroke();
            context.fillStyle = 'rgba(255, 248, 242, 0.88)';
            context.fillText(`ψ${slotIndex}`, x - 11, bottomY + 5 + bottomOffset);

            context.strokeStyle = `rgba(134, 208, 218, ${0.16 + view.entanglement * 0.52 + (slotIndex === activeSlot ? 0.18 : 0)})`;
            context.lineWidth = slotIndex === activeSlot ? 3 : 2;
            context.beginPath();
            context.moveTo(x, topY + 20 + topOffset);
            context.bezierCurveTo(x - 18, topY + 80, x + 18, bottomY - 80, x, bottomY - 24 + bottomOffset);
            context.stroke();
        }

        context.fillStyle = 'rgba(255, 248, 242, 0.88)';
        context.font = '600 14px IBM Plex Sans JP';
        context.fillText('global static state', panelX + 18, panelY + 24);
        context.fillText('clock', panelX + 18, topY - 36);
        context.fillText('conditional system', panelX + 18, bottomY - 36);

        const sideX = width * 0.68;
        const sideY = 82;
        const sideWidth = width * 0.22;
        const sideHeight = height * 0.48;
        drawPanel(sideX, sideY, sideWidth, sideHeight);
        const clockX = sideX + sideWidth * 0.5;
        const clockY = sideY + 88;
        const radius = 42;
        context.beginPath();
        context.arc(clockX, clockY, radius, 0, TAU);
        context.strokeStyle = 'rgba(255, 247, 232, 0.74)';
        context.lineWidth = 2;
        context.stroke();
        const handAngle = -Math.PI / 2 + tick * (0.8 + view.clockPrecision) * 0.9;
        context.beginPath();
        context.moveTo(clockX, clockY);
        context.lineTo(clockX + Math.cos(handAngle) * (radius - 10), clockY + Math.sin(handAngle) * (radius - 10));
        context.strokeStyle = 'rgba(240, 194, 119, 0.92)';
        context.lineWidth = 3;
        context.stroke();
        context.beginPath();
        context.arc(clockX, clockY, 5, 0, TAU);
        context.fillStyle = 'rgba(255, 247, 232, 0.92)';
        context.fill();

        context.font = '600 13px IBM Plex Sans JP';
        context.fillStyle = 'rgba(255, 248, 242, 0.88)';
        context.fillText('Htotal |Ψ⟩ = 0', sideX + 18, sideY + sideHeight - 64);
        context.fillText('|Ψ⟩ = Σ |t⟩⊗|ψ(t)⟩', sideX + 18, sideY + sideHeight - 38);

        drawTag(`corr ${Math.round(view.entanglement * 100)}%`, 54, 30, 'rgba(23, 27, 38, 0.78)', 'rgba(255, 255, 255, 0.14)', '#fff8f2');
        drawTag(`clock ${Math.round(view.clockPrecision * 100)}%`, width - 146, 30, 'rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.14)', '#2b3246');
    }

    function drawMemory(view) {
        const { width, height, tick } = state;
        const panelX = 58;
        const panelY = 82;
        const panelWidth = width * 0.84;
        const panelHeight = height * 0.44;
        drawPanel(panelX, panelY, panelWidth, panelHeight);

        const lineY = panelY + panelHeight * 0.58;
        const nowX = panelX + panelWidth * 0.48;
        context.strokeStyle = 'rgba(255, 255, 255, 0.14)';
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(panelX + 24, lineY);
        context.lineTo(panelX + panelWidth - 24, lineY);
        context.stroke();

        const pastPositions = [0.12, 0.24, 0.34, 0.43];
        pastPositions.forEach((fraction, index) => {
            const x = panelX + panelWidth * fraction;
            const y = lineY - 26 - (index % 2) * 18;
            roundedRectPath(x - 28, y - 18, 56, 36, 12);
            context.fillStyle = `rgba(134, 208, 218, ${0.16 + view.recordStrength * 0.52})`;
            context.fill();
            context.strokeStyle = 'rgba(255, 255, 255, 0.18)';
            context.stroke();
            context.beginPath();
            context.moveTo(x, y + 18);
            context.lineTo(x, lineY);
            context.strokeStyle = 'rgba(240, 194, 119, 0.78)';
            context.lineWidth = 1.8;
            context.stroke();
            context.fillStyle = 'rgba(255, 248, 242, 0.88)';
            context.font = '600 12px IBM Plex Sans JP';
            context.fillText(`R${index + 1}`, x - 10, y + 6);
        });

        context.beginPath();
        context.arc(nowX, lineY, 18, 0, TAU);
        context.fillStyle = 'rgba(240, 194, 119, 0.92)';
        context.fill();
        context.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        context.lineWidth = 2;
        context.stroke();
        for (let sparkIndex = 0; sparkIndex < 10; sparkIndex += 1) {
            const angle = (sparkIndex / 10) * TAU + tick * 1.6;
            const radius = 28 + view.recordCost * 24 + Math.sin(tick * 3 + sparkIndex) * 4;
            const x = nowX + Math.cos(angle) * radius;
            const y = lineY + Math.sin(angle) * radius;
            context.fillStyle = 'rgba(223, 123, 104, 0.78)';
            context.beginPath();
            context.arc(x, y, 2.2, 0, TAU);
            context.fill();
        }

        context.setLineDash([8, 8]);
        for (let branchIndex = 0; branchIndex < view.branchCount; branchIndex += 1) {
            const startX = nowX + 12;
            const startY = lineY;
            const endX = panelX + panelWidth * (0.64 + branchIndex * 0.05);
            const spread = (branchIndex - (view.branchCount - 1) * 0.5) * (16 + view.futureBranching * 42);
            const endY = lineY + spread;
            context.strokeStyle = `rgba(255, 255, 255, ${0.16 + view.futureBranching * 0.32})`;
            context.lineWidth = 1.8;
            context.beginPath();
            context.moveTo(startX, startY);
            context.bezierCurveTo(startX + 42, startY, endX - 28, endY, endX, endY);
            context.stroke();
        }
        context.setLineDash([]);

        context.fillStyle = 'rgba(255, 248, 242, 0.88)';
        context.font = '600 14px IBM Plex Sans JP';
        context.fillText('past records', panelX + 18, panelY + 24);
        context.fillText('now', nowX - 12, lineY + 40);
        context.fillText('future branches', panelX + panelWidth * 0.7, panelY + 24);

        const costBarX = 58;
        const costBarY = height - 74;
        const costBarWidth = width * 0.34;
        roundedRectPath(costBarX, costBarY, costBarWidth, 18, 9);
        context.fillStyle = 'rgba(255, 255, 255, 0.08)';
        context.fill();
        roundedRectPath(costBarX, costBarY, costBarWidth * view.irreversibility, 18, 9);
        context.fillStyle = 'rgba(223, 123, 104, 0.92)';
        context.fill();

        drawTag(`record ${Math.round(view.recordCost * 100)}%`, 54, 30, 'rgba(23, 27, 38, 0.78)', 'rgba(255, 255, 255, 0.14)', '#fff8f2');
        drawTag(`branches ${view.branchCount}`, width - 138, 30, 'rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.14)', '#2b3246');
    }

    function drawFrame(timestamp) {
        const deltaTime = clamp((timestamp - state.lastTime) / 1000, 0, 0.04);
        state.lastTime = timestamp;
        state.tick += deltaTime;

        context.clearRect(0, 0, state.width, state.height);
        drawBackdrop();

        if (currentView) {
            if (currentView.kind === 'coordinate') {
                drawCoordinate(currentView);
            } else if (currentView.kind === 'arrow') {
                drawArrow(currentView);
            } else if (currentView.kind === 'correlation') {
                drawCorrelation(currentView);
            } else if (currentView.kind === 'memory') {
                drawMemory(currentView);
            }
        }

        requestAnimationFrame(drawFrame);
    }

    modeRow.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (!target.matches('.mode-chip')) return;
        setMode(target.dataset.mode || 'coordinate');
    });

    primaryRange.addEventListener('input', rebuildView);
    secondaryRange.addEventListener('input', rebuildView);
    window.addEventListener('resize', () => {
        resizeCanvas();
    });

    setMode('coordinate');
    resizeCanvas();
    rebuildView();
    drawFrame(performance.now());
})();