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

    const canvas = document.getElementById('universeCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const modeRow = document.getElementById('modeRow');
    const primaryRange = document.getElementById('primaryRange');
    const secondaryRange = document.getElementById('secondaryRange');
    const primaryLabel = document.getElementById('primaryLabel');
    const secondaryLabel = document.getElementById('secondaryLabel');
    const primaryValue = document.getElementById('primaryValue');
    const secondaryValue = document.getElementById('secondaryValue');
    const demoNarration = document.getElementById('demoNarration');
    const scopeValue = document.getElementById('scopeValue');
    const boundaryValue = document.getElementById('boundaryValue');
    const outsideValue = document.getElementById('outsideValue');
    const timeValue = document.getElementById('timeValue');
    const statusValue = document.getElementById('statusValue');

    const TAU = Math.PI * 2;

    const modeConfig = {
        observable: {
            primary: {
                label: '観測の届き方',
                min: 20,
                max: 100,
                step: 1,
                value: 64,
                format: (value) => `${Math.round(value)}%`
            },
            secondary: {
                label: '膨張の効き',
                min: 0,
                max: 100,
                step: 1,
                value: 56,
                format: (value) => `${Math.round(value)}%`
            }
        },
        shape: {
            primary: {
                label: '曲率の強さ',
                min: 0,
                max: 100,
                step: 1,
                value: 58,
                format: (value) => `${Math.round(value)}%`
            },
            secondary: {
                label: '旅の進み',
                min: 0,
                max: 100,
                step: 1,
                value: 34,
                format: (value) => `${Math.round(value)}%`
            }
        },
        outside: {
            primary: {
                label: '空間の伸び',
                min: 0,
                max: 100,
                step: 1,
                value: 52,
                format: (value) => `${Math.round(value)}%`
            },
            secondary: {
                label: '視点のズーム',
                min: 0,
                max: 100,
                step: 1,
                value: 46,
                format: (value) => `${Math.round(value)}%`
            }
        },
        time: {
            primary: {
                label: '古典理論の比重',
                min: 0,
                max: 100,
                step: 1,
                value: 72,
                format: (value) => `${Math.round(value)}%`
            },
            secondary: {
                label: '量子補正の比重',
                min: 0,
                max: 100,
                step: 1,
                value: 44,
                format: (value) => `${Math.round(value)}%`
            }
        }
    };

    const state = {
        mode: 'observable',
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

    function buildObservableView(controls) {
        const visibleRadius = 112 + controls.primaryNorm * 126;
        const beyondRadius = visibleRadius + 60 + controls.secondaryNorm * 88;
        const arrowLength = 16 + controls.secondaryNorm * 34;
        return {
            kind: 'observable',
            visibleRadius,
            beyondRadius,
            arrowLength,
            scope: '観測可能宇宙は有限で、見えるのは「いま届く情報」の範囲だけ。',
            boundary: '地平線は壁ではなく、情報が届くかどうかを分ける観測限界です。',
            outside: 'その外は未観測で、存在しないとまでは言えません。むしろ広がっている可能性が高いです。',
            time: '宇宙年齢は約 138 億年でも、空間膨張のため現在の可視直径は約 930 億光年級になります。',
            status: 'ハッブル膨張が強いほど、「まだ見えない外側」が大きく残ると読むのが本質です。',
            narration: '見えている宇宙は、宇宙全体の切り抜きです。光速有限と宇宙膨張が組み合わさって、私たちの視界には地平線が生まれます。'
        };
    }

    function buildShapeView(controls) {
        const curvature = controls.primaryNorm;
        const travel = controls.secondaryNorm;
        let scope = '観測上はかなり平坦に見える宇宙像です。';
        if (curvature > 0.32) {
            scope = '有限でも端なし、という幾何の直感が見やすい設定です。';
        }
        if (curvature > 0.72) {
            scope = '曲がった空間のイメージをかなり強調しています。';
        }

        let narration = '宇宙が無限か有限かは未決着ですが、有限なら端が要るとは限りません。';
        if (travel > 0.6) {
            narration = 'どこまで進んでも壁にぶつからず、外へ落ちる方向もない。この感覚が「有限だけど端なし」です。';
        }

        return {
            kind: 'shape',
            curvature,
            travel,
            scope,
            boundary: '端の壁は現れず、外に抜ける方向も定義されません。',
            outside: '中心も特別ではなく、一様・等方なら「ここが真ん中」という場所はありません。',
            time: '空間の形の問題と、時間の始まりの問題は別です。まずは空間だけで端なしがあり得ます。',
            status: '地球表面の 2 次元類比を 3 次元空間へ持ち上げると、有限でも端なしが理解しやすくなります。',
            narration
        };
    }

    function buildOutsideView(controls) {
        const stretch = 0.85 + controls.primaryNorm * 0.95;
        const zoom = 0.76 + controls.secondaryNorm * 0.9;
        const speculative = controls.secondaryNorm > 0.58;
        return {
            kind: 'outside',
            stretch,
            zoom,
            scope: '宇宙論の基本では、宇宙は「空間そのもの」です。',
            boundary: '膨張に外枠や容器は要りません。伸びるのは空間の尺度です。',
            outside: speculative
                ? '高次元理論やマルチバースなら外側に似た考え方はできますが、まだ仮説段階です。'
                : '通常の意味での外側は定義されません。箱の外のようなものは要りません。',
            time: '銀河が何かの中を飛ぶのでなく、距離を測る物差し a(t) が伸びると考えます。',
            status: '風船表面のたとえは「表面が伸びる」部分だけを借りると有効です。',
            narration: speculative
                ? '日常語の「外」をそのまま宇宙に当てはめるとズレます。その先で高次元理論やマルチバースが現れます。'
                : '宇宙膨張は、銀河が箱の中を泳ぐ絵ではありません。空間そのものの尺度が大きくなる、と読むのが本筋です。'
        };
    }

    function buildTimeView(controls) {
        const classical = controls.primaryNorm;
        const quantum = controls.secondaryNorm;
        let scenario = '古典ビッグバン像が前面に出ています。';
        if (quantum > 0.32) {
            scenario = '特異点が理論の限界で、量子重力がそれをなだらかに置き換える可能性が見えてきます。';
        }
        if (quantum > 0.7) {
            scenario = 'バウンス、無境界、永遠インフレーションのような複数シナリオが並立する領域です。';
        }

        return {
            kind: 'time',
            classical,
            quantum,
            scope: '少なくともビッグバン後の膨張史は、観測でかなりよく確かめられています。',
            boundary: 't = 0 の特異点は、自然そのものよりも古典理論の限界を示しているかもしれません。',
            outside: '「時間の前」が定義できるかどうか自体が、まだ未確定です。',
            time: scenario,
            status: '時間の始まりは未解決問題で、始まりが単純な一点とは限りません。',
            narration: quantum > 0.55
                ? '量子重力の比重を上げると、特異点は研究の入口に変わります。始まりは、点ではなく構造かもしれません。'
                : '古典理論を前面に出すと、宇宙は高温高密度の過去へさかのぼります。ただし特異点そのものが答えだとは限りません。'
        };
    }

    function buildView() {
        const controls = readControls();
        updateRangeLabels(controls);
        switch (state.mode) {
            case 'shape':
                return buildShapeView(controls);
            case 'outside':
                return buildOutsideView(controls);
            case 'time':
                return buildTimeView(controls);
            case 'observable':
            default:
                return buildObservableView(controls);
        }
    }

    function rebuildView() {
        currentView = buildView();
        scopeValue.textContent = currentView.scope;
        boundaryValue.textContent = currentView.boundary;
        outsideValue.textContent = currentView.outside;
        timeValue.textContent = currentView.time;
        statusValue.textContent = currentView.status;
        demoNarration.textContent = currentView.narration;
    }

    function resizeCanvas() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const width = canvas.clientWidth || 900;
        const height = Math.max(400, Math.round(width * 0.58));
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.height = `${height}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        state.width = width;
        state.height = height;
    }

    function roundedRectPath(x, y, width, height, radius) {
        const r = Math.min(radius, width * 0.5, height * 0.5);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + width, y, x + width, y + height, r);
        ctx.arcTo(x + width, y + height, x, y + height, r);
        ctx.arcTo(x, y + height, x, y, r);
        ctx.arcTo(x, y, x + width, y, r);
        ctx.closePath();
    }

    function drawTag(text, x, y, fill, stroke, color) {
        ctx.save();
        ctx.font = '600 13px IBM Plex Sans JP';
        const width = ctx.measureText(text).width + 22;
        roundedRectPath(x, y, width, 30, 15);
        ctx.fillStyle = fill;
        ctx.fill();
        if (stroke) {
            ctx.strokeStyle = stroke;
            ctx.stroke();
        }
        ctx.fillStyle = color;
        ctx.fillText(text, x + 11, y + 20);
        ctx.restore();
    }

    function drawBackdrop() {
        const { width, height, tick } = state;
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, '#05101b');
        gradient.addColorStop(0.54, '#0d1f34');
        gradient.addColorStop(1, '#142d49');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        const nebulaA = ctx.createRadialGradient(width * 0.18, height * 0.24, 12, width * 0.18, height * 0.24, width * 0.28);
        nebulaA.addColorStop(0, 'rgba(85, 208, 255, 0.16)');
        nebulaA.addColorStop(1, 'rgba(85, 208, 255, 0)');
        ctx.fillStyle = nebulaA;
        ctx.fillRect(0, 0, width, height);

        const nebulaB = ctx.createRadialGradient(width * 0.78, height * 0.18, 10, width * 0.78, height * 0.18, width * 0.22);
        nebulaB.addColorStop(0, 'rgba(255, 196, 109, 0.12)');
        nebulaB.addColorStop(1, 'rgba(255, 196, 109, 0)');
        ctx.fillStyle = nebulaB;
        ctx.fillRect(0, 0, width, height);

        for (let index = 0; index < 82; index += 1) {
            const x = hash(index, 1) * width;
            const y = hash(index, 2) * height;
            const size = 0.6 + hash(index, 3) * 2.1;
            const alpha = 0.22 + hash(index, 4) * 0.58;
            ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
            ctx.beginPath();
            ctx.arc(x, y + Math.sin(tick * 0.3 + index) * 0.5, size, 0, TAU);
            ctx.fill();
        }
    }

    function drawObservable(view) {
        const { width, height } = state;
        const centerX = width * 0.48;
        const centerY = height * 0.56;

        const halo = ctx.createRadialGradient(centerX, centerY, view.visibleRadius * 0.16, centerX, centerY, view.beyondRadius);
        halo.addColorStop(0, 'rgba(90, 208, 255, 0.22)');
        halo.addColorStop(0.5, 'rgba(90, 208, 255, 0.08)');
        halo.addColorStop(1, 'rgba(90, 208, 255, 0.01)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(centerX, centerY, view.beyondRadius, 0, TAU);
        ctx.fill();

        const inner = ctx.createRadialGradient(centerX, centerY, 10, centerX, centerY, view.visibleRadius);
        inner.addColorStop(0, 'rgba(255, 236, 188, 0.94)');
        inner.addColorStop(0.26, 'rgba(255, 208, 120, 0.2)');
        inner.addColorStop(1, 'rgba(85, 208, 255, 0.12)');
        ctx.fillStyle = inner;
        ctx.beginPath();
        ctx.arc(centerX, centerY, view.visibleRadius, 0, TAU);
        ctx.fill();

        ctx.setLineDash([8, 10]);
        ctx.strokeStyle = 'rgba(202, 240, 255, 0.84)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, view.visibleRadius, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(centerX, centerY, view.beyondRadius, 0, TAU);
        ctx.stroke();

        for (let index = 0; index < 10; index += 1) {
            const angle = (index / 10) * TAU - Math.PI * 0.18;
            const start = view.visibleRadius + 8;
            const end = view.visibleRadius + 8 + view.arrowLength;
            const x1 = centerX + Math.cos(angle) * start;
            const y1 = centerY + Math.sin(angle) * start;
            const x2 = centerX + Math.cos(angle) * end;
            const y2 = centerY + Math.sin(angle) * end;
            ctx.strokeStyle = 'rgba(255, 196, 109, 0.85)';
            ctx.lineWidth = 2.2;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            ctx.fillStyle = 'rgba(255, 196, 109, 0.92)';
            ctx.beginPath();
            ctx.arc(x2, y2, 2.8, 0, TAU);
            ctx.fill();
        }

        for (let index = 0; index < 44; index += 1) {
            const angle = index * 2.3999632297;
            const radius = 28 + hash(index, 6) * (view.beyondRadius - 16);
            const x = centerX + Math.cos(angle) * radius;
            const y = centerY + Math.sin(angle) * radius;
            const inside = radius <= view.visibleRadius;
            const size = inside ? 2.8 + hash(index, 7) * 2.2 : 1.6 + hash(index, 8) * 1.8;
            ctx.fillStyle = inside
                ? 'rgba(255, 233, 178, 0.96)'
                : 'rgba(170, 200, 226, 0.42)';
            ctx.beginPath();
            ctx.arc(x, y, size, 0, TAU);
            ctx.fill();
        }

        ctx.fillStyle = 'rgba(255, 247, 227, 0.98)';
        ctx.beginPath();
        ctx.arc(centerX, centerY, 8, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(centerX, centerY, 18, 0, TAU);
        ctx.fillStyle = 'rgba(255, 247, 227, 0.1)';
        ctx.fill();

        drawTag('観測可能宇宙', centerX - 62, centerY - view.visibleRadius - 24, 'rgba(7, 16, 29, 0.78)', 'rgba(255, 255, 255, 0.14)', '#f4f9ff');
        drawTag('まだ見えない領域', centerX + view.visibleRadius * 0.36, centerY + view.beyondRadius * 0.04, 'rgba(7, 16, 29, 0.7)', 'rgba(255, 255, 255, 0.1)', '#f4f9ff');
        drawTag('わたしたち', centerX - 34, centerY + 18, 'rgba(255, 255, 255, 0.78)', 'rgba(255, 255, 255, 0.12)', '#10223a');
    }

    function drawShape(view) {
        const { width, height, tick } = state;
        const centerX = width * 0.5;
        const centerY = height * 0.54;
        const radiusX = 118 + view.curvature * 140;
        const radiusY = 42 + view.curvature * 74;
        const flatAlpha = 1 - view.curvature;

        if (flatAlpha > 0.04) {
            ctx.save();
            ctx.globalAlpha = flatAlpha * 0.52;
            ctx.strokeStyle = 'rgba(188, 225, 246, 0.28)';
            ctx.lineWidth = 1;
            for (let x = 70; x <= width - 70; x += 46) {
                ctx.beginPath();
                ctx.moveTo(x, height * 0.28);
                ctx.lineTo(x, height * 0.82);
                ctx.stroke();
            }
            for (let y = height * 0.28; y <= height * 0.82; y += 38) {
                ctx.beginPath();
                ctx.moveTo(60, y);
                ctx.lineTo(width - 60, y);
                ctx.stroke();
            }
            ctx.restore();
        }

        ctx.strokeStyle = 'rgba(230, 242, 255, 0.82)';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, TAU);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(117, 191, 227, 0.5)';
        ctx.lineWidth = 1.1;
        for (let index = -2; index <= 2; index += 1) {
            const ratio = index / 2.8;
            ctx.beginPath();
            ctx.ellipse(centerX, centerY + ratio * radiusY * 0.66, radiusX * Math.cos(ratio * 0.82), radiusY * 0.28, 0, 0, TAU);
            ctx.stroke();
        }
        for (let index = -3; index <= 3; index += 1) {
            const ratio = index / 3.8;
            ctx.beginPath();
            ctx.ellipse(centerX + ratio * radiusX * 0.72, centerY, radiusX * 0.18, radiusY, 0, 0, TAU);
            ctx.stroke();
        }

        ctx.strokeStyle = 'rgba(255, 196, 109, 0.62)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, radiusX, radiusY * 0.18, 0, 0, TAU);
        ctx.stroke();

        const progress = view.travel * TAU + tick * 0.18;
        const travelerX = centerX + Math.cos(progress) * radiusX;
        const travelerY = centerY + Math.sin(progress) * radiusY * 0.18;
        ctx.fillStyle = 'rgba(255, 239, 204, 0.98)';
        ctx.beginPath();
        ctx.arc(travelerX, travelerY, 8, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(travelerX, travelerY, 18, 0, TAU);
        ctx.fillStyle = 'rgba(255, 239, 204, 0.14)';
        ctx.fill();

        drawTag('有限でも端なし', centerX - 58, centerY - radiusY - 28, 'rgba(7, 16, 29, 0.78)', 'rgba(255, 255, 255, 0.14)', '#f4f9ff');
        drawTag(view.curvature < 0.4 ? '大規模にはほぼ平坦' : '曲がった空間の直感', 74, height - 56, 'rgba(255, 255, 255, 0.82)', 'rgba(255, 255, 255, 0.14)', '#10223a');
        drawTag('外へ出る方向がない', width - 220, 62, 'rgba(7, 16, 29, 0.72)', 'rgba(255, 255, 255, 0.1)', '#f4f9ff');
    }

    function drawOutside(view) {
        const { width, height, tick } = state;
        const centerX = width * 0.5;
        const centerY = height * 0.54;
        const spacingX = 62 * view.stretch * view.zoom;
        const spacingY = 52 * view.stretch * view.zoom;

        ctx.strokeStyle = 'rgba(125, 188, 224, 0.18)';
        ctx.lineWidth = 1.1;
        for (let gx = -3; gx <= 3; gx += 1) {
            for (let gy = -2; gy <= 2; gy += 1) {
                const x = centerX + gx * spacingX;
                const y = centerY + gy * spacingY;
                if (gx < 3) {
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                    ctx.lineTo(centerX + (gx + 1) * spacingX, y);
                    ctx.stroke();
                }
                if (gy < 2) {
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                    ctx.lineTo(x, centerY + (gy + 1) * spacingY);
                    ctx.stroke();
                }
            }
        }

        for (let gx = -3; gx <= 3; gx += 1) {
            for (let gy = -2; gy <= 2; gy += 1) {
                const wobbleX = Math.sin(tick * 0.5 + gx * 0.8 + gy * 0.5) * 2.5;
                const wobbleY = Math.cos(tick * 0.4 + gy * 0.9) * 2.5;
                const x = centerX + gx * spacingX + wobbleX;
                const y = centerY + gy * spacingY + wobbleY;
                const size = gx === 0 && gy === 0 ? 8 : 4.2;
                ctx.fillStyle = gx === 0 && gy === 0
                    ? 'rgba(255, 236, 188, 0.98)'
                    : 'rgba(170, 218, 242, 0.92)';
                ctx.beginPath();
                ctx.arc(x, y, size, 0, TAU);
                ctx.fill();
            }
        }

        ctx.strokeStyle = 'rgba(255, 196, 109, 0.72)';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(centerX - spacingX * 0.55, centerY - spacingY * 1.45);
        ctx.lineTo(centerX - spacingX * 0.95, centerY - spacingY * 1.95);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(centerX + spacingX * 0.55, centerY + spacingY * 1.45);
        ctx.lineTo(centerX + spacingX * 0.95, centerY + spacingY * 1.95);
        ctx.stroke();

        drawTag('空間そのものが伸びる', centerX - 72, 54, 'rgba(7, 16, 29, 0.8)', 'rgba(255, 255, 255, 0.14)', '#f4f9ff');
        drawTag('外枠は不要', width - 138, height - 58, 'rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.14)', '#10223a');
        drawTag('銀河間距離が広がる', 62, height - 58, 'rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.14)', '#10223a');
    }

    function drawTime(view) {
        const { width, height, tick } = state;
        const left = 76;
        const right = width - 76;
        const baseY = height * 0.72;
        const startX = width * 0.24;

        ctx.strokeStyle = 'rgba(225, 236, 247, 0.4)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(left, baseY);
        ctx.lineTo(right, baseY);
        ctx.stroke();

        ctx.fillStyle = 'rgba(225, 236, 247, 0.84)';
        ctx.font = '600 14px IBM Plex Sans JP';
        ctx.fillText('今', right - 12, baseY - 10);

        ctx.strokeStyle = `rgba(255, 196, 109, ${0.45 + view.classical * 0.4})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let x = startX; x <= right; x += 5) {
            const t = (x - startX) / (right - startX);
            const y = baseY - Math.pow(t, 0.45) * (150 + view.classical * 22);
            if (x === startX) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();

        const singularityAlpha = 0.2 + view.classical * (1 - view.quantum * 0.7);
        ctx.fillStyle = `rgba(255, 132, 120, ${singularityAlpha})`;
        ctx.beginPath();
        ctx.arc(startX, baseY, 9, 0, TAU);
        ctx.fill();

        if (view.quantum > 0.18) {
            const bounceAlpha = 0.18 + view.quantum * 0.7;
            ctx.strokeStyle = `rgba(90, 208, 255, ${bounceAlpha})`;
            ctx.lineWidth = 2.6;
            ctx.beginPath();
            for (let x = left; x <= startX; x += 5) {
                const t = (x - left) / (startX - left || 1);
                const y = baseY - Math.pow(1 - t, 0.55) * (116 + view.quantum * 20);
                if (x === left) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.stroke();

            ctx.beginPath();
            ctx.ellipse(startX, baseY - 8, 34 + view.quantum * 18, 20 + view.quantum * 10, 0, Math.PI * 0.08, Math.PI * 0.92);
            ctx.strokeStyle = `rgba(185, 236, 255, ${0.16 + view.quantum * 0.5})`;
            ctx.stroke();
        }

        if (view.quantum > 0.52) {
            const branchAlpha = 0.18 + (view.quantum - 0.52) * 1.5;
            ctx.fillStyle = `rgba(255, 196, 109, ${branchAlpha})`;
            for (let index = 0; index < 5; index += 1) {
                const x = left + index * 44;
                const y = 84 + Math.sin(tick * 0.5 + index) * 4;
                ctx.beginPath();
                ctx.arc(x, y, 14 + index * 2.4, 0, TAU);
                ctx.fill();
            }
        }

        drawTag('t = 0 ?', startX - 22, baseY + 18, 'rgba(7, 16, 29, 0.8)', 'rgba(255, 255, 255, 0.14)', '#f4f9ff');
        drawTag('特異点 or 理論の限界', startX - 58, baseY - 54, 'rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.14)', '#10223a');
        if (view.quantum > 0.18) {
            drawTag('バウンス / 無境界', left + 22, 60, 'rgba(7, 16, 29, 0.76)', 'rgba(255, 255, 255, 0.14)', '#f4f9ff');
        }
        if (view.quantum > 0.52) {
            drawTag('永遠インフレーション候補', width - 250, 72, 'rgba(7, 16, 29, 0.76)', 'rgba(255, 255, 255, 0.14)', '#f4f9ff');
        }
    }

    function drawFrame(timestamp) {
        const dt = clamp((timestamp - state.lastTime) / 1000, 0, 0.04);
        state.lastTime = timestamp;
        state.tick += dt;

        ctx.clearRect(0, 0, state.width, state.height);
        drawBackdrop();

        if (currentView) {
            if (currentView.kind === 'observable') {
                drawObservable(currentView);
            } else if (currentView.kind === 'shape') {
                drawShape(currentView);
            } else if (currentView.kind === 'outside') {
                drawOutside(currentView);
            } else if (currentView.kind === 'time') {
                drawTime(currentView);
            }
        }

        requestAnimationFrame(drawFrame);
    }

    modeRow.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (!target.matches('.mode-chip')) return;
        setMode(target.dataset.mode || 'observable');
    });

    primaryRange.addEventListener('input', rebuildView);
    secondaryRange.addEventListener('input', rebuildView);
    window.addEventListener('resize', () => {
        resizeCanvas();
    });

    setMode('observable');
    resizeCanvas();
    rebuildView();
    drawFrame(performance.now());
})();