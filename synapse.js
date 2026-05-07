(() => {
    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            }
        }
    }, { threshold: 0.16 });

    document.querySelectorAll('.reveal, .site-footer').forEach((element) => observer.observe(element));

    const canvas = document.getElementById('synapseCanvas');
    if (!canvas) {
        return;
    }

    const ctx = canvas.getContext('2d');
    const controls = {
        toggleBtn: document.getElementById('toggleBtn'),
        resetBtn: document.getElementById('resetBtn'),
        exciteBtn: document.getElementById('exciteBtn'),
        inhibitBtn: document.getElementById('inhibitBtn'),
        inputStrength: document.getElementById('inputStrength'),
        threshold: document.getElementById('threshold'),
        leak: document.getElementById('leak'),
        delay: document.getElementById('delay'),
        rate: document.getElementById('rate'),
        inputValue: document.getElementById('inputValue'),
        thresholdValue: document.getElementById('thresholdValue'),
        leakValue: document.getElementById('leakValue'),
        delayValue: document.getElementById('delayValue'),
        rateValue: document.getElementById('rateValue'),
        vA: document.getElementById('vA'),
        vB: document.getElementById('vB'),
        spikes: document.getElementById('spikes'),
        stateA: document.getElementById('stateA'),
        stateB: document.getElementById('stateB'),
        transitCount: document.getElementById('transitCount'),
        narration: document.getElementById('demoNarration'),
        presetRow: document.getElementById('presetRow')
    };

    const presets = {
        quiet: {
            input: 0.55,
            threshold: 1.35,
            leak: 0.024,
            delay: 0.55,
            rate: 0.8,
            note: '漏れがやや大きく、しきい値も高いので、入力が何度か続かないと発火まで届きません。'
        },
        balanced: {
            input: 0.8,
            threshold: 1.0,
            leak: 0.015,
            delay: 0.45,
            rate: 1.2,
            note: 'しきい値付近では、入力が少し続くと膜電位が積み上がり、ぎりぎりで発火する様子が見えます。'
        },
        burst: {
            input: 1.15,
            threshold: 0.82,
            leak: 0.01,
            delay: 0.28,
            rate: 2.6,
            note: '入力が強く漏れも小さいので、連続的にしきい値を超えやすく、発火の連鎖が起こりやすくなります。'
        }
    };

    const historyLength = 220;
    const voltageMin = -1.2;
    const refractoryDuration = 0.55;
    const layout = {
        width: 900,
        height: 620,
        neuronRadius: 58,
        neuronA: { x: 250, y: 200 },
        neuronB: { x: 650, y: 200 },
        exciteSource: { x: 72, y: 150 },
        inhibitSource: { x: 72, y: 250 },
        graphA: { x: 60, y: 420, width: 360, height: 120 },
        graphB: { x: 480, y: 420, width: 360, height: 120 }
    };

    let viewport = { width: 900, height: 620, dpr: 1 };
    let activePreset = 'balanced';
    let lastTime = 0;
    let paused = false;
    let autoClock = 0;
    let spikeCount = 0;
    let narrationTimer = 0;
    let neuronA;
    let neuronB;
    let particles = [];

    class Neuron {
        constructor(name) {
            this.name = name;
            this.v = 0;
            this.refractory = 0;
            this.flash = 0;
            this.history = Array(historyLength).fill(0);
        }

        receive(amount) {
            if (this.refractory <= 0) {
                this.v += amount;
            }
        }

        update(dt, threshold, leak) {
            if (this.refractory > 0) {
                this.refractory = Math.max(0, this.refractory - dt);
                this.v = 0;
                this.flash = Math.max(0, this.flash - dt * 2.6);
                this.pushHistory();
                return false;
            }

            this.v -= this.v * leak * dt * 60;
            this.v = clamp(this.v, voltageMin, 2.5);
            this.flash = Math.max(0, this.flash - dt * 2.8);

            if (this.v >= threshold) {
                this.v = 0;
                this.refractory = refractoryDuration;
                this.flash = 1;
                this.pushHistory();
                return true;
            }

            this.pushHistory();
            return false;
        }

        pushHistory() {
            this.history.push(this.v);
            if (this.history.length > historyLength) {
                this.history.shift();
            }
        }

        stateLabel(threshold) {
            if (this.refractory > 0) {
                return `不応期 ${this.refractory.toFixed(2)} 秒`;
            }
            if (this.v >= threshold * 0.82) {
                return 'しきい値に接近';
            }
            if (this.v > 0.18) {
                return '入力を蓄積中';
            }
            if (this.v < -0.18) {
                return '抑制が優位';
            }
            return '静止状態';
        }
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function getParams() {
        return {
            input: parseFloat(controls.inputStrength.value),
            threshold: parseFloat(controls.threshold.value),
            leak: parseFloat(controls.leak.value),
            delay: parseFloat(controls.delay.value),
            rate: parseFloat(controls.rate.value)
        };
    }

    function resizeCanvas() {
        const parentWidth = canvas.parentElement.clientWidth;
        const cssWidth = Math.min(parentWidth, 900);
        const mobile = window.innerWidth < 720;
        const cssHeight = mobile
            ? clamp(window.innerHeight * 0.52, 420, 560)
            : clamp(cssWidth * 0.68, 520, 620);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
        canvas.width = Math.round(cssWidth * dpr);
        canvas.height = Math.round(cssHeight * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        viewport = { width: cssWidth, height: cssHeight, dpr };
        layout.width = cssWidth;
        layout.height = cssHeight;
        layout.neuronRadius = mobile ? 44 : 58;
        layout.neuronA = { x: cssWidth * 0.28, y: cssHeight * 0.3 };
        layout.neuronB = { x: cssWidth * 0.72, y: cssHeight * 0.3 };
        layout.exciteSource = { x: cssWidth * 0.08, y: layout.neuronA.y - layout.neuronRadius * 0.9 };
        layout.inhibitSource = { x: cssWidth * 0.08, y: layout.neuronA.y + layout.neuronRadius * 0.9 };
        layout.graphA = {
            x: cssWidth * 0.06,
            y: cssHeight * 0.67,
            width: cssWidth * 0.39,
            height: cssHeight * 0.2
        };
        layout.graphB = {
            x: cssWidth * 0.55,
            y: cssHeight * 0.67,
            width: cssWidth * 0.39,
            height: cssHeight * 0.2
        };
    }

    function resetState() {
        neuronA = new Neuron('ニューロンA');
        neuronB = new Neuron('ニューロンB');
        particles = [];
        autoClock = 0;
        spikeCount = 0;
        lastTime = performance.now();
        paused = false;
        controls.toggleBtn.textContent = '一時停止';
        setNarration(presets[activePreset].note);
        syncReadouts();
    }

    function setNarration(message) {
        controls.narration.textContent = message;
        narrationTimer = 2.6;
    }

    function applyPreset(name) {
        const preset = presets[name];
        if (!preset) {
            return;
        }

        activePreset = name;
        controls.inputStrength.value = preset.input.toFixed(2);
        controls.threshold.value = preset.threshold.toFixed(2);
        controls.leak.value = preset.leak.toFixed(3);
        controls.delay.value = preset.delay.toFixed(2);
        controls.rate.value = preset.rate.toFixed(1);
        controls.presetRow.querySelectorAll('.preset-chip').forEach((button) => {
            button.classList.toggle('is-active', button.dataset.preset === name);
        });
        syncReadouts();
        setNarration(preset.note);
        resetState();
    }

    function syncReadouts() {
        const params = getParams();
        controls.inputValue.textContent = params.input.toFixed(2);
        controls.thresholdValue.textContent = params.threshold.toFixed(2);
        controls.leakValue.textContent = params.leak.toFixed(3);
        controls.delayValue.textContent = `${params.delay.toFixed(2)} 秒`;
        controls.rateValue.textContent = `${params.rate.toFixed(1)} 回/秒`;

        if (!neuronA || !neuronB) {
            return;
        }

        controls.vA.textContent = neuronA.v.toFixed(2);
        controls.vB.textContent = neuronB.v.toFixed(2);
        controls.spikes.textContent = `${spikeCount}`;
        controls.stateA.textContent = neuronA.stateLabel(params.threshold);
        controls.stateB.textContent = neuronB.stateLabel(params.threshold);
        controls.transitCount.textContent = `${particles.filter((particle) => particle.kind === 'spike' && !particle.delivered).length}`;
    }

    function createParticle(from, to, kind, strength, duration) {
        particles.push({
            from: { x: from.x, y: from.y },
            to: { x: to.x, y: to.y },
            target: to.target || null,
            kind,
            strength,
            duration,
            t: 0,
            delivered: false
        });
    }

    function sendExcitatoryInput() {
        const params = getParams();
        createParticle(layout.exciteSource, { x: layout.neuronA.x - layout.neuronRadius * 0.7, y: layout.neuronA.y, target: neuronA }, 'excite', params.input, 0.34);
        setNarration('興奮入力が入ると、ニューロンAの膜電位が少し押し上げられます。');
    }

    function sendInhibitoryInput() {
        const params = getParams();
        createParticle(layout.inhibitSource, { x: layout.neuronA.x - layout.neuronRadius * 0.7, y: layout.neuronA.y, target: neuronA }, 'inhibit', -params.input * 0.8, 0.34);
        setNarration('抑制入力が入ると、積み上がった膜電位が下がり、発火しにくくなります。');
    }

    function scheduleSynapticTransmission() {
        const params = getParams();
        createParticle(
            { x: layout.neuronA.x + layout.neuronRadius * 0.95, y: layout.neuronA.y },
            { x: layout.neuronB.x - layout.neuronRadius * 0.95, y: layout.neuronB.y, target: neuronB },
            'spike',
            params.input * 0.9,
            params.delay
        );
        setNarration('ニューロンAが発火しました。信号がシナプスを通って、少し遅れてニューロンBへ向かいます。');
    }

    function updateSimulation(dt) {
        const params = getParams();

        autoClock += dt;
        const interval = params.rate > 0 ? 1 / params.rate : Number.POSITIVE_INFINITY;
        while (autoClock > interval) {
            autoClock -= interval;
            if (Math.random() < 0.26) {
                sendInhibitoryInput();
            } else {
                sendExcitatoryInput();
            }
        }

        for (const particle of particles) {
            particle.t += dt;
            if (!particle.delivered && particle.t >= particle.duration) {
                if (particle.target) {
                    particle.target.receive(particle.strength);
                }
                particle.delivered = true;
            }
        }
        particles = particles.filter((particle) => particle.t < particle.duration + 0.08);

        const firedA = neuronA.update(dt, params.threshold, params.leak);
        const firedB = neuronB.update(dt, params.threshold, params.leak);

        if (firedA) {
            spikeCount += 1;
            scheduleSynapticTransmission();
        }

        if (firedB) {
            spikeCount += 1;
            setNarration('ニューロンBも発火しました。入力の足し算が次のニューロンへ波及しています。');
        }

        if (narrationTimer > 0) {
            narrationTimer -= dt;
            if (narrationTimer <= 0) {
                controls.narration.textContent = describeCurrentState(params.threshold);
            }
        }
    }

    function describeCurrentState(threshold) {
        if (neuronA.refractory > 0) {
            return '発火直後のニューロンAは不応期です。この間は入力が来ても、すぐには次の発火につながりません。';
        }
        if (neuronB.refractory > 0) {
            return 'ニューロンBまで信号が届き、次の細胞でも発火した直後の休止が見えています。';
        }
        if (neuronA.v >= threshold * 0.75) {
            return 'ニューロンAの膜電位がしきい値に近づいています。あと少し入力が重なると発火します。';
        }
        if (particles.some((particle) => particle.kind === 'spike' && !particle.delivered)) {
            return 'シナプス中を信号が移動中です。発火と伝達の間には、わずかな遅れがあります。';
        }
        if (neuronA.v < -0.18) {
            return '抑制入力が優勢で、膜電位が下がっています。しきい値から遠ざかる方向です。';
        }
        return '入力が来るたびに膜電位が少しずつ変わり、時間的な足し算が進んでいます。';
    }

    function draw() {
        const params = getParams();
        ctx.clearRect(0, 0, viewport.width, viewport.height);
        drawBackdrop();
        drawSynapseTrack();
        drawInputSources();
        drawParticles();
        drawNeuron(layout.neuronA, neuronA, '#ff7d66', params.threshold);
        drawNeuron(layout.neuronB, neuronB, '#47a6ef', params.threshold);
        drawGraph(neuronA, layout.graphA, '#ff7d66', params.threshold);
        drawGraph(neuronB, layout.graphB, '#47a6ef', params.threshold);
        drawLegendLabels();
    }

    function drawBackdrop() {
        const panelRadius = 26;
        roundedRect(26, 24, viewport.width - 52, viewport.height - 48, panelRadius);
        const gradient = ctx.createLinearGradient(0, 24, 0, viewport.height - 24);
        gradient.addColorStop(0, '#ffffff');
        gradient.addColorStop(1, '#f4f8fc');
        ctx.fillStyle = gradient;
        ctx.fill();

        ctx.save();
        ctx.strokeStyle = 'rgba(24, 48, 71, 0.06)';
        ctx.lineWidth = 1;
        for (let x = 40; x < viewport.width - 20; x += 36) {
            ctx.beginPath();
            ctx.moveTo(x, 40);
            ctx.lineTo(x, viewport.height - 40);
            ctx.stroke();
        }
        for (let y = 40; y < viewport.height - 20; y += 36) {
            ctx.beginPath();
            ctx.moveTo(40, y);
            ctx.lineTo(viewport.width - 40, y);
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawInputSources() {
        drawPulseNode(layout.exciteSource, '#ff635f', '興奮入力');
        drawPulseNode(layout.inhibitSource, '#47a6ef', '抑制入力');
    }

    function drawPulseNode(point, color, label) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(point.x, point.y, 14, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 20;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(24, 48, 71, 0.76)';
        ctx.font = `${viewport.width < 640 ? 11 : 13}px IBM Plex Sans JP`;
        ctx.textAlign = 'left';
        ctx.fillText(label, point.x + 22, point.y + 5);
        ctx.restore();
    }

    function drawSynapseTrack() {
        const startX = layout.neuronA.x + layout.neuronRadius;
        const endX = layout.neuronB.x - layout.neuronRadius;
        const controlY = layout.neuronA.y - Math.min(66, viewport.height * 0.11);

        ctx.save();
        ctx.strokeStyle = 'rgba(88, 108, 128, 0.72)';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(startX, layout.neuronA.y);
        ctx.bezierCurveTo(startX + 90, controlY, endX - 90, controlY, endX, layout.neuronB.y);
        ctx.stroke();

        const gapX = (startX + endX) / 2;
        for (let index = -1; index <= 1; index += 1) {
            ctx.beginPath();
            ctx.arc(gapX + index * 14, controlY + 10 + Math.abs(index) * 5, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#7a8793';
            ctx.fill();
        }

        ctx.fillStyle = 'rgba(24, 48, 71, 0.82)';
        ctx.font = `${viewport.width < 640 ? 12 : 14}px IBM Plex Sans JP`;
        ctx.textAlign = 'center';
        ctx.fillText('シナプス: 発火後、少し遅れて次のニューロンへ届く', (startX + endX) / 2, controlY - 18);
        ctx.restore();
    }

    function drawNeuron(position, neuron, hue, threshold) {
        const radius = layout.neuronRadius;
        const glow = neuron.flash;
        const charge = clamp(neuron.v / Math.max(threshold, 0.01), -1, 1.6);

        ctx.save();
        ctx.translate(position.x, position.y);

        if (glow > 0) {
            ctx.beginPath();
            ctx.arc(0, 0, radius + glow * 32, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 191, 71, ${0.22 * glow})`;
            ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fillStyle = neuron.refractory > 0 ? '#e3e9ef' : '#ffffff';
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = glow > 0 ? '#ffbf47' : '#2c4357';
        ctx.stroke();

        const ring = ctx.createLinearGradient(-radius, -radius, radius, radius);
        ring.addColorStop(0, hue);
        ring.addColorStop(1, '#ffffff');
        ctx.beginPath();
        ctx.arc(0, 0, radius - 10, Math.PI / 2, Math.PI / 2 - clamp(Math.max(charge, 0), 0, 1.1) * Math.PI * 2, true);
        ctx.lineWidth = Math.max(8, radius * 0.15);
        ctx.strokeStyle = ring;
        ctx.stroke();

        if (charge < 0) {
            ctx.beginPath();
            ctx.arc(0, 0, radius - 17, Math.PI / 2, Math.PI / 2 + clamp(Math.abs(charge), 0, 0.8) * Math.PI * 1.7, false);
            ctx.lineWidth = Math.max(4, radius * 0.08);
            ctx.strokeStyle = '#47a6ef';
            ctx.stroke();
        }

        ctx.fillStyle = '#173149';
        ctx.textAlign = 'center';
        ctx.font = `${viewport.width < 640 ? 13 : 17}px IBM Plex Sans JP`;
        ctx.fillText(neuron.name, 0, 4);
        ctx.font = `${viewport.width < 640 ? 11 : 13}px IBM Plex Sans JP`;
        ctx.fillStyle = 'rgba(24, 48, 71, 0.74)';
        ctx.fillText(neuron.refractory > 0 ? '不応期' : `膜電位 ${neuron.v.toFixed(2)}`, 0, radius * 0.48);
        ctx.restore();
    }

    function drawParticles() {
        for (const particle of particles) {
            const progress = clamp(particle.t / particle.duration, 0, 1);
            const eased = progress * progress * (3 - 2 * progress);
            const x = particle.from.x + (particle.to.x - particle.from.x) * eased;
            const y = particle.from.y + (particle.to.y - particle.from.y) * eased;
            const radius = particle.kind === 'spike' ? 9 : 7;
            const color = particle.kind === 'inhibit'
                ? '#47a6ef'
                : particle.kind === 'spike'
                    ? '#ffbf47'
                    : '#ff635f';

            ctx.save();
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.shadowColor = color;
            ctx.shadowBlur = 18;
            ctx.fill();
            ctx.restore();
        }
    }

    function drawGraph(neuron, area, color, threshold) {
        const maxVoltage = Math.max(2.3, threshold + 0.6);
        const pad = 12;

        ctx.save();
        roundedRect(area.x, area.y, area.width, area.height, 18);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(24, 48, 71, 0.1)';
        ctx.lineWidth = 1;
        ctx.stroke();

        const thresholdY = mapVoltageToY(threshold, area, maxVoltage);
        ctx.strokeStyle = 'rgba(216, 90, 47, 0.5)';
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(area.x + pad, thresholdY);
        ctx.lineTo(area.x + area.width - pad, thresholdY);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.strokeStyle = 'rgba(24, 48, 71, 0.08)';
        ctx.lineWidth = 1;
        for (let index = 1; index <= 3; index += 1) {
            const y = area.y + (area.height / 4) * index;
            ctx.beginPath();
            ctx.moveTo(area.x + pad, y);
            ctx.lineTo(area.x + area.width - pad, y);
            ctx.stroke();
        }

        ctx.beginPath();
        neuron.history.forEach((value, index) => {
            const x = area.x + pad + (index / (historyLength - 1)) * (area.width - pad * 2);
            const y = mapVoltageToY(value, area, maxVoltage);
            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.4;
        ctx.stroke();

        ctx.fillStyle = 'rgba(24, 48, 71, 0.8)';
        ctx.font = `${viewport.width < 640 ? 11 : 13}px IBM Plex Sans JP`;
        ctx.textAlign = 'left';
        ctx.fillText(`${neuron.name} の膜電位`, area.x + pad, area.y - 10);
        ctx.fillStyle = 'rgba(216, 90, 47, 0.88)';
        ctx.fillText('しきい値', area.x + area.width - 58, thresholdY - 8);
        ctx.restore();
    }

    function mapVoltageToY(value, area, maxVoltage) {
        const normalized = (clamp(value, voltageMin, maxVoltage) - voltageMin) / (maxVoltage - voltageMin);
        return area.y + area.height - normalized * area.height;
    }

    function drawLegendLabels() {
        ctx.save();
        ctx.fillStyle = 'rgba(24, 48, 71, 0.74)';
        ctx.font = `${viewport.width < 640 ? 12 : 14}px IBM Plex Sans JP`;
        ctx.textAlign = 'left';
        ctx.fillText('入力源', layout.exciteSource.x - 14, layout.exciteSource.y - 28);
        ctx.fillText('時間変化', layout.graphA.x, layout.graphA.y + layout.graphA.height + 24);
        ctx.fillText('時間変化', layout.graphB.x, layout.graphB.y + layout.graphB.height + 24);
        ctx.restore();
    }

    function roundedRect(x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + width - r, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + r);
        ctx.lineTo(x + width, y + height - r);
        ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
        ctx.lineTo(x + r, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    function frame(now) {
        const dt = Math.min(0.05, (now - lastTime) / 1000 || 0.016);
        lastTime = now;

        if (!paused) {
            updateSimulation(dt);
        }

        syncReadouts();
        draw();
        requestAnimationFrame(frame);
    }

    controls.toggleBtn.addEventListener('click', () => {
        paused = !paused;
        controls.toggleBtn.textContent = paused ? '再開' : '一時停止';
        if (!paused) {
            lastTime = performance.now();
        }
    });

    controls.resetBtn.addEventListener('click', () => {
        resetState();
    });

    controls.exciteBtn.addEventListener('click', () => {
        sendExcitatoryInput();
    });

    controls.inhibitBtn.addEventListener('click', () => {
        sendInhibitoryInput();
    });

    controls.presetRow.querySelectorAll('.preset-chip').forEach((button) => {
        button.addEventListener('click', () => {
            applyPreset(button.dataset.preset);
        });
    });

    [controls.inputStrength, controls.threshold, controls.leak, controls.delay, controls.rate].forEach((element) => {
        element.addEventListener('input', () => {
            syncReadouts();
            controls.narration.textContent = describeCurrentState(getParams().threshold);
            controls.presetRow.querySelectorAll('.preset-chip').forEach((button) => {
                button.classList.toggle('is-active', button.dataset.preset === activePreset && valuesMatchPreset(activePreset));
            });
        });
    });

    function valuesMatchPreset(name) {
        const preset = presets[name];
        const params = getParams();
        return params.input === preset.input
            && params.threshold === preset.threshold
            && params.leak === preset.leak
            && params.delay === preset.delay
            && params.rate === preset.rate;
    }

    window.addEventListener('resize', () => {
        resizeCanvas();
        draw();
    });

    resizeCanvas();
    resetState();
    applyPreset(activePreset);
    requestAnimationFrame(frame);
})();