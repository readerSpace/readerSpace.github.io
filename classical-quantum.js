const classicalGates = [
    {
        name: "NOT",
        desc: "0 を 1 に、1 を 0 に反転",
        kind: "single",
        apply(bit) {
            return 1 - bit;
        }
    },
    {
        name: "BUF",
        desc: "そのまま通す",
        kind: "single",
        apply(bit) {
            return bit;
        }
    },
    {
        name: "AND",
        desc: "補助ビットとの AND を取る",
        kind: "binary",
        apply(bit, auxiliaryBit) {
            return bit & auxiliaryBit;
        }
    },
    {
        name: "OR",
        desc: "補助ビットとの OR を取る",
        kind: "binary",
        apply(bit, auxiliaryBit) {
            return bit | auxiliaryBit;
        }
    }
];

const singleQubitMatrices = {
    X: [
        [0, 1],
        [1, 0]
    ],
    H: [
        [1 / Math.sqrt(2), 1 / Math.sqrt(2)],
        [1 / Math.sqrt(2), -1 / Math.sqrt(2)]
    ],
    Z: [
        [1, 0],
        [0, -1]
    ]
};

const basisLabels = ["00", "01", "10", "11"];

const quantumGates = [
    {
        name: "X q0",
        desc: "上の量子ビット q0 を反転",
        type: "single",
        target: 0,
        matrix: singleQubitMatrices.X
    },
    {
        name: "X q1",
        desc: "下の量子ビット q1 を反転",
        type: "single",
        target: 1,
        matrix: singleQubitMatrices.X
    },
    {
        name: "H q0",
        desc: "q0 を重ね合わせへ広げる",
        type: "single",
        target: 0,
        matrix: singleQubitMatrices.H
    },
    {
        name: "H q1",
        desc: "q1 を重ね合わせへ広げる",
        type: "single",
        target: 1,
        matrix: singleQubitMatrices.H
    },
    {
        name: "Z q0",
        desc: "q0 の |1⟩ 側だけ位相反転",
        type: "single",
        target: 0,
        matrix: singleQubitMatrices.Z
    },
    {
        name: "Z q1",
        desc: "q1 の |1⟩ 側だけ位相反転",
        type: "single",
        target: 1,
        matrix: singleQubitMatrices.Z
    },
    {
        name: "CNOT q0→q1",
        desc: "q0=1 のときだけ q1 を反転",
        type: "cnot",
        control: 0,
        target: 1
    },
    {
        name: "CNOT q1→q0",
        desc: "q1=1 のときだけ q0 を反転",
        type: "cnot",
        control: 1,
        target: 0
    },
    {
        name: "SWAP",
        desc: "q0 と q1 を入れ替える",
        type: "swap"
    }
];

const quantumGateByName = Object.fromEntries(quantumGates.map((gate) => [gate.name, gate]));
const classicalGateByName = Object.fromEntries(classicalGates.map((gate) => [gate.name, gate]));

const appState = {
    classicalInput: 0,
    classicalAuxiliaryBit: 1,
    classicalCircuit: ["NOT"],
    quantumInput: "00",
    quantumCircuit: ["H q0", "CNOT q0→q1"],
    measurements: []
};

const dom = {
    classicalInputButtons: document.querySelector("#classicalInputButtons"),
    classicalAuxButtons: document.querySelector("#classicalAuxButtons"),
    classicalGateButtons: document.querySelector("#classicalGateButtons"),
    classicalCircuitFlow: document.querySelector("#classicalCircuitFlow"),
    classicalCircuitDiagram: document.querySelector("#classicalCircuitDiagram"),
    classicalResultValue: document.querySelector("#classicalResultValue"),
    classicalResultNote: document.querySelector("#classicalResultNote"),
    classicalSteps: document.querySelector("#classicalSteps"),
    clearClassicalCircuit: document.querySelector("#clearClassicalCircuit"),
    quantumInputButtons: document.querySelector("#quantumInputButtons"),
    quantumGateButtons: document.querySelector("#quantumGateButtons"),
    quantumCircuitFlow: document.querySelector("#quantumCircuitFlow"),
    quantumCircuitDiagram: document.querySelector("#quantumCircuitDiagram"),
    quantumStateValue: document.querySelector("#quantumStateValue"),
    quantumPhaseNote: document.querySelector("#quantumPhaseNote"),
    basisProbabilityGrid: document.querySelector("#basisProbabilityGrid"),
    measureQuantum: document.querySelector("#measureQuantum"),
    resetMeasurements: document.querySelector("#resetMeasurements"),
    measurementSummary: document.querySelector("#measurementSummary"),
    measurementHistory: document.querySelector("#measurementHistory"),
    quantumSteps: document.querySelector("#quantumSteps"),
    clearQuantumCircuit: document.querySelector("#clearQuantumCircuit"),
    exampleButtons: document.querySelectorAll(".example-load")
};

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

const clampPercent = (value) => Math.max(0, Math.min(100, value));

const formatAmplitude = (value) => {
    const safeValue = Math.abs(value) < 1e-10 ? 0 : value;
    return safeValue.toFixed(2);
};

const formatState = (state) => {
    const terms = [];

    state.forEach((amplitude, index) => {
        if (Math.abs(amplitude) < 1e-10) {
            return;
        }

        const prefix = terms.length === 0
            ? amplitude < 0 ? "− " : ""
            : amplitude < 0 ? " − " : " + ";

        terms.push(`${prefix}${formatAmplitude(Math.abs(amplitude))}|${basisLabels[index]}⟩`);
    });

    return terms.length > 0 ? terms.join("") : "0.00|00⟩";
};

const basisVector = (label) => {
    const state = [0, 0, 0, 0];
    const index = basisLabels.indexOf(label);

    state[index] = 1;
    return state;
};

const applySingleQubitGate = (state, matrix, target) => {
    const nextState = [0, 0, 0, 0];

    if (target === 0) {
        [0, 1].forEach((q1) => {
            const idx0 = q1;
            const idx1 = 2 + q1;
            const a = state[idx0];
            const b = state[idx1];

            nextState[idx0] = matrix[0][0] * a + matrix[0][1] * b;
            nextState[idx1] = matrix[1][0] * a + matrix[1][1] * b;
        });

        return nextState;
    }

    [0, 1].forEach((q0) => {
        const idx0 = q0 * 2;
        const idx1 = q0 * 2 + 1;
        const a = state[idx0];
        const b = state[idx1];

        nextState[idx0] = matrix[0][0] * a + matrix[0][1] * b;
        nextState[idx1] = matrix[1][0] * a + matrix[1][1] * b;
    });

    return nextState;
};

const applyCnot = (state, control) => {
    if (control === 0) {
        return [state[0], state[1], state[3], state[2]];
    }

    return [state[0], state[3], state[2], state[1]];
};

const applySwap = (state) => [state[0], state[2], state[1], state[3]];

const applyQuantumGate = (state, gate) => {
    if (gate.type === "single") {
        return applySingleQubitGate(state, gate.matrix, gate.target);
    }

    if (gate.type === "cnot") {
        return applyCnot(state, gate.control);
    }

    return applySwap(state);
};

const computeClassical = () => {
    let bit = appState.classicalInput;
    const auxiliaryBit = appState.classicalAuxiliaryBit;
    const steps = [
        {
            label: "入力",
            value: `${bit} | 補助 ${auxiliaryBit}`,
            meta: "初期状態"
        }
    ];

    appState.classicalCircuit.forEach((gateName) => {
        const gate = classicalGateByName[gateName];
        bit = gate.apply(bit, auxiliaryBit);
        steps.push({
            label: gateName,
            value: `${bit} | 補助 ${auxiliaryBit}`,
            meta: gate.desc
        });
    });

    return { bit, auxiliaryBit, steps };
};

const computeQuantum = () => {
    let state = basisVector(appState.quantumInput);
    const steps = [
        {
            label: `|${appState.quantumInput}⟩`,
            state: [...state],
            meta: "初期状態"
        }
    ];

    appState.quantumCircuit.forEach((gateName) => {
        const gate = quantumGateByName[gateName];
        state = applyQuantumGate(state, gate);
        steps.push({
            label: gateName,
            state: [...state],
            meta: gate.desc
        });
    });

    const rawProbabilities = state.map((amplitude) => amplitude * amplitude * 100);
    const total = rawProbabilities.reduce((sum, probability) => sum + probability, 0);
    const probabilities = total > 0
        ? rawProbabilities.map((probability) => (probability / total) * 100)
        : rawProbabilities;

    return {
        state,
        probabilities,
        steps
    };
};

const resetMeasurements = () => {
    appState.measurements = [];
};

const updateQuantumConfiguration = (updater) => {
    updater();
    resetMeasurements();
    render();
};

const renderChoiceButtons = (container, options, activeValue, formatter, onClick) => {
    if (!container) {
        return;
    }

    container.innerHTML = "";

    options.forEach((option) => {
        const button = document.createElement("button");

        button.type = "button";
        button.className = "choice-pill";
        button.textContent = formatter(option);
        button.classList.toggle("is-active", option === activeValue);
        button.addEventListener("click", () => onClick(option));
        container.appendChild(button);
    });
};

const renderGateButtons = (container, gates, onClick) => {
    if (!container) {
        return;
    }

    container.innerHTML = "";

    gates.forEach((gate) => {
        const button = document.createElement("button");
        const title = document.createElement("strong");
        const desc = document.createElement("span");

        button.type = "button";
        button.className = "gate-button";
        title.textContent = gate.name;
        desc.textContent = gate.desc;
        button.append(title, desc);
        button.addEventListener("click", () => onClick(gate.name));
        container.appendChild(button);
    });
};

const appendArrow = (container) => {
    const arrow = document.createElement("span");

    arrow.className = "flow-arrow";
    arrow.textContent = "→";
    container.appendChild(arrow);
};

const createCircuitNode = (label, extraClass = "") => {
    const node = document.createElement("span");

    node.className = `circuit-node ${extraClass}`.trim();
    node.textContent = label;

    return node;
};

const createGateChip = (gateName, onRemove) => {
    const chip = document.createElement("span");
    const label = document.createElement("strong");
    const remove = document.createElement("button");

    chip.className = "gate-chip";
    label.textContent = gateName;
    remove.type = "button";
    remove.className = "gate-remove";
    remove.setAttribute("aria-label", `${gateName} を削除`);
    remove.textContent = "×";
    remove.addEventListener("click", onRemove);
    chip.append(label, remove);

    return chip;
};

const renderCircuitFlow = (container, inputLabel, circuit, outputLabel, removeGate) => {
    if (!container) {
        return;
    }

    container.innerHTML = "";
    container.appendChild(createCircuitNode(inputLabel));
    appendArrow(container);

    if (circuit.length === 0) {
        const empty = document.createElement("span");

        empty.className = "empty-chip";
        empty.textContent = "ゲートなし";
        container.appendChild(empty);
    } else {
        circuit.forEach((gateName, index) => {
            container.appendChild(createGateChip(gateName, () => removeGate(index)));
            appendArrow(container);
        });
    }

    container.appendChild(createCircuitNode(outputLabel.label, outputLabel.className));
};

const createDiagramGrid = (container, rowCount, gateSlots) => {
    if (!container) {
        return null;
    }

    const grid = document.createElement("div");
    const totalColumns = gateSlots + 3;

    container.innerHTML = "";
    grid.className = "circuit-diagram";
    grid.style.gridTemplateColumns = `72px repeat(${totalColumns - 1}, minmax(64px, 1fr))`;
    grid.style.gridTemplateRows = `repeat(${rowCount}, 72px)`;
    container.appendChild(grid);

    return { grid, totalColumns };
};

const createDiagramLabel = (labelText, row) => {
    const label = document.createElement("span");

    label.className = "diagram-label";
    label.textContent = labelText;
    label.style.gridRow = String(row);
    label.style.gridColumn = "1";

    return label;
};

const createDiagramWire = (row, totalColumns, extraClass = "") => {
    const wire = document.createElement("span");

    wire.className = `diagram-wire ${extraClass}`.trim();
    wire.style.gridRow = String(row);
    wire.style.gridColumn = `2 / ${totalColumns + 1}`;

    return wire;
};

const createDiagramStateNode = (text, row, column, extraClass = "") => {
    const node = document.createElement("span");

    node.className = `diagram-state ${extraClass}`.trim();
    node.textContent = text;
    node.style.gridRow = String(row);
    node.style.gridColumn = String(column);

    return node;
};

const createDiagramGate = (labelText, row, column, extraClass = "") => {
    const gate = document.createElement("span");

    gate.className = `diagram-gate ${extraClass}`.trim();
    gate.textContent = labelText;
    gate.style.gridRow = String(row);
    gate.style.gridColumn = String(column);

    return gate;
};

const createDiagramBridgeGate = (labelText, column, extraClass = "") => {
    const gate = document.createElement("span");

    gate.className = `diagram-gate diagram-gate-bridge ${extraClass}`.trim();
    gate.textContent = labelText;
    gate.style.gridRow = "1 / span 2";
    gate.style.gridColumn = String(column);

    return gate;
};

const createDiagramPlaceholder = (rowCount, column, text) => {
    const placeholder = document.createElement("span");

    placeholder.className = "diagram-placeholder";
    placeholder.textContent = text;
    placeholder.style.gridRow = `1 / span ${rowCount}`;
    placeholder.style.gridColumn = String(column);

    return placeholder;
};

const createQuantumBridge = (column, topKind, bottomKind, extraClass = "") => {
    const bridge = document.createElement("div");
    const line = document.createElement("span");
    const topNode = document.createElement("span");
    const bottomNode = document.createElement("span");

    bridge.className = `diagram-bridge ${extraClass}`.trim();
    bridge.style.gridRow = "1 / span 2";
    bridge.style.gridColumn = String(column);

    line.className = "diagram-bridge-line";
    topNode.className = `diagram-bridge-node is-${topKind}`;
    bottomNode.className = `diagram-bridge-node is-${bottomKind}`;
    topNode.style.gridRow = "1";
    bottomNode.style.gridRow = "2";

    if (topKind === "target") {
        topNode.textContent = "+";
    }
    if (bottomKind === "target") {
        bottomNode.textContent = "+";
    }
    if (topKind === "swap") {
        topNode.textContent = "×";
    }
    if (bottomKind === "swap") {
        bottomNode.textContent = "×";
    }

    bridge.append(line, topNode, bottomNode);

    return bridge;
};

const renderClassicalCircuitDiagram = (classical) => {
    const gateSlots = Math.max(appState.classicalCircuit.length, 1);
    const diagram = createDiagramGrid(dom.classicalCircuitDiagram, 2, gateSlots);

    if (!diagram) {
        return;
    }

    const { grid, totalColumns } = diagram;

    grid.append(
        createDiagramWire(1, totalColumns, "is-classical"),
        createDiagramWire(2, totalColumns, "is-classical is-secondary"),
        createDiagramLabel("main", 1),
        createDiagramLabel("aux", 2),
        createDiagramStateNode(String(appState.classicalInput), 1, 2, "is-classical is-input"),
        createDiagramStateNode(String(appState.classicalAuxiliaryBit), 2, 2, "is-classical is-secondary is-input"),
        createDiagramStateNode(String(classical.bit), 1, totalColumns, "is-classical is-output"),
        createDiagramStateNode(String(classical.auxiliaryBit), 2, totalColumns, "is-classical is-secondary is-output")
    );

    if (appState.classicalCircuit.length === 0) {
        grid.appendChild(createDiagramPlaceholder(2, 3, "直通"));
        return;
    }

    appState.classicalCircuit.forEach((gateName, index) => {
        const gate = classicalGateByName[gateName];
        const column = index + 3;

        if (gate.kind === "binary") {
            grid.appendChild(createDiagramBridgeGate(gate.name, column, "is-classical is-binary"));
            return;
        }

        grid.appendChild(createDiagramGate(gate.name, 1, column, "is-classical"));
    });
};

const renderQuantumCircuitDiagram = () => {
    const gateSlots = Math.max(appState.quantumCircuit.length, 1);
    const diagram = createDiagramGrid(dom.quantumCircuitDiagram, 2, gateSlots);

    if (!diagram) {
        return;
    }

    const { grid, totalColumns } = diagram;
    const [inputQ0, inputQ1] = appState.quantumInput.split("");

    grid.append(
        createDiagramWire(1, totalColumns, "is-quantum"),
        createDiagramWire(2, totalColumns, "is-quantum is-secondary"),
        createDiagramLabel("q0", 1),
        createDiagramLabel("q1", 2),
        createDiagramStateNode(`|${inputQ0}⟩`, 1, 2, "is-quantum is-input"),
        createDiagramStateNode(`|${inputQ1}⟩`, 2, 2, "is-quantum is-input is-secondary"),
        createDiagramStateNode("M", 1, totalColumns, "is-quantum is-output is-measure"),
        createDiagramStateNode("M", 2, totalColumns, "is-quantum is-output is-measure")
    );

    if (appState.quantumCircuit.length === 0) {
        grid.appendChild(createDiagramPlaceholder(2, 3, "直通"));
        return;
    }

    appState.quantumCircuit.forEach((gateName, index) => {
        const gate = quantumGateByName[gateName];
        const column = index + 3;

        if (gate.type === "single") {
            grid.appendChild(createDiagramGate(gate.name.split(" ")[0], gate.target + 1, column, "is-quantum"));
            return;
        }

        if (gate.type === "cnot") {
            const topKind = gate.control === 0 ? "control" : "target";
            const bottomKind = gate.control === 0 ? "target" : "control";

            grid.appendChild(createQuantumBridge(column, topKind, bottomKind, "is-cnot"));
            return;
        }

        grid.appendChild(createQuantumBridge(column, "swap", "swap", "is-swap"));
    });
};

const renderSteps = (container, items, formatter) => {
    if (!container) {
        return;
    }

    container.innerHTML = "";

    items.forEach((item) => {
        const li = document.createElement("li");
        const top = document.createElement("div");
        const label = document.createElement("span");
        const value = document.createElement("strong");
        const meta = document.createElement("p");

        li.className = "step-item";
        top.className = "step-top";
        label.className = "step-label";
        value.className = "step-value";
        meta.className = "step-meta";
        label.textContent = item.label;
        value.textContent = formatter(item);
        meta.textContent = item.meta;
        top.append(label, value);
        li.append(top, meta);
        container.appendChild(li);
    });
};

const renderProbabilityGrid = (probabilities) => {
    if (!dom.basisProbabilityGrid) {
        return;
    }

    dom.basisProbabilityGrid.innerHTML = "";

    basisLabels.forEach((basisLabel, index) => {
        const card = document.createElement("div");
        const header = document.createElement("div");
        const label = document.createElement("span");
        const value = document.createElement("strong");
        const track = document.createElement("div");
        const fill = document.createElement("span");

        card.className = "probability-card";
        header.className = "probability-header";
        track.className = "probability-track";
        fill.className = `probability-fill basis-${basisLabel}`;
        fill.style.width = `${clampPercent(probabilities[index])}%`;
        label.textContent = `測定で |${basisLabel}⟩ が出る確率`;
        value.textContent = `${probabilities[index].toFixed(1)}%`;
        header.append(label, value);
        track.appendChild(fill);
        card.append(header, track);
        dom.basisProbabilityGrid.appendChild(card);
    });
};

const renderMeasurementHistory = (measurements) => {
    if (!dom.measurementHistory || !dom.measurementSummary) {
        return;
    }

    dom.measurementHistory.innerHTML = "";

    if (measurements.length === 0) {
        dom.measurementSummary.textContent = "まだ測定していません。";
        return;
    }

    const counts = measurements.reduce(
        (accumulator, measurement) => {
            accumulator[measurement] += 1;
            return accumulator;
        },
        { "00": 0, "01": 0, "10": 0, "11": 0 }
    );

    dom.measurementSummary.textContent = `最近 ${measurements.length} 回の測定: |00⟩ ${counts["00"]} 回, |01⟩ ${counts["01"]} 回, |10⟩ ${counts["10"]} 回, |11⟩ ${counts["11"]} 回。`;

    measurements.forEach((measurement) => {
        const pill = document.createElement("span");

        pill.className = `measurement-pill is-basis-${measurement}`;
        pill.textContent = measurement;
        dom.measurementHistory.appendChild(pill);
    });
};

const approximatelyEquals = (state, targetState, tolerance = 1e-6) => state.every(
    (value, index) => Math.abs(value - targetState[index]) < tolerance
);

const describeQuantumState = (state, probabilities) => {
    const half = 1 / Math.sqrt(2);
    const bellStates = [
        { state: [half, 0, 0, half], note: "Bell 状態 |Φ+⟩ です。2 量子ビットがもつれています。" },
        { state: [half, 0, 0, -half], note: "Bell 状態 |Φ−⟩ です。位相差まで含めて 2 量子ビットが結びついています。" },
        { state: [0, half, half, 0], note: "Bell 状態 |Ψ+⟩ です。|01⟩ と |10⟩ が対になって現れます。" },
        { state: [0, half, -half, 0], note: "Bell 状態 |Ψ−⟩ です。反対符号の干渉を持つもつれ状態です。" }
    ];

    const matchedBell = bellStates.find((candidate) => approximatelyEquals(state, candidate.state));

    if (matchedBell) {
        return matchedBell.note;
    }

    const activeBasisCount = probabilities.filter((probability) => probability > 0.1).length;

    if (activeBasisCount === 1) {
        return "今は測定結果がほぼ 1 つに決まる基底状態です。";
    }

    if (activeBasisCount === 2) {
        return "今は 2 つの基底状態が重なっています。CNOT を足すと相関のある状態へ進めます。";
    }

    if (appState.quantumCircuit.some((gateName) => gateName.startsWith("CNOT") || gateName === "SWAP")) {
        return "CNOT や SWAP を含むので、2 量子ビットの相関や役割の入れ替えが結果に効いています。";
    }

    return "Z は確率を変えなくても符号を変え、あとから H や CNOT と組み合わさると結果に現れます。";
};

const sampleMeasurement = (probabilities) => {
    const randomValue = Math.random() * 100;
    let total = 0;

    for (let index = 0; index < probabilities.length; index += 1) {
        total += probabilities[index];
        if (randomValue <= total) {
            return basisLabels[index];
        }
    }

    return basisLabels[basisLabels.length - 1];
};

const renderExamples = () => {
    dom.exampleButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const example = button.dataset.example;

            if (example === "classical-double-not") {
                appState.classicalInput = 0;
                appState.classicalAuxiliaryBit = 1;
                appState.classicalCircuit = ["NOT", "NOT"];
                appState.quantumInput = "00";
                appState.quantumCircuit = [];
            }

            if (example === "quantum-superposition") {
                appState.classicalInput = 0;
                appState.classicalAuxiliaryBit = 1;
                appState.classicalCircuit = ["BUF"];
                appState.quantumInput = "00";
                appState.quantumCircuit = ["H q0"];
            }

            if (example === "quantum-cnot") {
                appState.classicalInput = 1;
                appState.classicalAuxiliaryBit = 0;
                appState.classicalCircuit = ["BUF"];
                appState.quantumInput = "10";
                appState.quantumCircuit = ["CNOT q0→q1"];
            }

            if (example === "quantum-bell") {
                appState.classicalInput = 0;
                appState.classicalAuxiliaryBit = 1;
                appState.classicalCircuit = ["NOT"];
                appState.quantumInput = "00";
                appState.quantumCircuit = ["H q0", "CNOT q0→q1"];
            }

            resetMeasurements();
            render();
            document.querySelector("#compare")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    });
};

const render = () => {
    const classical = computeClassical();
    const quantum = computeQuantum();

    renderChoiceButtons(dom.classicalInputButtons, [0, 1], appState.classicalInput, String, (value) => {
        appState.classicalInput = value;
        render();
    });

    renderChoiceButtons(dom.classicalAuxButtons, [0, 1], appState.classicalAuxiliaryBit, String, (value) => {
        appState.classicalAuxiliaryBit = value;
        render();
    });

    renderChoiceButtons(dom.quantumInputButtons, basisLabels, appState.quantumInput, (value) => `|${value}⟩`, (value) => {
        updateQuantumConfiguration(() => {
            appState.quantumInput = value;
        });
    });

    renderGateButtons(dom.classicalGateButtons, classicalGates, (gateName) => {
        appState.classicalCircuit = [...appState.classicalCircuit, gateName];
        render();
    });

    renderGateButtons(dom.quantumGateButtons, quantumGates, (gateName) => {
        updateQuantumConfiguration(() => {
            appState.quantumCircuit = [...appState.quantumCircuit, gateName];
        });
    });

    renderCircuitFlow(
        dom.classicalCircuitFlow,
        `${appState.classicalInput} | 補助 ${appState.classicalAuxiliaryBit}`,
        appState.classicalCircuit,
        { label: String(classical.bit), className: "circuit-node-output" },
        (index) => {
            appState.classicalCircuit = appState.classicalCircuit.filter((_, itemIndex) => itemIndex !== index);
            render();
        }
    );

    renderCircuitFlow(
        dom.quantumCircuitFlow,
        `|${appState.quantumInput}⟩`,
        appState.quantumCircuit,
        { label: "測定", className: "circuit-node-measure" },
        (index) => {
            updateQuantumConfiguration(() => {
                appState.quantumCircuit = appState.quantumCircuit.filter((_, itemIndex) => itemIndex !== index);
            });
        }
    );

    renderClassicalCircuitDiagram(classical);
    renderQuantumCircuitDiagram();

    if (dom.classicalResultValue) {
        dom.classicalResultValue.textContent = String(classical.bit);
    }

    if (dom.classicalResultNote) {
        dom.classicalResultNote.textContent = classical.steps.length === 1
            ? `補助ビット ${classical.auxiliaryBit} を固定しています。ゲートがないので、出力は入力 ${classical.bit} と同じです。`
            : `補助ビット ${classical.auxiliaryBit} を使った現在の出力は ${classical.bit} です。`;
    }

    if (dom.quantumStateValue) {
        dom.quantumStateValue.textContent = formatState(quantum.state);
    }

    if (dom.quantumPhaseNote) {
        dom.quantumPhaseNote.textContent = describeQuantumState(quantum.state, quantum.probabilities);
    }

    renderProbabilityGrid(quantum.probabilities);
    renderSteps(dom.classicalSteps, classical.steps, (item) => item.value);
    renderSteps(dom.quantumSteps, quantum.steps, (item) => formatState(item.state));
    renderMeasurementHistory(appState.measurements);
};

dom.clearClassicalCircuit?.addEventListener("click", () => {
    appState.classicalCircuit = [];
    render();
});

dom.clearQuantumCircuit?.addEventListener("click", () => {
    updateQuantumConfiguration(() => {
        appState.quantumCircuit = [];
    });
});

dom.measureQuantum?.addEventListener("click", () => {
    const quantum = computeQuantum();
    const result = sampleMeasurement(quantum.probabilities);

    appState.measurements = [result, ...appState.measurements].slice(0, 20);
    renderMeasurementHistory(appState.measurements);
});

dom.resetMeasurements?.addEventListener("click", () => {
    resetMeasurements();
    renderMeasurementHistory(appState.measurements);
});

renderExamples();
render();