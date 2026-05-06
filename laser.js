(() => {
    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            }
        }
    }, { threshold: 0.16 });

    document.querySelectorAll('.reveal, .site-footer').forEach((el) => observer.observe(el));

    const canvas = document.getElementById('laserCanvas');
    const macroCanvas = document.getElementById('macroCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const macroCtx = macroCanvas ? macroCanvas.getContext('2d') : null;
    const pumpRange = document.getElementById('pumpRange');
    const lossRange = document.getElementById('lossRange');
    const seedRange = document.getElementById('seedRange');
    const pumpVal = document.getElementById('pumpVal');
    const lossVal = document.getElementById('lossVal');
    const seedVal = document.getElementById('seedVal');
    const statExcited = document.getElementById('statExcited');
    const statPhotons = document.getElementById('statPhotons');
    const statOutput = document.getElementById('statOutput');
    const statThreshold = document.getElementById('statThreshold');
    const macroIntensityVal = document.getElementById('macroIntensityVal');
    const macroLinkVal = document.getElementById('macroLinkVal');
    const macroModeVal = document.getElementById('macroModeVal');
    const macroNarration = document.getElementById('macroNarration');
    const narration = document.getElementById('demoNarration');
    const presetRow = document.getElementById('presetRow');

    const presets = {
        below: {
            pump: 0.24,
            loss: 0.16,
            seed: 4,
            note: 'しきい値以下では光が増えても往復のたびに負けるので、出力は断続的な点滅に留まります。'
        },
        threshold: {
            pump: 0.42,
            loss: 0.12,
            seed: 8,
            note: 'しきい値付近では、反転分布と損失が競り合い、光子数と出力が揺れながら立ち上がります。'
        },
        above: {
            pump: 0.68,
            loss: 0.08,
            seed: 10,
            note: 'しきい値以上では、種光が引き金になって誘導放出が連鎖し、細い出力ビームが連続して現れます。'
        }
    };

    const totalAtoms = 112;
    const maxPhotons = 720;
    const historyLength = 180;
    const outputCoupling = 0.18;
    const tau = Math.PI * 2;

    let atoms = [];
    let photons = [];
    let outputBursts = [];
    let photonHistory = Array(historyLength).fill(0);
    let inversionHistory = Array(historyLength).fill(0);
    let outputHistory = Array(historyLength).fill(0);
    let macroHistory = Array(historyLength).fill(0);
    let layout = null;
    let viewport = { width: 760, height: 560, dpr: 1 };
    let macroViewport = { width: 760, height: 220, dpr: 1 };
    let frame = 0;
    let smoothedOutput = 0;
    let macroIntensity = 0;
    let macroPhotonShare = 0;
    let macroOutputShare = 0;
    let activePreset = 'threshold';

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function rand(min, max) {
        return min + Math.random() * (max - min);
    }

    function roundedRectPath(x, y, width, height, radius) {
        roundedRectPathOn(ctx, x, y, width, height, radius);
    }

    function roundedRectPathOn(context, x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        context.beginPath();
        context.moveTo(x + r, y);
        context.lineTo(x + width - r, y);
        context.quadraticCurveTo(x + width, y, x + width, y + r);
        context.lineTo(x + width, y + height - r);
        context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
        context.lineTo(x + r, y + height);
        context.quadraticCurveTo(x, y + height, x, y + height - r);
        context.lineTo(x, y + r);
        context.quadraticCurveTo(x, y, x + r, y);
        context.closePath();
    }

    function resizeSurface(element, context, cssWidth, cssHeight, dpr) {
        if (!element || !context) return;

        element.style.width = `${cssWidth}px`;
        element.style.height = `${cssHeight}px`;
        element.width = Math.round(cssWidth * dpr);
        element.height = Math.round(cssHeight * dpr);
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function computeLayout(width, height) {
        const cavityTop = height * 0.12;
        const cavityBottom = height * 0.58;
        const graphTop = height * 0.69;
        const graphHeight = height * 0.2;
        const leftMirrorX = width * 0.12;
        const rightMirrorX = width * 0.82;
        return {
            width,
            height,
            leftMirrorX,
            rightMirrorX,
            cavity: {
                x: width * 0.08,
                y: cavityTop,
                width: width * 0.8,
                height: cavityBottom - cavityTop
            },
            medium: {
                left: width * 0.18,
                right: width * 0.76,
                top: height * 0.18,
                bottom: height * 0.52
            },
            outputLane: {
                x: width * 0.86,
                y: height * 0.34
            },
            graph: {
                x: width * 0.08,
                y: graphTop,
                width: width * 0.84,
                height: graphHeight
            }
        };
    }

    function resizeCanvas() {
        const parentWidth = canvas.parentElement.clientWidth;
        const cssWidth = Math.min(parentWidth, 760);
        const mobile = window.innerWidth < 720;
        const cssHeight = mobile
            ? clamp(window.innerHeight * 0.48, 360, 500)
            : clamp(cssWidth * 0.72, 460, 560);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const macroWidth = macroCanvas ? Math.min(macroCanvas.parentElement.clientWidth, 760) : 760;
        const macroHeight = mobile
            ? clamp(macroWidth * 0.42, 170, 220)
            : clamp(macroWidth * 0.3, 180, 230);

        resizeSurface(canvas, ctx, cssWidth, cssHeight, dpr);
        resizeSurface(macroCanvas, macroCtx, macroWidth, macroHeight, dpr);

        viewport = { width: cssWidth, height: cssHeight, dpr };
        macroViewport = { width: macroWidth, height: macroHeight, dpr };
        layout = computeLayout(cssWidth, cssHeight);
        resetSimulation(parseInt(seedRange.value, 10));
    }

    function buildAtoms() {
        atoms = [];
        for (let index = 0; index < totalAtoms; index += 1) {
            atoms.push({
                x: rand(layout.medium.left, layout.medium.right),
                y: rand(layout.medium.top, layout.medium.bottom),
                excited: Math.random() < 0.22,
                cooldown: Math.floor(Math.random() * 18)
            });
        }
    }

    function injectPhoton(x, y, direction, phase, speed) {
        photons.push({
            x,
            y,
            vx: direction * speed,
            phase,
            dead: false
        });
    }

    function injectSeedCluster(count) {
        for (let index = 0; index < count; index += 1) {
            injectPhoton(
                layout.medium.left + rand(8, 26),
                rand(layout.medium.top + 10, layout.medium.bottom - 10),
                1,
                rand(0, tau),
                rand(2.8, 3.6)
            );
        }
    }

    function resetHistory() {
        photonHistory = Array(historyLength).fill(0);
        inversionHistory = Array(historyLength).fill(0);
        outputHistory = Array(historyLength).fill(0);
        macroHistory = Array(historyLength).fill(0);
        smoothedOutput = 0;
        macroIntensity = 0;
        macroPhotonShare = 0;
        macroOutputShare = 0;
    }

    function resetSimulation(seedPhotons) {
        if (!layout) return;
        buildAtoms();
        photons = [];
        outputBursts = [];
        frame = 0;
        resetHistory();
        injectSeedCluster(seedPhotons);
    }

    function updateControlLabels() {
        pumpVal.textContent = parseFloat(pumpRange.value).toFixed(2);
        lossVal.textContent = parseFloat(lossRange.value).toFixed(2);
        seedVal.textContent = seedRange.value;
    }

    function setThresholdState(label, state) {
        statThreshold.textContent = label;
        statThreshold.dataset.state = state;
    }

    function describeState(metrics) {
        if (metrics.margin > 0.07 && metrics.photons > 90) {
            return '利得が損失を上回り、共振器内に残る光が連続的に増えています。右側の出力が滑らかなら発振状態です。';
        }
        if (metrics.margin > -0.01) {
            return 'ほぼしきい値です。少し反転分布がたまると光が伸び、増えすぎると励起が消費されてまた下がります。';
        }
        if (metrics.inversion > 0.35) {
            return '励起原子は増えていますが、往復の間に散乱や透過で削られ、持続的な増幅へは届いていません。';
        }
        return 'ポンプが弱く、光子は種光や自然放出で現れても、共振器内に残り続ける前に失われています。';
    }

    function updateStats(inversion, photonCount, outputLevel, margin) {
        statExcited.textContent = `${Math.round(inversion * 100)} %`;
        statPhotons.textContent = `${photonCount}`;
        statOutput.textContent = outputLevel.toFixed(2);

        if (margin > 0.04) {
            setThresholdState('利得 > 損失', 'good');
        } else if (margin > -0.02) {
            setThresholdState('ほぼしきい値', 'near');
        } else {
            setThresholdState('利得 < 損失', 'warn');
        }
    }

    function updateMacroReadout(photonCount, outputLevel, intensity, margin) {
        if (macroIntensityVal) {
            macroIntensityVal.textContent = `${Math.round(intensity * 100)} %`;
        }

        if (macroLinkVal) {
            macroLinkVal.textContent = `光子 ${photonCount} / 出力 ${outputLevel.toFixed(2)}`;
        }

        if (macroModeVal) {
            if (margin > 0.04 && intensity > 0.52) {
                macroModeVal.textContent = '安定発振';
            } else if (margin > -0.02 || intensity > 0.18) {
                macroModeVal.textContent = '立ち上がり';
            } else {
                macroModeVal.textContent = '増幅待ち';
            }
        }

        if (macroNarration) {
            if (margin > 0.04 && intensity > 0.52) {
                macroNarration.textContent = outputLevel > 0.12
                    ? 'このマクロ表示は、上のミクロ描像で共振器内光子が高い水準で維持され、半透鏡からの出力も現れ始めているため、強いビームとして明るく表示されています。'
                    : 'このマクロ表示は、上のミクロ描像で共振器内光子が高い水準まで蓄積し、そろった光が媒質内に保たれているため、強い光として明るく表示されています。';
            } else if (margin > -0.02 || intensity > 0.18) {
                macroNarration.textContent = 'ミクロ側で光子数と出力が揺れているので、マクロ側も断続的に明るくなります。しきい値付近らしい競り合いです。';
            } else {
                macroNarration.textContent = 'ミクロ側で共振器内光子がまだ少なく、右向き出力も断続的なので、マクロ側では弱い光としてしか見えません。';
            }
        }
    }

    function pushHistory(inversion, photonCount, outputLevel) {
        photonHistory.shift();
        photonHistory.push(clamp(Math.log1p(photonCount) / Math.log1p(maxPhotons), 0, 1));
        inversionHistory.shift();
        inversionHistory.push(clamp(inversion, 0, 1));
        outputHistory.shift();
        outputHistory.push(clamp(outputLevel / 8, 0, 1));
        macroHistory.shift();
        macroHistory.push(clamp(macroIntensity, 0, 1));
    }

    function updateSimulation() {
        const pump = parseFloat(pumpRange.value);
        const loss = parseFloat(lossRange.value);
        const seed = parseInt(seedRange.value, 10);
        const pumpRate = 0.002 + pump * 0.018;
        const spontaneousRate = 0.0006 + pump * 0.0012;
        const cavityLossRate = 0.0007 + loss * 0.01;

        updateControlLabels();
        frame += 1;

        if (Math.random() < seed / 180) {
            injectPhoton(
                layout.medium.left + 6,
                rand(layout.medium.top + 12, layout.medium.bottom - 12),
                1,
                rand(0, tau),
                rand(3.0, 3.8)
            );
        }

        for (const atom of atoms) {
            if (atom.cooldown > 0) atom.cooldown -= 1;

            if (!atom.excited && Math.random() < pumpRate) {
                atom.excited = true;
                continue;
            }

            if (atom.excited && Math.random() < spontaneousRate) {
                atom.excited = false;
                atom.cooldown = 20;
                injectPhoton(
                    atom.x,
                    atom.y,
                    Math.random() < 0.5 ? -1 : 1,
                    rand(0, tau),
                    rand(2.3, 3.2)
                );
            }
        }

        let transmittedCount = 0;
        const nextPhotons = [];

        for (const photon of photons) {
            photon.x += photon.vx;
            photon.phase += 0.18 * Math.sign(photon.vx || 1);

            if (photon.x <= layout.leftMirrorX) {
                photon.x = layout.leftMirrorX;
                photon.vx = Math.abs(photon.vx);
            }

            if (photon.x >= layout.rightMirrorX) {
                if (Math.random() < outputCoupling) {
                    transmittedCount += 1;
                    outputBursts.push({
                        x: layout.rightMirrorX + 12,
                        y: photon.y,
                        vx: rand(4.8, 6.2),
                        life: 1
                    });
                    photon.dead = true;
                } else {
                    photon.x = layout.rightMirrorX;
                    photon.vx = -Math.abs(photon.vx);
                }
            }

            if (photon.dead || Math.random() < cavityLossRate) {
                continue;
            }

            for (const atom of atoms) {
                if (!atom.excited || atom.cooldown > 0) continue;

                const dx = atom.x - photon.x;
                const dy = atom.y - photon.y;
                if (dx * dx + dy * dy < 84) {
                    atom.excited = false;
                    atom.cooldown = 28;
                    nextPhotons.push({
                        x: atom.x + Math.sign(photon.vx) * 4,
                        y: atom.y + rand(-3, 3),
                        vx: photon.vx * rand(0.98, 1.04),
                        phase: photon.phase,
                        dead: false
                    });
                    break;
                }
            }

            nextPhotons.push(photon);
        }

        photons = nextPhotons.slice(-maxPhotons);
        outputBursts = outputBursts.filter((burst) => {
            burst.x += burst.vx;
            burst.life -= 0.03;
            return burst.life > 0 && burst.x < viewport.width - 18;
        });

        const excitedCount = atoms.reduce((count, atom) => count + (atom.excited ? 1 : 0), 0);
        const inversion = excitedCount / atoms.length;
        const photonCount = photons.length;
        const gain = pump * (0.55 + inversion * 1.1) + Math.min(0.18, photonCount / 900);
        const totalLoss = 0.19 + loss * 1.4;
        const margin = gain - totalLoss;
        smoothedOutput = smoothedOutput * 0.88 + transmittedCount * 0.24;
        macroPhotonShare = clamp(Math.log1p(photonCount) / Math.log1p(180), 0, 1);
        macroOutputShare = clamp(smoothedOutput / 5.5, 0, 1);
        const thresholdShare = clamp((margin + 0.12) / 0.24, 0, 1);
        const macroTarget = clamp(macroPhotonShare * 0.4 + macroOutputShare * 0.35 + thresholdShare * 0.25, 0, 1);
        macroIntensity = lerp(macroIntensity, macroTarget, 0.14);

        updateStats(inversion, photonCount, smoothedOutput, margin);
        updateMacroReadout(photonCount, smoothedOutput, macroIntensity, margin);
        narration.textContent = describeState({ inversion, photons: photonCount, margin });
        pushHistory(inversion, photonCount, smoothedOutput);
    }

    function drawBackground() {
        const gradient = ctx.createLinearGradient(0, 0, 0, viewport.height);
        gradient.addColorStop(0, '#110a1a');
        gradient.addColorStop(0.6, '#211329');
        gradient.addColorStop(1, '#1a101f');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, viewport.width, viewport.height);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
        for (let x = 0; x < viewport.width; x += 28) {
            ctx.fillRect(x, 0, 1, viewport.height);
        }
    }

    function drawCavity() {
        const cavity = layout.cavity;
        const medium = layout.medium;
        const excitedCount = atoms.reduce((count, atom) => count + (atom.excited ? 1 : 0), 0);
        const inversion = excitedCount / atoms.length;

        roundedRectPath(cavity.x, cavity.y, cavity.width, cavity.height, 24);
        const cavityFill = ctx.createLinearGradient(0, cavity.y, 0, cavity.y + cavity.height);
        cavityFill.addColorStop(0, 'rgba(31, 20, 42, 0.94)');
        cavityFill.addColorStop(1, 'rgba(15, 9, 25, 0.94)');
        ctx.fillStyle = cavityFill;
        ctx.fill();

        const gainGlow = ctx.createLinearGradient(medium.left, 0, medium.right, 0);
        gainGlow.addColorStop(0, `rgba(201, 87, 79, ${0.16 + inversion * 0.08})`);
        gainGlow.addColorStop(0.5, `rgba(239, 216, 109, ${0.12 + inversion * 0.2})`);
        gainGlow.addColorStop(1, `rgba(201, 87, 79, ${0.16 + inversion * 0.08})`);
        ctx.fillStyle = gainGlow;
        roundedRectPath(medium.left, medium.top, medium.right - medium.left, medium.bottom - medium.top, 20);
        ctx.fill();

        ctx.fillStyle = '#d8e1f0';
        roundedRectPath(layout.leftMirrorX - 6, cavity.y + 10, 12, cavity.height - 20, 8);
        ctx.fill();
        roundedRectPath(layout.rightMirrorX - 6, cavity.y + 10, 12, cavity.height - 20, 8);
        ctx.fill();

        const pumpStrength = parseFloat(pumpRange.value);
        ctx.fillStyle = `rgba(201, 87, 79, ${0.16 + pumpStrength * 0.3})`;
        for (let index = 0; index < 6; index += 1) {
            const x = medium.left + (medium.right - medium.left) * ((index + 0.5) / 6);
            ctx.beginPath();
            ctx.moveTo(x, cavity.y - 4);
            ctx.lineTo(x - 12, medium.top - 8);
            ctx.lineTo(x + 12, medium.top - 8);
            ctx.closePath();
            ctx.fill();
        }

        ctx.fillStyle = 'rgba(255, 245, 243, 0.82)';
        ctx.font = '13px IBM Plex Sans JP';
        ctx.fillText('全反射鏡', layout.leftMirrorX - 22, cavity.y + cavity.height + 26);
        ctx.fillText('半透鏡', layout.rightMirrorX - 18, cavity.y + cavity.height + 26);
    }

    function drawAtoms() {
        for (const atom of atoms) {
            if (atom.excited) {
                ctx.fillStyle = 'rgba(240, 110, 99, 0.2)';
                ctx.beginPath();
                ctx.arc(atom.x, atom.y, 8, 0, tau);
                ctx.fill();
            }

            ctx.fillStyle = atom.excited ? '#f06e63' : '#6189d1';
            ctx.beginPath();
            ctx.arc(atom.x, atom.y, 4.3, 0, tau);
            ctx.fill();
        }
    }

    function drawPhotons() {
        for (const photon of photons) {
            const wobble = Math.sin(photon.phase) * 2.2;
            ctx.strokeStyle = 'rgba(240, 216, 111, 0.9)';
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(photon.x - Math.sign(photon.vx) * 10, photon.y - wobble * 0.4);
            ctx.lineTo(photon.x + Math.sign(photon.vx) * 10, photon.y + wobble * 0.4);
            ctx.stroke();

            ctx.fillStyle = '#f0d86f';
            ctx.beginPath();
            ctx.arc(photon.x, photon.y + wobble, 2.8, 0, tau);
            ctx.fill();
        }

        for (const burst of outputBursts) {
            ctx.strokeStyle = `rgba(246, 241, 188, ${burst.life})`;
            ctx.lineWidth = 2.2;
            ctx.beginPath();
            ctx.moveTo(burst.x - 22, burst.y);
            ctx.lineTo(burst.x + 8, burst.y);
            ctx.stroke();
        }

        if (smoothedOutput > 0.4) {
            const beamGradient = ctx.createLinearGradient(layout.rightMirrorX, 0, viewport.width, 0);
            beamGradient.addColorStop(0, `rgba(246, 241, 188, ${clamp(smoothedOutput / 8, 0.12, 0.5)})`);
            beamGradient.addColorStop(1, 'rgba(246, 241, 188, 0)');
            ctx.strokeStyle = beamGradient;
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.moveTo(layout.rightMirrorX + 4, layout.outputLane.y);
            ctx.lineTo(viewport.width - 20, layout.outputLane.y);
            ctx.stroke();
        }
    }

    function drawGraph() {
        const graph = layout.graph;

        roundedRectPath(graph.x, graph.y, graph.width, graph.height, 20);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        for (let index = 1; index < 4; index += 1) {
            const y = graph.y + (graph.height / 4) * index;
            ctx.beginPath();
            ctx.moveTo(graph.x + 12, y);
            ctx.lineTo(graph.x + graph.width - 12, y);
            ctx.stroke();
        }

        function drawSeries(values, color, width) {
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.beginPath();
            values.forEach((value, index) => {
                const x = graph.x + (graph.width * index) / (values.length - 1);
                const y = graph.y + graph.height - value * graph.height;
                if (index === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            });
            ctx.stroke();
        }

        drawSeries(photonHistory, 'rgba(240, 216, 111, 0.95)', 2.4);
        drawSeries(inversionHistory, 'rgba(240, 110, 99, 0.92)', 2.1);
        drawSeries(outputHistory, 'rgba(246, 241, 188, 0.85)', 1.7);

        ctx.fillStyle = 'rgba(255, 245, 243, 0.84)';
        ctx.font = '13px IBM Plex Sans JP';
        ctx.fillText('履歴: 黄 = 共振器内光子 / 赤 = 反転分布 / 白 = 出力ビーム', graph.x + 14, graph.y + 22);
    }

    function drawOverlay() {
        const gain = parseFloat(pumpRange.value);
        const loss = parseFloat(lossRange.value);
        const excitedCount = atoms.reduce((count, atom) => count + (atom.excited ? 1 : 0), 0);
        const inversion = excitedCount / atoms.length;
        const margin = gain * (0.55 + inversion * 1.1) + Math.min(0.18, photons.length / 900) - (0.19 + loss * 1.4);

        const badgeWidth = 142;
        const badgeHeight = 34;
        const badgeX = layout.cavity.x + layout.cavity.width - badgeWidth - 16;
        const badgeY = layout.cavity.y + 16;

        roundedRectPath(badgeX, badgeY, badgeWidth, badgeHeight, 16);
        ctx.fillStyle = margin > 0.04 ? 'rgba(12, 143, 93, 0.22)' : margin > -0.02 ? 'rgba(183, 122, 8, 0.22)' : 'rgba(177, 76, 72, 0.22)';
        ctx.fill();

        ctx.fillStyle = '#fff5f3';
        ctx.font = 'bold 14px IBM Plex Sans JP';
        ctx.fillText(margin > 0.04 ? 'gain > loss' : margin > -0.02 ? 'near threshold' : 'gain < loss', badgeX + 16, badgeY + 22);
    }

    function drawMacro() {
        if (!macroCtx) return;

        const width = macroViewport.width;
        const height = macroViewport.height;
        const beamStartX = width * 0.08;
        const beamEndX = width * 0.84;
        const centerY = height * 0.4;
        const beamHalfHeight = lerp(10, 34, macroIntensity);

        macroCtx.clearRect(0, 0, width, height);

        const background = macroCtx.createLinearGradient(0, 0, 0, height);
        background.addColorStop(0, '#120b1c');
        background.addColorStop(1, '#201227');
        macroCtx.fillStyle = background;
        macroCtx.fillRect(0, 0, width, height);

        roundedRectPathOn(macroCtx, beamStartX - 10, centerY - 12, 16, 24, 8);
        macroCtx.fillStyle = 'rgba(216, 225, 240, 0.88)';
        macroCtx.fill();

        const glow = macroCtx.createLinearGradient(beamStartX, 0, beamEndX, 0);
        glow.addColorStop(0, `rgba(246, 241, 188, ${clamp(0.16 + macroIntensity * 0.5, 0, 0.72)})`);
        glow.addColorStop(0.45, `rgba(240, 216, 111, ${clamp(0.2 + macroIntensity * 0.6, 0, 0.88)})`);
        glow.addColorStop(1, 'rgba(240, 216, 111, 0)');

        macroCtx.fillStyle = glow;
        roundedRectPathOn(macroCtx, beamStartX, centerY - beamHalfHeight, beamEndX - beamStartX, beamHalfHeight * 2, beamHalfHeight);
        macroCtx.fill();

        for (let index = 0; index < 5; index += 1) {
            const x = lerp(beamStartX + 16, beamEndX - 30, index / 4);
            const radius = lerp(7, 18, macroIntensity) * (0.7 + index * 0.08);
            const pulse = (Math.sin(frame * 0.08 + index * 0.9) + 1) * 0.5;
            macroCtx.fillStyle = `rgba(255, 247, 210, ${0.06 + macroIntensity * 0.18 + pulse * 0.08})`;
            macroCtx.beginPath();
            macroCtx.arc(x, centerY, radius, 0, tau);
            macroCtx.fill();
        }

        const meterX = width * 0.89;
        const meterY = height * 0.18;
        const meterHeight = height * 0.52;
        const meterWidth = 22;

        roundedRectPathOn(macroCtx, meterX, meterY, meterWidth, meterHeight, 10);
        macroCtx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        macroCtx.fill();

        const fillHeight = meterHeight * macroIntensity;
        roundedRectPathOn(macroCtx, meterX + 3, meterY + meterHeight - fillHeight - 3, meterWidth - 6, fillHeight, 8);
        macroCtx.fillStyle = `rgba(240, 216, 111, ${0.18 + macroIntensity * 0.7})`;
        macroCtx.fill();

        const historyY = height * 0.72;
        const historyHeight = height * 0.18;
        roundedRectPathOn(macroCtx, beamStartX - 8, historyY, width * 0.76, historyHeight, 14);
        macroCtx.fillStyle = 'rgba(255, 255, 255, 0.04)';
        macroCtx.fill();

        macroCtx.beginPath();
        macroHistory.forEach((value, index) => {
            const x = beamStartX + ((width * 0.72) * index) / (macroHistory.length - 1);
            const y = historyY + historyHeight - value * (historyHeight - 12) - 6;
            if (index === 0) {
                macroCtx.moveTo(x, historyY + historyHeight - 6);
                macroCtx.lineTo(x, y);
            } else {
                macroCtx.lineTo(x, y);
            }
        });
        macroCtx.lineTo(beamStartX + width * 0.72, historyY + historyHeight - 6);
        macroCtx.closePath();
        macroCtx.fillStyle = 'rgba(240, 216, 111, 0.24)';
        macroCtx.fill();

        macroCtx.strokeStyle = 'rgba(246, 241, 188, 0.92)';
        macroCtx.lineWidth = 2;
        macroCtx.beginPath();
        macroHistory.forEach((value, index) => {
            const x = beamStartX + ((width * 0.72) * index) / (macroHistory.length - 1);
            const y = historyY + historyHeight - value * (historyHeight - 12) - 6;
            if (index === 0) {
                macroCtx.moveTo(x, y);
            } else {
                macroCtx.lineTo(x, y);
            }
        });
        macroCtx.stroke();

        macroCtx.fillStyle = 'rgba(255, 245, 243, 0.86)';
        macroCtx.font = '13px IBM Plex Sans JP';
        macroCtx.fillText('マクロ光強度', beamStartX, 24);
        macroCtx.fillText(`I = ${Math.round(macroIntensity * 100)} %`, width * 0.74, 24);
        macroCtx.fillText(`ミクロ連動: 光子 ${Math.round(macroPhotonShare * maxPhotons)} / 出力 ${smoothedOutput.toFixed(2)}`, beamStartX, height - 10);
    }

    function draw() {
        ctx.clearRect(0, 0, viewport.width, viewport.height);
        drawBackground();
        drawCavity();
        drawAtoms();
        drawPhotons();
        drawGraph();
        drawOverlay();
        drawMacro();
    }

    function loop() {
        updateSimulation();
        draw();
        requestAnimationFrame(loop);
    }

    function applyPreset(key) {
        const preset = presets[key];
        if (!preset) return;

        activePreset = key;
        pumpRange.value = preset.pump.toFixed(2);
        lossRange.value = preset.loss.toFixed(2);
        seedRange.value = `${preset.seed}`;
        narration.textContent = preset.note;
        presetRow.querySelectorAll('.preset-chip').forEach((chip) => {
            chip.classList.toggle('is-active', chip.dataset.preset === key);
        });
        updateControlLabels();
        resetSimulation(preset.seed);
    }

    presetRow.addEventListener('click', (event) => {
        const target = event.target.closest('[data-preset]');
        if (target) applyPreset(target.dataset.preset);
    });

    [pumpRange, lossRange, seedRange].forEach((input) => {
        input.addEventListener('input', () => {
            activePreset = '';
            presetRow.querySelectorAll('.preset-chip').forEach((chip) => chip.classList.remove('is-active'));
            updateControlLabels();
            if (input === seedRange && parseInt(seedRange.value, 10) === 0 && photons.length < 6) {
                resetSimulation(0);
            }
        });
    });

    window.addEventListener('resize', resizeCanvas);

    resizeCanvas();
    applyPreset(activePreset);
    loop();
})();