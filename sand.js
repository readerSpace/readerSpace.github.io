const revealObserver = new IntersectionObserver(
    (entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add("is-visible");
                revealObserver.unobserve(entry.target);
            }
        });
    },
    {
        threshold: 0.18,
        rootMargin: "0px 0px -40px 0px"
    }
);

document.querySelectorAll(".reveal, .site-footer").forEach((element) => {
    if (!element.classList.contains("is-visible")) {
        revealObserver.observe(element);
    }
});

// =====================================================================
// Demo 1: 砂のセルオートマトン
// =====================================================================
(() => {
    const canvas = document.querySelector("#sandCanvas");

    if (!canvas) {
        return;
    }

    const ctx = canvas.getContext("2d");
    const brushRange = document.querySelector("#brushRange");
    const stepsRange = document.querySelector("#stepsRange");
    const rainRange = document.querySelector("#rainRange");
    const brushValue = document.querySelector("#brushValue");
    const stepsValue = document.querySelector("#stepsValue");
    const rainValue = document.querySelector("#rainValue");
    const grainCount = document.querySelector("#grainCount");
    const pileHeight = document.querySelector("#pileHeight");
    const sandStatus = document.querySelector("#sandStatus");
    const sandNote = document.querySelector("#sandNote");
    const sandReset = document.querySelector("#sandReset");
    const sandWall = document.querySelector("#sandWall");

    const cellSize = 4;
    const cols = Math.floor(canvas.width / cellSize);
    const rows = Math.floor(canvas.height / cellSize);

    // 0: 空気, 1〜4: 砂の色違い, 9: 仕切り（壁）
    let grid = new Uint8Array(cols * rows);
    let next = new Uint8Array(cols * rows);

    let pointerDown = false;
    let pointerX = 0;
    let pointerY = 0;
    let placeMode = "sand"; // "sand" or "wall"
    let prevGrains = 0;
    let stableFrames = 0;

    const index = (x, y) => y * cols + x;
    const inBounds = (x, y) => x >= 0 && x < cols && y >= 0 && y < rows;

    const paintAt = (px, py) => {
        const cx = Math.floor(px / cellSize);
        const cy = Math.floor(py / cellSize);
        const r = Number(brushRange?.value || 5);
        const value = placeMode === "wall" ? 9 : 1 + Math.floor(Math.random() * 4);

        for (let dy = -r; dy <= r; dy += 1) {
            for (let dx = -r; dx <= r; dx += 1) {
                if (dx * dx + dy * dy > r * r) {
                    continue;
                }

                const x = cx + dx;
                const y = cy + dy;

                if (!inBounds(x, y)) {
                    continue;
                }

                if (placeMode === "wall") {
                    grid[index(x, y)] = 9;
                } else if (Math.random() < 0.45) {
                    grid[index(x, y)] = value;
                }
            }
        }
    };

    const rainSand = () => {
        const amount = Number(rainRange?.value || 0);

        if (amount <= 0) {
            return;
        }

        for (let i = 0; i < amount; i += 1) {
            const x = Math.floor(cols * (0.42 + Math.random() * 0.16));
            const y = 1;

            if (grid[index(x, y)] === 0) {
                grid[index(x, y)] = 1 + Math.floor(Math.random() * 4);
            }
        }
    };

    const updateSand = () => {
        next.fill(0);

        // 壁は移動しないので next にコピー
        for (let i = 0; i < grid.length; i += 1) {
            if (grid[i] === 9) {
                next[i] = 9;
            }
        }

        for (let y = rows - 1; y >= 0; y -= 1) {
            const leftToRight = Math.random() < 0.5;

            for (let i = 0; i < cols; i += 1) {
                const x = leftToRight ? i : cols - 1 - i;
                const id = index(x, y);
                const cell = grid[id];

                if (cell === 0 || cell === 9) {
                    continue;
                }

                if (next[id] !== 0) {
                    continue;
                }

                if (y + 1 >= rows) {
                    next[id] = cell;
                    continue;
                }

                const below = index(x, y + 1);

                if (grid[below] === 0 && next[below] === 0) {
                    next[below] = cell;
                    continue;
                }

                const dirs = Math.random() < 0.5 ? [-1, 1] : [1, -1];
                let moved = false;

                for (const d of dirs) {
                    const nx = x + d;
                    const ny = y + 1;

                    if (!inBounds(nx, ny)) {
                        continue;
                    }

                    const ni = index(nx, ny);

                    if (grid[ni] === 0 && next[ni] === 0) {
                        next[ni] = cell;
                        moved = true;
                        break;
                    }
                }

                if (!moved) {
                    next[id] = cell;
                }
            }
        }

        const swap = grid;
        grid = next;
        next = swap;
    };

    const palette = ["#0d0a04", "#d9b35f", "#c99a45", "#e6c978", "#b98236"];

    const render = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        for (let y = 0; y < rows; y += 1) {
            for (let x = 0; x < cols; x += 1) {
                const cell = grid[index(x, y)];

                if (cell === 0) {
                    continue;
                }

                if (cell === 9) {
                    ctx.fillStyle = "#888";
                } else {
                    ctx.fillStyle = palette[cell] || palette[1];
                }

                ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
            }
        }
    };

    const updateOutputs = () => {
        if (brushValue && brushRange) {
            brushValue.textContent = brushRange.value;
        }

        if (stepsValue && stepsRange) {
            stepsValue.textContent = stepsRange.value;
        }

        if (rainValue && rainRange) {
            rainValue.textContent = rainRange.value;
        }

        let count = 0;
        let topY = rows;

        for (let y = 0; y < rows; y += 1) {
            for (let x = 0; x < cols; x += 1) {
                const c = grid[index(x, y)];

                if (c >= 1 && c <= 4) {
                    count += 1;

                    if (y < topY) {
                        topY = y;
                    }
                }
            }
        }

        if (grainCount) {
            grainCount.textContent = `${count}`;
        }

        if (pileHeight) {
            const h = count > 0 ? Math.round((1 - topY / rows) * 100) : 0;
            pileHeight.textContent = `${h}%`;
        }

        const moving = Math.abs(count - prevGrains) >= 2;

        if (moving) {
            stableFrames = 0;
        } else {
            stableFrames += 1;
        }

        prevGrains = count;

        if (sandStatus) {
            if (count === 0) {
                sandStatus.textContent = "空";
            } else if (stableFrames > 6) {
                sandStatus.textContent = "停止 (固体的)";
            } else {
                sandStatus.textContent = "流れている";
            }
        }
    };

    const loop = () => {
        if (pointerDown) {
            paintAt(pointerX, pointerY);
        }

        rainSand();

        const steps = Number(stepsRange?.value || 3);

        for (let i = 0; i < steps; i += 1) {
            updateSand();
        }

        render();
        updateOutputs();
        window.requestAnimationFrame(loop);
    };

    const setPointer = (event) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        pointerX = (event.clientX - rect.left) * scaleX;
        pointerY = (event.clientY - rect.top) * scaleY;
    };

    canvas.addEventListener("pointerdown", (event) => {
        pointerDown = true;
        setPointer(event);
        canvas.setPointerCapture(event.pointerId);
    });

    canvas.addEventListener("pointermove", (event) => {
        setPointer(event);
    });

    canvas.addEventListener("pointerup", () => {
        pointerDown = false;
    });

    canvas.addEventListener("pointercancel", () => {
        pointerDown = false;
    });

    sandReset?.addEventListener("click", () => {
        grid.fill(0);
    });

    sandWall?.addEventListener("click", () => {
        placeMode = placeMode === "wall" ? "sand" : "wall";

        if (sandWall) {
            sandWall.textContent = placeMode === "wall" ? "砂を描く" : "仕切りを置く";
        }

        if (sandNote) {
            sandNote.textContent =
                placeMode === "wall"
                    ? "ドラッグするとグレーの仕切りを置けます。砂の流れをせき止めて、安息角や流れの分岐を確認してください。"
                    : "マウスドラッグで砂を加えると、重力で落ち、斜めに崩れて山が育ちます。「上から降らせる量」を上げると、砂時計のように継続的に降り続けます。";
        }
    });

    [brushRange, stepsRange, rainRange].forEach((el) => {
        el?.addEventListener("input", updateOutputs);
    });

    updateOutputs();
    loop();
})();

// =====================================================================
// Demo 2: ブラジルナッツ効果（粗視化 DEM）
// =====================================================================
(() => {
    const canvas = document.querySelector("#brazilCanvas");

    if (!canvas) {
        return;
    }

    const ctx = canvas.getContext("2d");
    const shakeRange = document.querySelector("#shakeRange");
    const smallRange = document.querySelector("#smallRange");
    const largeRange = document.querySelector("#largeRange");
    const shakeValue = document.querySelector("#shakeValue");
    const smallValue = document.querySelector("#smallValue");
    const largeValue = document.querySelector("#largeValue");
    const largeHeight = document.querySelector("#largeHeight");
    const shakePhase = document.querySelector("#shakePhase");
    const brazilFrames = document.querySelector("#brazilFrames");
    const brazilReset = document.querySelector("#brazilReset");

    const W = canvas.width;
    const H = canvas.height;

    const box = {
        x: 80,
        y: 40,
        w: 400,
        h: 430
    };

    const particles = [];
    let frame = 0;

    const rand = (min, max) => min + Math.random() * (max - min);

    const makeParticle = (type, x, y) => {
        const isLarge = type === "large";

        return {
            type,
            x,
            y,
            vx: rand(-0.4, 0.4),
            vy: rand(-0.4, 0.4),
            r: isLarge ? 16 : 5,
            m: isLarge ? 9 : 1,
            color: isLarge ? "#d04540" : "#e0b562"
        };
    };

    const reset = () => {
        particles.length = 0;

        const smallCount = Number(smallRange?.value || 200);
        const largeCount = Number(largeRange?.value || 4);

        for (let i = 0; i < smallCount; i += 1) {
            particles.push(
                makeParticle(
                    "small",
                    rand(box.x + 20, box.x + box.w - 20),
                    rand(box.y + 180, box.y + box.h - 20)
                )
            );
        }

        for (let i = 0; i < largeCount; i += 1) {
            particles.push(
                makeParticle(
                    "large",
                    rand(box.x + 60, box.x + box.w - 60),
                    rand(box.y + box.h - 95, box.y + box.h - 35)
                )
            );
        }

        frame = 0;
    };

    const applyForces = () => {
        const shake = Number(shakeRange?.value || 55) / 100;
        const ax = Math.sin(frame * 0.21) * 0.35 * shake + rand(-0.04, 0.04) * shake;
        const ay = Math.sin(frame * 0.38) * 0.75 * shake;

        for (const p of particles) {
            p.vy += 0.24;
            p.vx += ax / Math.sqrt(p.m);
            p.vy += ay / Math.sqrt(p.m);
            p.vx *= 0.985;
            p.vy *= 0.985;

            if (p.type === "small") {
                p.vy += 0.05 * shake;
                p.vx += rand(-0.035, 0.035) * shake;
            } else {
                p.vy -= 0.035 * shake;
            }
        }
    };

    const integrate = () => {
        for (const p of particles) {
            p.x += p.vx;
            p.y += p.vy;

            const left = box.x + p.r;
            const right = box.x + box.w - p.r;
            const top = box.y + p.r;
            const bottom = box.y + box.h - p.r;

            if (p.x < left) {
                p.x = left;
                p.vx *= -0.35;
            }

            if (p.x > right) {
                p.x = right;
                p.vx *= -0.35;
            }

            if (p.y < top) {
                p.y = top;
                p.vy *= -0.25;
            }

            if (p.y > bottom) {
                p.y = bottom;
                p.vy *= -0.25;
                p.vx *= 0.78;
            }
        }
    };

    const solveCollisions = () => {
        for (let iter = 0; iter < 3; iter += 1) {
            for (let i = 0; i < particles.length; i += 1) {
                const a = particles[i];

                for (let j = i + 1; j < particles.length; j += 1) {
                    const b = particles[j];
                    const dx = b.x - a.x;
                    const dy = b.y - a.y;
                    const dist2 = dx * dx + dy * dy;
                    const minDist = a.r + b.r;

                    if (dist2 >= minDist * minDist || dist2 === 0) {
                        continue;
                    }

                    const dist = Math.sqrt(dist2);
                    const nx = dx / dist;
                    const ny = dy / dist;
                    const overlap = minDist - dist;
                    const totalMass = a.m + b.m;
                    const moveA = overlap * (b.m / totalMass);
                    const moveB = overlap * (a.m / totalMass);

                    a.x -= nx * moveA;
                    a.y -= ny * moveA;
                    b.x += nx * moveB;
                    b.y += ny * moveB;

                    const rvx = b.vx - a.vx;
                    const rvy = b.vy - a.vy;
                    const vn = rvx * nx + rvy * ny;

                    if (vn < 0) {
                        const restitution = 0.18;
                        const impulse = (-(1 + restitution) * vn) / (1 / a.m + 1 / b.m);
                        const ix = impulse * nx;
                        const iy = impulse * ny;
                        a.vx -= ix / a.m;
                        a.vy -= iy / a.m;
                        b.vx += ix / b.m;
                        b.vy += iy / b.m;
                    }

                    const tx = -ny;
                    const ty = nx;
                    const vt = rvx * tx + rvy * ty;
                    const friction = 0.02;
                    a.vx += (vt * tx * friction) / a.m;
                    a.vy += (vt * ty * friction) / a.m;
                    b.vx -= (vt * tx * friction) / b.m;
                    b.vy -= (vt * ty * friction) / b.m;
                }
            }
        }
    };

    const draw = () => {
        ctx.clearRect(0, 0, W, H);

        const shake = Number(shakeRange?.value || 55) / 100;
        const offsetX = Math.sin(frame * 0.21) * 5 * shake;
        const offsetY = Math.sin(frame * 0.38) * 5 * shake;

        ctx.save();
        ctx.translate(offsetX, offsetY);

        ctx.fillStyle = "#1a1108";
        ctx.fillRect(box.x, box.y, box.w, box.h);

        ctx.strokeStyle = "#a16322";
        ctx.lineWidth = 4;
        ctx.strokeRect(box.x, box.y, box.w, box.h);

        for (const p of particles) {
            if (p.type !== "small") continue;

            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.fill();
        }

        for (const p of particles) {
            if (p.type !== "large") continue;

            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.fill();
            ctx.strokeStyle = "rgba(255,255,255,0.32)";
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        ctx.restore();
    };

    const updateOutputs = () => {
        if (shakeValue && shakeRange) shakeValue.textContent = shakeRange.value;
        if (smallValue && smallRange) smallValue.textContent = smallRange.value;
        if (largeValue && largeRange) largeValue.textContent = largeRange.value;

        const largeParticles = particles.filter((p) => p.type === "large");
        const avgY =
            largeParticles.length > 0
                ? largeParticles.reduce((s, p) => s + p.y, 0) / largeParticles.length
                : box.y + box.h;
        const ratio = 1 - (avgY - box.y) / box.h;

        if (largeHeight) {
            largeHeight.textContent = `${(ratio * 100).toFixed(1)}%`;
        }

        if (shakePhase && shakeRange) {
            const v = Number(shakeRange.value);

            if (v <= 20) {
                shakePhase.textContent = "静止に近い";
            } else if (v <= 60) {
                shakePhase.textContent = "中程度";
            } else {
                shakePhase.textContent = "激しい";
            }
        }

        if (brazilFrames) {
            brazilFrames.textContent = `${frame}`;
        }
    };

    const loop = () => {
        frame += 1;
        applyForces();
        integrate();
        solveCollisions();
        draw();

        if (frame % 6 === 0) {
            updateOutputs();
        }

        window.requestAnimationFrame(loop);
    };

    brazilReset?.addEventListener("click", reset);
    smallRange?.addEventListener("change", reset);
    largeRange?.addEventListener("change", reset);
    [shakeRange, smallRange, largeRange].forEach((el) => {
        el?.addEventListener("input", updateOutputs);
    });

    reset();
    loop();
})();
