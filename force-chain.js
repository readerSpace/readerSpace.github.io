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

    const canvas = document.getElementById('forceChainCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const forceRange = document.getElementById('forceRange');
    const widthRange = document.getElementById('widthRange');
    const dampingRange = document.getElementById('dampingRange');
    const forceVal = document.getElementById('forceVal');
    const widthVal = document.getElementById('widthVal');
    const dampingVal = document.getElementById('dampingVal');
    const statPeak = document.getElementById('statPeak');
    const statLoaded = document.getElementById('statLoaded');
    const statChains = document.getElementById('statChains');
    const statDepth = document.getElementById('statDepth');
    const statSupport = document.getElementById('statSupport');
    const statMode = document.getElementById('statMode');
    const demoNarration = document.getElementById('demoNarration');
    const presetRow = document.getElementById('presetRow');

    const presets = {
        narrow: {
            force: 0.78,
            width: 0.22,
            damping: 0.972
        },
        balanced: {
            force: 0.52,
            width: 0.32,
            damping: 0.965
        },
        wide: {
            force: 0.68,
            width: 0.68,
            damping: 0.952
        }
    };

    function percentileThreshold(values, ratio) {
        if (!values.length) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const index = clamp(Math.floor(sorted.length * ratio), 0, sorted.length - 1);
        return sorted[index];
    }

    const tau = Math.PI * 2;
    const gravity = 0.018;
    const gravityVisualK = 5.6;
    const linkK = 0.095;
    const lateralHomeK = 0.03;
    const verticalHomeK = 0.012;
    const wallK = 0.42;
    const plateLoadK = 1.38;

    let viewport = { width: 920, height: 620, dpr: 1 };
    let particles = [];
    let links = [];
    let contacts = [];
    let displayPaths = [];
    let particleRadius = 10;
    let maxRowIndex = 0;
    let latestMetrics = {
        peakForce: 0,
        loadedCount: 0,
        chainCount: 0,
        compressionDepth: 0,
        supportExtent: 0,
        mode: '待機中'
    };

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function rand(min, max) {
        return min + Math.random() * (max - min);
    }

    function roundedRectPath(x, y, width, height, radius) {
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

    function getLayout() {
        const width = viewport.width;
        const height = viewport.height;
        const textBandBottom = 78;
        return {
            chamber: {
                left: 34,
                right: width - 34,
                top: Math.max(98, textBandBottom + 30),
                bottom: height - 46
            }
        };
    }

    function buildParticles() {
        const { chamber } = getLayout();
        particleRadius = clamp(viewport.width / 82, 8.2, 11.6);
        const spacingX = particleRadius * 2.12;
        const spacingY = particleRadius * 1.84;
        const startX = chamber.left + particleRadius * 2.6;
        const startY = chamber.top + 64;
        const maxX = chamber.right - particleRadius * 2.2;
        const maxY = chamber.bottom - particleRadius * 2.2;

        particles = [];
        let rowIndex = 0;
        for (let y = startY; y < maxY; y += spacingY) {
            const offset = rowIndex % 2 ? spacingX * 0.5 : 0;
            for (let x = startX + offset; x < maxX; x += spacingX) {
                particles.push({
                    x,
                    y,
                    homeX: x,
                    homeY: y,
                    vx: 0,
                    vy: 0,
                    fx: 0,
                    fy: 0,
                    forceMag: 0,
                    pressureMag: 0,
                    weightMag: 0,
                    r: particleRadius * (0.96 + Math.random() * 0.08),
                    fixed: false,
                    row: rowIndex
                });
            }
            rowIndex += 1;
        }

        maxRowIndex = Math.max(...particles.map((particle) => particle.row), 0);
        for (const particle of particles) {
            particle.fixed = particle.row >= maxRowIndex;
        }

        buildLinks();
    }

    function buildLinks() {
        links = [];
        const neighborDistance = particleRadius * 2.36;
        for (let index = 0; index < particles.length; index += 1) {
            const a = particles[index];
            for (let otherIndex = index + 1; otherIndex < particles.length; otherIndex += 1) {
                const b = particles[otherIndex];
                if (Math.abs(a.row - b.row) > 1) continue;
                const dx = b.homeX - a.homeX;
                const dy = b.homeY - a.homeY;
                const dist = Math.hypot(dx, dy);
                if (dist <= neighborDistance) {
                    links.push({ a: index, b: otherIndex, rest: dist });
                }
            }
        }
    }

    function computePlate(layout) {
        const force = parseFloat(forceRange.value);
        const widthRatio = parseFloat(widthRange.value);
        const chamberWidth = layout.chamber.right - layout.chamber.left;
        const widthPx = clamp(chamberWidth * widthRatio, 84, chamberWidth - 48);
        const centerX = viewport.width * 0.5;
        const baseY = layout.chamber.top + 18;
        return {
            force,
            widthRatio,
            widthPx,
            left: centerX - widthPx * 0.5,
            right: centerX + widthPx * 0.5,
            pressY: baseY + force * 66,
            chamberWidth
        };
    }

    function updateControlLabels() {
        const plate = computePlate(getLayout());
        forceVal.textContent = parseFloat(forceRange.value).toFixed(2);
        widthVal.textContent = `${Math.round(plate.widthPx)} px`;
        dampingVal.textContent = parseFloat(dampingRange.value).toFixed(3);
    }

    function resizeCanvas() {
        const parentWidth = canvas.parentElement.clientWidth;
        const cssWidth = Math.min(parentWidth, 920);
        const mobile = window.innerWidth < 720;
        const cssHeight = mobile
            ? clamp(window.innerHeight * 0.56, 410, 560)
            : clamp(cssWidth * 0.68, 520, 620);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
        canvas.width = Math.round(cssWidth * dpr);
        canvas.height = Math.round(cssHeight * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        viewport = { width: cssWidth, height: cssHeight, dpr };

        buildParticles();
        updateControlLabels();
    }

    function describePattern(plate, peakForce, loadedCount) {
        const damping = parseFloat(dampingRange.value);
        if (peakForce < 0.09) return 'ほぼ無荷重';
        if (plate.widthRatio < 0.26) return '細い荷重で深い力鎖';
        if (plate.widthRatio > 0.62) return '広い荷重で面状分散';
        if (damping < 0.93) return '摩擦が弱く再配列中';
        if (loadedCount > 120) return '複数の枝へ広く分配';
        return '中央から扇状に伝達';
    }

    function describeState(metrics, plate) {
        const damping = parseFloat(dampingRange.value);
        if (metrics.peakForce < 0.08) {
            return '荷重がまだ弱く、接触ネットワークはほぼ均一です。粒子は少し沈むだけで、はっきりした力鎖は目立ちません。';
        }
        if (plate.widthRatio < 0.26) {
            return '細い圧子なので、力が中央の少数粒子へ集中し、深いところまで細い力鎖が伸びています。';
        }
        if (plate.widthRatio > 0.62) {
            return '広い圧子なので、荷重が上面で分散し、複数の枝が横へ広がりながら支持点へ流れています。';
        }
        if (damping < 0.93) {
            return '摩擦が弱く、粒子が滑りながら再配列しています。力鎖の枝も固定されず、時間とともに組み替わります。';
        }
        return '標準状態では、中央から扇状に数本の力鎖が分かれ、下の支持点へ荷重が流れます。';
    }

    function getForceMix(pressureMag, weightMag) {
        const total = pressureMag + weightMag;
        if (total <= 0.0001) {
            return {
                pressureRatio: 0.5,
                weightRatio: 0.5,
                total: 0
            };
        }

        return {
            pressureRatio: pressureMag / total,
            weightRatio: weightMag / total,
            total
        };
    }

    function mixForceColor(pressureMag, weightMag, alpha, brighten = 0) {
        const visualPressure = pressureMag * 1.32;
        const visualWeight = weightMag * 0.6;
        const { pressureRatio, weightRatio } = getForceMix(visualPressure, visualWeight);
        const pressureColor = { r: 255, g: 148, b: 72 };
        const weightColor = { r: 86, g: 196, b: 255 };

        let r = pressureColor.r * pressureRatio + weightColor.r * weightRatio;
        let g = pressureColor.g * pressureRatio + weightColor.g * weightRatio;
        let b = pressureColor.b * pressureRatio + weightColor.b * weightRatio;

        r += (255 - r) * brighten;
        g += (255 - g) * brighten;
        b += (255 - b) * brighten;

        return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
    }

    function samplePathSeeds(candidates, desiredCount) {
        if (!candidates.length) return [];
        const ordered = [...candidates].sort((a, b) => a.x - b.x);
        const sampleCount = Math.min(desiredCount, ordered.length);
        const seeds = [];

        for (let index = 0; index < sampleCount; index += 1) {
            const position = sampleCount === 1
                ? 0
                : Math.round((index * (ordered.length - 1)) / Math.max(1, sampleCount - 1));
            const candidate = ordered[position];
            if (candidate && !seeds.some((seed) => seed.index === candidate.index)) {
                seeds.push(candidate);
            }
        }

        if (seeds.length < sampleCount) {
            const byForce = [...candidates].sort((a, b) => b.forceMag - a.forceMag);
            for (const candidate of byForce) {
                if (seeds.length >= sampleCount) break;
                if (!seeds.some((seed) => seed.index === candidate.index)) {
                    seeds.push(candidate);
                }
            }
        }

        return seeds;
    }

    function traceTransmissionPath(startIndex, adjacency, entryPoint) {
        const path = [startIndex];
        const visited = new Set(path);
        let currentIndex = startIndex;
        let previousPoint = entryPoint;

        for (let step = 0; step < maxRowIndex + 4; step += 1) {
            const current = particles[currentIndex];
            const backDx = previousPoint.x - current.x;
            const backDy = previousPoint.y - current.y;
            const backLength = Math.max(Math.hypot(backDx, backDy), 0.0001);

            const options = (adjacency.get(currentIndex) || [])
                .map((edge) => {
                    const next = particles[edge.next];
                    const dx = next.x - current.x;
                    const dy = next.y - current.y;
                    if (visited.has(edge.next)) return null;
                    if (dy < -particleRadius * 0.55) return null;

                    const distance = Math.max(Math.hypot(dx, dy), 0.0001);
                    const returnCosine = (dx * backDx + dy * backDy) / (distance * backLength);
                    if (returnCosine > 0.82) return null;

                    const downwardBias = clamp(dy / (particleRadius * 2.2), -0.15, 1.1);
                    return {
                        next: edge.next,
                        forceMag: next.forceMag,
                        contactStrength: edge.strength,
                        downwardBias,
                        returnCosine
                    };
                })
                .filter(Boolean)
                .sort((a, b) => {
                    if (b.forceMag !== a.forceMag) return b.forceMag - a.forceMag;
                    if (b.contactStrength !== a.contactStrength) return b.contactStrength - a.contactStrength;
                    if (b.downwardBias !== a.downwardBias) return b.downwardBias - a.downwardBias;
                    return a.returnCosine - b.returnCosine;
                });

            if (!options.length) break;

            previousPoint = { x: current.x, y: current.y };
            currentIndex = options[0].next;
            path.push(currentIndex);
            visited.add(currentIndex);

            if (particles[currentIndex].row >= maxRowIndex - 1) break;
        }

        return path;
    }

    function computeDisplayPaths(plate, particlePeak, contactPeak, activeThreshold) {
        const pathThreshold = Math.max(0.0016, contactPeak * 0.18);
        const strongContacts = contacts.filter((contact) => contact.strength >= pathThreshold);
        if (!strongContacts.length) {
            displayPaths = [];
            canvas.dataset.pathCount = '0';
            canvas.dataset.pathLengths = '';
            canvas.dataset.pathStrengths = '';
            return;
        }

        const adjacency = new Map();
        const connect = (from, to, strength) => {
            if (!adjacency.has(from)) adjacency.set(from, []);
            adjacency.get(from).push({ next: to, strength });
        };

        for (const contact of strongContacts) {
            connect(contact.aIndex, contact.bIndex, contact.strength);
            connect(contact.bIndex, contact.aIndex, contact.strength);
        }

        let startCandidates = particles
            .map((particle, index) => ({
                index,
                x: particle.x,
                row: particle.row,
                forceMag: particle.forceMag
            }))
            .filter((candidate) => (
                candidate.row <= 2
                && candidate.x >= plate.left - particleRadius * 1.2
                && candidate.x <= plate.right + particleRadius * 1.2
                && candidate.forceMag >= Math.max(0.025, particlePeak * 0.28, activeThreshold * 0.4)
            ));

        if (!startCandidates.length) {
            startCandidates = particles
                .map((particle, index) => ({
                    index,
                    x: particle.x,
                    row: particle.row,
                    forceMag: particle.forceMag
                }))
                .filter((candidate) => (
                    candidate.row <= 3
                    && candidate.x >= plate.left - particleRadius * 1.4
                    && candidate.x <= plate.right + particleRadius * 1.4
                    && candidate.forceMag >= Math.max(0.018, particlePeak * 0.22)
                ));
        }

        const desiredCount = clamp(Math.round(plate.widthRatio * 4) + 2, 3, 5);
        const seeds = samplePathSeeds(startCandidates, desiredCount);
        const signatures = new Set();
        const nextPaths = [];

        for (const seed of seeds) {
            const chain = traceTransmissionPath(seed.index, adjacency, {
                x: particles[seed.index].x,
                y: plate.pressY
            });
            if (chain.length < 2) continue;
            const signature = chain.slice(0, 4).join('>');
            if (signatures.has(signature)) continue;
            signatures.add(signature);

            const pointForces = chain.map((index) => particles[index].forceMag);

            nextPaths.push({
                strength: Math.max(seed.forceMag, ...pointForces),
                points: [
                    {
                        x: particles[seed.index].x,
                        y: plate.pressY,
                        force: seed.forceMag,
                        pressure: particles[seed.index].pressureMag,
                        weight: particles[seed.index].weightMag
                    },
                    ...chain.map((index) => ({
                        x: particles[index].x,
                        y: particles[index].y,
                        force: particles[index].forceMag,
                        pressure: particles[index].pressureMag,
                        weight: particles[index].weightMag
                    }))
                ]
            });
        }

        displayPaths = nextPaths;
        canvas.dataset.pathCount = `${displayPaths.length}`;
        canvas.dataset.pathLengths = displayPaths.map((path) => path.points.length - 1).join(',');
        canvas.dataset.pathStrengths = displayPaths
            .map((path) => path.points.slice(1).map((point) => point.force.toFixed(2)).join(':'))
            .join('|');
    }

    function applyForces(layout, plate) {
        contacts = [];
        for (const particle of particles) {
            particle.fx = (particle.homeX - particle.x) * lateralHomeK;
            particle.fy = gravity + (particle.homeY - particle.y) * verticalHomeK;
            particle.forceMag = 0;
            particle.pressureMag = 0;
            particle.weightMag = gravity * gravityVisualK;
        }

        const plateCenter = (plate.left + plate.right) * 0.5;
        const loadSpread = plate.widthPx * 0.5 + particleRadius * 1.4;
        const topBand = layout.chamber.top + particleRadius * 6.8;
        const pressureScale = plate.force * plateLoadK / (0.38 + plate.widthRatio * 1.1);

        for (const particle of particles) {
            const horizontal = 1 - Math.abs(particle.x - plateCenter) / loadSpread;
            const vertical = 1 - (particle.homeY - layout.chamber.top - particleRadius * 1.6) / (topBand - layout.chamber.top);
            if (horizontal > 0 && vertical > 0) {
                const load = pressureScale * horizontal * horizontal * clamp(vertical, 0, 1);
                particle.fy += load;
                particle.forceMag += load * 0.18;
                particle.pressureMag += load * 0.18;
            }
        }

        for (const link of links) {
            const a = particles[link.a];
            const b = particles[link.b];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.max(Math.hypot(dx, dy), 0.0001);
            const stretch = dist - link.rest;
            const nx = dx / dist;
            const ny = dy / dist;
            const springForce = stretch * linkK;

            a.fx += springForce * nx;
            a.fy += springForce * ny;
            b.fx -= springForce * nx;
            b.fy -= springForce * ny;

            const axialLoad = Math.abs(springForce) * (1 + Math.abs(ny) * 0.35);
            const transmitted = axialLoad * 12;
            const sourcePressure = a.pressureMag + b.pressureMag;
            const sourceWeight = a.weightMag + b.weightMag;
            const sourceMix = getForceMix(sourcePressure, sourceWeight);
            const pressureTransmit = transmitted * sourceMix.pressureRatio;
            const weightTransmit = transmitted * sourceMix.weightRatio;

            a.forceMag += transmitted * 0.5;
            b.forceMag += transmitted * 0.5;
            a.pressureMag += pressureTransmit * 0.5;
            b.pressureMag += pressureTransmit * 0.5;
            a.weightMag += weightTransmit * 0.5;
            b.weightMag += weightTransmit * 0.5;

            if (axialLoad > 0.0012) {
                contacts.push({
                    aIndex: link.a,
                    bIndex: link.b,
                    ax: a.x,
                    ay: a.y,
                    bx: b.x,
                    by: b.y,
                    strength: axialLoad,
                    pressureMag: axialLoad * sourceMix.pressureRatio,
                    weightMag: axialLoad * sourceMix.weightRatio
                });
            }
        }

        for (const particle of particles) {
            if (particle.x - particle.r < layout.chamber.left) {
                const force = wallK * (layout.chamber.left - (particle.x - particle.r));
                particle.fx += force;
                particle.forceMag += Math.abs(force);
            }
            if (particle.x + particle.r > layout.chamber.right) {
                const force = wallK * ((particle.x + particle.r) - layout.chamber.right);
                particle.fx -= force;
                particle.forceMag += Math.abs(force);
            }
            if (particle.y + particle.r > layout.chamber.bottom) {
                const force = wallK * ((particle.y + particle.r) - layout.chamber.bottom);
                particle.fy -= force;
                particle.forceMag += Math.abs(force);
            }
            if (particle.y - particle.r < layout.chamber.top + 16) {
                const force = wallK * ((layout.chamber.top + 16) - (particle.y - particle.r));
                particle.fy += force;
                particle.forceMag += Math.abs(force);
            }
        }

        const particlePeak = particles.reduce((max, particle) => Math.max(max, particle.forceMag), 0);
        const contactPeak = contacts.reduce((max, contact) => Math.max(max, contact.strength), 0);
        const activeThreshold = Math.max(0.08, particlePeak * 0.72);
        const chainThreshold = Math.max(0.01, contactPeak * 0.62);
        const loadedCount = particles.filter((particle) => particle.forceMag > activeThreshold).length;
        const chainCount = contacts.filter((contact) => contact.strength > chainThreshold).length;
        computeDisplayPaths(plate, particlePeak, contactPeak, activeThreshold);

        const compressionDepth = Math.max(0, plate.pressY - (layout.chamber.top + 18));

        const bottomParticles = particles.filter((particle) => particle.row >= maxRowIndex - 1);
        const supportThreshold = Math.max(0.02, particlePeak * 0.16);
        const supportParticles = bottomParticles.filter((particle) => particle.forceMag > supportThreshold);
        let supportExtent = 0;
        if (supportParticles.length > 1) {
            const xs = supportParticles.map((particle) => particle.x);
            supportExtent = ((Math.max(...xs) - Math.min(...xs)) / plate.chamberWidth) * 100;
        }

        latestMetrics = {
            peakForce: contactPeak,
            loadedCount,
            chainCount,
            compressionDepth,
            supportExtent,
            mode: describePattern(plate, contactPeak, loadedCount)
        };
    }

    function integrate(layout) {
        const damping = parseFloat(dampingRange.value);
        for (const particle of particles) {
            if (particle.fixed) {
                particle.x = particle.homeX;
                particle.y = particle.homeY;
                particle.vx = 0;
                particle.vy = 0;
                continue;
            }

            particle.vx = (particle.vx + particle.fx) * damping;
            particle.vy = (particle.vy + particle.fy) * damping;
            particle.x += particle.vx * 0.62;
            particle.y += particle.vy * 0.62;

            particle.x = clamp(particle.x, layout.chamber.left + particle.r, layout.chamber.right - particle.r);
            particle.y = clamp(particle.y, layout.chamber.top + particle.r + 10, layout.chamber.bottom - particle.r);
        }
    }

    function updateStats(metrics) {
        statPeak.textContent = metrics.peakForce.toFixed(2);
        statLoaded.textContent = `${metrics.loadedCount} 粒`;
        statChains.textContent = `${metrics.chainCount}`;
        statDepth.textContent = `${metrics.compressionDepth.toFixed(1)} px`;
        statSupport.textContent = `${Math.round(metrics.supportExtent)} %`;
        statMode.textContent = metrics.mode;
    }

    function drawArrow(x, y, length) {
        ctx.strokeStyle = 'rgba(246, 234, 222, 0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + length);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y + length);
        ctx.lineTo(x - 6, y + length - 8);
        ctx.lineTo(x + 6, y + length - 8);
        ctx.closePath();
        ctx.fillStyle = 'rgba(246, 234, 222, 0.86)';
        ctx.fill();
    }

    function drawScene(layout, plate) {
        const width = viewport.width;
        const height = viewport.height;

        ctx.clearRect(0, 0, width, height);

        const background = ctx.createLinearGradient(0, 0, 0, height);
        background.addColorStop(0, '#18110d');
        background.addColorStop(1, '#0d0907');
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
        for (let x = 0; x < width; x += 28) {
            ctx.fillRect(x, 0, 1, height);
        }

        ctx.fillStyle = '#f8f3ee';
        ctx.font = '700 24px IBM Plex Sans JP';
        ctx.fillText('粒子に加わる力', 34, 36);

        ctx.fillStyle = 'rgba(248, 243, 238, 0.84)';
        ctx.font = '16px IBM Plex Sans JP';
        ctx.fillText(`押す力 ${plate.force.toFixed(2)} / 幅 ${Math.round(plate.widthPx)} px / 摩擦 ${parseFloat(dampingRange.value).toFixed(3)}`, 34, 64);

        ctx.strokeStyle = '#a89686';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(layout.chamber.left, layout.chamber.top);
        ctx.lineTo(layout.chamber.left, layout.chamber.bottom);
        ctx.lineTo(layout.chamber.right, layout.chamber.bottom);
        ctx.lineTo(layout.chamber.right, layout.chamber.top);
        ctx.stroke();

        ctx.fillStyle = 'rgba(108, 102, 95, 0.22)';
        ctx.fillRect(layout.chamber.left, layout.chamber.bottom - 18, layout.chamber.right - layout.chamber.left, 18);

        roundedRectPath(plate.left, plate.pressY - 16, plate.widthPx, 16, 8);
        ctx.fillStyle = '#d1c6b9';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        drawArrow(plate.left + 24, plate.pressY - 42, 22);
        drawArrow(plate.right - 24, plate.pressY - 42, 22);

        ctx.fillStyle = '#f8f3ee';
        ctx.font = '15px IBM Plex Sans JP';
        ctx.fillText('圧子', plate.left + 12, plate.pressY - 24);

        const peak = Math.max(0.18, latestMetrics.peakForce);
        for (const contact of contacts) {
            const strength = clamp(contact.strength / (peak * 0.8), 0, 1);
            if (strength < 0.05) continue;
            ctx.strokeStyle = mixForceColor(contact.pressureMag, contact.weightMag, 0.12 + strength * 0.78, 0.06 + strength * 0.08);
            ctx.lineWidth = 0.5 + strength * 5.6;
            ctx.beginPath();
            ctx.moveTo(contact.ax, contact.ay);
            ctx.lineTo(contact.bx, contact.by);
            ctx.stroke();
        }

        for (const particle of particles) {
            const glow = clamp(particle.forceMag / peak, 0, 1);
            if (glow > 0.05) {
                ctx.beginPath();
                ctx.arc(particle.x, particle.y, particle.r + glow * 6.5, 0, tau);
                ctx.fillStyle = mixForceColor(particle.pressureMag, particle.weightMag, 0.14 + glow * 0.5, 0.16 + glow * 0.12);
                ctx.fill();
            }

            ctx.beginPath();
            ctx.arc(particle.x, particle.y, particle.r, 0, tau);
            ctx.fillStyle = particle.fixed ? '#6c665f' : '#23303a';
            ctx.fill();
            ctx.strokeStyle = mixForceColor(particle.pressureMag, particle.weightMag, 0.22 + glow * 0.7, 0.24 + glow * 0.16);
            ctx.lineWidth = 1 + glow * 2.2;
            ctx.stroke();
        }

        if (displayPaths.length) {
            const pathPeak = displayPaths.reduce((max, path) => (
                path.points.reduce((innerMax, point) => Math.max(innerMax, point.force || 0), max)
            ), 0.001);
            ctx.save();
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';

            displayPaths.forEach((path, pathIndex) => {
                for (let index = 0; index < path.points.length - 1; index += 1) {
                    const start = path.points[index];
                    const end = path.points[index + 1];
                    const segmentForce = Math.max(start.force || 0, end.force || 0);
                    const segmentPressure = (start.pressure || 0) + (end.pressure || 0);
                    const segmentWeight = (start.weight || 0) + (end.weight || 0);
                    const emphasis = clamp(segmentForce / pathPeak, 0.14, 1);

                    ctx.setLineDash([]);
                    ctx.strokeStyle = mixForceColor(segmentPressure, segmentWeight, 0.14 + emphasis * 0.2, 0.18 + emphasis * 0.14);
                    ctx.lineWidth = 5.8 + emphasis * 2.8;
                    ctx.beginPath();
                    ctx.moveTo(start.x, start.y);
                    ctx.lineTo(end.x, end.y);
                    ctx.stroke();

                    ctx.strokeStyle = mixForceColor(segmentPressure, segmentWeight, 0.56 + emphasis * 0.28, 0.02 + emphasis * 0.06);
                    ctx.lineWidth = 2.2 + emphasis * 1.3;
                    ctx.beginPath();
                    ctx.moveTo(start.x, start.y);
                    ctx.lineTo(end.x, end.y);
                    ctx.stroke();
                }

                const entryForce = path.points[1]?.force || path.strength;
                const entryPressure = path.points[1]?.pressure || 0;
                const entryWeight = path.points[1]?.weight || 0;
                const entryEmphasis = clamp(entryForce / pathPeak, 0.2, 1);
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.arc(path.points[0].x, path.points[0].y - 12, 8.4, 0, tau);
                ctx.fillStyle = mixForceColor(entryPressure, entryWeight, 0.74 + entryEmphasis * 0.18, 0.12 + entryEmphasis * 0.12);
                ctx.fill();
                ctx.fillStyle = '#082530';
                ctx.font = '700 11px IBM Plex Sans JP';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(String(pathIndex + 1), path.points[0].x, path.points[0].y - 12);
            });

            ctx.fillStyle = 'rgba(218, 245, 255, 0.9)';
            ctx.font = '13px IBM Plex Sans JP';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText('主な伝達経路', layout.chamber.right - 112, layout.chamber.top + 24);
            ctx.restore();
        }

        ctx.fillStyle = '#f8f3ee';
        ctx.font = '15px IBM Plex Sans JP';
        ctx.fillText(`最大接触力 ${latestMetrics.peakForce.toFixed(2)}`, 28, height - 20);
        ctx.fillText(`圧縮 ${latestMetrics.compressionDepth.toFixed(1)} px`, width * 0.28, height - 20);
        ctx.fillText(`支持の広がり ${Math.round(latestMetrics.supportExtent)} %`, width * 0.48, height - 20);
        ctx.fillText(`モード ${latestMetrics.mode}`, width * 0.7, height - 20);
    }

    function frame() {
        const layout = getLayout();
        updateControlLabels();

        let plate = computePlate(layout);
        for (let step = 0; step < 3; step += 1) {
            plate = computePlate(layout);
            applyForces(layout, plate);
            integrate(layout);
        }
        plate = computePlate(layout);
        applyForces(layout, plate);

        updateStats(latestMetrics);
        demoNarration.textContent = describeState(latestMetrics, plate);
        drawScene(layout, plate);
        requestAnimationFrame(frame);
    }

    function applyPreset(key) {
        const preset = presets[key];
        if (!preset) return;
        forceRange.value = preset.force.toFixed(2);
        widthRange.value = preset.width.toFixed(2);
        dampingRange.value = preset.damping.toFixed(3);
        presetRow.querySelectorAll('.preset-chip').forEach((chip) => {
            chip.classList.toggle('is-active', chip.dataset.preset === key);
        });
        buildParticles();
        updateControlLabels();
    }

    presetRow.addEventListener('click', (event) => {
        const target = event.target.closest('[data-preset]');
        if (target) applyPreset(target.dataset.preset);
    });

    [forceRange, widthRange, dampingRange].forEach((input) => {
        input.addEventListener('input', () => {
            updateControlLabels();
            presetRow.querySelectorAll('.preset-chip').forEach((chip) => chip.classList.remove('is-active'));
        });
    });

    window.addEventListener('resize', resizeCanvas);

    resizeCanvas();
    applyPreset('balanced');
    frame();
})();