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

    const canvas = document.getElementById('nuclearCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const rodRange = document.getElementById('rodRange');
    const coolantRange = document.getElementById('coolantRange');
    const rodVal = document.getElementById('rodVal');
    const coolantVal = document.getElementById('coolantVal');
    const statTemp = document.getElementById('statTemp');
    const statNeutrons = document.getElementById('statNeutrons');
    const statPower = document.getElementById('statPower');
    const statReactivity = document.getElementById('statReactivity');
    const statSteam = document.getElementById('statSteam');
    const statDecay = document.getElementById('statDecay');
    const statWater = document.getElementById('statWater');
    const statDamage = document.getElementById('statDamage');
    const statHydrogen = document.getElementById('statHydrogen');
    const statStatus = document.getElementById('statStatus');
    const narration = document.getElementById('demoNarration');
    const eventNarration = document.getElementById('eventNarration');
    const presetRow = document.getElementById('presetRow');
    const eventRow = document.getElementById('eventRow');

    const presets = {
        low: {
            rod: 0.72,
            coolant: 0.88,
            note: '制御棒が深く入ると中性子が吸収され、核分裂の回数が減って低出力側へ寄ります。'
        },
        stable: {
            rod: 0.30,
            coolant: 0.86,
            note: '制御棒と冷却のバランスがとれていると、炉心温度と蒸気量が安定し、タービンの回転も落ち着きます。'
        },
        hot: {
            rod: 0.10,
            coolant: 0.55,
            note: '制御棒が浅く、冷却も弱いと反応と温度が上がりやすくなります。高出力側ですが余裕は小さくなります。'
        }
    };

    const tau = Math.PI * 2;
    const maxNeutrons = 500;

    let neutrons = [];
    let steam = [];
    let flashes = [];
    let angle = 0;
    let temperature = 260;
    let power = 0;
    let viewport = { width: 900, height: 560, dpr: 1 };
    let accident = createAccidentState();
    let latestMetrics = {
        rod: 0.35,
        coolant: 0.9,
        reactivity: 0.64,
        steamCount: 0,
        decayHeat: 0,
        waterLevel: 1,
        fuelDamage: 0,
        hydrogen: 0,
        scram: false,
        coolantLoss: false,
        eccs: false,
        status: 'stable',
        statusLabel: '安定運転中',
        fissions: 0,
        neutronCount: 25,
        temperature: 260,
        electricOutput: 0
    };

    function createAccidentState() {
        return {
            scram: false,
            coolantLoss: false,
            eccs: false,
            decayHeat: 0,
            waterLevel: 1,
            fuelDamage: 0,
            hydrogen: 0
        };
    }

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

    function resizeCanvas() {
        const parentWidth = canvas.parentElement.clientWidth;
        const cssWidth = Math.min(parentWidth, 900);
        const mobile = window.innerWidth < 720;
        const cssHeight = mobile
            ? clamp(window.innerHeight * 0.55, 390, 540)
            : clamp(cssWidth * 0.62, 500, 560);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
        canvas.width = Math.round(cssWidth * dpr);
        canvas.height = Math.round(cssHeight * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        viewport = { width: cssWidth, height: cssHeight, dpr };

        resetSimulation();
    }

    function getLayout() {
        const width = viewport.width;
        const height = viewport.height;
        const diagramOffsetY = clamp(height * 0.1, 40, 56);
        return {
            containment: {
                x: width * 0.05,
                y: height * 0.12 + diagramOffsetY,
                w: width * 0.32,
                h: height * 0.7
            },
            core: {
                x: width * 0.11,
                y: height * 0.2 + diagramOffsetY,
                w: width * 0.2,
                h: height * 0.5
            },
            steamGen: {
                x: width * 0.44,
                y: height * 0.24 + diagramOffsetY,
                w: width * 0.14,
                h: height * 0.38
            },
            turbine: {
                x: width * 0.77,
                y: height * 0.44 + diagramOffsetY,
                r: Math.min(width, height) * 0.08
            },
            generator: {
                x: width * 0.86,
                y: height * 0.38 + diagramOffsetY,
                w: width * 0.1,
                h: height * 0.12
            },
            condenser: {
                x: width * 0.61,
                y: height * 0.72 + diagramOffsetY,
                w: width * 0.2,
                h: height * 0.12
            }
        };
    }

    function addNeutron(x, y, vx = rand(-2.2, 2.2), vy = rand(-2.2, 2.2)) {
        neutrons.push({ x, y, vx, vy, life: 160 });
    }

    function computeTargets(rod, coolant, waterLevel = 1, scram = false) {
        const coolingFactor = clamp((coolant - 0.2) / 1.3, 0, 1);
        const moderation = clamp(0.35 + waterLevel * 0.65, 0.18, 1);
        let reactivity = clamp((1 - rod) * 1.05 - coolingFactor * 0.25, 0.02, 1.02) * moderation;
        if (scram) {
            reactivity = Math.min(reactivity, 0.03);
        }
        const targetNeutrons = Math.round(clamp(12 + reactivity * 190 - rod * 18, scram ? 3 : 10, 230));
        const chainTemp = clamp(90 + reactivity * 650 - coolingFactor * 120, 80, 760);
        const targetSteam = Math.round(clamp(Math.max(0, chainTemp - 220) * 0.46 * (0.65 + coolingFactor * 0.35), 0, 220));
        return {
            coolingFactor,
            reactivity,
            targetNeutrons,
            chainTemp,
            targetSteam
        };
    }

    function syncEventButtons() {
        if (!eventRow) return;
        const eventStateMap = {
            scram: 'scram',
            loca: 'coolantLoss',
            eccs: 'eccs'
        };
        eventRow.querySelectorAll('[data-event]').forEach((button) => {
            const eventKey = button.dataset.event;
            const active = eventKey !== 'reset' && Boolean(accident[eventStateMap[eventKey]]);
            button.classList.toggle('is-active', active);
        });
    }

    function resetAccidentState() {
        accident = createAccidentState();
        syncEventButtons();
    }

    function resetSimulation() {
        const layout = getLayout();
        const rod = parseFloat(rodRange.value);
        const coolant = parseFloat(coolantRange.value);
        const effectiveRod = accident.scram ? Math.max(rod, 0.98) : rod;
        let effectiveCoolant = coolant;
        if (accident.coolantLoss) {
            effectiveCoolant = coolant * accident.waterLevel * 0.18;
        }
        if (accident.eccs) {
            effectiveCoolant += 0.42 + accident.waterLevel * 0.12;
        }
        effectiveCoolant = clamp(effectiveCoolant, 0.02, 1.5);
        const targets = computeTargets(effectiveRod, effectiveCoolant, accident.waterLevel, accident.scram);
        neutrons = [];
        steam = [];
        flashes = [];
        angle = 0;
        temperature = clamp((targets.chainTemp + accident.decayHeat * 900 + accident.fuelDamage * 14) * 0.92, 80, 3200);
        power = clamp(targets.targetSteam / 130, 0, 1);

        for (let index = 0; index < Math.round(targets.targetNeutrons * 0.55); index += 1) {
            addNeutron(
                rand(layout.core.x + 18, layout.core.x + layout.core.w - 18),
                rand(layout.core.y + 18, layout.core.y + layout.core.h - 18)
            );
        }
    }

    function updateControlLabels() {
        rodVal.textContent = parseFloat(rodRange.value).toFixed(2);
        coolantVal.textContent = parseFloat(coolantRange.value).toFixed(2);
    }

    function setStatus(label, state) {
        statStatus.textContent = label;
        statStatus.dataset.state = state;
    }

    function updateStats(metrics) {
        statTemp.textContent = `${Math.round(metrics.temperature)} ℃`;
        statNeutrons.textContent = `${metrics.neutronCount}`;
        statPower.textContent = `${Math.round(metrics.electricOutput * 100)} %`;
        statReactivity.textContent = metrics.reactivity.toFixed(2);
        statSteam.textContent = `${metrics.steamCount}`;
        statDecay.textContent = `${(metrics.decayHeat * 100).toFixed(1)} %`;
        statWater.textContent = `${Math.round(metrics.waterLevel * 100)} %`;
        statDamage.textContent = `${Math.round(metrics.fuelDamage)} %`;
        statHydrogen.textContent = `${Math.round(metrics.hydrogen)} %`;
        setStatus(metrics.statusLabel, metrics.status);
    }

    function describeMetrics(metrics) {
        if (metrics.fuelDamage >= 95) {
            return '冷却喪失が続き、SCRAM 後も残る崩壊熱を除去できず、燃料が溶融しました。高温のコリウムと水素蓄積を伴う重大事故状態です。';
        }
        if (metrics.fuelDamage >= 55) {
            return '水位低下で燃料棒が露出し、崩壊熱と被覆管反応で炉心損傷が進んでいます。ECCS 注水で冷却を戻さないと融解へ進みます。';
        }
        if (metrics.scram && metrics.coolantLoss && metrics.eccs) {
            return 'SCRAM 後の崩壊熱に対して ECCS が注水し、水位と冷却を回復させています。事故時はこの回復の速さが炉心損傷を左右します。';
        }
        if (metrics.scram && metrics.coolantLoss) {
            return '連鎖反応は止まりましたが、崩壊熱は残っています。冷却喪失が続くと水位が下がり、やがて炉心損傷へ進みます。';
        }
        if (metrics.scram) {
            return 'SCRAM で連鎖反応は止まりました。ここから重要なのは「止めること」ではなく、崩壊熱を冷やし続けることです。';
        }
        if (metrics.status === 'alert') {
            return '炉心温度が高く、反応と冷却の余裕が小さくなっています。制御棒を深く入れるか、冷却を強める方向が必要です。';
        }
        if (metrics.status === 'low') {
            return '制御棒が深いか反応度が小さく、核分裂が十分に続いていません。蒸気量も少なく、電気出力は低めです。';
        }
        if (metrics.reactivity > 0.75 && metrics.temperature > 420) {
            return '核分裂が活発で、炉心から蒸気発生器へ熱がしっかり送られています。制御棒と冷却の均衡を保つことが重要です。';
        }
        return '一次冷却材が炉心から熱を運び、蒸気がタービンを回すという基本の鎖が安定して見える状態です。';
    }

    function describeEvent(metrics) {
        if (metrics.fuelDamage >= 95) {
            return '炉心融解イベント: 崩壊熱除去に失敗し、燃料が溶けて下部へ落ち込んでいます。格納容器は最後の防護壁として残ります。';
        }
        if (metrics.fuelDamage >= 55) {
            return '炉心融解直前: 水位低下で燃料露出が進み、水素蓄積も増えています。ECCS が遅れると損傷が自己加速します。';
        }
        if (metrics.scram && metrics.coolantLoss && metrics.eccs) {
            return 'ECCS 注水中: 連鎖反応停止後も残る崩壊熱に対して、水位回復と除熱を同時に進めています。';
        }
        if (metrics.scram && metrics.coolantLoss) {
            return '典型事故シナリオ: SCRAM で連鎖反応は止まりましたが、崩壊熱が残り、冷却喪失で水位が下がっています。';
        }
        if (metrics.scram) {
            return 'SCRAM 後: 定格出力の数 % 程度の崩壊熱が残るため、停止しても冷却は続ける必要があります。';
        }
        if (metrics.eccs) {
            return 'ECCS 待機中: 非常用炉心冷却系は、水位回復と崩壊熱除去の両方を支える事故対応の要です。';
        }
        return '事故イベントを押すと、SCRAM 後の崩壊熱、冷却喪失、水位低下、水素蓄積、炉心損傷の流れを簡略モデルで追えます。';
    }

    function updateSimulation() {
        const layout = getLayout();
        const rod = parseFloat(rodRange.value);
        const coolant = parseFloat(coolantRange.value);

        if (accident.scram) {
            const scramDecayBase = 0.07 + latestMetrics.electricOutput * 0.04;
            accident.decayHeat = Math.max(accident.decayHeat, scramDecayBase);
            accident.decayHeat = Math.max(0.018, accident.decayHeat * 0.9992 - 0.00002);
        } else {
            accident.decayHeat = lerp(accident.decayHeat, 0, 0.06);
        }

        if (accident.coolantLoss) {
            const drain = accident.eccs ? 0.0007 : 0.0018 + accident.decayHeat * 0.006;
            const refill = accident.eccs ? 0.0016 : 0;
            accident.waterLevel = clamp(accident.waterLevel - drain + refill, 0, 1);
        } else {
            accident.waterLevel = clamp(accident.waterLevel + (accident.eccs ? 0.006 : 0.002), 0, 1);
        }

        const effectiveRod = accident.scram ? Math.max(rod, 0.98) : rod;
        let effectiveCoolant = coolant;
        if (accident.coolantLoss) {
            effectiveCoolant = coolant * accident.waterLevel * 0.18;
        }
        if (accident.eccs) {
            effectiveCoolant += 0.42 + accident.waterLevel * 0.12;
        }
        effectiveCoolant = clamp(effectiveCoolant, 0.02, 1.5);

        const targets = computeTargets(effectiveRod, effectiveCoolant, accident.waterLevel, accident.scram);

        updateControlLabels();

        const neutronDiff = targets.targetNeutrons - neutrons.length;
        if (neutronDiff > 0) {
            const toAdd = Math.max(1, Math.round(neutronDiff * 0.08));
            for (let index = 0; index < toAdd; index += 1) {
                addNeutron(
                    rand(layout.core.x + 18, layout.core.x + layout.core.w - 18),
                    rand(layout.core.y + 18, layout.core.y + layout.core.h - 18)
                );
            }
        } else if (neutronDiff < 0) {
            neutrons.splice(0, Math.min(Math.round(Math.abs(neutronDiff) * 0.08), neutrons.length));
        }

        for (const neutron of neutrons) {
            neutron.x += neutron.vx;
            neutron.y += neutron.vy;
            neutron.life -= 1;
            neutron.vx += rand(-0.08, 0.08);
            neutron.vy += rand(-0.08, 0.08);
            neutron.vx = clamp(neutron.vx, -2.6, 2.6);
            neutron.vy = clamp(neutron.vy, -2.6, 2.6);

            if (neutron.x < layout.core.x + 6 || neutron.x > layout.core.x + layout.core.w - 6) {
                neutron.vx *= -1;
                neutron.x = clamp(neutron.x, layout.core.x + 6, layout.core.x + layout.core.w - 6);
            }
            if (neutron.y < layout.core.y + 6 || neutron.y > layout.core.y + layout.core.h - 6) {
                neutron.vy *= -1;
                neutron.y = clamp(neutron.y, layout.core.y + 6, layout.core.y + layout.core.h - 6);
            }

            if (neutron.life < 1) {
                neutron.life = rand(140, 220);
                neutron.x = rand(layout.core.x + 18, layout.core.x + layout.core.w - 18);
                neutron.y = rand(layout.core.y + 18, layout.core.y + layout.core.h - 18);
            }
        }

        const fissions = Math.round(targets.targetNeutrons * (0.01 + targets.reactivity * 0.018) * rand(0.82, 1.18));
        for (let index = 0; index < Math.min(fissions, 7); index += 1) {
            const source = neutrons[Math.floor(Math.random() * neutrons.length)];
            if (source) {
                flashes.push({ x: source.x, y: source.y, radius: rand(8, 18), life: 1 });
            }
        }

        const inadequateCooling = Math.max(0, accident.decayHeat * 1.25 - effectiveCoolant * 0.12);
        if (accident.scram && accident.coolantLoss) {
            const damageDriver = inadequateCooling * (0.35 + (1 - accident.waterLevel) * 1.8);
            const damageCooling = accident.eccs ? 0.1 : 0.01;
            accident.fuelDamage = clamp(accident.fuelDamage + damageDriver * (accident.eccs ? 0.22 : 2.2) - damageCooling, 0, 100);
        } else {
            accident.fuelDamage = clamp(accident.fuelDamage - (accident.eccs ? 0.12 : 0.04), 0, 100);
        }

        if (accident.fuelDamage > 12 && accident.waterLevel < 0.72) {
            const hydrogenDriver = (1 - accident.waterLevel) * (accident.fuelDamage / 100) * 0.26;
            accident.hydrogen = clamp(accident.hydrogen + hydrogenDriver - (accident.eccs ? 0.05 : 0.01), 0, 100);
        } else {
            accident.hydrogen = clamp(accident.hydrogen - (accident.eccs ? 0.05 : 0.01), 0, 100);
        }

        const accidentHeat = accident.decayHeat * (950 + (1 - effectiveCoolant) * 1200 + (1 - accident.waterLevel) * 900);
        const damageHeat = accident.fuelDamage * 16;
        const targetTemperature = clamp(targets.chainTemp + accidentHeat + damageHeat, 80, 3200);
        temperature = lerp(temperature, targetTemperature, accident.scram ? 0.03 : 0.04);
        temperature = clamp(temperature, 80, 3200);

        const steamPotential = clamp(targets.targetSteam / 130, 0, 1);
        power = clamp(steamPotential * (1 - accident.fuelDamage / 100) * (accident.coolantLoss ? accident.waterLevel * 1.2 : 1), 0, 1);
        angle += power * 0.25 + 0.01;

        const steamDiff = targets.targetSteam - steam.length;
        if (steamDiff > 0) {
            const steamToAdd = Math.max(1, Math.round(steamDiff * 0.08));
            for (let index = 0; index < steamToAdd; index += 1) {
                steam.push({
                    x: layout.steamGen.x + layout.steamGen.w * 0.35 + Math.random() * layout.steamGen.w * 0.24,
                    y: layout.steamGen.y + layout.steamGen.h * 0.42 + Math.random() * layout.steamGen.h * 0.22,
                    vx: rand(1.5, 3.5),
                    vy: rand(-0.45, 0.45),
                    life: 120
                });
            }
        } else if (steamDiff < 0) {
            for (let index = 0; index < Math.min(Math.round(Math.abs(steamDiff) * 0.08), steam.length); index += 1) {
                steam[index].life = Math.min(steam[index].life, 8);
            }
        }

        for (const particle of steam) {
            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.life -= 1;
        }
        steam = steam.filter((particle) => particle.life > 0 && particle.x < viewport.width * 0.82);

        for (const flash of flashes) {
            flash.life -= 0.08;
            flash.radius += 0.7;
        }
        flashes = flashes.filter((flash) => flash.life > 0);

        if (neutrons.length > maxNeutrons) {
            neutrons = neutrons.slice(neutrons.length - maxNeutrons);
        }

        let status = 'stable';
        let statusLabel = '安定運転中';
        if (accident.fuelDamage >= 95) {
            status = 'melt';
            statusLabel = '炉心融解';
        } else if (accident.fuelDamage >= 55) {
            status = 'damage';
            statusLabel = '炉心損傷';
        } else if (accident.scram && accident.coolantLoss && accident.waterLevel < 0.45) {
            status = 'decay';
            statusLabel = '崩壊熱で加熱中';
        } else if (accident.scram) {
            status = 'recovery';
            statusLabel = 'SCRAM後の冷却';
        } else if (temperature > 650) {
            status = 'alert';
            statusLabel = '温度が高すぎます';
        } else if (power < 0.15) {
            status = 'low';
            statusLabel = '低出力状態';
        }

        latestMetrics = {
            rod: effectiveRod,
            coolant: effectiveCoolant,
            reactivity: targets.reactivity,
            steamCount: steam.length,
            decayHeat: accident.decayHeat,
            waterLevel: accident.waterLevel,
            fuelDamage: accident.fuelDamage,
            hydrogen: accident.hydrogen,
            scram: accident.scram,
            coolantLoss: accident.coolantLoss,
            eccs: accident.eccs,
            status,
            statusLabel,
            fissions,
            neutronCount: neutrons.length,
            temperature,
            electricOutput: power
        };

        narration.textContent = describeMetrics(latestMetrics);
        eventNarration.textContent = describeEvent(latestMetrics);
        updateStats(latestMetrics);
    }

    function drawArrow(x1, y1, x2, y2, color, width = 3, headSize = 10) {
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        const angleArrow = Math.atan2(y2 - y1, x2 - x1);
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - headSize * Math.cos(angleArrow - 0.48), y2 - headSize * Math.sin(angleArrow - 0.48));
        ctx.lineTo(x2 - headSize * Math.cos(angleArrow + 0.48), y2 - headSize * Math.sin(angleArrow + 0.48));
        ctx.closePath();
        ctx.fill();
    }

    function drawScene() {
        const width = viewport.width;
        const height = viewport.height;
        const layout = getLayout();
        const metrics = latestMetrics;
        const rodDepth = layout.core.h * 0.84 * metrics.rod;

        ctx.clearRect(0, 0, width, height);

        const background = ctx.createLinearGradient(0, 0, 0, height);
        background.addColorStop(0, '#111822');
        background.addColorStop(1, '#091017');
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
        for (let x = 0; x < width; x += 28) {
            ctx.fillRect(x, 0, 1, height);
        }

        ctx.fillStyle = '#f6fbff';
        ctx.font = '700 26px IBM Plex Sans JP';
        if (metrics.status === 'melt') {
            ctx.fillStyle = '#ff786a';
            ctx.fillText('炉心融解', 34, 36);
        } else if (metrics.status === 'damage') {
            ctx.fillStyle = '#ff9b70';
            ctx.fillText('炉心損傷が進行中', 34, 36);
        } else if (metrics.status === 'decay') {
            ctx.fillStyle = '#ffbc79';
            ctx.fillText('崩壊熱を除去できていません', 34, 36);
        } else if (metrics.status === 'recovery') {
            ctx.fillStyle = '#8fd8ff';
            ctx.fillText('SCRAM後の崩壊熱冷却', 34, 36);
        } else if (metrics.status === 'alert') {
            ctx.fillStyle = '#ff8c82';
            ctx.fillText('注意: 温度が高すぎます', 34, 36);
        } else if (metrics.status === 'low') {
            ctx.fillStyle = '#9bc5ec';
            ctx.fillText('低出力状態', 34, 36);
        } else {
            ctx.fillStyle = '#8ff0c8';
            ctx.fillText('安定運転中', 34, 36);
        }

        ctx.fillStyle = 'rgba(246, 251, 255, 0.84)';
        ctx.font = '16px IBM Plex Sans JP';
        if (metrics.scram || metrics.coolantLoss || metrics.eccs || metrics.fuelDamage > 0) {
            ctx.fillText(`崩壊熱 ${(metrics.decayHeat * 100).toFixed(1)} % / 水位 ${Math.round(metrics.waterLevel * 100)} % / 水素 ${Math.round(metrics.hydrogen)} %`, 34, 64);
        } else {
            ctx.fillText(`反応度 ${metrics.reactivity.toFixed(2)} / 冷却 ${metrics.coolant.toFixed(2)} / 出力 ${Math.round(metrics.electricOutput * 100)} %`, 34, 64);
        }

        ctx.strokeStyle = '#a8b7c6';
        ctx.lineWidth = 4;
        roundedRectPath(layout.containment.x, layout.containment.y, layout.containment.w, layout.containment.h, 34);
        ctx.stroke();

        const innerContainmentX = layout.containment.x + 18;
        const innerContainmentY = layout.containment.y + 24;
        const innerContainmentW = layout.containment.w - 36;
        const innerContainmentH = layout.containment.h - 48;

        ctx.fillStyle = 'rgba(114, 184, 255, 0.04)';
        roundedRectPath(innerContainmentX, innerContainmentY, innerContainmentW, innerContainmentH, 26);
        ctx.fill();

        ctx.save();
        roundedRectPath(innerContainmentX, innerContainmentY, innerContainmentW, innerContainmentH, 26);
        ctx.clip();
        const waterHeight = innerContainmentH * clamp(metrics.waterLevel, 0, 1);
        ctx.fillStyle = 'rgba(114, 184, 255, 0.16)';
        ctx.fillRect(innerContainmentX, innerContainmentY + innerContainmentH - waterHeight, innerContainmentW, waterHeight);
        if (metrics.hydrogen > 3) {
            ctx.fillStyle = `rgba(243, 194, 125, ${0.04 + metrics.hydrogen / 1400})`;
            ctx.fillRect(innerContainmentX, innerContainmentY, innerContainmentW, innerContainmentH * 0.4);
        }
        ctx.restore();

        ctx.fillStyle = '#f6fbff';
        ctx.font = '16px IBM Plex Sans JP';
        ctx.fillText('原子炉格納容器', layout.containment.x + 54, layout.containment.y - 8);

        const damageRatio = clamp(metrics.fuelDamage / 100, 0, 1);
        const coreGradient = ctx.createLinearGradient(layout.core.x, layout.core.y, layout.core.x, layout.core.y + layout.core.h);
        coreGradient.addColorStop(0, `rgba(${Math.round(49 + damageRatio * 86)}, ${Math.round(59 - damageRatio * 18)}, ${Math.round(75 - damageRatio * 42)}, 1)`);
        coreGradient.addColorStop(1, `rgba(${Math.round(33 + damageRatio * 160)}, ${Math.round(43 - damageRatio * 12)}, ${Math.round(55 - damageRatio * 36)}, 1)`);
        ctx.fillStyle = coreGradient;
        roundedRectPath(layout.core.x, layout.core.y, layout.core.w, layout.core.h, 16);
        ctx.fill();
        ctx.fillStyle = '#f6fbff';
        ctx.fillText('炉心', layout.core.x + layout.core.w * 0.38, layout.core.y - 10);

        for (let index = 0; index < 7; index += 1) {
            const rodX = layout.core.x + 20 + index * (layout.core.w - 40) / 6;
            ctx.fillStyle = '#b99a48';
            ctx.fillRect(rodX, layout.core.y + 20, 12, layout.core.h - 40);
        }

        for (let index = 0; index < 6; index += 1) {
            const rodX = layout.core.x + 34 + index * (layout.core.w - 52) / 5;
            ctx.fillStyle = '#121821';
            roundedRectPath(rodX, layout.core.y + 14, 8, rodDepth, 4);
            ctx.fill();
        }

        for (const flash of flashes) {
            ctx.fillStyle = `rgba(255, 233, 102, ${flash.life * 0.55})`;
            ctx.beginPath();
            ctx.arc(flash.x, flash.y, flash.radius, 0, tau);
            ctx.fill();
        }

        for (const neutron of neutrons) {
            ctx.fillStyle = '#7efcff';
            ctx.beginPath();
            ctx.arc(neutron.x, neutron.y, 3, 0, tau);
            ctx.fill();
        }

        if (damageRatio > 0.35) {
            ctx.strokeStyle = `rgba(255, 150, 106, ${0.25 + damageRatio * 0.35})`;
            ctx.lineWidth = 2;
            for (let index = 0; index < 4; index += 1) {
                const crackX = layout.core.x + 24 + index * layout.core.w * 0.18;
                ctx.beginPath();
                ctx.moveTo(crackX, layout.core.y + 28 + rand(-6, 6));
                ctx.lineTo(crackX - 10, layout.core.y + layout.core.h * 0.4 + rand(-12, 12));
                ctx.lineTo(crackX + 8, layout.core.y + layout.core.h * 0.8 + rand(-10, 10));
                ctx.stroke();
            }
        }

        if (damageRatio > 0.55) {
            const poolWidth = layout.core.w * clamp(0.22 + damageRatio * 0.42, 0.28, 0.7);
            const poolHeight = layout.core.h * clamp((damageRatio - 0.45) * 0.34, 0.08, 0.26);
            ctx.fillStyle = `rgba(255, 108, 77, ${0.34 + damageRatio * 0.32})`;
            ctx.beginPath();
            ctx.ellipse(
                layout.core.x + layout.core.w * 0.5,
                layout.core.y + layout.core.h - poolHeight * 0.68,
                poolWidth * 0.5,
                poolHeight,
                0,
                0,
                tau
            );
            ctx.fill();
            ctx.fillStyle = 'rgba(255, 229, 190, 0.92)';
            ctx.font = '12px IBM Plex Sans JP';
            ctx.fillText('溶融炉心', layout.core.x + layout.core.w * 0.3, layout.core.y + layout.core.h - 18);
        }

        ctx.strokeStyle = '#d9e4ee';
        ctx.lineWidth = 4;
        roundedRectPath(layout.steamGen.x, layout.steamGen.y, layout.steamGen.w, layout.steamGen.h, 20);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.fillRect(layout.steamGen.x + 8, layout.steamGen.y + 8, layout.steamGen.w - 16, layout.steamGen.h - 16);
        ctx.fillStyle = '#f6fbff';
        ctx.fillText('蒸気発生器', layout.steamGen.x + 12, layout.steamGen.y - 14);

        drawArrow(layout.core.x + layout.core.w, layout.core.y + layout.core.h * 0.35, layout.steamGen.x, layout.steamGen.y + layout.steamGen.h * 0.38, '#ff7f68', 4, 12);
        drawArrow(layout.steamGen.x, layout.steamGen.y + layout.steamGen.h * 0.78, layout.core.x + layout.core.w, layout.core.y + layout.core.h * 0.76, '#72b8ff', 4, 12);
        ctx.fillStyle = '#ffb2a6';
        ctx.font = '13px IBM Plex Sans JP';
        ctx.fillText('高温の冷却材', layout.core.x + layout.core.w + 12, layout.core.y + layout.core.h * 0.28);
        ctx.fillStyle = '#9bcfff';
        ctx.fillText('冷えて戻る', layout.core.x + layout.core.w + 18, layout.core.y + layout.core.h * 0.9);

        if (metrics.eccs) {
            drawArrow(layout.containment.x + layout.containment.w * 0.24, layout.containment.y - 18, layout.core.x + layout.core.w * 0.5, layout.core.y + 18, '#8ff0c8', 3, 10);
            ctx.fillStyle = '#8ff0c8';
            ctx.fillText('ECCS注水', layout.containment.x + layout.containment.w * 0.04, layout.containment.y - 26);
        }

        for (const particle of steam) {
            ctx.fillStyle = `rgba(236, 242, 248, ${particle.life / 150})`;
            ctx.beginPath();
            ctx.arc(particle.x, particle.y, 5, 0, tau);
            ctx.fill();
        }

        drawArrow(layout.steamGen.x + layout.steamGen.w, layout.steamGen.y + layout.steamGen.h * 0.48, layout.turbine.x - layout.turbine.r - 12, layout.turbine.y, '#eef2f6', 4, 12);
        ctx.fillStyle = '#f6fbff';
        ctx.fillText('蒸気', layout.steamGen.x + layout.steamGen.w + 38, layout.steamGen.y + layout.steamGen.h * 0.43);

        ctx.strokeStyle = '#d9e4ee';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(layout.turbine.x, layout.turbine.y, layout.turbine.r, 0, tau);
        ctx.stroke();
        for (let index = 0; index < 8; index += 1) {
            const bladeAngle = angle + index * tau / 8;
            ctx.beginPath();
            ctx.moveTo(layout.turbine.x, layout.turbine.y);
            ctx.lineTo(
                layout.turbine.x + Math.cos(bladeAngle) * (layout.turbine.r - 4),
                layout.turbine.y + Math.sin(bladeAngle) * (layout.turbine.r - 4)
            );
            ctx.stroke();
        }
        ctx.fillStyle = '#f6fbff';
        ctx.fillText('タービン', layout.turbine.x - 28, layout.turbine.y + layout.turbine.r + 24);

        ctx.strokeStyle = '#ffd97d';
        ctx.lineWidth = 3;
        roundedRectPath(layout.generator.x, layout.generator.y, layout.generator.w, layout.generator.h, 12);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 217, 125, 0.12)';
        ctx.fill();
        drawArrow(layout.turbine.x + layout.turbine.r + 8, layout.turbine.y, layout.generator.x, layout.generator.y + layout.generator.h * 0.52, '#ffd97d', 4, 11);
        ctx.fillStyle = '#ffd97d';
        ctx.fillText('発電機', layout.generator.x + 14, layout.generator.y - 12);

        ctx.fillStyle = '#fff4a9';
        ctx.font = '20px IBM Plex Sans JP';
        ctx.fillText(`電気出力: ${Math.round(metrics.electricOutput * 100)} %`, width * 0.67, height * 0.68);

        roundedRectPath(layout.condenser.x, layout.condenser.y, layout.condenser.w, layout.condenser.h, 16);
        ctx.strokeStyle = '#7dbdff';
        ctx.stroke();
        ctx.fillStyle = 'rgba(125, 189, 255, 0.12)';
        ctx.fill();
        ctx.fillStyle = '#9bcfff';
        ctx.font = '15px IBM Plex Sans JP';
        ctx.fillText('復水器・冷却系', layout.condenser.x + 24, layout.condenser.y + layout.condenser.h + 22);
        drawArrow(layout.turbine.x - 10, layout.turbine.y + layout.turbine.r + 16, layout.condenser.x + layout.condenser.w * 0.72, layout.condenser.y, '#7dbdff', 3, 10);
        drawArrow(layout.condenser.x, layout.condenser.y + layout.condenser.h * 0.48, layout.steamGen.x + layout.steamGen.w * 0.78, layout.steamGen.y + layout.steamGen.h * 0.98, '#7dbdff', 3, 10);

        ctx.fillStyle = '#f6fbff';
        ctx.font = '15px IBM Plex Sans JP';
        ctx.fillText(`炉心温度 ${Math.round(metrics.temperature)} ℃`, 26, height - 22);
        ctx.fillText(`中性子 ${metrics.neutronCount}`, width * 0.24, height - 22);
        ctx.fillText(`燃料損傷 ${Math.round(metrics.fuelDamage)} %`, width * 0.39, height - 22);
        ctx.fillText(`核分裂イベント ${metrics.fissions}`, width * 0.57, height - 22);

        const badgeX = width - 210;
        const badgeY = 20;
        roundedRectPath(badgeX, badgeY, 170, 34, 16);
        ctx.fillStyle = metrics.status === 'melt'
            ? 'rgba(130, 29, 21, 0.28)'
            : metrics.status === 'damage'
                ? 'rgba(191, 86, 75, 0.26)'
                : metrics.status === 'decay'
                    ? 'rgba(164, 93, 31, 0.24)'
                    : metrics.status === 'recovery'
                        ? 'rgba(47, 105, 136, 0.22)'
                        : metrics.status === 'alert'
                            ? 'rgba(191, 86, 75, 0.22)'
                            : metrics.status === 'low'
                                ? 'rgba(74, 134, 187, 0.22)'
                                : 'rgba(11, 141, 109, 0.22)';
        ctx.fill();
        ctx.fillStyle = '#f6fbff';
        ctx.font = 'bold 14px IBM Plex Sans JP';
        ctx.fillText(metrics.statusLabel, badgeX + 16, badgeY + 22);
    }

    function loop() {
        updateSimulation();
        drawScene();
        requestAnimationFrame(loop);
    }

    function applyPreset(key) {
        const preset = presets[key];
        if (!preset) return;

        resetAccidentState();
        rodRange.value = preset.rod.toFixed(2);
        coolantRange.value = preset.coolant.toFixed(2);
        narration.textContent = preset.note;
        presetRow.querySelectorAll('.preset-chip').forEach((chip) => {
            chip.classList.toggle('is-active', chip.dataset.preset === key);
        });
        updateControlLabels();
        resetSimulation();
    }

    function triggerEvent(action) {
        if (action === 'reset') {
            applyPreset('stable');
            return;
        }

        if (action === 'scram') {
            accident.scram = true;
            rodRange.value = '1.00';
            accident.decayHeat = Math.max(accident.decayHeat, 0.07 + latestMetrics.electricOutput * 0.04);
        }

        if (action === 'loca') {
            accident.scram = true;
            accident.coolantLoss = true;
            accident.eccs = false;
            rodRange.value = '1.00';
            coolantRange.value = '0.20';
            accident.decayHeat = Math.max(accident.decayHeat, 0.07 + latestMetrics.electricOutput * 0.04);
        }

        if (action === 'eccs') {
            accident.eccs = !accident.eccs;
            if (accident.eccs) {
                accident.scram = true;
                accident.decayHeat = Math.max(accident.decayHeat, 0.05);
            }
        }

        syncEventButtons();
        updateControlLabels();
    }

    presetRow.addEventListener('click', (event) => {
        const target = event.target.closest('[data-preset]');
        if (target) applyPreset(target.dataset.preset);
    });

    eventRow.addEventListener('click', (event) => {
        const target = event.target.closest('[data-event]');
        if (target) triggerEvent(target.dataset.event);
    });

    [rodRange, coolantRange].forEach((input) => {
        input.addEventListener('input', () => {
            updateControlLabels();
            presetRow.querySelectorAll('.preset-chip').forEach((chip) => chip.classList.remove('is-active'));
        });
    });

    window.addEventListener('resize', resizeCanvas);

    resizeCanvas();
    applyPreset('stable');
    syncEventButtons();
    loop();
})();