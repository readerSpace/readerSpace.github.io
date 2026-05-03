(() => {
    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            }
        }
    }, { threshold: 0.18 });

    document.querySelectorAll('.reveal, .site-footer').forEach((el) => observer.observe(el));

    const canvas = document.getElementById('interiorCanvas');
    if (!canvas) return;

    const context = canvas.getContext('2d');
    const modeRow = document.getElementById('modeRow');
    const depthRange = document.getElementById('depthRange');
    const massRange = document.getElementById('massRange');
    const depthValue = document.getElementById('depthValue');
    const massValue = document.getElementById('massValue');
    const regionValue = document.getElementById('regionValue');
    const futureValue = document.getElementById('futureValue');
    const coreValue = document.getElementById('coreValue');
    const infoValue = document.getElementById('infoValue');
    const tidalValue = document.getElementById('tidalValue');
    const demoNarration = document.getElementById('demoNarration');

    const presets = {
        classical: {
            depth: 72,
            mass: 38,
            note: '一般相対論では、いったん地平線の内側へ入ると、未来そのものが特異点へ収束します。'
        },
        fuzzball: {
            depth: 70,
            mass: 46,
            note: 'ファズボールでは、地平線の内側が空洞ではなく、弦とブレーンの量子構造そのものになります。'
        },
        holography: {
            depth: 56,
            mass: 72,
            note: 'ホログラフィーでは、内部空間は境界の量子情報から再構成された見かけかもしれません。'
        },
        worldsheet: {
            depth: 60,
            mass: 58,
            note: '弦理論では相互作用が点ではなく世界面に広がり、特異点の発散はなめらぐ可能性があります。'
        }
    };

    const state = {
        mode: 'classical',
        phase: 0,
        width: 720,
        height: 460,
        ratio: 1
    };

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function massFromSlider(value) {
        return 10 ** (1 + value * 0.05);
    }

    function formatMassSolar(massSolar) {
        if (massSolar < 1000) {
            return `${Math.round(massSolar).toLocaleString('ja-JP')} M☉`;
        }
        if (massSolar < 100000) {
            return `${(massSolar / 10000).toFixed(2)}万 M☉`;
        }
        return `${(massSolar / 10000).toFixed(1)}万 M☉`;
    }

    function describeDepth(depth) {
        if (depth < 40) return '地平線の外側';
        if (depth < 58) return '地平線付近';
        return '地平線の内側';
    }

    function describeFuture(mode, depth) {
        if (depth < 40) return '外にも横にも広がる';
        if (depth < 58) return '強く内向きに絞られる';

        if (mode === 'classical') return '中心へ収束する';
        if (mode === 'fuzzball') return '量子構造へ吸収される';
        if (mode === 'holography') return '境界情報へ再符号化';
        return '弦の広がりへ分散する';
    }

    function describeCore(mode) {
        if (mode === 'classical') return '特異点';
        if (mode === 'fuzzball') return 'microstate geometry';
        if (mode === 'holography') return '創発した内部';
        return '弦長でぼやけた領域';
    }

    function describeInfo(mode) {
        if (mode === 'classical') return '古典理論だけでは不明';
        if (mode === 'fuzzball') return '弦・ブレーン状態';
        if (mode === 'holography') return '境界 / CFT';
        return '世界面の自由度';
    }

    function describeTidal(depth, massSolar) {
        if (depth < 40 && massSolar > 1_000_000) return '地平線通過は比較的穏やか';
        if (depth > 70 && massSolar < 80) return '潮汐力は非常に強い';
        if (depth > 58 && massSolar < 1000) return 'かなり強い';
        if (massSolar > 1_000_000) return '超大質量なら穏やか';
        return 'まだ比較的穏やか';
    }

    function updateStats() {
        const depth = parseFloat(depthRange.value);
        const mass = parseFloat(massRange.value);
        const massSolar = massFromSlider(mass);
        const region = describeDepth(depth);
        const future = describeFuture(state.mode, depth);
        const core = describeCore(state.mode);
        const info = describeInfo(state.mode);
        const tidal = describeTidal(depth, massSolar);

        depthValue.textContent = region;
        massValue.textContent = `約 ${formatMassSolar(massSolar)}`;
        regionValue.textContent = region;
        futureValue.textContent = future;
        coreValue.textContent = core;
        infoValue.textContent = info;
        tidalValue.textContent = tidal;
    }

    function updateNarration() {
        const depth = parseFloat(depthRange.value);
        const region = describeDepth(depth);
        const preset = presets[state.mode];

        if (region === '地平線の外側') {
            demoNarration.textContent = 'まだ外側なので、外向きの未来も残っています。ここではブラックホールは強い重力源ですが、内部像の差はまだ直接は現れません。';
            return;
        }

        if (region === '地平線付近') {
            demoNarration.textContent = '事象の地平線付近では、未来円錐が急激に内向きへ傾きます。ここから先で、古典像と量子像の違いが大きく分かれます。';
            return;
        }

        demoNarration.textContent = preset.note;
    }

    function resizeCanvas() {
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        const displayWidth = Math.min(canvas.parentElement?.clientWidth || 720, 720);
        const displayHeight = Math.round(displayWidth * 0.64);

        canvas.width = Math.round(displayWidth * ratio);
        canvas.height = Math.round(displayHeight * ratio);
        canvas.style.width = `${displayWidth}px`;
        canvas.style.height = `${displayHeight}px`;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);

        state.width = displayWidth;
        state.height = displayHeight;
        state.ratio = ratio;
    }

    function drawArrow(x1, y1, x2, y2, color, width = 2.4) {
        const angle = Math.atan2(y2 - y1, x2 - x1);
        context.strokeStyle = color;
        context.fillStyle = color;
        context.lineWidth = width;
        context.lineCap = 'round';
        context.beginPath();
        context.moveTo(x1, y1);
        context.lineTo(x2, y2);
        context.stroke();

        context.beginPath();
        context.moveTo(x2, y2);
        context.lineTo(x2 - 10 * Math.cos(angle - Math.PI / 7), y2 - 10 * Math.sin(angle - Math.PI / 7));
        context.lineTo(x2 - 10 * Math.cos(angle + Math.PI / 7), y2 - 10 * Math.sin(angle + Math.PI / 7));
        context.closePath();
        context.fill();
    }

    function drawStars(width, height) {
        for (let i = 0; i < 28; i += 1) {
            const x = (i * 137) % width;
            const y = (i * 71) % height;
            const size = (i % 4) + 1;
            context.fillStyle = `rgba(255,255,255,${0.14 + (i % 3) * 0.08})`;
            context.fillRect(x, y, size, size);
        }
    }

    function drawFutureCone(mode, region, travelerX, travelerY, centerX, centerY, horizonRadius) {
        const outsideTargets = [
            [travelerX + 86, travelerY - 44],
            [travelerX + 92, travelerY],
            [travelerX + 86, travelerY + 44]
        ];
        const horizonTargets = [
            [travelerX - 12, travelerY - 50],
            [travelerX - 28, travelerY],
            [travelerX - 12, travelerY + 50]
        ];
        let targets = outsideTargets;

        if (region === '地平線付近') {
            targets = horizonTargets;
        } else if (region === '地平線の内側') {
            if (mode === 'classical') {
                targets = [
                    [centerX + 10, centerY - 38],
                    [centerX + 4, centerY],
                    [centerX + 10, centerY + 38]
                ];
            } else if (mode === 'fuzzball') {
                targets = [
                    [centerX + horizonRadius * 0.38, centerY - 52],
                    [centerX + horizonRadius * 0.24, centerY],
                    [centerX + horizonRadius * 0.38, centerY + 52]
                ];
            } else if (mode === 'holography') {
                targets = [
                    [centerX + 12, centerY - horizonRadius * 0.95],
                    [centerX + horizonRadius, centerY],
                    [centerX + 12, centerY + horizonRadius * 0.95]
                ];
            } else {
                targets = [
                    [centerX + 22, centerY - 64],
                    [centerX - 12, centerY],
                    [centerX + 22, centerY + 64]
                ];
            }
        }

        const colors = ['rgba(255,214,164,0.72)', 'rgba(143,196,255,0.82)', 'rgba(255,214,164,0.72)'];
        targets.forEach((target, index) => {
            drawArrow(travelerX, travelerY, target[0], target[1], colors[index]);
        });
    }

    function drawClassicalInterior(centerX, centerY, horizonRadius, time) {
        const coreGlow = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, horizonRadius * 1.15);
        coreGlow.addColorStop(0, 'rgba(210,156,91,0.26)');
        coreGlow.addColorStop(0.28, 'rgba(210,156,91,0.10)');
        coreGlow.addColorStop(1, 'rgba(0,0,0,0)');
        context.fillStyle = coreGlow;
        context.beginPath();
        context.arc(centerX, centerY, horizonRadius * 1.15, 0, Math.PI * 2);
        context.fill();

        context.beginPath();
        context.arc(centerX, centerY, 14 + Math.sin(time * 2.2) * 1.6, 0, Math.PI * 2);
        context.fillStyle = 'rgba(255, 220, 173, 0.95)';
        context.fill();

        context.strokeStyle = 'rgba(210,156,91,0.25)';
        context.lineWidth = 1.2;
        for (let i = 0; i < 6; i += 1) {
            const angle = -0.6 + i * 0.24;
            context.beginPath();
            context.moveTo(centerX + Math.cos(angle) * horizonRadius * 0.78, centerY + Math.sin(angle) * horizonRadius * 0.78);
            context.lineTo(centerX, centerY);
            context.stroke();
        }
    }

    function drawFuzzball(centerX, centerY, horizonRadius, time) {
        context.strokeStyle = 'rgba(115,212,255,0.38)';
        context.lineWidth = 2.2;
        for (let i = 0; i < 5; i += 1) {
            context.beginPath();
            for (let t = 0; t <= 1.0001; t += 0.04) {
                const angle = t * Math.PI * 2 + i * 0.7;
                const radius = horizonRadius * (0.36 + 0.28 * Math.sin(angle * 3 + time * 1.4 + i));
                const x = centerX + Math.cos(angle) * radius;
                const y = centerY + Math.sin(angle) * radius * 0.85;
                if (t === 0) context.moveTo(x, y);
                else context.lineTo(x, y);
            }
            context.closePath();
            context.stroke();
        }

        for (let i = 0; i < 18; i += 1) {
            const angle = i * (Math.PI * 2 / 18) + time * 0.45;
            const x = centerX + Math.cos(angle) * horizonRadius;
            const y = centerY + Math.sin(angle) * horizonRadius;
            context.fillStyle = 'rgba(115,212,255,0.84)';
            context.beginPath();
            context.arc(x, y, 3.3, 0, Math.PI * 2);
            context.fill();
        }
    }

    function drawHolography(centerX, centerY, horizonRadius, time) {
        for (let i = 0; i < 14; i += 1) {
            const angle = i * (Math.PI * 2 / 14) + time * 0.28;
            const x = centerX + Math.cos(angle) * horizonRadius;
            const y = centerY + Math.sin(angle) * horizonRadius;
            context.fillStyle = 'rgba(143,196,255,0.88)';
            context.fillRect(x - 4, y - 4, 8, 8);

            context.strokeStyle = 'rgba(143,196,255,0.16)';
            context.lineWidth = 1;
            context.beginPath();
            context.moveTo(x, y);
            context.lineTo(centerX + Math.cos(angle * 1.7) * horizonRadius * 0.26, centerY + Math.sin(angle * 1.7) * horizonRadius * 0.26);
            context.stroke();
        }
    }

    function drawWorldsheet(centerX, centerY, horizonRadius, time) {
        context.strokeStyle = 'rgba(115,212,255,0.54)';
        context.lineWidth = 2;
        for (let i = -2; i <= 2; i += 1) {
            context.beginPath();
            for (let x = -horizonRadius * 0.92; x <= horizonRadius * 0.92; x += 8) {
                const y = Math.sin((x / 26) + time * 1.3 + i) * 14 + i * 24;
                const px = centerX + x;
                const py = centerY + y;
                if (x === -horizonRadius * 0.92) context.moveTo(px, py);
                else context.lineTo(px, py);
            }
            context.stroke();
        }

        context.strokeStyle = 'rgba(255,214,164,0.46)';
        context.lineWidth = 2.4;
        context.beginPath();
        context.moveTo(centerX - 36, centerY - 84);
        context.bezierCurveTo(centerX - 88, centerY - 24, centerX - 54, centerY + 8, centerX, centerY + 32);
        context.bezierCurveTo(centerX + 54, centerY + 8, centerX + 88, centerY - 24, centerX + 36, centerY - 84);
        context.stroke();
    }

    function drawScene(time) {
        const width = state.width;
        const height = state.height;
        const depth = parseFloat(depthRange.value) / 100;
        const massScale = parseFloat(massRange.value) / 100;
        const region = describeDepth(parseFloat(depthRange.value));
        const centerX = width * 0.47;
        const centerY = height * 0.55;
        const horizonRadius = lerp(86, 126, massScale);
        const outerRadius = horizonRadius * 1.38;
        const travelerFactor = lerp(1.7, 0.24, depth);
        const travelerX = centerX + horizonRadius * travelerFactor;
        const travelerY = centerY + Math.sin(time * 1.6 + depth * 5) * 2;

        const background = context.createLinearGradient(0, 0, 0, height);
        background.addColorStop(0, '#050913');
        background.addColorStop(1, '#162131');
        context.clearRect(0, 0, width, height);
        context.fillStyle = background;
        context.fillRect(0, 0, width, height);
        drawStars(width, height);

        const glow = context.createRadialGradient(centerX, centerY, horizonRadius * 0.4, centerX, centerY, outerRadius * 1.05);
        glow.addColorStop(0, 'rgba(210,156,91,0.18)');
        glow.addColorStop(1, 'rgba(210,156,91,0)');
        context.fillStyle = glow;
        context.beginPath();
        context.arc(centerX, centerY, outerRadius * 1.05, 0, Math.PI * 2);
        context.fill();

        context.strokeStyle = 'rgba(143,196,255,0.14)';
        context.lineWidth = 1;
        context.setLineDash([7, 9]);
        context.beginPath();
        context.arc(centerX, centerY, outerRadius, 0, Math.PI * 2);
        context.stroke();
        context.setLineDash([]);

        context.beginPath();
        context.arc(centerX, centerY, horizonRadius, 0, Math.PI * 2);
        context.strokeStyle = 'rgba(143,196,255,0.7)';
        context.lineWidth = 2.2;
        context.stroke();

        if (state.mode === 'classical') {
            drawClassicalInterior(centerX, centerY, horizonRadius, time);
        } else if (state.mode === 'fuzzball') {
            drawFuzzball(centerX, centerY, horizonRadius, time);
        } else if (state.mode === 'holography') {
            drawHolography(centerX, centerY, horizonRadius, time);
        } else {
            drawWorldsheet(centerX, centerY, horizonRadius, time);
        }

        drawFutureCone(state.mode, region, travelerX, travelerY, centerX, centerY, horizonRadius);

        context.fillStyle = 'rgba(255,255,255,0.94)';
        context.beginPath();
        context.arc(travelerX, travelerY, 8, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = 'rgba(255,255,255,0.28)';
        context.lineWidth = 8;
        context.beginPath();
        context.arc(travelerX, travelerY, 14, 0, Math.PI * 2);
        context.stroke();

        context.fillStyle = 'rgba(255,255,255,0.84)';
        context.font = '600 14px IBM Plex Sans JP';
        context.fillText('observer', travelerX - 24, travelerY - 20);
        context.fillText('event horizon', centerX + horizonRadius + 14, centerY - 6);

        if (state.mode === 'classical') {
            context.fillStyle = 'rgba(255,214,164,0.86)';
            context.fillText('singularity', centerX - 34, centerY + 48);
        } else if (state.mode === 'fuzzball') {
            context.fillStyle = 'rgba(115,212,255,0.86)';
            context.fillText('microstate shell', centerX - 54, centerY + 48);
        } else if (state.mode === 'holography') {
            context.fillStyle = 'rgba(143,196,255,0.86)';
            context.fillText('boundary bits', centerX - 38, centerY + 48);
        } else {
            context.fillStyle = 'rgba(255,214,164,0.86)';
            context.fillText('worldsheet smoothing', centerX - 64, centerY + 48);
        }
    }

    function renderFrame(now) {
        state.phase = now * 0.001;
        drawScene(state.phase);
        requestAnimationFrame(renderFrame);
    }

    function applyMode(mode) {
        const preset = presets[mode];
        if (!preset) return;
        state.mode = mode;
        depthRange.value = preset.depth;
        massRange.value = preset.mass;
        modeRow.querySelectorAll('.mode-chip').forEach((chip) => {
            chip.classList.toggle('is-active', chip.dataset.mode === mode);
        });
        updateStats();
        updateNarration();
    }

    function markCustom() {
        modeRow.querySelectorAll('.mode-chip').forEach((chip) => chip.classList.remove('is-active'));
    }

    modeRow.addEventListener('click', (event) => {
        const button = event.target.closest('[data-mode]');
        if (!button) return;
        applyMode(button.dataset.mode);
    });

    depthRange.addEventListener('input', () => {
        markCustom();
        updateStats();
        updateNarration();
    });

    massRange.addEventListener('input', () => {
        markCustom();
        updateStats();
        updateNarration();
    });

    window.addEventListener('resize', resizeCanvas);

    resizeCanvas();
    applyMode('classical');
    requestAnimationFrame(renderFrame);
})();