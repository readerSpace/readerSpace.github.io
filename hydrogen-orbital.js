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

    const canvas = document.getElementById('orbitalCanvas');
    if (!canvas) {
        return;
    }

    const ctx = canvas.getContext('2d');
    const controls = {
        presetRow: document.getElementById('presetRow'),
        targetSelect: document.getElementById('targetSelect'),
        nRange: document.getElementById('nRange'),
        lRange: document.getElementById('lRange'),
        mRange: document.getElementById('mRange'),
        modeSelect: document.getElementById('modeSelect'),
        ampRange: document.getElementById('ampRange'),
        resRange: document.getElementById('resRange'),
        resetViewBtn: document.getElementById('resetViewBtn'),
        targetVal: document.getElementById('targetVal'),
        nVal: document.getElementById('nVal'),
        lVal: document.getElementById('lVal'),
        mVal: document.getElementById('mVal'),
        modeVal: document.getElementById('modeVal'),
        ampVal: document.getElementById('ampVal'),
        resVal: document.getElementById('resVal'),
        mHelp: document.getElementById('mHelp'),
        currentFormula: document.getElementById('currentFormula'),
        stateNote: document.getElementById('stateNote'),
        nQuantValue: document.getElementById('nQuantValue'),
        familyValue: document.getElementById('familyValue'),
        radialNodeValue: document.getElementById('radialNodeValue'),
        nodeTotalValue: document.getElementById('nodeTotalValue'),
        azimuthValue: document.getElementById('azimuthValue'),
        totalNodeValue: document.getElementById('totalNodeValue'),
        symmetryValue: document.getElementById('symmetryValue'),
        modeSummaryValue: document.getElementById('modeSummaryValue')
    };

    const presets = {
        oneS: { target: 'full', n: 1, l: 0, m: 0, mode: 'prob' },
        threeS: { target: 'full', n: 3, l: 0, m: 0, mode: 'real' },
        threePz: { target: 'full', n: 3, l: 1, m: 0, mode: 'real' },
        threeDxz: { target: 'full', n: 3, l: 2, m: 1, mode: 'real' },
        fourDx2y2: { target: 'full', n: 4, l: 2, m: 2, mode: 'real' }
    };

    const orbitalLetters = ['s', 'p', 'd', 'f', 'g', 'h', 'i', 'k', 'l'];
    let viewport = { width: 900, height: 680, dpr: 1 };
    let rotationX = -0.56;
    let rotationY = 0.82;
    let zoom = 1;
    let pointerId = null;
    let lastPointerX = 0;
    let lastPointerY = 0;
    let renderPending = false;
    let surfaceDirty = true;
    let surfacePoints = [];
    let activePreset = 'threePz';

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function factorial(value) {
        let result = 1;
        for (let index = 2; index <= value; index += 1) {
            result *= index;
        }
        return result;
    }

    function associatedLegendre(l, m, x) {
        const order = Math.abs(m);
        if (order > l) {
            return 0;
        }

        let pmm = 1;
        if (order > 0) {
            const sinTerm = Math.sqrt(Math.max(0, 1 - x * x));
            let factor = 1;
            for (let index = 1; index <= order; index += 1) {
                pmm *= -factor * sinTerm;
                factor += 2;
            }
        }

        if (l === order) {
            return pmm;
        }

        let pmmp1 = x * (2 * order + 1) * pmm;
        if (l === order + 1) {
            return pmmp1;
        }

        let pll = 0;
        for (let degree = order + 2; degree <= l; degree += 1) {
            pll = ((2 * degree - 1) * x * pmmp1 - (degree + order - 1) * pmm) / (degree - order);
            pmm = pmmp1;
            pmmp1 = pll;
        }
        return pll;
    }

    function normalization(l, m) {
        const order = Math.abs(m);
        return Math.sqrt(((2 * l + 1) / (4 * Math.PI)) * (factorial(l - order) / factorial(l + order)));
    }

    function generalizedLaguerre(order, alpha, x) {
        if (order === 0) {
            return 1;
        }
        if (order === 1) {
            return 1 + alpha - x;
        }

        let previous = 1;
        let current = 1 + alpha - x;
        for (let index = 2; index <= order; index += 1) {
            const next = ((2 * index - 1 + alpha - x) * current - (index - 1 + alpha) * previous) / index;
            previous = current;
            current = next;
        }
        return current;
    }

    function radialHydrogen(n, l, radius) {
        const rho = (2 * radius) / n;
        const prefactor = Math.pow(2 / n, 1.5) * Math.sqrt(factorial(n - l - 1) / (2 * n * factorial(n + l)));
        return prefactor
            * Math.exp(-rho / 2)
            * Math.pow(rho, l)
            * generalizedLaguerre(n - l - 1, 2 * l + 1, rho);
    }

    function realSphericalHarmonic(l, m, theta, phi) {
        const order = Math.abs(m);
        const legendre = associatedLegendre(l, order, Math.cos(theta));
        const base = normalization(l, order) * legendre;

        if (m > 0) {
            return Math.SQRT2 * base * Math.cos(order * phi);
        }
        if (m < 0) {
            return Math.SQRT2 * base * Math.sin(order * phi);
        }
        return base;
    }

    function complexMagnitude(l, m, theta) {
        const order = Math.abs(m);
        const legendre = associatedLegendre(l, order, Math.cos(theta));
        return Math.abs(normalization(l, order) * legendre);
    }

    function sampleHarmonic(l, m, theta, phi, mode) {
        const order = Math.abs(m);
        const realValue = realSphericalHarmonic(l, m, theta, phi);
        const magnitude = complexMagnitude(l, m, theta);

        if (mode === 'abs') {
            return {
                magnitude,
                sign: 1,
                colorPhase: 1
            };
        }

        if (mode === 'prob') {
            return {
                magnitude: magnitude * magnitude,
                sign: 1,
                colorPhase: 1
            };
        }

        if (mode === 'phase') {
            const phaseValue = order === 0 ? 1 : Math.cos(order * phi);
            return {
                magnitude,
                sign: phaseValue >= 0 ? 1 : -1,
                colorPhase: phaseValue
            };
        }

        return {
            magnitude: Math.abs(realValue),
            sign: realValue >= 0 ? 1 : -1,
            colorPhase: realValue
        };
    }

    function orbitalFamily(l) {
        return `${orbitalLetters[l] || l} 軌道`;
    }

    function orbitalLabel(n, l) {
        return `${n}${orbitalLetters[l] || l} 軌道`;
    }

    function harmonicMarkup(l, m) {
        return `Y<sub>${l}</sub><sup>${m}</sup>(θ, φ)`;
    }

    function wavefunctionMarkup(n, l, m) {
        return `ψ<sub>${n}${l}${m}</sub>(r, θ, φ)`;
    }

    function targetLabel(target) {
        return target === 'full' ? '全波動関数 ψ' : '角度部分 Y';
    }

    function modeLabel(target, mode) {
        if (mode === 'abs') {
            return target === 'full' ? '振幅 |ψ|' : '振幅 |Y|';
        }
        if (mode === 'prob') {
            return target === 'full' ? '確率密度 |ψ|²' : '確率密度 |Y|²';
        }
        if (mode === 'phase') {
            return target === 'full' ? '位相帯 arg(ψ)' : '位相帯 arg(Y)';
        }
        return target === 'full' ? '実部 Re[ψ]' : '実部 Re[Y]';
    }

    function symmetryLabel(target, l, m, mode) {
        const order = Math.abs(m);
        if (l === 0 && m === 0) {
            return target === 'full' ? '球対称な殻構造' : '完全な球対称';
        }
        if (order === 0) {
            return 'z 軸まわりに回転対称';
        }
        if (mode === 'abs' || mode === 'prob') {
            return '位相を消すと z 軸対称';
        }
        return `φ 方向に ${2 * order} 本の帯`; 
    }

    function noteText(target, n, l, m, mode) {
        const order = Math.abs(m);
        const radialNodes = Math.max(0, n - l - 1);
        const family = orbitalLetters[l] || l;

        if (target === 'angular') {
            if (mode === 'prob') {
                return `確率密度モードでは符号が消えるので、${harmonicMarkup(l, m)} の正負ではなく、向きごとの出やすさだけが残ります。`;
            }
            if (mode === 'abs') {
                return `|Y| モードでは複素振幅の大きさだけを見るので、m ≠ 0 でも z 軸まわりに対称な包絡が見えます。`;
            }
            if (mode === 'phase') {
                return `位相モードでは形は |Y| で固定し、φ 方向の複素位相を青赤の帯で近似表示しています。|m| = ${order} なので帯の切り替わりが増えます。`;
            }
            if (l === 0) {
                return 'l = 0, m = 0 では完全な球対称になり、どの方向も同じ角度依存性になります。';
            }
            if (order === 0) {
                return `${family} 系で m = 0 なので、z 軸まわりの回転対称を保ったまま、極方向だけに節が入ります。`;
            }
            return `l = ${l} は角度節の総数、|m| = ${order} は方位角方向の分割の強さです。実部モードでは赤青のローブの境目が節として見えます。`;
        }

        if (mode === 'prob') {
            return `確率密度モードでは ${wavefunctionMarkup(n, l, m)} の符号が消え、半径方向の殻と角度方向の出やすさだけが雲として残ります。`;
        }
        if (mode === 'abs') {
            return `|ψ| モードでは半径方向と角度方向の振幅の大きさだけを見るので、殻構造は残りつつ符号は消えます。`;
        }
        if (mode === 'phase') {
            return `位相モードでは形は |ψ| で固定し、角度部分の位相帯を青赤で近似表示しています。半径節では R_nl の符号反転も色に反映されます。`;
        }
        if (radialNodes === 0) {
            return `n = ${n}, l = ${l} では半径方向の節はありません。角度方向のローブ形状が、そのまま 1 つの殻として広がります。`;
        }
        if (order === 0) {
            return `n = ${n}, l = ${l}, m = 0 なので、z 軸まわりの回転対称を保ったまま、半径方向に ${radialNodes} 本の節が入ります。`;
        }
        return `n = ${n}, l = ${l}, |m| = ${order} なので、半径方向の節は ${radialNodes} 本、角度節は ${l} 本です。全波動関数モードでは殻構造とローブの向きが同時に見えます。`;
    }

    function updateSummaryText() {
        const target = controls.targetSelect.value;
        let n = Number(controls.nRange.value);
        const l = Number(controls.lRange.value);
        let clampedL = l;
        if (clampedL > n - 1) {
            clampedL = n - 1;
        }
        controls.lRange.max = String(Math.max(0, n - 1));
        controls.lRange.value = String(clampedL);

        let m = Number(controls.mRange.value);
        const mode = controls.modeSelect.value;
        const order = Math.abs(m);
        const radialNodes = Math.max(0, n - clampedL - 1);

        controls.mRange.min = String(-clampedL);
        controls.mRange.max = String(clampedL);
        if (m < -clampedL) {
            m = -clampedL;
        }
        if (m > clampedL) {
            m = clampedL;
        }
        controls.mRange.value = String(m);

        controls.targetVal.textContent = targetLabel(target);
        controls.nVal.textContent = String(n);
        controls.lVal.textContent = String(clampedL);
        controls.mVal.textContent = String(m);
        controls.modeVal.textContent = modeLabel(target, mode);
        controls.ampVal.textContent = Number(controls.ampRange.value).toFixed(2);
        controls.resVal.textContent = controls.resRange.value;
        controls.mHelp.textContent = clampedL === 0 ? 'm は 0 のみ' : `m は -${clampedL} から ${clampedL}`;
        controls.currentFormula.innerHTML = target === 'full'
            ? `
                <span>${wavefunctionMarkup(n, clampedL, m)}</span>
                <span>現在は ${orbitalLabel(n, clampedL)} の全波動関数</span>
            `
            : `
                <span>${harmonicMarkup(clampedL, m)}</span>
                <span>現在は ${orbitalFamily(clampedL)} の角度分布</span>
            `;
        controls.stateNote.textContent = noteText(target, n, clampedL, m, mode);
        controls.nQuantValue.textContent = String(n);
        controls.familyValue.textContent = orbitalLabel(n, clampedL);
        controls.radialNodeValue.textContent = String(radialNodes);
        controls.nodeTotalValue.textContent = String(clampedL);
        controls.azimuthValue.textContent = String(order === 0 ? 0 : 2 * order);
        controls.totalNodeValue.textContent = String(Math.max(0, n - 1));
        controls.symmetryValue.textContent = symmetryLabel(target, clampedL, m, mode);
        controls.modeSummaryValue.textContent = mode === 'real'
            ? target === 'full' ? 'R × Y の実部を表示' : 'Y の実部を表示'
            : mode === 'abs'
                ? target === 'full' ? '振幅 |ψ| の大きさ' : '振幅 |Y| の大きさ'
                : mode === 'prob'
                    ? target === 'full' ? '観測確率 |ψ|² の分布' : '観測確率 |Y|² の角度分布'
                    : target === 'full' ? '角度位相と R の符号を表示' : '複素位相の帯';

        const matchingPreset = Object.entries(presets).find(([, preset]) => preset.target === target && preset.n === n && preset.l === clampedL && preset.m === m && preset.mode === mode);
        activePreset = matchingPreset ? matchingPreset[0] : '';
        controls.presetRow.querySelectorAll('.preset-chip').forEach((button) => {
            button.classList.toggle('is-active', button.dataset.preset === activePreset);
        });
    }

    function resizeCanvas() {
        const parentWidth = canvas.parentElement.clientWidth;
        const cssWidth = Math.min(parentWidth, 900);
        const mobile = window.innerWidth < 720;
        const cssHeight = mobile
            ? clamp(window.innerHeight * 0.48, 360, 520)
            : clamp(cssWidth * 0.74, 520, 680);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
        canvas.width = Math.round(cssWidth * dpr);
        canvas.height = Math.round(cssHeight * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        viewport = { width: cssWidth, height: cssHeight, dpr };
        requestRender();
    }

    function buildAngularSurface() {
        const l = Number(controls.lRange.value);
        const m = Number(controls.mRange.value);
        const mode = controls.modeSelect.value;
        const amplitude = Number(controls.ampRange.value);
        const resolution = Number(controls.resRange.value);
        const raw = [];
        let maxMagnitude = 0;

        for (let thetaIndex = 0; thetaIndex <= resolution; thetaIndex += 1) {
            const theta = Math.PI * thetaIndex / resolution;
            for (let phiIndex = 0; phiIndex < resolution * 2; phiIndex += 1) {
                const phi = 2 * Math.PI * phiIndex / (resolution * 2);
                const sample = sampleHarmonic(l, m, theta, phi, mode);
                maxMagnitude = Math.max(maxMagnitude, sample.magnitude);
                raw.push({ theta, phi, sample });
            }
        }

        maxMagnitude = maxMagnitude || 1;
        surfacePoints = raw.map(({ theta, phi, sample }) => {
            const normalized = sample.magnitude / maxMagnitude;
            const radius = 0.42 + amplitude * 0.34 * normalized;
            const sinTheta = Math.sin(theta);
            return {
                x: radius * sinTheta * Math.cos(phi),
                y: radius * Math.cos(theta),
                z: radius * sinTheta * Math.sin(phi),
                strength: normalized,
                sign: sample.sign,
                phase: sample.colorPhase
            };
        });

        surfaceDirty = false;
    }

    function buildFullWavefunction() {
        const n = Number(controls.nRange.value);
        const l = Number(controls.lRange.value);
        const m = Number(controls.mRange.value);
        const mode = controls.modeSelect.value;
        const amplitude = Number(controls.ampRange.value);
        const resolution = Number(controls.resRange.value);
        const thetaSteps = clamp(Math.round(resolution * 0.22), 12, 22);
        const phiSteps = thetaSteps * 2;
        const radialSteps = clamp(Math.round(resolution * 0.24), 12, 24);
        const radialExtent = Math.max(6, 2.2 * n * n);
        const raw = [];
        let maxMagnitude = 0;

        for (let radialIndex = 1; radialIndex <= radialSteps; radialIndex += 1) {
            const radius = radialExtent * radialIndex / radialSteps;
            const radialValue = radialHydrogen(n, l, radius);

            for (let thetaIndex = 0; thetaIndex <= thetaSteps; thetaIndex += 1) {
                const theta = Math.PI * thetaIndex / thetaSteps;
                for (let phiIndex = 0; phiIndex < phiSteps; phiIndex += 1) {
                    const phi = 2 * Math.PI * phiIndex / phiSteps;
                    const angularReal = realSphericalHarmonic(l, m, theta, phi);
                    const angularAbs = complexMagnitude(l, m, theta);
                    const phaseCore = Math.abs(m) === 0
                        ? 1
                        : (m < 0 ? Math.sin(Math.abs(m) * phi) : Math.cos(Math.abs(m) * phi));

                    let magnitude;
                    let sign;

                    if (mode === 'abs') {
                        magnitude = Math.abs(radialValue) * angularAbs;
                        sign = 1;
                    } else if (mode === 'prob') {
                        magnitude = Math.pow(Math.abs(radialValue) * angularAbs, 2);
                        sign = 1;
                    } else if (mode === 'phase') {
                        magnitude = Math.abs(radialValue) * angularAbs;
                        sign = radialValue * phaseCore >= 0 ? 1 : -1;
                    } else {
                        const value = radialValue * angularReal;
                        magnitude = Math.abs(value);
                        sign = value >= 0 ? 1 : -1;
                    }

                    maxMagnitude = Math.max(maxMagnitude, magnitude);
                    raw.push({ radius, theta, phi, magnitude, sign });
                }
            }
        }

        maxMagnitude = maxMagnitude || 1;
        const radialScale = 0.34 + amplitude * 0.34;
        const densityThreshold = mode === 'prob' ? 0.02 : 0.035;
        surfacePoints = raw.flatMap((entry, index) => {
            const normalized = entry.magnitude / maxMagnitude;
            const keepPoint = normalized >= densityThreshold
                || (normalized >= densityThreshold * 0.55 && index % 3 === 0);
            if (!keepPoint) {
                return [];
            }
            const displayRadius = (entry.radius / radialExtent) * radialScale;
            const sinTheta = Math.sin(entry.theta);
            return [{
                x: displayRadius * sinTheta * Math.cos(entry.phi),
                y: displayRadius * Math.cos(entry.theta),
                z: displayRadius * sinTheta * Math.sin(entry.phi),
                strength: normalized,
                sign: entry.sign,
                phase: entry.sign
            }];
        });

        surfaceDirty = false;
    }

    function rotatePoint(point) {
        const cosY = Math.cos(rotationY);
        const sinY = Math.sin(rotationY);
        const cosX = Math.cos(rotationX);
        const sinX = Math.sin(rotationX);

        const x1 = point.x * cosY + point.z * sinY;
        const z1 = -point.x * sinY + point.z * cosY;
        const y1 = point.y;
        const y2 = y1 * cosX - z1 * sinX;
        const z2 = y1 * sinX + z1 * cosX;

        return { x: x1, y: y2, z: z2 };
    }

    function drawBackground() {
        const gradient = ctx.createRadialGradient(
            viewport.width * 0.46,
            viewport.height * 0.26,
            24,
            viewport.width * 0.52,
            viewport.height * 0.54,
            Math.max(viewport.width, viewport.height)
        );
        gradient.addColorStop(0, '#16344d');
        gradient.addColorStop(1, '#07131e');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, viewport.width, viewport.height);

        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.lineWidth = 1;
        for (let radius = 0.22; radius <= 0.82; radius += 0.14) {
            ctx.beginPath();
            ctx.arc(viewport.width / 2, viewport.height / 2, Math.min(viewport.width, viewport.height) * radius * 0.48 * zoom, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawAxes(scale) {
        const axes = [
            { point: { x: 1.1, y: 0, z: 0 }, label: 'x' },
            { point: { x: 0, y: 1.1, z: 0 }, label: 'z' },
            { point: { x: 0, y: 0, z: 1.1 }, label: 'y' }
        ];

        ctx.save();
        ctx.translate(viewport.width / 2, viewport.height / 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.24)';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
        ctx.lineWidth = 1.2;
        ctx.font = `${viewport.width < 640 ? 12 : 14}px IBM Plex Sans JP`;

        for (const axis of axes) {
            const rotated = rotatePoint(axis.point);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(rotated.x * scale * 0.82, -rotated.y * scale * 0.82);
            ctx.stroke();
            ctx.fillText(axis.label, rotated.x * scale * 0.88, -rotated.y * scale * 0.88);
        }
        ctx.restore();
    }

    function drawSurface() {
        const target = controls.targetSelect.value;
        const scale = Math.min(viewport.width, viewport.height) * 0.46 * zoom;
        const projected = surfacePoints.map((point) => {
            const rotated = rotatePoint(point);
            const depth = 2.8 + rotated.z;
            const perspective = 1.45 / depth;
            return {
                x: viewport.width / 2 + rotated.x * scale * perspective,
                y: viewport.height / 2 - rotated.y * scale * perspective,
                z: rotated.z,
                size: target === 'full'
                    ? Math.max(0.9, 3.2 * perspective * zoom)
                    : Math.max(1.1, 4.1 * perspective * zoom),
                strength: point.strength,
                sign: point.sign,
                phase: point.phase
            };
        }).sort((left, right) => left.z - right.z);

        ctx.save();
        if (target === 'full') {
            ctx.globalCompositeOperation = 'screen';
        }
        for (const point of projected) {
            const alpha = target === 'full'
                ? 0.08 + 0.62 * point.strength
                : 0.18 + 0.78 * point.strength;
            const depthLight = Math.floor(120 + 110 * (point.z + 1.3) / 2.6);
            if (point.sign >= 0) {
                ctx.fillStyle = `rgba(${Math.min(130, depthLight)}, ${Math.min(190, depthLight + 28)}, 255, ${alpha})`;
            } else {
                ctx.fillStyle = `rgba(255, ${Math.min(150, depthLight)}, ${Math.min(185, depthLight)}, ${alpha})`;
            }
            ctx.beginPath();
            ctx.arc(point.x, point.y, point.size, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    function drawHud() {
        const target = controls.targetSelect.value;
        const n = Number(controls.nRange.value);
        const l = Number(controls.lRange.value);
        const m = Number(controls.mRange.value);
        ctx.save();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.86)';
        ctx.font = `${viewport.width < 640 ? 13 : 15}px IBM Plex Sans JP`;
        const headText = target === 'full'
            ? `psi(${n}, ${l}, ${m})   mode: ${modeLabel(target, controls.modeSelect.value)}`
            : `Y_${l}^${m}(θ, φ)   mode: ${modeLabel(target, controls.modeSelect.value)}`;
        ctx.fillText(headText, 20, 28);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.58)';
        ctx.font = `${viewport.width < 640 ? 11 : 12}px IBM Plex Sans JP`;
        ctx.fillText(target === 'full' ? 'drag to rotate / wheel to zoom / shells show R_nl' : 'drag to rotate / wheel to zoom / surface shows Y_lm', 20, 48);
        ctx.restore();
    }

    function render() {
        renderPending = false;
        if (surfaceDirty) {
            if (controls.targetSelect.value === 'full') {
                buildFullWavefunction();
            } else {
                buildAngularSurface();
            }
        }

        drawBackground();
        drawAxes(Math.min(viewport.width, viewport.height) * 0.46 * zoom);
        drawSurface();
        drawHud();
    }

    function requestRender() {
        if (renderPending) {
            return;
        }
        renderPending = true;
        requestAnimationFrame(render);
    }

    function markSurfaceDirty() {
        updateSummaryText();
        surfaceDirty = true;
        requestRender();
    }

    function applyPreset(name) {
        const preset = presets[name];
        if (!preset) {
            return;
        }

        activePreset = name;
        controls.targetSelect.value = preset.target;
        controls.nRange.value = String(preset.n);
        controls.lRange.value = String(preset.l);
        controls.mRange.min = String(-preset.l);
        controls.mRange.max = String(preset.l);
        controls.mRange.value = String(preset.m);
        controls.modeSelect.value = preset.mode;
        markSurfaceDirty();
    }

    function resetView() {
        rotationX = -0.56;
        rotationY = 0.82;
        zoom = 1;
        requestRender();
    }

    controls.presetRow.querySelectorAll('.preset-chip').forEach((button) => {
        button.addEventListener('click', () => {
            applyPreset(button.dataset.preset);
        });
    });

    [controls.targetSelect, controls.nRange, controls.lRange, controls.mRange, controls.modeSelect, controls.ampRange, controls.resRange].forEach((element) => {
        element.addEventListener('input', markSurfaceDirty);
        element.addEventListener('change', markSurfaceDirty);
    });

    controls.resetViewBtn.addEventListener('click', resetView);

    canvas.addEventListener('pointerdown', (event) => {
        pointerId = event.pointerId;
        lastPointerX = event.clientX;
        lastPointerY = event.clientY;
        canvas.setPointerCapture(pointerId);
    });

    canvas.addEventListener('pointermove', (event) => {
        if (pointerId !== event.pointerId) {
            return;
        }

        const deltaX = event.clientX - lastPointerX;
        const deltaY = event.clientY - lastPointerY;
        rotationY += deltaX * 0.008;
        rotationX = clamp(rotationX + deltaY * 0.008, -Math.PI / 2 + 0.08, Math.PI / 2 - 0.08);
        lastPointerX = event.clientX;
        lastPointerY = event.clientY;
        requestRender();
    });

    function clearPointer(event) {
        if (pointerId !== event.pointerId) {
            return;
        }
        canvas.releasePointerCapture(pointerId);
        pointerId = null;
    }

    canvas.addEventListener('pointerup', clearPointer);
    canvas.addEventListener('pointercancel', clearPointer);

    canvas.addEventListener('wheel', (event) => {
        event.preventDefault();
        zoom *= event.deltaY > 0 ? 0.92 : 1.08;
        zoom = clamp(zoom, 0.45, 2.4);
        requestRender();
    }, { passive: false });

    window.addEventListener('resize', resizeCanvas);

    applyPreset(activePreset);
    resizeCanvas();
})();