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

    const canvas = document.getElementById('communicationCanvas');
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
    const routeValue = document.getElementById('routeValue');
    const waveValue = document.getElementById('waveValue');
    const capacityValue = document.getElementById('capacityValue');
    const tradeoffValue = document.getElementById('tradeoffValue');
    const statusValue = document.getElementById('statusValue');

    const TAU = Math.PI * 2;

    const modeConfig = {
        network: {
            primary: {
                label: 'スマホの位置',
                min: 0,
                max: 100,
                step: 1,
                value: 32,
                format: (value) => `${Math.round(value)}%`
            },
            secondary: {
                label: '通信量',
                min: 0,
                max: 100,
                step: 1,
                value: 54,
                format: (value) => `${Math.round(value)}%`
            }
        },
        modulation: {
            primary: {
                label: '変調の深さ',
                min: 0,
                max: 100,
                step: 1,
                value: 62,
                format: (value) => `${Math.round(value)}%`
            },
            secondary: {
                label: 'シンボル数',
                min: 4,
                max: 12,
                step: 1,
                value: 8,
                format: (value) => `${Math.round(value)} 個`
            }
        },
        mimo: {
            primary: {
                label: 'アンテナ数',
                min: 2,
                max: 8,
                step: 1,
                value: 4,
                format: (value) => `${Math.round(value)} 本`
            },
            secondary: {
                label: 'ビーム集中',
                min: 0,
                max: 100,
                step: 1,
                value: 58,
                format: (value) => `${Math.round(value)}%`
            }
        },
        ofdm: {
            primary: {
                label: 'サブキャリア数',
                min: 4,
                max: 16,
                step: 1,
                value: 8,
                format: (value) => `${Math.round(value)} 本`
            },
            secondary: {
                label: 'CP 比率',
                min: 0,
                max: 40,
                step: 1,
                value: 14,
                format: (value) => `${Math.round(value)}%`
            }
        }
    };

    const state = {
        mode: 'network',
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

    function buildNetworkView(controls) {
        const phonePos = controls.primaryNorm;
        const load = controls.secondaryNorm;
        const towerIndex = phonePos < 0.33 ? 0 : phonePos < 0.66 ? 1 : 2;
        const handover = Math.abs(phonePos - 0.33) < 0.07 || Math.abs(phonePos - 0.66) < 0.07;
        return {
            kind: 'network',
            phonePos,
            load,
            towerIndex,
            handover,
            route: handover
                ? '移動中で、2 つの基地局の間でハンドオーバーが起きやすい位置です。'
                : '携帯回線では最寄り基地局が最初の受け手になり、Wi-Fi ではルーターが受け手になります。',
            wave: '電波そのものは同じ電磁波で、違うのは最初の中継相手と周波数帯です。',
            capacity: `通信量 ${Math.round(load * 100)}% に応じて、パケットがより密に流れます。`,
            tradeoff: '携帯回線は移動に強く、Wi-Fi は固定環境で効率が高い。どちらも最後は有線インターネットへ合流します。',
            status: handover
                ? 'スマホ通信の「動きながらつながる」は、基地局切替の制御が支えています。'
                : '通信の入口は無線でも、全区間が無線というわけではありません。',
            narration: '回線と Wi-Fi モードでは、スマホが基地局やルーターへ無線で飛ばし、その先でインターネットへ流れる流れを見てください。'
        };
    }

    function buildModulationView(controls) {
        const depth = 0.22 + controls.primaryNorm * 0.72;
        const symbols = Math.round(controls.secondary);
        const qamOrder = depth > 0.65 ? 16 : depth > 0.38 ? 8 : 4;
        return {
            kind: 'modulation',
            depth,
            symbols,
            qamOrder,
            route: '0 と 1 のビット列は、そのままではなく波の振幅や位相の違いとして送られます。',
            wave: `変調の深さ ${Math.round(depth * 100)}% で、搬送波の振れ方がはっきり分かる設定です。`,
            capacity: `QAM の点配置を増やすと、1 シンボルでより多くのビットを送れます。今の模式図は約 ${qamOrder} 値相当です。`,
            tradeoff: '点を密に詰めるほど高速ですが、ノイズで隣の点へ誤認しやすくなります。',
            status: '通信の本質は「波の形を変えて意味を埋め込み、遠くでその形を読み直す」ことです。',
            narration: '変調モードでは、時間波形と I-Q 平面を対応させて、位相と振幅がデータへ変わる様子を見てください。'
        };
    }

    function buildMimoView(controls) {
        const antennas = Math.round(controls.primary);
        const focus = controls.secondaryNorm;
        const streams = Math.max(1, Math.min(antennas, Math.round(1 + antennas * (0.28 + focus * 0.42))));
        const bandwidthGain = 1 + focus * 0.6;
        return {
            kind: 'mimo',
            antennas,
            focus,
            streams,
            bandwidthGain,
            route: `送受信アンテナ ${antennas} 本で、空間的に約 ${streams} 本の独立ストリームを狙う設定です。`,
            wave: 'MIMO は反射・回折でできた複数経路を、邪魔ではなく分離可能な情報経路として利用します。',
            capacity: `ビーム集中を上げると S/N が改善し、容量も約 ${bandwidthGain.toFixed(2)} 倍ぶん有利に働きます。`,
            tradeoff: 'ミリ波は広帯域だが減衰しやすいので、基地局密度とビーム制御が重要になります。',
            status: '5G の速さは、周波数だけでなく「空間そのもの」を並列チャネルに変えて作っています。',
            narration: '5G / MIMO モードでは、複数アンテナとビームフォーミングで、同時通信数と S/N を押し上げる発想を見てください。'
        };
    }

    function buildOfdmView(controls) {
        const carriers = Math.round(controls.primary);
        const cpRatio = controls.secondary / 100;
        const spacing = 1;
        return {
            kind: 'ofdm',
            carriers,
            cpRatio,
            spacing,
            route: `${carriers} 本のサブキャリアへ広帯域を分けて、同時に並列送信するイメージです。`,
            wave: 'サブキャリアは有限時間 T だけ送られるので、周波数側では sinc へ広がります。',
            capacity: '細いチャネルを多数並べることで高速化しつつ、各サブキャリアは低速なのでマルチパスに強くなります。',
            tradeoff: `CP を ${Math.round(cpRatio * 100)}% 入れると遅延に強くなりますが、その分だけ有効データ率は少し下がります。`,
            status: 'OFDM の核心は、重なって見えるスペクトルを「直交」で分離し、FFT で一気に処理することです。',
            narration: 'OFDM モードでは、時間窓で切られたサブキャリアが sinc スペクトルになり、中心周波数では隣がゼロになる設計を見てください。'
        };
    }

    function buildView() {
        const controls = readControls();
        updateRangeLabels(controls);
        switch (state.mode) {
            case 'modulation':
                return buildModulationView(controls);
            case 'mimo':
                return buildMimoView(controls);
            case 'ofdm':
                return buildOfdmView(controls);
            case 'network':
            default:
                return buildNetworkView(controls);
        }
    }

    function rebuildView() {
        currentView = buildView();
        routeValue.textContent = currentView.route;
        waveValue.textContent = currentView.wave;
        capacityValue.textContent = currentView.capacity;
        tradeoffValue.textContent = currentView.tradeoff;
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
        gradient.addColorStop(0, '#040d12');
        gradient.addColorStop(0.54, '#0d1d25');
        gradient.addColorStop(1, '#163640');
        context.fillStyle = gradient;
        context.fillRect(0, 0, width, height);

        const glowA = context.createRadialGradient(width * 0.18, height * 0.18, 10, width * 0.18, height * 0.18, width * 0.24);
        glowA.addColorStop(0, 'rgba(68, 215, 214, 0.16)');
        glowA.addColorStop(1, 'rgba(68, 215, 214, 0)');
        context.fillStyle = glowA;
        context.fillRect(0, 0, width, height);

        const glowB = context.createRadialGradient(width * 0.8, height * 0.22, 10, width * 0.8, height * 0.22, width * 0.18);
        glowB.addColorStop(0, 'rgba(255, 179, 87, 0.12)');
        glowB.addColorStop(1, 'rgba(255, 179, 87, 0)');
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
            const alpha = 0.22 + hash(index, 4) * 0.54;
            context.fillStyle = `rgba(255, 255, 255, ${alpha})`;
            context.beginPath();
            context.arc(x, y + Math.sin(tick * 0.35 + index) * 0.5, size, 0, TAU);
            context.fill();
        }
    }

    function drawPhone(x, y, width, height, glow) {
        roundedRectPath(x, y, width, height, 16);
        context.fillStyle = 'rgba(12, 23, 33, 0.96)';
        context.fill();
        context.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        context.stroke();

        roundedRectPath(x + 8, y + 8, width - 16, height - 18, 12);
        context.fillStyle = glow;
        context.fill();
        context.fillStyle = 'rgba(255, 255, 255, 0.32)';
        context.fillRect(x + width * 0.35, y + height - 8, width * 0.3, 2.5);
    }

    function drawTower(x, y, color) {
        context.strokeStyle = color;
        context.lineWidth = 3;
        context.beginPath();
        context.moveTo(x, y + 76);
        context.lineTo(x, y + 8);
        context.stroke();

        context.beginPath();
        context.moveTo(x - 20, y + 34);
        context.lineTo(x, y + 20);
        context.lineTo(x + 20, y + 34);
        context.stroke();

        context.beginPath();
        context.arc(x, y + 12, 24, 0, TAU);
        context.strokeStyle = 'rgba(68, 215, 214, 0.26)';
        context.stroke();
        context.beginPath();
        context.arc(x, y + 12, 38, 0, TAU);
        context.strokeStyle = 'rgba(255, 179, 87, 0.18)';
        context.stroke();
    }

    function drawRouter(x, y) {
        roundedRectPath(x, y, 86, 44, 14);
        context.fillStyle = 'rgba(12, 26, 39, 0.96)';
        context.fill();
        context.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        context.stroke();
        context.strokeStyle = 'rgba(255, 255, 255, 0.72)';
        context.lineWidth = 2.5;
        context.beginPath();
        context.moveTo(x + 18, y - 16);
        context.lineTo(x + 18, y + 6);
        context.moveTo(x + 68, y - 16);
        context.lineTo(x + 68, y + 6);
        context.stroke();
    }

    function drawNetwork(view) {
        const { width, height, tick } = state;
        const leftPhoneX = 76 + view.phonePos * 220;
        const leftPhoneY = height - 118;
        const towerXs = [200, 324, 448];
        const activeTower = towerXs[view.towerIndex];
        const loadCount = 4 + Math.round(view.load * 8);

        const cloudX = width * 0.5;
        const cloudY = 84;
        roundedRectPath(cloudX - 92, cloudY, 184, 58, 28);
        context.fillStyle = 'rgba(208, 246, 243, 0.82)';
        context.fill();
        context.fillStyle = 'rgba(15, 44, 54, 0.68)';
        context.font = '600 14px IBM Plex Sans JP';
        context.fillText('Internet / Core Network', cloudX - 62, cloudY + 34);

        drawPhone(leftPhoneX, leftPhoneY, 52, 90, 'rgba(68, 215, 214, 0.24)');
        drawTower(towerXs[0], 210, 'rgba(255,255,255,0.34)');
        drawTower(towerXs[1], 182, 'rgba(255,255,255,0.34)');
        drawTower(towerXs[2], 224, 'rgba(255,255,255,0.34)');
        drawRouter(width - 180, 244);
        drawPhone(width - 96, height - 118, 52, 90, 'rgba(255, 179, 87, 0.22)');

        context.strokeStyle = 'rgba(68, 215, 214, 0.9)';
        context.lineWidth = 3;
        context.beginPath();
        context.moveTo(leftPhoneX + 26, leftPhoneY + 12);
        context.quadraticCurveTo((leftPhoneX + activeTower) * 0.5, leftPhoneY - 68, activeTower, 228);
        context.stroke();

        if (view.handover) {
            const secondTower = towerXs[view.phonePos < 0.5 ? 1 : 1];
            context.strokeStyle = 'rgba(255, 179, 87, 0.72)';
            context.lineWidth = 2;
            context.beginPath();
            context.moveTo(leftPhoneX + 26, leftPhoneY + 8);
            context.quadraticCurveTo((leftPhoneX + secondTower) * 0.5, leftPhoneY - 52, secondTower, 200);
            context.stroke();
        }

        context.strokeStyle = 'rgba(196, 245, 243, 0.54)';
        context.lineWidth = 2.4;
        context.beginPath();
        context.moveTo(activeTower, 194);
        context.lineTo(cloudX - 110, cloudY + 28);
        context.stroke();

        context.strokeStyle = 'rgba(255, 179, 87, 0.84)';
        context.beginPath();
        context.moveTo(width - 140, 244);
        context.lineTo(width - 70, height - 110);
        context.stroke();
        context.strokeStyle = 'rgba(255, 242, 220, 0.52)';
        context.beginPath();
        context.moveTo(width - 140, 244);
        context.lineTo(cloudX + 112, cloudY + 28);
        context.stroke();

        for (let index = 0; index < loadCount; index += 1) {
            const progress = (tick * 0.36 + index / loadCount) % 1;
            const x = leftPhoneX + 26 + (activeTower - (leftPhoneX + 26)) * progress;
            const y = leftPhoneY + 12 - 78 * Math.sin(progress * Math.PI);
            context.fillStyle = 'rgba(183, 240, 106, 0.94)';
            context.beginPath();
            context.arc(x, y, 3.5, 0, TAU);
            context.fill();
        }

        for (let index = 0; index < 3 + Math.round(view.load * 5); index += 1) {
            const progress = (tick * 0.42 + index / 8) % 1;
            const x = width - 114 + 44 * Math.cos(progress * Math.PI * 0.8);
            const y = height - 102 - progress * 140;
            context.fillStyle = 'rgba(255, 179, 87, 0.92)';
            context.beginPath();
            context.arc(x, y, 3.5, 0, TAU);
            context.fill();
        }

        drawTag('携帯回線', 54, 40, 'rgba(7, 16, 23, 0.8)', 'rgba(255, 255, 255, 0.14)', '#f4fbfb');
        drawTag('Wi-Fi', width - 134, 40, 'rgba(7, 16, 23, 0.8)', 'rgba(255, 255, 255, 0.14)', '#f4fbfb');
        drawTag(view.handover ? 'ハンドオーバー境界' : '最寄り基地局へ接続', 136, height - 54, 'rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.14)', '#12303d');
    }

    function drawModulation(view) {
        const { width, height } = state;
        const graphLeft = 58;
        const graphTop = 76;
        const graphWidth = width * 0.56;
        const graphHeight = height * 0.54;
        const midY = graphTop + graphHeight * 0.52;
        const symbols = view.symbols;
        const segmentWidth = graphWidth / symbols;
        const depth = view.depth;
        const states = Array.from({ length: symbols }, (_, index) => (index * 3 + 1) % 4);

        roundedRectPath(graphLeft, graphTop, graphWidth, graphHeight, 24);
        context.fillStyle = 'rgba(255, 255, 255, 0.04)';
        context.fill();
        context.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        context.stroke();

        context.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        context.lineWidth = 1;
        for (let index = 1; index < symbols; index += 1) {
            const x = graphLeft + index * segmentWidth;
            context.beginPath();
            context.moveTo(x, graphTop + 16);
            context.lineTo(x, graphTop + graphHeight - 16);
            context.stroke();
        }
        context.beginPath();
        context.moveTo(graphLeft + 16, midY);
        context.lineTo(graphLeft + graphWidth - 16, midY);
        context.stroke();

        context.strokeStyle = 'rgba(255, 179, 87, 0.24)';
        context.lineWidth = 2;
        context.beginPath();
        for (let x = 0; x <= graphWidth; x += 2) {
            const y = midY + 24 * Math.sin((x / graphWidth) * symbols * TAU * 1.2);
            if (x === 0) {
                context.moveTo(graphLeft + x, y);
            } else {
                context.lineTo(graphLeft + x, y);
            }
        }
        context.stroke();

        context.strokeStyle = 'rgba(68, 215, 214, 0.94)';
        context.lineWidth = 3;
        context.beginPath();
        for (let x = 0; x <= graphWidth; x += 2) {
            const symbolIndex = Math.min(symbols - 1, Math.floor(x / segmentWidth));
            const stateValue = states[symbolIndex];
            const amplitude = 18 + (10 + stateValue * 8) * depth;
            const phase = stateValue >= 2 ? Math.PI : 0;
            const frequency = 0.9 + (stateValue % 2) * 0.45;
            const y = midY + amplitude * Math.sin((x / segmentWidth) * TAU * frequency + phase);
            if (x === 0) {
                context.moveTo(graphLeft + x, y);
            } else {
                context.lineTo(graphLeft + x, y);
            }
        }
        context.stroke();

        context.fillStyle = 'rgba(238, 245, 245, 0.92)';
        context.font = '600 13px IBM Plex Sans JP';
        states.forEach((stateValue, index) => {
            const label = stateValue.toString(2).padStart(2, '0');
            context.fillText(label, graphLeft + index * segmentWidth + 10, graphTop + 22);
        });

        const planeX = width * 0.74;
        const planeY = height * 0.54;
        const planeSize = 134;
        context.strokeStyle = 'rgba(228, 238, 239, 0.48)';
        context.lineWidth = 1.4;
        context.beginPath();
        context.moveTo(planeX - planeSize * 0.5, planeY);
        context.lineTo(planeX + planeSize * 0.5, planeY);
        context.moveTo(planeX, planeY + planeSize * 0.5);
        context.lineTo(planeX, planeY - planeSize * 0.5);
        context.stroke();
        context.fillStyle = 'rgba(228, 238, 239, 0.92)';
        context.fillText('I', planeX + planeSize * 0.5 - 10, planeY - 10);
        context.fillText('Q', planeX + 10, planeY - planeSize * 0.5 + 16);

        const constellation = [
            { i: -1, q: -1 },
            { i: -1, q: 1 },
            { i: 1, q: -1 },
            { i: 1, q: 1 }
        ];
        constellation.forEach((point, index) => {
            const radius = 24 + depth * 18;
            const x = planeX + point.i * radius;
            const y = planeY - point.q * radius;
            context.fillStyle = index < 2 + Math.round(depth * 2)
                ? 'rgba(183, 240, 106, 0.96)'
                : 'rgba(255,255,255,0.24)';
            context.beginPath();
            context.arc(x, y, 7, 0, TAU);
            context.fill();
        });

        drawTag('搬送波 → 変調波', graphLeft + 24, graphTop + graphHeight - 38, 'rgba(7, 16, 23, 0.78)', 'rgba(255, 255, 255, 0.14)', '#f4fbfb');
        drawTag('I-Q 平面', planeX - 30, planeY - planeSize * 0.5 - 24, 'rgba(7, 16, 23, 0.78)', 'rgba(255, 255, 255, 0.14)', '#f4fbfb');
        drawTag(`約 ${view.qamOrder} 値相当`, planeX - 38, planeY + planeSize * 0.5 + 18, 'rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.14)', '#12303d');
    }

    function drawMimo(view) {
        const { width, height, tick } = state;
        const txX = 126;
        const rxX = width - 168;
        const baseY = height * 0.5;
        const antennas = view.antennas;
        const spacing = 34;
        const txTop = baseY - ((antennas - 1) * spacing) * 0.5;
        const rxCount = Math.max(2, Math.min(4, view.streams));
        const rxTop = baseY - ((rxCount - 1) * spacing * 1.1) * 0.5;

        roundedRectPath(70, 84, 110, height - 150, 24);
        context.fillStyle = 'rgba(255, 255, 255, 0.05)';
        context.fill();
        roundedRectPath(width - 220, 112, 124, height - 206, 24);
        context.fill();

        context.fillStyle = 'rgba(228, 238, 239, 0.92)';
        context.font = '600 14px IBM Plex Sans JP';
        context.fillText('Base Station', 86, 108);
        context.fillText('User Device', width - 204, 136);

        const txPoints = [];
        const rxPoints = [];
        for (let index = 0; index < antennas; index += 1) {
            const y = txTop + index * spacing;
            txPoints.push({ x: txX, y });
            context.fillStyle = 'rgba(68, 215, 214, 0.96)';
            context.beginPath();
            context.arc(txX, y, 7, 0, TAU);
            context.fill();
        }
        for (let index = 0; index < rxCount; index += 1) {
            const y = rxTop + index * spacing * 1.1;
            rxPoints.push({ x: rxX, y });
            context.fillStyle = 'rgba(255, 179, 87, 0.96)';
            context.beginPath();
            context.arc(rxX, y, 7, 0, TAU);
            context.fill();
        }

        txPoints.forEach((txPoint, txIndex) => {
            rxPoints.forEach((rxPoint, rxIndex) => {
                const alpha = 0.14 + ((txIndex + rxIndex) % 4) * 0.08;
                const focusLift = (1 - view.focus) * 80 + (txIndex - rxIndex) * 10;
                context.strokeStyle = `rgba(196, 245, 243, ${alpha})`;
                context.lineWidth = 1.4;
                context.beginPath();
                context.moveTo(txPoint.x, txPoint.y);
                context.quadraticCurveTo(width * 0.48, baseY - focusLift, rxPoint.x, rxPoint.y);
                context.stroke();
            });
        });

        const beamWidth = 190 - view.focus * 120;
        context.fillStyle = `rgba(183, 240, 106, ${0.08 + view.focus * 0.18})`;
        context.beginPath();
        context.moveTo(190, baseY - beamWidth * 0.5);
        context.lineTo(rxX + 10, baseY - 28);
        context.lineTo(rxX + 10, baseY + 28);
        context.lineTo(190, baseY + beamWidth * 0.5);
        context.closePath();
        context.fill();

        for (let stream = 0; stream < view.streams; stream += 1) {
            const progress = (tick * 0.36 + stream / Math.max(view.streams, 1)) % 1;
            const y = baseY - (view.streams - 1) * 12 + stream * 24;
            const x = 190 + (rxX - 190) * progress;
            context.fillStyle = 'rgba(255, 248, 224, 0.96)';
            context.beginPath();
            context.arc(x, y + Math.sin(progress * Math.PI * 2 + stream) * (8 + (1 - view.focus) * 10), 4, 0, TAU);
            context.fill();
        }

        roundedRectPath(width * 0.43, 84, 108, 64, 18);
        context.fillStyle = 'rgba(7, 16, 23, 0.78)';
        context.fill();
        context.fillStyle = 'rgba(244, 251, 251, 0.92)';
        context.fillText('y = Hx', width * 0.43 + 30, 112);
        context.fillText(`${view.streams} streams`, width * 0.43 + 18, 134);

        drawTag('MIMO + Beamforming', width * 0.39, 40, 'rgba(7, 16, 23, 0.8)', 'rgba(255, 255, 255, 0.14)', '#f4fbfb');
        drawTag(`アンテナ ${antennas} 本`, 78, height - 54, 'rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.14)', '#12303d');
        drawTag(`空間ストリーム ${view.streams}`, width - 242, height - 54, 'rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.14)', '#12303d');
    }

    function sinc(value) {
        if (Math.abs(value) < 1e-6) return 1;
        return Math.sin(Math.PI * value) / (Math.PI * value);
    }

    function drawOfdm(view) {
        const { width, height } = state;
        const timeLeft = 56;
        const timeTop = 66;
        const timeWidth = width * 0.38;
        const timeHeight = 128;
        const cpWidth = timeWidth * view.cpRatio;

        roundedRectPath(timeLeft, timeTop, timeWidth, timeHeight, 24);
        context.fillStyle = 'rgba(255, 255, 255, 0.05)';
        context.fill();
        roundedRectPath(timeLeft, timeTop, cpWidth, timeHeight, 24);
        context.fillStyle = 'rgba(255, 179, 87, 0.16)';
        context.fill();

        const midY = timeTop + timeHeight * 0.55;
        context.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(timeLeft + 12, midY);
        context.lineTo(timeLeft + timeWidth - 12, midY);
        context.stroke();

        context.strokeStyle = 'rgba(68, 215, 214, 0.96)';
        context.lineWidth = 2.6;
        context.beginPath();
        for (let x = 0; x <= timeWidth; x += 2) {
            const local = x / timeWidth;
            let sum = 0;
            const shown = Math.min(view.carriers, 6);
            for (let carrier = 0; carrier < shown; carrier += 1) {
                const frequency = 1 + carrier * 0.8;
                sum += Math.sin(local * TAU * frequency + carrier * 0.7) * (0.22 + carrier * 0.05);
            }
            const y = midY + sum * 24;
            if (x === 0) {
                context.moveTo(timeLeft + x, y);
            } else {
                context.lineTo(timeLeft + x, y);
            }
        }
        context.stroke();

        const graphLeft = 52;
        const graphBottom = height - 66;
        const graphWidth = width - 104;
        const graphHeight = height * 0.42;
        context.strokeStyle = 'rgba(228, 238, 239, 0.58)';
        context.lineWidth = 1.3;
        context.beginPath();
        context.moveTo(graphLeft, graphBottom);
        context.lineTo(graphLeft + graphWidth, graphBottom);
        context.lineTo(graphLeft + graphWidth, graphBottom - graphHeight);
        context.stroke();

        const displayed = Math.min(view.carriers, 7);
        const centerIndex = Math.floor(displayed / 2);
        const spacing = graphWidth / (displayed + 1);
        for (let carrier = 0; carrier < displayed; carrier += 1) {
            const centerX = graphLeft + spacing * (carrier + 1);
            context.strokeStyle = carrier === centerIndex
                ? 'rgba(255, 179, 87, 0.9)'
                : 'rgba(68, 215, 214, 0.6)';
            context.lineWidth = carrier === centerIndex ? 2.8 : 1.8;
            context.beginPath();
            for (let step = -180; step <= 180; step += 2) {
                const normalized = step / 60;
                const x = centerX + step;
                const y = graphBottom - sinc(normalized) * graphHeight * 0.48;
                if (step === -180) {
                    context.moveTo(x, y);
                } else {
                    context.lineTo(x, y);
                }
            }
            context.stroke();
        }

        for (let carrier = 0; carrier < displayed; carrier += 1) {
            const centerX = graphLeft + spacing * (carrier + 1);
            context.fillStyle = 'rgba(244, 251, 251, 0.9)';
            context.beginPath();
            context.arc(centerX, graphBottom - graphHeight * 0.48, 4.5, 0, TAU);
            context.fill();
        }

        drawTag(`CP ${Math.round(view.cpRatio * 100)}%`, timeLeft + 10, timeTop + 14, 'rgba(7, 16, 23, 0.78)', 'rgba(255, 255, 255, 0.14)', '#f4fbfb');
        drawTag(`Δf = 1/T`, graphLeft + 18, graphBottom - graphHeight + 20, 'rgba(7, 16, 23, 0.78)', 'rgba(255, 255, 255, 0.14)', '#f4fbfb');
        drawTag('重なっても復号点では直交', graphLeft + graphWidth - 220, graphBottom - graphHeight + 20, 'rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.14)', '#12303d');
    }

    function drawFrame(timestamp) {
        const deltaTime = clamp((timestamp - state.lastTime) / 1000, 0, 0.04);
        state.lastTime = timestamp;
        state.tick += deltaTime;

        context.clearRect(0, 0, state.width, state.height);
        drawBackdrop();

        if (currentView) {
            if (currentView.kind === 'network') {
                drawNetwork(currentView);
            } else if (currentView.kind === 'modulation') {
                drawModulation(currentView);
            } else if (currentView.kind === 'mimo') {
                drawMimo(currentView);
            } else if (currentView.kind === 'ofdm') {
                drawOfdm(currentView);
            }
        }

        requestAnimationFrame(drawFrame);
    }

    modeRow.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (!target.matches('.mode-chip')) return;
        setMode(target.dataset.mode || 'network');
    });

    primaryRange.addEventListener('input', rebuildView);
    secondaryRange.addEventListener('input', rebuildView);
    window.addEventListener('resize', () => {
        resizeCanvas();
    });

    setMode('network');
    resizeCanvas();
    rebuildView();
    drawFrame(performance.now());
})();