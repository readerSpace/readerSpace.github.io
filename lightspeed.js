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

    const canvas = document.getElementById('lightspeedCanvas');
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
    const limitValue = document.getElementById('limitValue');
    const geometryValue = document.getElementById('geometryValue');
    const energyValue = document.getElementById('energyValue');
    const timeValue = document.getElementById('timeValue');
    const statusValue = document.getElementById('statusValue');

    const TAU = Math.PI * 2;

    const modeConfig = {
        cone: {
            primary: {
                label: '速度比 v/c',
                min: 5,
                max: 95,
                step: 1,
                value: 58,
                format: (value) => `${(value / 100).toFixed(2)} c`
            },
            secondary: {
                label: '表示時間',
                min: 20,
                max: 100,
                step: 1,
                value: 72,
                format: (value) => `${Math.round(value)}%`
            }
        },
        energy: {
            primary: {
                label: '速度比 v/c',
                min: 15,
                max: 99,
                step: 1,
                value: 88,
                format: (value) => `${(value / 100).toFixed(2)} c`
            },
            secondary: {
                label: '質量スケール',
                min: 10,
                max: 100,
                step: 1,
                value: 36,
                format: (value) => `${(0.4 + value / 25).toFixed(1)} m₀`
            }
        },
        massless: {
            primary: {
                label: '運動量スケール',
                min: 10,
                max: 100,
                step: 1,
                value: 54,
                format: (value) => `${(0.5 + value / 20).toFixed(1)} p₀`
            },
            secondary: {
                label: '質量比',
                min: 0,
                max: 100,
                step: 1,
                value: 10,
                format: (value) => `${(value / 40).toFixed(2)} m₀`
            }
        },
        proper: {
            primary: {
                label: '粒子の速度',
                min: 5,
                max: 95,
                step: 1,
                value: 66,
                format: (value) => `${(value / 100).toFixed(2)} c`
            },
            secondary: {
                label: '移動距離',
                min: 20,
                max: 100,
                step: 1,
                value: 64,
                format: (value) => `${Math.round(value)}%`
            }
        },
        quantum: {
            primary: {
                label: '波束の鋭さ',
                min: 0,
                max: 100,
                step: 1,
                value: 52,
                format: (value) => `${Math.round(value)}%`
            },
            secondary: {
                label: '観測時間',
                min: 20,
                max: 100,
                step: 1,
                value: 46,
                format: (value) => `${Math.round(value)}%`
            }
        }
    };

    const state = {
        mode: 'cone',
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

    function buildConeView(controls) {
        const beta = clamp(controls.primary / 100, 0.05, 0.95);
        const displaySpan = 0.46 + controls.secondaryNorm * 0.52;
        const gamma = 1 / Math.sqrt(1 - beta * beta);
        return {
            kind: 'cone',
            beta,
            displaySpan,
            gamma,
            limit: 'c はすべての慣性系で共通の因果境界です。',
            geometry: '質量あり粒子は光円錐の内側、光は境界の上を進みます。',
            energy: `速度 ${beta.toFixed(2)}c に対して γ = ${gamma.toFixed(2)}。`,
            proper: '超光速が許されると、ある観測者では結果が原因より先になります。',
            status: '光速制限の本質は、時空図の円錐が「届く未来」を決めていることです。',
            narration: '光円錐モードでは、c が「最大速度」というより「到達可能な未来の境界」として働く様子を見てください。'
        };
    }

    function buildEnergyView(controls) {
        const beta = clamp(controls.primary / 100, 0.15, 0.99);
        const massScale = 0.4 + controls.secondary / 25;
        const gamma = 1 / Math.sqrt(1 - beta * beta);
        const totalEnergy = gamma * massScale;
        return {
            kind: 'energy',
            beta,
            massScale,
            gamma,
            totalEnergy,
            limit: '質量を持つ粒子は c に近づくほど加速しにくくなります。',
            geometry: 'エネルギー障壁は、光円錐の境界を越えられない幾何学の別の顔です。',
            energy: `${massScale.toFixed(1)} m₀ に対して E ≈ ${totalEnergy.toFixed(2)} m₀c²。`,
            proper: 'v が c に近づくほど、同じ座標時間に対する固有時も強く縮みます。',
            status: '光速を越える前にエネルギーが発散するので、質量あり粒子は境界へ漸近するだけです。',
            narration: 'エネルギーモードでは、v/c を上げると γ 曲線が立ち上がり、c 付近で壁になる様子を見てください。'
        };
    }

    function buildMasslessView(controls) {
        const momentum = 0.5 + controls.primary / 20;
        const massScale = controls.secondary / 40;
        const massiveEnergy = Math.sqrt(momentum * momentum + massScale * massScale);
        return {
            kind: 'massless',
            momentum,
            massScale,
            massiveEnergy,
            limit: 'm = 0 のときだけ分散関係は光円錐の表面に貼りつきます。',
            geometry: '質量ゼロ粒子は timelike ではなく lightlike の経路を進みます。',
            energy: massScale < 0.05
                ? `m ≈ 0 なので E = pc の直線にほぼ一致します。`
                : `m = ${massScale.toFixed(2)} m₀ では E = pc より上に持ち上がります。`,
            proper: '止まれないことと c で進むことは、同じ分散関係の別の言い方です。',
            status: '「光が速いから質量ゼロ」ではなく、「質量ゼロだから c でしか存在できない」が正しい順番です。',
            narration: '質量ゼロモードでは、E = pc の直線と、質量項を持つ曲線の違いを見てください。質量が消えると勾配が c に固定されます。'
        };
    }

    function buildProperView(controls) {
        const beta = clamp(controls.primary / 100, 0.05, 0.95);
        const distanceScale = 0.35 + controls.secondaryNorm * 0.65;
        const tauRatio = Math.sqrt(1 - beta * beta);
        return {
            kind: 'proper',
            beta,
            distanceScale,
            tauRatio,
            limit: '光には静止系がないので、「光の視点」は厳密には定義できません。',
            geometry: `質量あり粒子の固有時比は約 ${tauRatio.toFixed(2)}、光は 0 です。`,
            energy: '時間の遅れは光速に近づくほど強まりますが、光そのものでは時計が止まるのではなく、そもそも固有時がありません。',
            proper: '光円錐の表面では dτ = 0。これが「光の腕時計は進まない」という意味です。',
            status: '「光から見ると同時」はイメージとしては近くても、観測者としての光を定義できない点に注意が要ります。',
            narration: '固有時モードでは、質量あり粒子の世界線には時計の刻みを描けても、光の世界線には刻みを置けないことを見てください。'
        };
    }

    function buildQuantumView(controls) {
        const coherence = controls.primaryNorm;
        const observation = 0.35 + controls.secondaryNorm * 0.65;
        return {
            kind: 'quantum',
            coherence,
            observation,
            limit: '量子論でも c は因果構造の境界として残ります。',
            geometry: '光子は小さな玉というより、電磁場の励起として広がるモードです。',
            energy: coherence > 0.55
                ? '波束が鋭いほど、主な寄与が光円錐付近へ集中して見えます。'
                : '波束が広いと、光子を「点の粒子」とみなす限界が見えやすくなります。',
            proper: '時間発展は観測者の座標時間で書き、光子の固有時間は使いません。',
            status: '量子場の言葉では、光は「時空の構造に従って伝わる揺らぎ」です。',
            narration: '量子論モードでは、多くの経路を考えても、相対論と整合する主な寄与は光円錐上に集まるという見方を確認してください。'
        };
    }

    function buildView() {
        const controls = readControls();
        updateRangeLabels(controls);
        switch (state.mode) {
            case 'energy':
                return buildEnergyView(controls);
            case 'massless':
                return buildMasslessView(controls);
            case 'proper':
                return buildProperView(controls);
            case 'quantum':
                return buildQuantumView(controls);
            case 'cone':
            default:
                return buildConeView(controls);
        }
    }

    function rebuildView() {
        currentView = buildView();
        limitValue.textContent = currentView.limit;
        geometryValue.textContent = currentView.geometry;
        energyValue.textContent = currentView.energy;
        timeValue.textContent = currentView.proper;
        statusValue.textContent = currentView.status;
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
        gradient.addColorStop(0, '#040b13');
        gradient.addColorStop(0.54, '#0b1b2d');
        gradient.addColorStop(1, '#122944');
        context.fillStyle = gradient;
        context.fillRect(0, 0, width, height);

        const hazeA = context.createRadialGradient(width * 0.18, height * 0.18, 12, width * 0.18, height * 0.18, width * 0.24);
        hazeA.addColorStop(0, 'rgba(86, 223, 245, 0.16)');
        hazeA.addColorStop(1, 'rgba(86, 223, 245, 0)');
        context.fillStyle = hazeA;
        context.fillRect(0, 0, width, height);

        const hazeB = context.createRadialGradient(width * 0.78, height * 0.2, 10, width * 0.78, height * 0.2, width * 0.2);
        hazeB.addColorStop(0, 'rgba(255, 196, 111, 0.12)');
        hazeB.addColorStop(1, 'rgba(255, 196, 111, 0)');
        context.fillStyle = hazeB;
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

        for (let index = 0; index < 74; index += 1) {
            const x = hash(index, 1) * width;
            const y = hash(index, 2) * height;
            const size = 0.6 + hash(index, 3) * 1.8;
            const alpha = 0.24 + hash(index, 4) * 0.56;
            context.fillStyle = `rgba(255, 255, 255, ${alpha})`;
            context.beginPath();
            context.arc(x, y + Math.sin(tick * 0.35 + index) * 0.5, size, 0, TAU);
            context.fill();
        }
    }

    function drawAxes(originX, originY, spanX, spanY) {
        context.strokeStyle = 'rgba(228, 238, 249, 0.62)';
        context.lineWidth = 1.3;
        context.beginPath();
        context.moveTo(originX - spanX, originY);
        context.lineTo(originX + spanX, originY);
        context.stroke();
        context.beginPath();
        context.moveTo(originX, originY + 12);
        context.lineTo(originX, originY - spanY);
        context.stroke();

        context.fillStyle = 'rgba(228, 238, 249, 0.92)';
        context.font = '600 14px IBM Plex Sans JP';
        context.fillText('x', originX + spanX - 10, originY - 10);
        context.fillText('ct', originX + 10, originY - spanY + 18);
    }

    function drawCone(view) {
        const { width, height } = state;
        const originX = width * 0.5;
        const originY = height * 0.8;
        const coneHeight = 170 + view.displaySpan * 120;
        const halfWidth = coneHeight * 0.66;
        const worldlineX = originX + halfWidth * view.beta;

        drawAxes(originX, originY, width * 0.34, coneHeight + 20);

        const coneFill = context.createLinearGradient(originX, originY, originX, originY - coneHeight);
        coneFill.addColorStop(0, 'rgba(86, 223, 245, 0.18)');
        coneFill.addColorStop(1, 'rgba(86, 223, 245, 0.04)');
        context.fillStyle = coneFill;
        context.beginPath();
        context.moveTo(originX, originY);
        context.lineTo(originX - halfWidth, originY - coneHeight);
        context.lineTo(originX + halfWidth, originY - coneHeight);
        context.closePath();
        context.fill();

        context.strokeStyle = 'rgba(255, 196, 111, 0.94)';
        context.lineWidth = 2.5;
        context.beginPath();
        context.moveTo(originX, originY);
        context.lineTo(originX - halfWidth, originY - coneHeight);
        context.moveTo(originX, originY);
        context.lineTo(originX + halfWidth, originY - coneHeight);
        context.stroke();

        context.setLineDash([7, 8]);
        context.strokeStyle = 'rgba(255, 126, 138, 0.74)';
        context.beginPath();
        context.moveTo(originX, originY);
        context.lineTo(originX + halfWidth * 1.18, originY - coneHeight * 0.9);
        context.stroke();
        context.setLineDash([]);

        context.strokeStyle = 'rgba(200, 247, 255, 0.92)';
        context.lineWidth = 3;
        context.beginPath();
        context.moveTo(originX, originY);
        context.lineTo(worldlineX, originY - coneHeight);
        context.stroke();

        context.fillStyle = 'rgba(255, 240, 202, 0.98)';
        context.beginPath();
        context.arc(originX, originY, 7, 0, TAU);
        context.fill();
        context.beginPath();
        context.arc(worldlineX, originY - coneHeight, 7, 0, TAU);
        context.fill();

        drawTag('光円錐', originX - 36, originY - coneHeight - 28, 'rgba(7, 15, 26, 0.78)', 'rgba(255, 255, 255, 0.14)', '#f4f9ff');
        drawTag(`質量あり: ${view.beta.toFixed(2)}c`, originX + 22, originY - coneHeight * 0.56, 'rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.14)', '#10263e');
        drawTag('超光速なら因果が崩れる', originX + halfWidth * 0.44, originY - coneHeight * 0.86, 'rgba(80, 14, 20, 0.72)', 'rgba(255, 126, 138, 0.24)', '#fff1f3');
    }

    function drawEnergy(view) {
        const { width, height } = state;
        const graphLeft = width * 0.12;
        const graphBottom = height * 0.82;
        const graphWidth = width * 0.74;
        const graphHeight = height * 0.6;
        const maxGamma = 10;

        context.strokeStyle = 'rgba(228, 238, 249, 0.58)';
        context.lineWidth = 1.3;
        context.beginPath();
        context.moveTo(graphLeft, graphBottom);
        context.lineTo(graphLeft + graphWidth, graphBottom);
        context.lineTo(graphLeft + graphWidth, graphBottom - graphHeight);
        context.stroke();

        context.fillStyle = 'rgba(228, 238, 249, 0.92)';
        context.font = '600 14px IBM Plex Sans JP';
        context.fillText('v / c', graphLeft + graphWidth - 24, graphBottom - 10);
        context.fillText('γ', graphLeft + 10, graphBottom - graphHeight + 20);

        for (let row = 1; row <= 4; row += 1) {
            const y = graphBottom - (row / 4) * graphHeight;
            context.strokeStyle = 'rgba(255, 255, 255, 0.08)';
            context.beginPath();
            context.moveTo(graphLeft, y);
            context.lineTo(graphLeft + graphWidth, y);
            context.stroke();
            const gammaMark = (row / 4) * maxGamma;
            context.fillStyle = 'rgba(228, 238, 249, 0.62)';
            context.fillText(gammaMark.toFixed(1), graphLeft - 34, y + 4);
        }

        context.strokeStyle = 'rgba(86, 223, 245, 0.95)';
        context.lineWidth = 3;
        context.beginPath();
        for (let step = 0; step <= 220; step += 1) {
            const beta = step / 220 * 0.995;
            const gamma = 1 / Math.sqrt(1 - beta * beta);
            const clampedGamma = Math.min(gamma, maxGamma);
            const x = graphLeft + (beta / 0.995) * graphWidth;
            const y = graphBottom - (clampedGamma / maxGamma) * graphHeight;
            if (step === 0) {
                context.moveTo(x, y);
            } else {
                context.lineTo(x, y);
            }
        }
        context.stroke();

        const selectedX = graphLeft + (view.beta / 0.995) * graphWidth;
        const selectedGamma = Math.min(view.gamma, maxGamma);
        const selectedY = graphBottom - (selectedGamma / maxGamma) * graphHeight;
        context.strokeStyle = 'rgba(255, 196, 111, 0.82)';
        context.lineWidth = 1.8;
        context.beginPath();
        context.moveTo(selectedX, graphBottom);
        context.lineTo(selectedX, selectedY);
        context.stroke();
        context.beginPath();
        context.moveTo(graphLeft, selectedY);
        context.lineTo(selectedX, selectedY);
        context.stroke();

        context.fillStyle = 'rgba(255, 240, 202, 0.98)';
        context.beginPath();
        context.arc(selectedX, selectedY, 6.5, 0, TAU);
        context.fill();

        drawTag(`γ = ${view.gamma.toFixed(2)}`, selectedX + 12, selectedY - 16, 'rgba(7, 15, 26, 0.78)', 'rgba(255, 255, 255, 0.14)', '#f4f9ff');
        drawTag(`E ≈ ${view.totalEnergy.toFixed(2)} m₀c²`, graphLeft + 24, graphBottom - graphHeight + 24, 'rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.14)', '#10263e');
        drawTag('c 付近で壁になる', graphLeft + graphWidth - 180, graphBottom - graphHeight * 0.28, 'rgba(80, 14, 20, 0.72)', 'rgba(255, 126, 138, 0.24)', '#fff1f3');
    }

    function drawMassless(view) {
        const { width, height } = state;
        const graphLeft = width * 0.12;
        const graphBottom = height * 0.82;
        const graphWidth = width * 0.74;
        const graphHeight = height * 0.6;
        const maxValue = 6;

        context.strokeStyle = 'rgba(228, 238, 249, 0.58)';
        context.lineWidth = 1.3;
        context.beginPath();
        context.moveTo(graphLeft, graphBottom);
        context.lineTo(graphLeft + graphWidth, graphBottom);
        context.lineTo(graphLeft + graphWidth, graphBottom - graphHeight);
        context.stroke();

        context.fillStyle = 'rgba(228, 238, 249, 0.92)';
        context.font = '600 14px IBM Plex Sans JP';
        context.fillText('p', graphLeft + graphWidth - 10, graphBottom - 10);
        context.fillText('E', graphLeft + 8, graphBottom - graphHeight + 20);

        context.strokeStyle = 'rgba(255, 196, 111, 0.92)';
        context.lineWidth = 2.8;
        context.beginPath();
        context.moveTo(graphLeft, graphBottom);
        context.lineTo(graphLeft + graphWidth, graphBottom - graphHeight);
        context.stroke();

        context.strokeStyle = 'rgba(86, 223, 245, 0.96)';
        context.lineWidth = 3;
        context.beginPath();
        for (let step = 0; step <= 180; step += 1) {
            const momentum = step / 180 * maxValue;
            const energy = Math.sqrt(momentum * momentum + view.massScale * view.massScale);
            const x = graphLeft + (momentum / maxValue) * graphWidth;
            const y = graphBottom - (Math.min(energy, maxValue) / maxValue) * graphHeight;
            if (step === 0) {
                context.moveTo(x, y);
            } else {
                context.lineTo(x, y);
            }
        }
        context.stroke();

        const selectedX = graphLeft + (view.momentum / maxValue) * graphWidth;
        const masslessY = graphBottom - (Math.min(view.momentum, maxValue) / maxValue) * graphHeight;
        const massiveY = graphBottom - (Math.min(view.massiveEnergy, maxValue) / maxValue) * graphHeight;

        context.fillStyle = 'rgba(255, 240, 202, 0.98)';
        context.beginPath();
        context.arc(selectedX, masslessY, 6.5, 0, TAU);
        context.fill();
        context.fillStyle = 'rgba(86, 223, 245, 0.98)';
        context.beginPath();
        context.arc(selectedX, massiveY, 6.5, 0, TAU);
        context.fill();

        drawTag('m = 0 → E = pc', graphLeft + 28, graphBottom - graphHeight + 28, 'rgba(7, 15, 26, 0.78)', 'rgba(255, 255, 255, 0.14)', '#f4f9ff');
        drawTag(view.massScale < 0.05 ? 'ほぼ質量ゼロ' : `m = ${view.massScale.toFixed(2)} m₀`, selectedX + 12, massiveY - 18, 'rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.14)', '#10263e');
        drawTag('質量項があると c の直線から離れる', graphLeft + graphWidth - 270, graphBottom - graphHeight * 0.34, 'rgba(7, 15, 26, 0.74)', 'rgba(255, 255, 255, 0.14)', '#f4f9ff');
    }

    function drawProper(view) {
        const { width, height } = state;
        const originX = width * 0.26;
        const originY = height * 0.8;
        const coneHeight = 160 + view.distanceScale * 120;
        const halfWidth = coneHeight * 0.64;
        const particleX = originX + halfWidth * view.beta;

        drawAxes(originX, originY, width * 0.18, coneHeight + 20);

        context.strokeStyle = 'rgba(255, 196, 111, 0.92)';
        context.lineWidth = 2.4;
        context.beginPath();
        context.moveTo(originX, originY);
        context.lineTo(originX + halfWidth, originY - coneHeight);
        context.stroke();

        context.strokeStyle = 'rgba(86, 223, 245, 0.96)';
        context.lineWidth = 3;
        context.beginPath();
        context.moveTo(originX, originY);
        context.lineTo(particleX, originY - coneHeight);
        context.stroke();

        for (let tick = 1; tick <= 6; tick += 1) {
            const ratio = tick / 7;
            const x = originX + (particleX - originX) * ratio;
            const y = originY - coneHeight * ratio;
            context.strokeStyle = 'rgba(255, 240, 202, 0.94)';
            context.lineWidth = 1.8;
            context.beginPath();
            context.moveTo(x - 6, y + 3);
            context.lineTo(x + 6, y - 3);
            context.stroke();
        }

        const gaugeLeft = width * 0.58;
        const gaugeBottom = height * 0.76;
        const gaugeHeight = height * 0.48;
        const particleHeight = gaugeHeight * view.tauRatio;

        context.fillStyle = 'rgba(255, 255, 255, 0.08)';
        roundedRectPath(gaugeLeft, gaugeBottom - gaugeHeight, 54, gaugeHeight, 18);
        context.fill();
        roundedRectPath(gaugeLeft + 110, gaugeBottom - gaugeHeight, 54, gaugeHeight, 18);
        context.fill();

        context.fillStyle = 'rgba(86, 223, 245, 0.92)';
        roundedRectPath(gaugeLeft, gaugeBottom - particleHeight, 54, particleHeight, 18);
        context.fill();
        context.fillStyle = 'rgba(255, 196, 111, 0.92)';
        roundedRectPath(gaugeLeft + 110, gaugeBottom, 54, 0.001, 18);
        context.fill();

        context.fillStyle = 'rgba(228, 238, 249, 0.92)';
        context.font = '600 14px IBM Plex Sans JP';
        context.fillText('質量あり', gaugeLeft - 4, gaugeBottom + 26);
        context.fillText('光', gaugeLeft + 126, gaugeBottom + 26);
        context.fillText(`τ / t ≈ ${view.tauRatio.toFixed(2)}`, gaugeLeft - 10, gaugeBottom - gaugeHeight - 14);
        context.fillText('τ = 0', gaugeLeft + 118, gaugeBottom - gaugeHeight - 14);

        drawTag('光の世界線には時計の刻みがない', gaugeLeft - 32, 58, 'rgba(7, 15, 26, 0.78)', 'rgba(255, 255, 255, 0.14)', '#f4f9ff');
        drawTag(`粒子: ${view.beta.toFixed(2)}c`, originX + 24, originY - coneHeight * 0.52, 'rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.14)', '#10263e');
    }

    function drawQuantum(view) {
        const { width, height, tick } = state;
        const sourceX = width * 0.22;
        const sourceY = height * 0.72;
        const targetX = width * (0.62 + view.observation * 0.18);
        const targetY = height * (0.24 + (1 - view.observation) * 0.16);
        const focusAlpha = 0.12 + view.coherence * 0.6;

        context.strokeStyle = 'rgba(255, 196, 111, 0.92)';
        context.lineWidth = 2.4;
        context.beginPath();
        context.moveTo(sourceX, sourceY);
        context.lineTo(targetX, targetY);
        context.stroke();

        context.strokeStyle = 'rgba(86, 223, 245, 0.25)';
        context.lineWidth = 1.5;
        for (let index = 0; index < 11; index += 1) {
            const spread = (index - 5) * (24 + (1 - view.coherence) * 22);
            context.beginPath();
            context.moveTo(sourceX, sourceY);
            context.quadraticCurveTo(
                width * 0.44,
                height * 0.3 + spread,
                targetX,
                targetY
            );
            context.stroke();
        }

        context.strokeStyle = `rgba(86, 223, 245, ${focusAlpha})`;
        context.lineWidth = 3.2;
        context.beginPath();
        context.moveTo(sourceX, sourceY);
        context.quadraticCurveTo(width * 0.44, height * 0.32, targetX, targetY);
        context.stroke();

        for (let ring = 0; ring < 4; ring += 1) {
            const radius = 20 + ring * 20 + Math.sin(tick * 2.1 + ring) * 2;
            context.strokeStyle = `rgba(255, 196, 111, ${0.18 - ring * 0.03})`;
            context.lineWidth = 1.3;
            context.beginPath();
            context.arc(sourceX, sourceY, radius, 0, TAU);
            context.stroke();
        }

        context.fillStyle = 'rgba(255, 240, 202, 0.98)';
        context.beginPath();
        context.arc(sourceX, sourceY, 7, 0, TAU);
        context.fill();
        context.beginPath();
        context.arc(targetX, targetY, 7, 0, TAU);
        context.fill();

        drawTag('電磁場の励起', sourceX - 34, sourceY + 18, 'rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.14)', '#10263e');
        drawTag('主な寄与は光円錐付近', width * 0.42, 56, 'rgba(7, 15, 26, 0.78)', 'rgba(255, 255, 255, 0.14)', '#f4f9ff');
        drawTag('時間発展は座標時間で追う', width - 256, height - 58, 'rgba(7, 15, 26, 0.74)', 'rgba(255, 255, 255, 0.14)', '#f4f9ff');
    }

    function drawFrame(timestamp) {
        const deltaTime = clamp((timestamp - state.lastTime) / 1000, 0, 0.04);
        state.lastTime = timestamp;
        state.tick += deltaTime;

        context.clearRect(0, 0, state.width, state.height);
        drawBackdrop();

        if (currentView) {
            if (currentView.kind === 'cone') {
                drawCone(currentView);
            } else if (currentView.kind === 'energy') {
                drawEnergy(currentView);
            } else if (currentView.kind === 'massless') {
                drawMassless(currentView);
            } else if (currentView.kind === 'proper') {
                drawProper(currentView);
            } else if (currentView.kind === 'quantum') {
                drawQuantum(currentView);
            }
        }

        requestAnimationFrame(drawFrame);
    }

    modeRow.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (!target.matches('.mode-chip')) return;
        setMode(target.dataset.mode || 'cone');
    });

    primaryRange.addEventListener('input', rebuildView);
    secondaryRange.addEventListener('input', rebuildView);
    window.addEventListener('resize', () => {
        resizeCanvas();
    });

    setMode('cone');
    resizeCanvas();
    rebuildView();
    drawFrame(performance.now());
})();