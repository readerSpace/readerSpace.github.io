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

    const canvas = document.getElementById('frictionCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const forceRange = document.getElementById('forceRange');
    const massRange = document.getElementById('massRange');
    const muSRange = document.getElementById('muSRange');
    const muKRange = document.getElementById('muKRange');
    const forceValue = document.getElementById('forceValue');
    const massValue = document.getElementById('massValue');
    const muSValue = document.getElementById('muSValue');
    const muKValue = document.getElementById('muKValue');
    const stateValue = document.getElementById('stateValue');
    const frictionValue = document.getElementById('frictionValue');
    const accValue = document.getElementById('accValue');
    const heatValue = document.getElementById('heatValue');
    const demoNarration = document.getElementById('demoNarration');
    const presetRow = document.getElementById('presetRow');
    const impulseButton = document.getElementById('impulseButton');
    const resetButton = document.getElementById('resetButton');

    const presets = {
        wood: {
            force: 11,
            mass: 4,
            muS: 0.55,
            muK: 0.32,
            note: '木の箱では、最初は静止摩擦が押す力に合わせて増え、限界を超えた瞬間に滑り出します。'
        },
        rubber: {
            force: 18,
            mass: 4,
            muS: 1.1,
            muK: 0.85,
            note: 'ゴムは接着が強く、動き出すまでに大きな力が必要です。滑ると熱も急激にたまります。'
        },
        ice: {
            force: 4,
            mass: 4,
            muS: 0.08,
            muK: 0.03,
            note: '氷では摩擦係数が小さく、少し押すだけで滑り始め、発熱もかなり小さくなります。'
        },
        superfluid: {
            force: 0,
            mass: 3,
            muS: 0,
            muK: 0,
            note: '量子凝縮を模した散逸ゼロの極限です。ひと押しすると熱をほとんど出さず、いつまでも動き続けます。'
        }
    };

    const state = {
        activePreset: 'wood',
        blockX: 180,
        blockV: 0,
        heat: 0,
        lastTime: performance.now(),
        frictionForce: 0,
        acceleration: 0,
        modeLabel: '静止摩擦',
        kickFlash: 0
    };

    const g = 9.8;
    const block = { width: 124, height: 74 };

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function syncCoefficients(changed) {
        const muS = parseFloat(muSRange.value);
        const muK = parseFloat(muKRange.value);
        if (muK > muS) {
            if (changed === 'muS') {
                muKRange.value = muS.toFixed(2);
            } else {
                muSRange.value = muK.toFixed(2);
            }
        }
    }

    function currentParameters() {
        return {
            applied: parseFloat(forceRange.value),
            mass: parseFloat(massRange.value),
            muS: parseFloat(muSRange.value),
            muK: parseFloat(muKRange.value)
        };
    }

    function updateLabels() {
        const { applied, mass, muS, muK } = currentParameters();
        forceValue.textContent = `${applied.toFixed(1)} N`;
        massValue.textContent = `${mass.toFixed(1)} kg`;
        muSValue.textContent = muS.toFixed(2);
        muKValue.textContent = muK.toFixed(2);
    }

    function updateNarration(params, maxStatic, kinetic) {
        if (params.muS === 0 && params.muK === 0) {
            if (Math.abs(state.blockV) > 0.05) {
                demoNarration.textContent = '散逸ゼロの極限です。速度があれば、熱に崩れる先がないのでそのまま運動が続きます。';
                return;
            }
            demoNarration.textContent = presets.superfluid.note;
            return;
        }

        if (state.modeLabel === '静止摩擦') {
            demoNarration.textContent = `押す力 ${params.applied.toFixed(1)} N に対して、静止摩擦が同じだけ増えて止めています。限界は ${maxStatic.toFixed(1)} N です。`;
            return;
        }

        if (state.modeLabel === '滑り出し') {
            demoNarration.textContent = `静止摩擦の限界 ${maxStatic.toFixed(1)} N を超えたので滑り始めました。以後は動摩擦 ${kinetic.toFixed(1)} N が働きます。`;
            return;
        }

        if (state.modeLabel === '動摩擦') {
            demoNarration.textContent = `滑っている間は、ほぼ一定の動摩擦 ${kinetic.toFixed(1)} N が逆向きに働き、運動エネルギーが熱 ${state.heat.toFixed(1)} J へ変わります。`;
            return;
        }

        if (state.modeLabel === '減速') {
            demoNarration.textContent = '押すのをやめたので、動摩擦だけが残って箱は減速しています。秩序だった運動が熱へ崩れている最中です。';
            return;
        }

        demoNarration.textContent = '摩擦は、接触面のくっつきを引きはがすための抵抗として現れます。';
    }

    function resetBlock() {
        state.blockX = 180;
        state.blockV = 0;
        state.heat = 0;
        state.acceleration = 0;
        state.frictionForce = 0;
        state.modeLabel = '静止摩擦';
    }

    function applyPreset(key) {
        const preset = presets[key];
        if (!preset) return;
        state.activePreset = key;
        forceRange.value = preset.force;
        massRange.value = preset.mass;
        muSRange.value = preset.muS;
        muKRange.value = preset.muK;
        presetRow.querySelectorAll('.preset-chip').forEach((chip) => {
            chip.classList.toggle('is-active', chip.dataset.preset === key);
        });
        updateLabels();
        demoNarration.textContent = preset.note;
        resetBlock();
    }

    function drawArrow(x1, y1, x2, y2, color, label) {
        if (Math.abs(x2 - x1) < 4) return;
        const head = 12;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        const dir = Math.sign(x2 - x1) || 1;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - dir * head, y2 - head * 0.7);
        ctx.lineTo(x2 - dir * head, y2 + head * 0.7);
        ctx.closePath();
        ctx.fill();

        ctx.font = '600 14px IBM Plex Sans JP';
        ctx.fillText(label, (x1 + x2) * 0.5 - 22, y1 - 10);
    }

    function drawBar(x, y, width, height, value, maxValue, fill, label) {
        const ratio = clamp(value / maxValue, 0, 1);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(x, y, width, height);
        ctx.fillStyle = fill;
        ctx.fillRect(x, y, width * ratio, height);
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.strokeRect(x, y, width, height);
        ctx.fillStyle = 'rgba(255,255,255,0.86)';
        ctx.font = '600 13px IBM Plex Sans JP';
        ctx.fillText(label, x, y - 8);
    }

    function step(dt) {
        const params = currentParameters();
        const normal = params.mass * g;
        const maxStatic = params.muS * normal;
        const kinetic = params.muK * normal;
        const leftLimit = 88 + block.width * 0.5;
        const rightLimit = canvas.width - 88 - block.width * 0.5;

        let friction = 0;
        let acceleration = 0;
        let modeLabel = '静止摩擦';

        if (Math.abs(state.blockV) < 0.018) {
            if (params.applied <= maxStatic + 1e-6) {
                friction = params.applied;
                state.blockV = 0;
                acceleration = 0;
                modeLabel = params.applied > 0 ? '静止摩擦' : '静止';
            } else {
                friction = kinetic;
                acceleration = (params.applied - kinetic) / params.mass;
                state.blockV += acceleration * dt;
                modeLabel = '滑り出し';
            }
        } else {
            const direction = Math.sign(state.blockV);
            friction = kinetic;
            acceleration = (params.applied - direction * kinetic) / params.mass;
            const nextV = state.blockV + acceleration * dt;
            if (params.applied < kinetic && Math.sign(nextV) !== Math.sign(state.blockV)) {
                state.blockV = 0;
                acceleration = 0;
                modeLabel = '静止摩擦';
            } else {
                state.blockV = nextV;
                modeLabel = params.applied > 0 ? '動摩擦' : '減速';
            }
            state.heat = Math.min(140, state.heat + friction * Math.abs(state.blockV) * dt * 0.22);
        }

        state.blockX += state.blockV * 54 * dt;
        if (state.blockX < leftLimit || state.blockX > rightLimit) {
            state.blockX = clamp(state.blockX, leftLimit, rightLimit);
            const bounce = kinetic === 0 ? 0.995 : 0.58;
            state.blockV *= -bounce;
        }

        state.frictionForce = friction;
        state.acceleration = acceleration;
        state.modeLabel = kinetic === 0 && Math.abs(state.blockV) > 0.03 ? '散逸なし' : modeLabel;
        state.kickFlash = Math.max(0, state.kickFlash - dt * 1.8);

        stateValue.textContent = state.modeLabel;
        frictionValue.textContent = `${friction.toFixed(1)} N`;
        accValue.textContent = `${acceleration.toFixed(2)} m/s²`;
        heatValue.textContent = `${state.heat.toFixed(1)} J`;
        updateNarration(params, maxStatic, kinetic);
    }

    function draw() {
        const W = canvas.width;
        const H = canvas.height;
        const trackY = H * 0.76;
        const params = currentParameters();
        const isZeroFriction = params.muS === 0 && params.muK === 0;

        const bg = ctx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#1d0f09');
        bg.addColorStop(0.65, '#4b2415');
        bg.addColorStop(0.66, '#9a7664');
        bg.addColorStop(1, '#2f180f');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        const glow = ctx.createRadialGradient(W * 0.16, H * 0.16, 10, W * 0.16, H * 0.16, 180);
        glow.addColorStop(0, 'rgba(242,163,64,0.18)');
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, W, H);

        ctx.fillStyle = 'rgba(255, 248, 242, 0.05)';
        for (let i = 0; i < W; i += 30) {
            ctx.fillRect(i, trackY + 12, 16, 2);
        }

        ctx.fillStyle = isZeroFriction ? 'rgba(113,199,230,0.85)' : 'rgba(156, 119, 99, 0.95)';
        ctx.fillRect(56, trackY, W - 112, 18);

        if (isZeroFriction) {
            ctx.strokeStyle = 'rgba(113,199,230,0.72)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            for (let x = 56; x <= W - 56; x += 8) {
                const phase = (x - 56) / 24;
                const y = trackY - 5 + Math.sin(phase) * 5;
                if (x === 56) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        const blockX = state.blockX - block.width * 0.5;
        const blockY = trackY - block.height + 2;
        const blockGrad = ctx.createLinearGradient(blockX, blockY, blockX + block.width, blockY + block.height);
        blockGrad.addColorStop(0, '#ffe9d8');
        blockGrad.addColorStop(1, '#cf8d62');
        ctx.fillStyle = blockGrad;
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.roundRect(blockX, blockY, block.width, block.height, 18);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = 'rgba(47,24,15,0.7)';
        ctx.font = '700 28px Shippori Mincho';
        ctx.fillText('μ', state.blockX - 10, blockY + 44);

        if (!isZeroFriction) {
            ctx.strokeStyle = 'rgba(255, 213, 179, 0.72)';
            ctx.lineWidth = 1.6;
            for (let i = 0; i < 8; i++) {
                const px = blockX + 12 + i * 14;
                ctx.beginPath();
                ctx.moveTo(px, trackY + 2);
                ctx.lineTo(px, trackY - 8 - (i % 2) * 4);
                ctx.stroke();
            }
        }

        const forceScale = 4.6;
        drawArrow(state.blockX, blockY - 36, state.blockX + parseFloat(forceRange.value) * forceScale, blockY - 36, '#f2a340', '押す力');
        drawArrow(state.blockX, blockY - 8, state.blockX - state.frictionForce * forceScale, blockY - 8, '#71c7e6', '摩擦');

        if (state.heat > 0.2 && Math.abs(state.blockV) > 0.03) {
            const sparkCount = Math.floor(10 + Math.min(20, state.heat * 0.15));
            for (let i = 0; i < sparkCount; i++) {
                const x = blockX + 8 + Math.random() * (block.width - 16);
                const y = trackY - Math.random() * 18;
                const r = 1 + Math.random() * 2.2;
                ctx.fillStyle = `rgba(255, ${160 + Math.random() * 60}, ${60 + Math.random() * 40}, ${0.2 + Math.random() * 0.5})`;
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        if (state.kickFlash > 0) {
            ctx.fillStyle = `rgba(255,255,255,${state.kickFlash * 0.35})`;
            ctx.fillRect(0, 0, W, H);
        }

        drawBar(26, 32, 180, 14, Math.abs(state.blockV), 8, '#f6d66b', '速度');
        drawBar(26, 78, 180, 14, state.heat, 140, '#ff8a3d', '熱化');
        drawBar(W - 206, 32, 180, 14, state.frictionForce, 14 * 9.8, '#71c7e6', '摩擦力');

        ctx.fillStyle = 'rgba(255,255,255,0.86)';
        ctx.font = '600 14px IBM Plex Sans JP';
        ctx.fillText(`状態: ${state.modeLabel}`, 26, H - 26);
    }

    function animate(now) {
        const dt = Math.min(0.033, (now - state.lastTime) / 1000 || 0.016);
        state.lastTime = now;
        step(dt);
        draw();
        requestAnimationFrame(animate);
    }

    presetRow.addEventListener('click', (event) => {
        const button = event.target.closest('[data-preset]');
        if (!button) return;
        applyPreset(button.dataset.preset);
    });

    forceRange.addEventListener('input', () => {
        presetRow.querySelectorAll('.preset-chip').forEach((chip) => chip.classList.remove('is-active'));
        state.activePreset = 'custom';
        updateLabels();
    });

    massRange.addEventListener('input', () => {
        presetRow.querySelectorAll('.preset-chip').forEach((chip) => chip.classList.remove('is-active'));
        state.activePreset = 'custom';
        updateLabels();
    });

    muSRange.addEventListener('input', () => {
        syncCoefficients('muS');
        presetRow.querySelectorAll('.preset-chip').forEach((chip) => chip.classList.remove('is-active'));
        state.activePreset = 'custom';
        updateLabels();
    });

    muKRange.addEventListener('input', () => {
        syncCoefficients('muK');
        presetRow.querySelectorAll('.preset-chip').forEach((chip) => chip.classList.remove('is-active'));
        state.activePreset = 'custom';
        updateLabels();
    });

    impulseButton.addEventListener('click', () => {
        const params = currentParameters();
        state.blockV += params.muS === 0 && params.muK === 0 ? 4.8 : 3.5;
        state.kickFlash = 1;
    });

    resetButton.addEventListener('click', () => {
        resetBlock();
    });

    applyPreset('wood');
    requestAnimationFrame(animate);
})();