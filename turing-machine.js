const dom = {
    sampleSelect: document.querySelector("#sampleSelect"),
    inputTape: document.querySelector("#inputTape"),
    speed: document.querySelector("#speed"),
    speedText: document.querySelector("#speedText"),
    loadBtn: document.querySelector("#loadBtn"),
    stepBtn: document.querySelector("#stepBtn"),
    runBtn: document.querySelector("#runBtn"),
    resetBtn: document.querySelector("#resetBtn"),
    sampleSummary: document.querySelector("#sampleSummary"),
    observeTitle: document.querySelector("#observeTitle"),
    observeText: document.querySelector("#observeText"),
    tape: document.querySelector("#tape"),
    stateBadge: document.querySelector("#stateBadge"),
    statusChip: document.querySelector("#statusChip"),
    message: document.querySelector("#message"),
    stepCount: document.querySelector("#stepCount"),
    headPos: document.querySelector("#headPos"),
    readSymbol: document.querySelector("#readSymbol"),
    outputTape: document.querySelector("#outputTape"),
    currentRuleBox: document.querySelector("#currentRuleBox"),
    rulesText: document.querySelector("#rulesText"),
    parseNote: document.querySelector("#parseNote"),
    ruleTable: document.querySelector("#ruleTable")
};

const samples = {
    appendOne: {
        name: "1の列の末尾に1を追加",
        input: "111",
        start: "q0",
        summary: "1 が続く間は右へ進み、最初の空白を見つけたら 1 を書いて止まる最小の末尾追加機械です。",
        observeTitle: "空白を見つけるまで右へ進む",
        observeText: "同じ規則を繰り返し使い、入力の終わりに着いた瞬間だけ別の規則へ切り替わります。末尾探索と追記の分離が見どころです。",
        rules: `# 1が続く間は右へ進む
q0 1 1 R q0
# 空白を見つけたら1を書いて停止
q0 _ 1 N HALT`
    },
    invertBits: {
        name: "0と1を反転する",
        input: "1011001",
        start: "q0",
        summary: "0 なら 1、1 なら 0 へ書き換えながら右へ進み、空白に着いたら停止する反転機械です。",
        observeTitle: "読む記号ごとに書き換えが分かれる",
        observeText: "状態は 1 つしかありませんが、読んだ記号によって別の規則が選ばれるため、条件分岐として働いています。",
        rules: `# 0なら1にする
q0 0 1 R q0
# 1なら0にする
q0 1 0 R q0
# 空白で停止
q0 _ _ N HALT`
    },
    unaryAdd: {
        name: "単項足し算 111+11 → 11111",
        input: "111+11",
        start: "q0",
        summary: "+ を消して左右の 1 列をつなぎ、最後の 1 を 1 つ消すことで単項加算を表すサンプルです。",
        observeTitle: "状態を切り替えて段階を分ける",
        observeText: "右へ進む段階、末尾から戻る段階、最後に消す段階を状態で分けています。状態が手続きの段階分けとして使われます。",
        rules: `# 左の1を飛ばす
q0 1 1 R q0
# + を見つけたら空白にして右へ
q0 + _ R q1
# 右側の1を飛ばす
q1 1 1 R q1
# 末尾の空白を見つけたら左へ戻る
q1 _ _ L q2
# 最後の1を消して停止
q2 1 _ N HALT`
    },
    binaryIncrement: {
        name: "2進数に1を足す",
        input: "1011",
        start: "q0",
        summary: "まず右端まで進み、そこから左へ戻りながら繰り上がりを処理する 2 進インクリメント機械です。",
        observeTitle: "右端探索と繰り上がり処理を分離する",
        observeText: "繰り上がりが続く限り 1 を 0 に変えて左へ進み、初めて 0 を見つけたら 1 に変えて止まります。",
        rules: `# まず右端へ移動
q0 0 0 R q0
q0 1 1 R q0
q0 _ _ L q1
# 右端から繰り上がり処理
q1 0 1 N HALT
q1 1 0 L q1
q1 _ 1 N HALT`
    },
    eraseTape: {
        name: "テープを全部消去する",
        input: "1011011",
        start: "q0",
        summary: "0 と 1 を見つけるたびに空白へ書き換え、空白に着いたら停止する消去機械です。書き込みが記憶の削除にも使えることが分かります。",
        observeTitle: "書き込み先を空白にする",
        observeText: "動きそのものは右へ進むだけですが、書く記号を _ にすることでテープ内容を消せます。読む・書く・進むの組み合わせだけで破壊的更新が表せます。",
        rules: `# 0と1を順に消していく
q0 0 _ R q0
q0 1 _ R q0
# 空白に来たら停止
q0 _ _ N HALT`
    },
    findFirstZero: {
        name: "最初の0を1に変えて止まる",
        input: "1110111",
        start: "q0",
        summary: "左から右へ読み進め、最初に見つかった 0 だけを 1 に変えて停止する探索機械です。条件一致で止まる流れを観察できます。",
        observeTitle: "条件に当たった瞬間だけ止まる",
        observeText: "1 を読んでいる間は同じ規則で進み、0 を見つけた瞬間だけ別の規則が選ばれます。探索と一致判定の最小例として扱いやすい機械です。",
        rules: `# 1 を飛ばしながら 0 を探す
q0 1 1 R q0
# 最初の 0 だけを 1 に変えて停止
q0 0 1 N HALT
# 0 が見つからなければ空白で停止
q0 _ _ N HALT`
    },
    returnToLeftEdge: {
        name: "右端まで行って左端へ戻る",
        input: "1011",
        start: "q0",
        summary: "まず右端の空白まで進み、そこから左へ戻って左端の最初の記号位置で停止する往復機械です。状態で進行方向を切り替える例として使えます。",
        observeTitle: "状態で進行方向を切り替える",
        observeText: "右へ探す段階と左へ戻る段階を別状態に分けることで、同じ 0 と 1 の上でも逆向きの振る舞いを作れます。",
        rules: `# まず右端の空白まで進む
q0 0 0 R q0
q0 1 1 R q0
q0 _ _ L q1
# 左端の手前の空白まで戻る
q1 0 0 L q1
q1 1 1 L q1
q1 _ _ R HALT`
    },
    parityMarker: {
        name: "1の個数の偶奇を末尾へ書く",
        input: "10111",
        start: "qEven",
        summary: "1 を読むたびに偶数状態と奇数状態を切り替え、最後の空白に E または O を書いて停止する機械です。状態そのものが小さな記憶として働きます。",
        observeTitle: "状態が 1 ビットの記憶になる",
        observeText: "0 は無視し、1 を読むたびに qEven と qOdd を行き来します。テープを書き換えなくても、状態だけで過去の読み取り結果を要約できることが分かります。",
        rules: `# 1 を読むたびに偶奇状態を切り替える
qEven 1 1 R qOdd
qOdd 1 1 R qEven
# 0 は読み飛ばす
qEven 0 0 R qEven
qOdd 0 0 R qOdd
# 末尾に偶奇結果を書いて停止
qEven _ E N HALT
qOdd _ O N HALT`
    }
};

const appState = {
    tape: new Map(),
    head: 0,
    state: "q0",
    startState: "q0",
    steps: 0,
    rules: new Map(),
    parsedRules: [],
    halted: false,
    running: false,
    timerId: null,
    lastRule: null,
    currentSampleKey: "appendOne",
    stopReason: "ready"
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

function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, (character) => (
        {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            "\"": "&quot;"
        }[character]
    ));
}

function populateSamples() {
    Object.entries(samples).forEach(([key, sample]) => {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = sample.name;
        dom.sampleSelect.append(option);
    });
}

function loadSample(sampleKey) {
    const sample = samples[sampleKey];
    appState.currentSampleKey = sampleKey;
    appState.startState = sample.start;
    dom.sampleSelect.value = sampleKey;
    dom.inputTape.value = sample.input;
    dom.rulesText.value = sample.rules;
    dom.sampleSummary.textContent = sample.summary;
    dom.observeTitle.textContent = sample.observeTitle;
    dom.observeText.textContent = sample.observeText;
    resetMachine();
}

function parseRules() {
    const ruleMap = new Map();
    const parsedRules = [];
    const invalidLines = [];
    const lines = dom.rulesText.value.split("\n");

    lines.forEach((rawLine, index) => {
        const trimmed = rawLine.trim();

        if (!trimmed || trimmed.startsWith("#")) {
            return;
        }

        const parts = trimmed.split(/\s+/);
        if (parts.length !== 5) {
            invalidLines.push(index + 1);
            return;
        }

        const [from, read, write, moveValue, to] = parts;
        const move = moveValue.toUpperCase();
        const key = `${from}|${read}`;
        const rule = {
            key,
            from,
            read,
            write,
            move,
            to,
            line: index + 1
        };

        ruleMap.set(key, rule);
        parsedRules.push(rule);
    });

    appState.rules = ruleMap;
    appState.parsedRules = parsedRules;
    renderRuleTable(parsedRules);

    if (invalidLines.length > 0) {
        dom.parseNote.textContent = `5 項目に分かれない行を無視しました: ${invalidLines.join(", ")}`;
        dom.parseNote.classList.add("is-error");
    } else {
        dom.parseNote.textContent = `${parsedRules.length} 個の規則を読み込みました。`;
        dom.parseNote.classList.remove("is-error");
    }
}

function renderRuleTable(parsedRules) {
    const body = parsedRules.length > 0
        ? parsedRules.map((rule) => `
            <tr data-rule-key="${escapeHtml(rule.key)}">
                <td>${escapeHtml(rule.from)}</td>
                <td>${escapeHtml(rule.read)}</td>
                <td>${escapeHtml(rule.write)}</td>
                <td>${escapeHtml(rule.move)}</td>
                <td>${escapeHtml(rule.to)}</td>
            </tr>
        `).join("")
        : "<tr><td colspan=\"5\">規則がありません。</td></tr>";

    dom.ruleTable.innerHTML = `
        <thead>
            <tr>
                <th>状態</th>
                <th>読む</th>
                <th>書く</th>
                <th>移動</th>
                <th>次状態</th>
            </tr>
        </thead>
        <tbody>${body}</tbody>
    `;
}

function seedTapeFromInput() {
    appState.tape = new Map();
    const input = dom.inputTape.value || "";

    for (let index = 0; index < input.length; index += 1) {
        const symbol = input[index] === " " ? "_" : input[index];
        if (symbol !== "_") {
            appState.tape.set(index, symbol);
        }
    }
}

function readTape(position) {
    return appState.tape.get(position) || "_";
}

function writeTape(position, symbol) {
    if (symbol === "_") {
        appState.tape.delete(position);
        return;
    }

    appState.tape.set(position, symbol);
}

function getOutputTape() {
    if (appState.tape.size === 0) {
        return "_";
    }

    const positions = [...appState.tape.keys()];
    const min = Math.min(...positions);
    const max = Math.max(...positions);
    let output = "";

    for (let position = min; position <= max; position += 1) {
        output += readTape(position);
    }

    return output.replace(/^_+|_+$/g, "") || "_";
}

function getVisibleWindow() {
    return {
        min: appState.head - 11,
        max: appState.head + 11
    };
}

function renderTape() {
    const { min, max } = getVisibleWindow();
    dom.tape.innerHTML = "";

    for (let position = min; position <= max; position += 1) {
        const cellBox = document.createElement("div");
        cellBox.className = "cell-box";

        if (position === appState.head) {
            const headMark = document.createElement("div");
            headMark.className = "head-mark";
            headMark.textContent = "HEAD";
            cellBox.append(headMark);
        }

        const cell = document.createElement("div");
        cell.className = position === appState.head ? "cell is-head" : "cell";
        cell.textContent = readTape(position);

        const index = document.createElement("div");
        index.className = "index";
        index.textContent = String(position);

        cellBox.append(cell, index);
        dom.tape.append(cellBox);
    }
}

function updateRuleHighlights() {
    const nextRule = appState.rules.get(`${appState.state}|${readTape(appState.head)}`);
    dom.ruleTable.querySelectorAll("tbody tr").forEach((row) => {
        row.classList.remove("is-next", "is-last");
        const rowKey = row.dataset.ruleKey;

        if (nextRule && rowKey === nextRule.key && !appState.halted) {
            row.classList.add("is-next");
        }

        if (appState.lastRule && rowKey === appState.lastRule.key) {
            row.classList.add("is-last");
        }
    });
}

function updateStatusChip() {
    dom.statusChip.className = "status-chip";

    if (appState.running) {
        dom.statusChip.textContent = "自動実行中";
        dom.statusChip.classList.add("is-running");
        return;
    }

    if (appState.halted && appState.stopReason === "halt") {
        dom.statusChip.textContent = "正常停止";
        dom.statusChip.classList.add("is-halted");
        return;
    }

    if (appState.halted) {
        dom.statusChip.textContent = "規則なしで停止";
        dom.statusChip.classList.add("is-error");
        return;
    }

    dom.statusChip.textContent = "待機中";
}

function renderRuleFocus() {
    if (appState.lastRule) {
        dom.currentRuleBox.innerHTML = `
            <strong>直前に適用した規則</strong><br>
            状態 <code>${escapeHtml(appState.lastRule.from)}</code> で <code>${escapeHtml(appState.lastRule.read)}</code> を読み、
            <code>${escapeHtml(appState.lastRule.write)}</code> を書いて <code>${escapeHtml(appState.lastRule.move)}</code> に動き、
            状態 <code>${escapeHtml(appState.lastRule.to)}</code> へ移りました。
        `;
        return;
    }

    const nextRule = appState.rules.get(`${appState.state}|${readTape(appState.head)}`);
    if (nextRule && !appState.halted) {
        dom.currentRuleBox.innerHTML = `
            <strong>次に適用される規則</strong><br>
            <code>${escapeHtml(nextRule.from)} ${escapeHtml(nextRule.read)} ${escapeHtml(nextRule.write)} ${escapeHtml(nextRule.move)} ${escapeHtml(nextRule.to)}</code>
        `;
        return;
    }

    dom.currentRuleBox.textContent = "現在適用できる規則はありません。";
}

function render() {
    renderTape();
    dom.stateBadge.textContent = appState.state;
    dom.message.textContent = dom.message.textContent;
    dom.stepCount.textContent = String(appState.steps);
    dom.headPos.textContent = String(appState.head);
    dom.readSymbol.textContent = readTape(appState.head);
    dom.outputTape.textContent = getOutputTape();
    updateStatusChip();
    renderRuleFocus();
    updateRuleHighlights();
}

function stopRun() {
    appState.running = false;
    if (appState.timerId !== null) {
        window.clearInterval(appState.timerId);
        appState.timerId = null;
    }
    dom.runBtn.textContent = "自動実行";
    dom.runBtn.classList.remove("button-primary");
    dom.runBtn.classList.add("button-secondary");
}

function resetMachine() {
    stopRun();
    parseRules();
    seedTapeFromInput();
    appState.head = 0;
    appState.state = appState.startState;
    appState.steps = 0;
    appState.halted = false;
    appState.lastRule = null;
    appState.stopReason = "ready";
    dom.message.textContent = "準備完了";
    render();
}

function stepMachine() {
    if (appState.halted) {
        render();
        return;
    }

    parseRules();
    const currentSymbol = readTape(appState.head);
    const ruleKey = `${appState.state}|${currentSymbol}`;
    const rule = appState.rules.get(ruleKey);

    if (!rule) {
        appState.halted = true;
        appState.lastRule = null;
        appState.stopReason = "missing-rule";
        dom.message.textContent = `規則がないため停止: (${appState.state}, ${currentSymbol})`;
        stopRun();
        render();
        return;
    }

    writeTape(appState.head, rule.write);

    if (rule.move === "R") {
        appState.head += 1;
    } else if (rule.move === "L") {
        appState.head -= 1;
    } else if (rule.move !== "N") {
        appState.halted = true;
        appState.stopReason = "missing-rule";
        dom.message.textContent = `移動方向が不正です: ${rule.move}`;
        stopRun();
        render();
        return;
    }

    appState.state = rule.to;
    appState.steps += 1;
    appState.lastRule = rule;

    if (appState.state === "HALT") {
        appState.halted = true;
        appState.stopReason = "halt";
        dom.message.textContent = "HALT 状態に到達しました";
        stopRun();
    } else {
        dom.message.textContent = `規則 ${rule.from} / ${rule.read} を適用しました`;
    }

    render();
}

function runMachine() {
    if (appState.running) {
        stopRun();
        render();
        return;
    }

    if (appState.halted) {
        render();
        return;
    }

    appState.running = true;
    dom.runBtn.textContent = "停止";
    dom.runBtn.classList.remove("button-secondary");
    dom.runBtn.classList.add("button-primary");
    render();

    appState.timerId = window.setInterval(() => {
        if (appState.halted) {
            stopRun();
            render();
            return;
        }
        stepMachine();
    }, Number(dom.speed.value));
}

dom.sampleSelect.addEventListener("change", () => {
    loadSample(dom.sampleSelect.value);
});

dom.loadBtn.addEventListener("click", () => {
    resetMachine();
});

dom.stepBtn.addEventListener("click", () => {
    stepMachine();
});

dom.runBtn.addEventListener("click", () => {
    runMachine();
});

dom.resetBtn.addEventListener("click", () => {
    resetMachine();
});

dom.speed.addEventListener("input", () => {
    dom.speedText.textContent = dom.speed.value;
    if (appState.running) {
        stopRun();
        runMachine();
    }
});

populateSamples();
dom.speedText.textContent = dom.speed.value;
loadSample(appState.currentSampleKey);