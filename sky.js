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

    const canvas = document.getElementById('skyCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });

    const elevationRange = document.getElementById('elevationRange');
    const thicknessRange = document.getElementById('thicknessRange');
    const particleRange = document.getElementById('particleRange');
    const elevationVal = document.getElementById('elevationVal');
    const thicknessVal = document.getElementById('thicknessVal');
    const particleVal = document.getElementById('particleVal');
    const statBlue = document.getElementById('statBlue');
    const statRed = document.getElementById('statRed');
    const statPath = document.getElementById('statPath');
    const swatchSky = document.getElementById('swatchSky');
    const swatchSun = document.getElementById('swatchSun');
    const narration = document.getElementById('demoNarration');
    const presetRow = document.getElementById('presetRow');

    const presets = {
        noon:    { elevation: 70, thickness: 100, particle: 0,   note: '太陽が高く大気を真っ直ぐ突き抜けるので、青の散乱光が天頂いっぱいに広がっています。' },
        evening: { elevation: 22, thickness: 130, particle: 5,   note: '太陽高度が下がり大気路長が伸びはじめ、青が削られて空の色味が浅くなります。' },
        sunset:  { elevation: 6,  thickness: 180, particle: 12,  note: '長い大気路で青〜緑が散らされ尽くし、残った長波長が地平線を赤橙に染めます。' },
        mars:    { elevation: 28, thickness: 220, particle: 78,  note: '酸化鉄ダストが青を吸収・前方散乱。空全体は赤茶色、太陽周辺だけが青く見えます。' }
    };

    let activePreset = 'noon';

    // wavelengths (nm) for R, G, B
    const wavelengths = [650, 550, 450];

    function computeColors(elevationDeg, thickness, particleMix, marsLike) {
        // path length factor: 1/sin(elev), capped
        const elev = Math.max(elevationDeg, 1) * Math.PI / 180;
        const path = Math.min(thickness * (1 / Math.sin(elev)), 16);

        // particleMix 0..1 => exponent from 4 (Rayleigh) to 0.5 (Mie-ish)
        const exponent = 4 - 3.5 * particleMix;
        // base coefficient tuned so noon looks right
        const base = 0.0042;

        const ref = Math.pow(550, exponent);
        const tau = wavelengths.map((lam) => base * path * (ref / Math.pow(lam, exponent)));

        // Transmission T = exp(-tau)
        const T = tau.map((t) => Math.exp(-t));
        // Scattered fraction (single-scatter approximation)
        const S = T.map((t) => 1 - t);

        // Mars-like: add iron-oxide absorption preferentially on blue/green (multiply scattered by absorption tint)
        let absorb = [1, 1, 1];
        if (marsLike > 0) {
            absorb = [
                1 - 0.05 * marsLike,
                1 - 0.45 * marsLike,
                1 - 0.78 * marsLike
            ];
        }

        // Sky color = scattered light, weighted by source spectrum (slight blue boost minus violet)
        const source = [1.00, 1.05, 1.00];
        const scattered = S.map((s, i) => s * source[i] * absorb[i]);
        const transmitted = T.map((t, i) => t * source[i]);

        // Brightness scales with solar elevation: high sun → bright sky, low sun → dim
        const sinE = Math.sin(Math.max(elevationDeg, 0.5) * Math.PI / 180);
        const brightness = 0.18 + 0.82 * Math.pow(sinE, 0.55);

        // Hue from normalized scattered spectrum, then scaled by brightness
        const skyMax = Math.max(...scattered, 0.001);
        const skyHue = scattered.map((c) => c / skyMax);
        const skyNorm = skyHue.map((c) => Math.min(1, c * brightness));

        // Sun color preserves relative levels
        const sunMax = Math.max(...transmitted, 0.001);
        const sunNorm = transmitted.map((c) => Math.min(1, c / Math.max(sunMax, 0.4)));

        return {
            sky: skyNorm,
            sun: sunNorm,
            tau,
            T,
            S,
            path
        };
    }

    function rgbCss(arr, gamma = 1) {
        const g = (v) => Math.round(Math.pow(Math.max(0, Math.min(1, v)), 1 / gamma) * 255);
        return `rgb(${g(arr[0])}, ${g(arr[1])}, ${g(arr[2])})`;
    }

    function lerp(a, b, t) { return a + (b - a) * t; }

    function drawScene(elevationDeg, thickness, particleMix, marsLike) {
        const W = canvas.width;
        const H = canvas.height;

        const { sky, sun, T, S, path } = computeColors(elevationDeg, thickness, particleMix, marsLike);

        // Sky gradient: zenith deeper, horizon warmer (use sky as base, mix sun/red toward horizon)
        const horizon = [
            lerp(sky[0], 1.0, 0.55) * lerp(1, sun[0], 0.4),
            lerp(sky[1], 0.7, 0.45) * lerp(1, sun[1], 0.4),
            lerp(sky[2], 0.4, 0.35) * lerp(1, sun[2], 0.4)
        ];

        const gradient = ctx.createLinearGradient(0, 0, 0, H);
        gradient.addColorStop(0, rgbCss(sky.map((c) => c * 0.85), 1));
        gradient.addColorStop(0.55, rgbCss(sky, 1));
        gradient.addColorStop(1.0, rgbCss(horizon, 1));
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, W, H);

        // Ground
        const groundTop = H * 0.78;
        const groundGrad = ctx.createLinearGradient(0, groundTop, 0, H);
        groundGrad.addColorStop(0, 'rgba(8, 14, 28, 0.92)');
        groundGrad.addColorStop(1, 'rgba(2, 4, 10, 1)');
        ctx.fillStyle = groundGrad;
        ctx.fillRect(0, groundTop, W, H - groundTop);

        // Sun position: elevation 0..90 maps from horizon to high
        const sunX = W * 0.78;
        const sunY = groundTop - (groundTop * 0.85) * (elevationDeg / 90);
        const sunRadius = 38;

        // Sun glow
        const glow = ctx.createRadialGradient(sunX, sunY, sunRadius * 0.4, sunX, sunY, sunRadius * 4);
        glow.addColorStop(0, `${rgbCss(sun, 1).replace('rgb', 'rgba').replace(')', ', 0.55)')}`);
        glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, W, H);

        // Sun disk
        ctx.beginPath();
        ctx.arc(sunX, sunY, sunRadius, 0, Math.PI * 2);
        ctx.fillStyle = rgbCss(sun.map((c) => Math.min(1, c * 1.1 + 0.05)), 1);
        ctx.fill();

        // Photon rays from sun toward observer through atmosphere
        const observerX = W * 0.16;
        const observerY = groundTop - 12;

        const rayCount = 7;
        for (let i = 0; i < rayCount; i++) {
            const t = (i + 0.5) / rayCount;
            const startY = lerp(20, groundTop - 40, t);
            const startX = W - 8;
            ctx.strokeStyle = `rgba(255, 244, 210, ${0.16 + 0.18 * (1 - t)})`;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(0, startY + (groundTop - startY) * 0.2);
            ctx.stroke();
        }

        // Scattered photons (stochastic dots colored by sky)
        const photonCount = Math.floor(60 + 110 * (1 - Math.exp(-path * 0.18)));
        for (let i = 0; i < photonCount; i++) {
            const px = Math.random() * W;
            const py = Math.random() * groundTop;
            const tint = [
                lerp(sky[0], 1, 0.3) + (Math.random() - 0.5) * 0.1,
                lerp(sky[1], 1, 0.3) + (Math.random() - 0.5) * 0.1,
                lerp(sky[2], 1, 0.3) + (Math.random() - 0.5) * 0.1
            ];
            const alpha = 0.15 + Math.random() * 0.35;
            ctx.fillStyle = `${rgbCss(tint, 1).replace('rgb', 'rgba').replace(')', `, ${alpha})`)}`;
            const r = Math.random() * 1.6 + 0.5;
            ctx.beginPath();
            ctx.arc(px, py, r, 0, Math.PI * 2);
            ctx.fill();
        }

        // Atmosphere band guide
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, groundTop);
        ctx.lineTo(W, groundTop);
        ctx.stroke();

        // Observer marker
        ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
        ctx.beginPath();
        ctx.arc(observerX, observerY, 4, 0, Math.PI * 2);
        ctx.fill();

        // Update DOM swatches
        const skyCss = rgbCss(sky, 1);
        const sunCss = rgbCss(sun.map((c) => Math.min(1, c * 1.05 + 0.05)), 1);
        if (swatchSky) swatchSky.style.background = skyCss;
        if (swatchSun) swatchSun.style.background = sunCss;

        statBlue.textContent = S[2].toFixed(2);
        statRed.textContent = S[0].toFixed(2);
        statPath.textContent = `${(path / 100).toFixed(2)} ×`;
    }

    function updateLabels(elev, thick, particle) {
        elevationVal.textContent = `${elev}°`;
        thicknessVal.textContent = `${(thick / 100).toFixed(2)}×`;
        const mix = particle / 100;
        let label = 'レイリー';
        if (mix > 0.7) label = 'ダスト（ミー）';
        else if (mix > 0.35) label = '混合';
        else if (mix > 0.05) label = 'やや大粒';
        particleVal.textContent = label;
    }

    function render() {
        const elev = parseFloat(elevationRange.value);
        const thick = parseFloat(thicknessRange.value);
        const particle = parseFloat(particleRange.value);
        const particleMix = particle / 100;
        const marsLike = activePreset === 'mars' ? Math.min(1, particleMix * 1.1) : Math.max(0, particleMix - 0.55) * 0.6;
        updateLabels(elev, thick, particle);
        drawScene(elev, thick, particleMix, marsLike);
    }

    function applyPreset(key) {
        const p = presets[key];
        if (!p) return;
        activePreset = key;
        elevationRange.value = p.elevation;
        thicknessRange.value = p.thickness;
        particleRange.value = p.particle;
        narration.textContent = p.note;
        presetRow.querySelectorAll('.preset-chip').forEach((chip) => {
            chip.classList.toggle('is-active', chip.dataset.preset === key);
        });
        render();
    }

    presetRow.addEventListener('click', (e) => {
        const target = e.target.closest('[data-preset]');
        if (target) applyPreset(target.dataset.preset);
    });

    [elevationRange, thicknessRange, particleRange].forEach((el) => {
        el.addEventListener('input', () => {
            presetRow.querySelectorAll('.preset-chip').forEach((chip) => chip.classList.remove('is-active'));
            render();
        });
    });

    applyPreset('noon');
})();
