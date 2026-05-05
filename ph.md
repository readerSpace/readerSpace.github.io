酸・アルカリを混ぜたときに、単純な平均ではなく「H⁺ と OH⁻ の量」で中和を計算するモデルにします。強酸・強塩基の簡易モデルとして、量とpHを変えて混合できるHTMLを作ります。

<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>酸性・アルカリ性液体のpH混合シミュレーション</title>
  <style>
    body {
      margin: 0;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f6f8fb;
      color: #1f2937;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    h1 {
      margin: 18px 0 6px;
      font-size: 24px;
    }

    .description {
      max-width: 960px;
      padding: 0 16px;
      margin-bottom: 12px;
      font-size: 14px;
      line-height: 1.7;
      color: #4b5563;
    }

    .layout {
      width: min(1160px, 96vw);
      display: grid;
      grid-template-columns: 350px 1fr;
      gap: 16px;
      margin-bottom: 20px;
    }

    .panel, .sim {
      background: white;
      border-radius: 18px;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
      padding: 16px;
    }

    .panel h2 {
      font-size: 17px;
      margin: 6px 0 12px;
    }

    .control {
      margin-bottom: 14px;
    }

    label {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      font-size: 13px;
      margin-bottom: 5px;
    }

    input[type="range"] {
      width: 100%;
    }

    button {
      border: none;
      border-radius: 12px;
      padding: 10px 12px;
      margin: 4px 2px;
      color: white;
      font-weight: 700;
      cursor: pointer;
      background: #2563eb;
    }

    button.acid { background: #ef4444; }
    button.base { background: #2563eb; }
    button.water { background: #0ea5e9; }
    button.reset { background: #475569; }

    .stats {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-top: 12px;
    }

    .stat {
      background: #f8fafc;
      border-radius: 12px;
      padding: 10px;
      font-size: 13px;
    }

    .stat strong {
      display: block;
      margin-top: 3px;
      font-size: 18px;
      color: #111827;
    }

    canvas {
      display: block;
      width: 100%;
      height: 560px;
      border-radius: 16px;
      background: linear-gradient(#eef2ff, #f8fafc);
    }

    .note {
      font-size: 12px;
      color: #64748b;
      line-height: 1.6;
      margin-top: 12px;
    }

    .pill {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      background: #f1f5f9;
      color: #334155;
      margin-left: 4px;
    }

    @media (max-width: 850px) {
      .layout { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <h1>酸性液体とアルカリ性液体のpH混合シミュレーション</h1>
  <div class="description">
    酸性液体とアルカリ性液体を混ぜると、pHは単純な平均にはなりません。
    このシミュレーションでは、酸の H⁺ とアルカリの OH⁻ が中和して水になる、という考え方でpHを計算します。
  </div>

  <div class="layout">
    <div class="panel">
      <h2>液体を追加</h2>

      <div class="control">
        <label>追加する量 <span id="amountText">100 mL</span></label>
        <input id="amount" type="range" min="10" max="500" step="10" value="100" />
      </div>

      <div class="control">
        <label>酸性液体のpH <span id="acidPhText">pH 2.0</span></label>
        <input id="acidPh" type="range" min="0" max="6.9" step="0.1" value="2.0" />
        <button class="acid" onclick="addAcid()">酸性液体を入れる</button>
      </div>

      <div class="control">
        <label>アルカリ性液体のpH <span id="basePhText">pH 12.0</span></label>
        <input id="basePh" type="range" min="7.1" max="14" step="0.1" value="12.0" />
        <button class="base" onclick="addBase()">アルカリ性液体を入れる</button>
      </div>

      <div class="control">
        <button class="water" onclick="addWater()">中性の水を入れる</button>
        <button class="reset" onclick="resetSim()">リセット</button>
      </div>

      <div class="stats">
        <div class="stat">全体量<strong id="volumeStat">0 mL</strong></div>
        <div class="stat">現在のpH<strong id="phStat">7.00</strong></div>
        <div class="stat">性質<strong id="typeStat">中性</strong></div>
        <div class="stat">中和率<strong id="neutralStat">0 %</strong></div>
        <div class="stat">残ったH⁺<strong id="hStat">0 mol</strong></div>
        <div class="stat">残ったOH⁻<strong id="ohStat">0 mol</strong></div>
      </div>

      <div class="note">
        簡易モデル：強酸・強塩基が完全に電離すると仮定します。pH から [H⁺] = 10^(-pH)、pOH = 14 - pH、[OH⁻] = 10^(-pOH) を計算し、H⁺ と OH⁻ を中和させます。弱酸・緩衝液・温度変化は扱いません。
      </div>
    </div>

    <div class="sim">
      <canvas id="canvas" width="780" height="560"></canvas>
    </div>
  </div>

  <script>
    const canvas = document.getElementById("canvas");
    const ctx = canvas.getContext("2d");

    const amountSlider = document.getElementById("amount");
    const acidPhSlider = document.getElementById("acidPh");
    const basePhSlider = document.getElementById("basePh");

    let volumeL = 0;
    let hMol = 0;
    let ohMol = 0;
    let neutralizedMol = 0;
    let particles = [];
    let drops = [];
    let reactionFlashes = [];

    const maxVolumeL = 1.4;
    const beaker = { x: 210, y: 88, w: 360, h: 390 };

    function clamp(v, min, max) {
      return Math.max(min, Math.min(max, v));
    }

    function currentPH() {
      if (volumeL <= 0) return 7;
      const excessH = hMol - ohMol;
      const excessOH = ohMol - hMol;

      if (Math.abs(excessH) < 1e-12 && Math.abs(excessOH) < 1e-12) return 7;

      if (excessH > 0) {
        const hConc = excessH / volumeL;
        return clamp(-Math.log10(hConc), 0, 14);
      } else {
        const ohConc = excessOH / volumeL;
        const pOH = -Math.log10(ohConc);
        return clamp(14 - pOH, 0, 14);
      }
    }

    function liquidType(ph) {
      if (ph < 6.8) return "酸性";
      if (ph > 7.2) return "アルカリ性";
      return "ほぼ中性";
    }

    function colorForPH(ph, alpha = 0.75) {
      // 酸性: 赤、 中性: 緑、 アルカリ性: 青紫
      let r, g, b;
      if (ph < 7) {
        const t = ph / 7;
        r = 239;
        g = Math.round(68 + 145 * t);
        b = Math.round(68 + 72 * t);
      } else {
        const t = (ph - 7) / 7;
        r = Math.round(34 + 65 * t);
        g = Math.round(197 - 95 * t);
        b = Math.round(94 + 141 * t);
      }
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function addAcid() {
      const ml = Number(amountSlider.value);
      const ph = Number(acidPhSlider.value);
      const L = ml / 1000;
      const h = Math.pow(10, -ph) * L;
      addLiquid(L, h, 0, "acid", ph);
    }

    function addBase() {
      const ml = Number(amountSlider.value);
      const ph = Number(basePhSlider.value);
      const L = ml / 1000;
      const pOH = 14 - ph;
      const oh = Math.pow(10, -pOH) * L;
      addLiquid(L, 0, oh, "base", ph);
    }

    function addWater() {
      const ml = Number(amountSlider.value);
      const L = ml / 1000;
      addLiquid(L, 0, 0, "water", 7);
    }

    function addLiquid(L, addH, addOH, kind, ph) {
      const allowed = Math.max(0, maxVolumeL - volumeL);
      const ratio = L > 0 ? Math.min(1, allowed / L) : 0;
      L *= ratio;
      addH *= ratio;
      addOH *= ratio;
      if (L <= 0) return;

      volumeL += L;
      hMol += addH;
      ohMol += addOH;

      const beforeMin = Math.min(hMol - addH, ohMol - addOH);
      neutralize();
      const afterMin = Math.min(hMol, ohMol);
      const reactedNow = Math.max(0, beforeMin - afterMin + Math.min(addH, ohMol) + Math.min(addOH, hMol));

      makeDrops(kind, ph, Math.floor(L * 220));
      makeParticles(kind, ph, Math.floor(L * 350));
      if (addH > 0 || addOH > 0) makeReactionFlashes(Math.min(20, Math.floor(4 + reactedNow * 200000)));
    }

    function neutralize() {
      const reacted = Math.min(hMol, ohMol);
      hMol -= reacted;
      ohMol -= reacted;
      neutralizedMol += reacted;
    }

    function resetSim() {
      volumeL = 0;
      hMol = 0;
      ohMol = 0;
      neutralizedMol = 0;
      particles = [];
      drops = [];
      reactionFlashes = [];
    }

    function liquidBounds() {
      const fillRatio = Math.min(1, volumeL / maxVolumeL);
      const liquidH = beaker.h * fillRatio;
      const liquidTop = beaker.y + beaker.h - liquidH;
      return { liquidTop, liquidBottom: beaker.y + beaker.h, liquidH };
    }

    function randomInsideLiquid() {
      const b = liquidBounds();
      return {
        x: beaker.x + 48 + Math.random() * (beaker.w - 96),
        y: b.liquidTop + 15 + Math.random() * Math.max(1, b.liquidH - 30)
      };
    }

    function makeDrops(kind, ph, n) {
      for (let i = 0; i < n; i++) {
        drops.push({
          kind,
          ph,
          x: 360 + Math.random() * 90 - 45,
          y: 28 + Math.random() * 30,
          vy: 2 + Math.random() * 3,
          r: 3 + Math.random() * 5,
          life: 1
        });
      }
      if (drops.length > 160) drops.splice(0, drops.length - 160);
    }

    function makeParticles(kind, ph, n) {
      if (volumeL <= 0) return;
      for (let i = 0; i < n; i++) {
        const p = randomInsideLiquid();
        particles.push({
          kind,
          ph,
          x: p.x,
          y: p.y,
          vx: Math.random() * 2 - 1,
          vy: Math.random() * 2 - 1,
          r: 2 + Math.random() * 4,
          life: 1
        });
      }
      if (particles.length > 450) particles.splice(0, particles.length - 450);
    }

    function makeReactionFlashes(n) {
      const b = liquidBounds();
      for (let i = 0; i < n; i++) {
        reactionFlashes.push({
          x: beaker.x + 60 + Math.random() * (beaker.w - 120),
          y: b.liquidTop + 20 + Math.random() * Math.max(1, b.liquidH - 40),
          r: 8 + Math.random() * 18,
          alpha: 0.45
        });
      }
    }

    function updatePhysics() {
      neutralize();
      const b = liquidBounds();
      const ph = currentPH();

      for (const p of particles) {
        p.vx += (Math.random() - 0.5) * 0.14;
        p.vy += (Math.random() - 0.5) * 0.14;
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.96;
        p.vy *= 0.96;
        p.ph += (ph - p.ph) * 0.012;
        p.life -= 0.0015;

        const left = beaker.x + 42;
        const right = beaker.x + beaker.w - 42;
        if (p.x < left) { p.x = left; p.vx *= -0.6; }
        if (p.x > right) { p.x = right; p.vx *= -0.6; }
        if (p.y < b.liquidTop + 8) { p.y = b.liquidTop + 8; p.vy *= -0.5; }
        if (p.y > b.liquidBottom - 8) { p.y = b.liquidBottom - 8; p.vy *= -0.5; }
      }
      particles = particles.filter(p => p.life > 0.18);

      drops = drops
        .map(d => ({ ...d, y: d.y + d.vy, vy: d.vy + 0.06, life: d.life - 0.002 }))
        .filter(d => d.y < b.liquidBottom && d.life > 0);

      reactionFlashes = reactionFlashes
        .map(f => ({ ...f, r: f.r * 1.025, alpha: f.alpha - 0.012 }))
        .filter(f => f.alpha > 0);
    }

    function updateUI() {
      const ph = currentPH();
      const totalIonBefore = neutralizedMol + hMol + ohMol;
      const neutralRate = totalIonBefore > 0 ? neutralizedMol / totalIonBefore : 0;

      document.getElementById("amountText").textContent = `${amountSlider.value} mL`;
      document.getElementById("acidPhText").textContent = `pH ${Number(acidPhSlider.value).toFixed(1)}`;
      document.getElementById("basePhText").textContent = `pH ${Number(basePhSlider.value).toFixed(1)}`;
      document.getElementById("volumeStat").textContent = `${(volumeL * 1000).toFixed(0)} mL`;
      document.getElementById("phStat").textContent = ph.toFixed(2);
      document.getElementById("typeStat").textContent = liquidType(ph);
      document.getElementById("neutralStat").textContent = `${(neutralRate * 100).toFixed(0)} %`;
      document.getElementById("hStat").textContent = hMol.toExponential(2);
      document.getElementById("ohStat").textContent = ohMol.toExponential(2);
    }

    function drawBeaker() {
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(30, 41, 59, 0.72)";
      ctx.beginPath();
      ctx.moveTo(beaker.x, beaker.y);
      ctx.lineTo(beaker.x + 35, beaker.y + beaker.h);
      ctx.lineTo(beaker.x + beaker.w - 35, beaker.y + beaker.h);
      ctx.lineTo(beaker.x + beaker.w, beaker.y);
      ctx.stroke();

      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(148, 163, 184, 0.7)";
      for (let i = 1; i <= 5; i++) {
        const yy = beaker.y + beaker.h - i * beaker.h / 6;
        ctx.beginPath();
        ctx.moveTo(beaker.x + 28, yy);
        ctx.lineTo(beaker.x + 54, yy);
        ctx.stroke();
      }
    }

    function drawLiquid() {
      if (volumeL <= 0) return;
      const b = liquidBounds();
      const ph = currentPH();
      const wave = Math.sin(Date.now() * 0.003) * 5;

      const grad = ctx.createLinearGradient(0, b.liquidTop, 0, b.liquidBottom);
      grad.addColorStop(0, colorForPH(ph, 0.68));
      grad.addColorStop(1, colorForPH(ph, 0.88));

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(beaker.x + 35, b.liquidBottom);
      ctx.lineTo(beaker.x + beaker.w - 35, b.liquidBottom);
      ctx.lineTo(beaker.x + beaker.w - 35 + 20, b.liquidTop + wave);
      ctx.quadraticCurveTo(beaker.x + beaker.w / 2, b.liquidTop - wave, beaker.x + 35 - 20, b.liquidTop + wave);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "rgba(255,255,255,0.22)";
      ctx.beginPath();
      ctx.ellipse(beaker.x + beaker.w / 2, b.liquidTop, 145, 10, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    function drawParticles() {
      for (const p of particles) {
        ctx.fillStyle = colorForPH(p.ph, 0.55);
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    function drawDrops() {
      for (const d of drops) {
        ctx.fillStyle = colorForPH(d.ph, 0.82);
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function drawFlashes() {
      for (const f of reactionFlashes) {
        ctx.strokeStyle = `rgba(255,255,255,${f.alpha})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    function drawPHScale() {
      const x = 62;
      const y = 115;
      const w = 36;
      const h = 340;
      const ph = currentPH();

      for (let i = 0; i < h; i++) {
        const scalePH = 14 - (i / h) * 14;
        ctx.fillStyle = colorForPH(scalePH, 1);
        ctx.fillRect(x, y + i, w, 1);
      }
      ctx.strokeStyle = "#334155";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);

      ctx.fillStyle = "#111827";
      ctx.font = "13px system-ui";
      ctx.fillText("pH", x + 4, y - 12);
      ctx.fillText("14", x + 44, y + 5);
      ctx.fillText("7", x + 44, y + h / 2 + 4);
      ctx.fillText("0", x + 44, y + h + 4);

      const markerY = y + h - (ph / 14) * h;
      ctx.fillStyle = "#111827";
      ctx.beginPath();
      ctx.moveTo(x - 10, markerY);
      ctx.lineTo(x - 2, markerY - 7);
      ctx.lineTo(x - 2, markerY + 7);
      ctx.closePath();
      ctx.fill();
      ctx.font = "14px system-ui";
      ctx.fillText(ph.toFixed(2), x - 52, markerY + 5);
    }

    function drawMoleculeEquation() {
      ctx.fillStyle = "#111827";
      ctx.font = "16px system-ui";
      ctx.fillText("中和反応： H⁺  +  OH⁻  →  H₂O", 470, 515);

      ctx.font = "13px system-ui";
      ctx.fillStyle = "#475569";
      ctx.fillText("赤に近いほど酸性、緑が中性、青紫に近いほどアルカリ性", 32, 66);
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      drawLiquid();
      drawParticles();
      drawFlashes();
      drawBeaker();
      drawDrops();
      drawPHScale();
      drawMoleculeEquation();

      const ph = currentPH();
      ctx.fillStyle = "#111827";
      ctx.font = "17px system-ui";
      let status = "液体を入れてください";
      if (volumeL > 0) {
        status = `現在は ${liquidType(ph)}：pH ${ph.toFixed(2)}`;
      }
      ctx.fillText(status, 32, 38);

      if (volumeL > 0 && Math.abs(ph - 7) < 0.15) {
        ctx.fillStyle = "rgba(34,197,94,0.12)";
        ctx.beginPath();
        ctx.roundRect(235, 155, 310, 80, 18);
        ctx.fill();
        ctx.fillStyle = "#166534";
        ctx.font = "18px system-ui";
        ctx.fillText("ほぼ中性になりました", 300, 202);
      }
    }

    function loop() {
      updatePhysics();
      updateUI();
      draw();
      requestAnimationFrame(loop);
    }

    updateUI();
    loop();
  </script>
</body>
</html>
できること：

酸性液体のpHを指定して追加
アルカリ性液体のpHを指定して追加
水で薄める
H⁺ と OH⁻ の中和でpH計算
pHスケールと色変化を表示
中性付近になると表示が出る

単純なpH平均ではなく、中和反応ベースの簡易モデルです。