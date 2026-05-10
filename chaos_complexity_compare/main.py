import numpy as np
import lzma
import csv
from math import sin, cos, pi, log, factorial
from collections import Counter
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

from mutal_information import lagged_mutual_information_curve, lagged_transfer_entropy_curve, lagged_transfer_entropy_directional_curve, summarize_trials

# ----------------------------
# utility
# ----------------------------

def wrap_angle(x):
    return (x + np.pi) % (2 * np.pi) - np.pi

def rk4_step(f, y, dt):
    k1 = f(y)
    k2 = f(y + 0.5 * dt * k1)
    k3 = f(y + 0.5 * dt * k2)
    k4 = f(y + dt * k3)
    return y + dt * (k1 + 2*k2 + 2*k3 + k4) / 6

def rk4_step_batch(f, y, dt):
    k1 = f(y)
    k2 = f(y + 0.5 * dt * k1)
    k3 = f(y + 0.5 * dt * k2)
    k4 = f(y + dt * k3)
    return y + dt * (k1 + 2*k2 + 2*k3 + k4) / 6

def wrap_state_angles(y):
    wrapped = np.array(y, dtype=float, copy=True)
    if len(wrapped) >= 1:
        wrapped[0] = wrap_angle(wrapped[0])
    if len(wrapped) >= 3:
        wrapped[2] = wrap_angle(wrapped[2])
    return wrapped

def wrap_state_angles_batch(y):
    wrapped = np.array(y, dtype=float, copy=True)
    if wrapped.shape[1] >= 1:
        wrapped[:, 0] = wrap_angle(wrapped[:, 0])
    if wrapped.shape[1] >= 3:
        wrapped[:, 2] = wrap_angle(wrapped[:, 2])
    return wrapped

def state_difference(y1, y2):
    diff = np.asarray(y1, dtype=float) - np.asarray(y2, dtype=float)
    if len(diff) >= 1:
        diff[0] = wrap_angle(diff[0])
    if len(diff) >= 3:
        diff[2] = wrap_angle(diff[2])
    return diff

def positive_lyapunov_sum(spectrum, floor=1e-3):
    spectrum = np.asarray(spectrum, dtype=float)
    return float(np.sum(spectrum[spectrum > floor]))

def quantize_bytes(x, bins=256):
    bins = int(bins)
    if bins < 2 or bins > 256:
        raise ValueError("bins must be between 2 and 256 for byte-wise coarse-graining")

    x = np.asarray(x)
    x = (x - x.min()) / (x.max() - x.min() + 1e-12)
    q = np.floor(x * (bins - 1)).astype(np.uint8)
    return q.tobytes()

def lzma_ratio(x, bins=256):
    raw = quantize_bytes(x, bins=bins)
    comp = lzma.compress(raw, preset=9)
    return len(comp) / len(raw)

def lz_complexity_binary(x):
    """
    Lempel-Ziv 76風の簡易複雑度。
    時系列を中央値で2値化して、未知部分列の数を数える。
    """
    x = np.asarray(x)
    threshold = np.median(x)
    s = ''.join('1' if v > threshold else '0' for v in x)
    n = len(s)
    i, c = 0, 0
    seen = set()

    while i < n:
        j = i + 1
        while j <= n and s[i:j] in seen:
            j += 1
        seen.add(s[i:j])
        c += 1
        i = j

    # ランダム列でおおよそ1に近づく正規化
    return c * np.log2(n) / n

def permutation_entropy(x, order=5, delay=1):
    """
    Bandt-Pompe permutation entropy.
    0〜1に正規化。
    """
    x = np.asarray(x)
    patterns = []

    n = len(x) - delay * (order - 1)
    for i in range(n):
        window = x[i:i + delay * order:delay]
        patterns.append(tuple(np.argsort(window)))

    counts = Counter(patterns)
    probs = np.array(list(counts.values()), dtype=float)
    probs /= probs.sum()

    H = -np.sum(probs * np.log(probs + 1e-15))
    Hmax = log(factorial(order))
    return H / Hmax

# ----------------------------
# single pendulum
# state = [theta, omega]
# ----------------------------

def single_pendulum_dynamics(g=9.81, L=1.0):
    def f(y):
        theta, omega = y
        return np.array([
            omega,
            -(g / L) * sin(theta)
        ])
    return f

# ----------------------------
# double pendulum
# equal masses and lengths
# state = [theta1, omega1, theta2, omega2]
# ----------------------------

def double_pendulum_dynamics(g=9.81, L=1.0, m=1.0):
    def f(y):
        th1, w1, th2, w2 = y
        delta = th1 - th2

        denom1 = L * (2*m - m*cos(2*delta))
        denom2 = L * (2*m - m*cos(2*delta))

        dw1 = (
            -g*(2*m)*sin(th1)
            - m*g*sin(th1 - 2*th2)
            - 2*sin(delta)*m*(w2*w2*L + w1*w1*L*cos(delta))
        ) / denom1

        dw2 = (
            2*sin(delta) * (
                w1*w1*L*m
                + g*m*cos(th1)
                + w2*w2*L*m*cos(delta)
            )
        ) / denom2

        return np.array([w1, dw1, w2, dw2])
    return f

def double_pendulum_dynamics_batch(g=9.81, L=1.0, m=1.0):
    def f(y):
        th1 = y[:, 0]
        w1 = y[:, 1]
        th2 = y[:, 2]
        w2 = y[:, 3]
        delta = th1 - th2

        denom1 = L * (2 * m - m * np.cos(2 * delta))
        denom2 = L * (2 * m - m * np.cos(2 * delta))

        dw1 = (
            -g * (2 * m) * np.sin(th1)
            - m * g * np.sin(th1 - 2 * th2)
            - 2 * np.sin(delta) * m * (w2 * w2 * L + w1 * w1 * L * np.cos(delta))
        ) / denom1

        dw2 = (
            2 * np.sin(delta) * (
                w1 * w1 * L * m
                + g * m * np.cos(th1)
                + w2 * w2 * L * m * np.cos(delta)
            )
        ) / denom2

        return np.column_stack((w1, dw1, w2, dw2))

    return f

# ----------------------------
# simulation
# ----------------------------

def advance_state(f, y0, dt=0.01, steps=1):
    y = wrap_state_angles(np.array(y0, dtype=float))

    for _ in range(steps):
        y = wrap_state_angles(rk4_step(f, y, dt))

    return y

def simulate(f, y0, dt=0.01, steps=60000, discard=5000, observe_index=0):
    y = wrap_state_angles(np.array(y0, dtype=float))
    data = []

    for i in range(steps):
        y = wrap_state_angles(rk4_step(f, y, dt))

        if i >= discard:
            data.append(y[observe_index])

    return np.array(data)

def simulate_state_series(f, y0, dt=0.01, steps=60000, discard=5000):
    y = wrap_state_angles(np.array(y0, dtype=float))
    states = []

    for i in range(steps):
        y = wrap_state_angles(rk4_step(f, y, dt))

        if i >= discard:
            states.append(y.copy())

    return np.array(states)

def lyapunov_spectrum_benettin(
    f,
    y0,
    dt=0.01,
    steps=60000,
    discard=5000,
    observe_index=0,
    eps=1e-8,
    renorm_steps=25,
):
    y = wrap_state_angles(np.array(y0, dtype=float))
    measured_steps = steps - discard
    state_dim = len(y)

    if measured_steps <= 0:
        raise ValueError("steps must be greater than discard")
    if renorm_steps <= 0:
        raise ValueError("renorm_steps must be positive")

    for _ in range(discard):
        y = wrap_state_angles(rk4_step(f, y, dt))

    basis = np.eye(state_dim, dtype=float)
    perturbed_states = [wrap_state_angles(y + eps * basis[:, col]) for col in range(state_dim)]

    observed = []
    log_sums = np.zeros(state_dim, dtype=float)
    elapsed = 0.0
    completed_steps = 0

    # Benettin: 基準軌道と近傍軌道を同時に進め、QRで伸張率を積算する。
    while completed_steps < measured_steps:
        interval_steps = min(renorm_steps, measured_steps - completed_steps)

        for _ in range(interval_steps):
            y = wrap_state_angles(rk4_step(f, y, dt))
            perturbed_states = [wrap_state_angles(rk4_step(f, yp, dt)) for yp in perturbed_states]
            observed.append(y[observe_index])

        deviation_matrix = np.column_stack([state_difference(yp, y) for yp in perturbed_states])
        q_matrix, r_matrix = np.linalg.qr(deviation_matrix)
        stretches = np.abs(np.diag(r_matrix))

        log_sums += np.log((stretches + 1e-30) / eps)
        elapsed += interval_steps * dt
        completed_steps += interval_steps

        perturbed_states = [wrap_state_angles(y + eps * q_matrix[:, col]) for col in range(state_dim)]

    spectrum = np.sort(log_sums / max(elapsed, 1e-30))[::-1]
    return np.array(observed), spectrum

def lyapunov_exponent(f, y0, dt=0.01, steps=60000, discard=5000, eps=1e-8, renorm_steps=25):
    _, spectrum = lyapunov_spectrum_benettin(
        f,
        y0,
        dt=dt,
        steps=steps,
        discard=discard,
        observe_index=0,
        eps=eps,
        renorm_steps=renorm_steps,
    )
    return float(spectrum[0])

def simulate_with_lyapunov(f, y0, dt=0.01, steps=60000, discard=5000, observe_index=0, eps=1e-8, renorm_steps=25):
    observed, spectrum = lyapunov_spectrum_benettin(
        f,
        y0,
        dt=dt,
        steps=steps,
        discard=discard,
        observe_index=observe_index,
        eps=eps,
        renorm_steps=renorm_steps,
    )
    return observed, float(spectrum[0])

def downsample_series(x, max_points=6000):
    x = np.asarray(x)
    if len(x) <= max_points:
        return x

    indices = np.linspace(0, len(x) - 1, max_points, dtype=int)
    return x[indices]

def complexity_metrics(x, lzma_bins=256):
    x = np.asarray(x, dtype=float)
    return {
        "LZMA_ratio": lzma_ratio(x, bins=lzma_bins),
        "Lempel_Ziv_complexity": lz_complexity_binary(x),
        "Permutation_entropy": permutation_entropy(x, order=5, delay=1),
    }

def lyapunov_component_keys(record):
    return sorted(
        [
            key for key in record.keys()
            if key.startswith("Lyapunov_") and key[len("Lyapunov_"):].isdigit()
        ],
        key=lambda key: int(key.split("_")[1])
    )

def analyze(name, data, spectrum):
    sampled = downsample_series(data, max_points=6000)
    ordered_spectrum = np.sort(np.asarray(spectrum, dtype=float))[::-1]
    record = {
        "system": name,
        **complexity_metrics(sampled),
        "Lyapunov_exponent": float(ordered_spectrum[0]),
        "KS_entropy_Pesin": positive_lyapunov_sum(ordered_spectrum),
        "Positive_lyapunov_count": int(np.sum(ordered_spectrum > 1e-3)),
    }

    for index, value in enumerate(ordered_spectrum, start=1):
        record[f"Lyapunov_{index}"] = float(value)

    record["Pesin_gap_lambda1"] = record["KS_entropy_Pesin"] - record["Lyapunov_exponent"]
    return record, sampled

def scan_double_pendulum_grid(f, theta1_values, theta2_values, dt, steps, discard, observe_index=0, renorm_steps=25):
    records = []
    lyap_grid = np.full((len(theta2_values), len(theta1_values)), np.nan)
    ks_grid = np.full((len(theta2_values), len(theta1_values)), np.nan)
    sampled_series = []

    for row, theta2 in enumerate(theta2_values):
        for col, theta1 in enumerate(theta1_values):
            y0 = [theta1, 0.0, theta2, 0.0]
            series, spectrum = lyapunov_spectrum_benettin(
                f, y0,
                dt=dt,
                steps=steps,
                discard=discard,
                observe_index=observe_index,
                renorm_steps=renorm_steps,
            )
            record, sampled = analyze("double_pendulum", series, spectrum)
            record["theta1_0"] = theta1
            record["theta2_0"] = theta2
            records.append(record)
            sampled_series.append(sampled)
            lyap_grid[row, col] = record["Lyapunov_exponent"]
            ks_grid[row, col] = record["KS_entropy_Pesin"]

    return records, lyap_grid, ks_grid, sampled_series

def label_chaos_regions(records, positive_floor=0.02):
    lyaps = np.array([record["Lyapunov_exponent"] for record in records], dtype=float)
    positive = lyaps[lyaps > positive_floor]

    if len(positive) >= 6:
        weak_cut, strong_cut = np.quantile(positive, [1 / 3, 2 / 3])
        strategy = "positive_tertiles"
    else:
        weak_cut, strong_cut = np.quantile(lyaps, [1 / 3, 2 / 3])
        strategy = "all_tertiles"

    for record in records:
        lyap = record["Lyapunov_exponent"]
        if strategy == "positive_tertiles" and lyap <= positive_floor:
            record["chaos_region"] = "near_regular"
        elif lyap <= weak_cut:
            record["chaos_region"] = "weak_chaos"
        elif lyap >= strong_cut:
            record["chaos_region"] = "strong_chaos"
        else:
            record["chaos_region"] = "intermediate"

    return {
        "strategy": strategy,
        "positive_floor": positive_floor,
        "weak_cut": float(weak_cut),
        "strong_cut": float(strong_cut)
    }

def summarize_region(records, region_name):
    subset = [record for record in records if record["chaos_region"] == region_name]
    summary = {"count": len(subset)}

    if not records:
        return summary

    metric_keys = [
        "LZMA_ratio",
        "Lempel_Ziv_complexity",
        "Permutation_entropy",
        "Lyapunov_exponent",
        "KS_entropy_Pesin",
        "Pesin_gap_lambda1",
    ] + lyapunov_component_keys(records[0])

    for key in metric_keys:
        values = np.array([record[key] for record in subset], dtype=float)
        if len(values) == 0:
            summary[key] = np.nan
            summary[f"{key}_std"] = np.nan
        else:
            summary[key] = float(np.mean(values))
            summary[f"{key}_std"] = float(np.std(values))

    return summary

def save_records_csv(records, output_path):
    spectrum_keys = lyapunov_component_keys(records[0]) if records else []
    fieldnames = [
        "theta1_0",
        "theta2_0",
        "Lyapunov_exponent",
        *spectrum_keys,
        "KS_entropy_Pesin",
        "Positive_lyapunov_count",
        "Pesin_gap_lambda1",
        "LZMA_ratio",
        "Lempel_Ziv_complexity",
        "Permutation_entropy",
        "chaos_region"
    ]

    with output_path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        for record in records:
            writer.writerow({key: record[key] for key in fieldnames})

def generate_matched_white_noise(sampled_series, rng):
    sampled_series = np.asarray(sampled_series, dtype=float)
    mean = float(np.mean(sampled_series))
    std = float(np.std(sampled_series))
    return rng.normal(loc=mean, scale=max(std, 1e-12), size=len(sampled_series))

def compare_chaos_to_random_noise(records, sampled_series, source_regions, trials_per_series=16, seed=20260510):
    rng = np.random.default_rng(seed)
    metric_keys = ["LZMA_ratio", "Lempel_Ziv_complexity", "Permutation_entropy"]
    noise_records = []

    for source_index, (record, sampled) in enumerate(zip(records, sampled_series)):
        region_name = record["chaos_region"]
        if region_name not in source_regions:
            continue

        for trial in range(trials_per_series):
            noise_series = generate_matched_white_noise(sampled, rng)
            noise_metrics = complexity_metrics(noise_series)
            noise_record = {
                "noise_type": "gaussian_white",
                "source_index": source_index,
                "source_region": region_name,
                "trial": trial + 1,
                "theta1_0": record["theta1_0"],
                "theta2_0": record["theta2_0"],
            }

            for key in metric_keys:
                noise_record[key] = noise_metrics[key]
                noise_record[f"source_{key}"] = record[key]
                noise_record[f"{key}_delta_vs_source"] = noise_metrics[key] - record[key]

            noise_records.append(noise_record)

    return noise_records

def summarize_metrics(records, metric_keys):
    summary = {"count": len(records)}

    for key in metric_keys:
        values = np.array([record[key] for record in records], dtype=float)
        if len(values) == 0:
            summary[key] = np.nan
            summary[f"{key}_std"] = np.nan
        else:
            summary[key] = float(np.mean(values))
            summary[f"{key}_std"] = float(np.std(values))

    return summary

def summarize_noise_records(noise_records, region_name=None):
    subset = noise_records if region_name is None else [record for record in noise_records if record["source_region"] == region_name]
    metric_keys = [
        "LZMA_ratio",
        "Lempel_Ziv_complexity",
        "Permutation_entropy",
        "LZMA_ratio_delta_vs_source",
        "Lempel_Ziv_complexity_delta_vs_source",
        "Permutation_entropy_delta_vs_source",
    ]
    return summarize_metrics(subset, metric_keys)

def permutation_entropy_separation(noise_records, region_name=None):
    subset = noise_records if region_name is None else [record for record in noise_records if record["source_region"] == region_name]
    deltas = np.array([record["Permutation_entropy_delta_vs_source"] for record in subset], dtype=float)

    if len(deltas) == 0:
        return {
            "count": 0,
            "positive_fraction": np.nan,
            "mean_delta": np.nan,
            "std_delta": np.nan,
            "min_delta": np.nan,
        }

    return {
        "count": len(deltas),
        "positive_fraction": float(np.mean(deltas > 0.0)),
        "mean_delta": float(np.mean(deltas)),
        "std_delta": float(np.std(deltas)),
        "min_delta": float(np.min(deltas)),
    }

def save_noise_records_csv(noise_records, output_path):
    fieldnames = [
        "noise_type",
        "source_index",
        "source_region",
        "trial",
        "theta1_0",
        "theta2_0",
        "LZMA_ratio",
        "source_LZMA_ratio",
        "LZMA_ratio_delta_vs_source",
        "Lempel_Ziv_complexity",
        "source_Lempel_Ziv_complexity",
        "Lempel_Ziv_complexity_delta_vs_source",
        "Permutation_entropy",
        "source_Permutation_entropy",
        "Permutation_entropy_delta_vs_source",
    ]

    with output_path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        for record in noise_records:
            writer.writerow({key: record[key] for key in fieldnames})

def lzma_ratio_scan(x, bin_values):
    return {int(bins): lzma_ratio(x, bins=int(bins)) for bins in bin_values}

def summarize_array(values):
    values = np.asarray(values, dtype=float)
    if len(values) == 0:
        return np.nan, np.nan
    return float(np.mean(values)), float(np.std(values))

def run_coarse_graining_experiment(records, sampled_series, source_regions, bin_values, noise_trials=16, seed=20260511):
    rng = np.random.default_rng(seed)
    group_rows = []
    delta_rows = []

    for source_index, (record, sampled) in enumerate(zip(records, sampled_series)):
        region_name = record["chaos_region"]
        if region_name not in source_regions:
            continue

        noise_group_name = region_name.replace("_chaos", "_noise")
        chaos_scan = lzma_ratio_scan(sampled, bin_values)
        for bins, value in chaos_scan.items():
            group_rows.append(
                {
                    "group": region_name,
                    "kind": "chaos",
                    "source_region": region_name,
                    "source_index": source_index,
                    "trial": 0,
                    "bins": bins,
                    "LZMA_ratio": value,
                }
            )

        for trial in range(noise_trials):
            noise_series = generate_matched_white_noise(sampled, rng)
            noise_scan = lzma_ratio_scan(noise_series, bin_values)

            for bins, value in noise_scan.items():
                group_rows.append(
                    {
                        "group": noise_group_name,
                        "kind": "noise",
                        "source_region": region_name,
                        "source_index": source_index,
                        "trial": trial + 1,
                        "bins": bins,
                        "LZMA_ratio": value,
                    }
                )
                delta_rows.append(
                    {
                        "source_region": region_name,
                        "source_index": source_index,
                        "trial": trial + 1,
                        "bins": bins,
                        "noise_minus_chaos": value - chaos_scan[bins],
                    }
                )

    return group_rows, delta_rows

def summarize_coarse_graining(group_rows, delta_rows, bin_values):
    summary_rows = []

    for bins in bin_values:
        row = {"bins": int(bins)}

        for group_name in ["weak_chaos", "strong_chaos", "weak_noise", "strong_noise"]:
            values = [
                record["LZMA_ratio"] for record in group_rows
                if record["group"] == group_name and record["bins"] == bins
            ]
            mean_value, std_value = summarize_array(values)
            row[f"{group_name}_mean"] = mean_value
            row[f"{group_name}_std"] = std_value

        weak_deltas = [
            record["noise_minus_chaos"] for record in delta_rows
            if record["source_region"] == "weak_chaos" and record["bins"] == bins
        ]
        strong_deltas = [
            record["noise_minus_chaos"] for record in delta_rows
            if record["source_region"] == "strong_chaos" and record["bins"] == bins
        ]

        weak_mean, weak_std = summarize_array(weak_deltas)
        strong_mean, strong_std = summarize_array(strong_deltas)
        row["weak_noise_minus_chaos_mean"] = weak_mean
        row["weak_noise_minus_chaos_std"] = weak_std
        row["weak_noise_gt_chaos_fraction"] = float(np.mean(np.asarray(weak_deltas) > 0.0)) if weak_deltas else np.nan
        row["strong_noise_minus_chaos_mean"] = strong_mean
        row["strong_noise_minus_chaos_std"] = strong_std
        row["strong_noise_gt_chaos_fraction"] = float(np.mean(np.asarray(strong_deltas) > 0.0)) if strong_deltas else np.nan
        row["strong_minus_weak_chaos_mean"] = row["strong_chaos_mean"] - row["weak_chaos_mean"]

        summary_rows.append(row)

    return summary_rows

def assess_coarse_graining_robustness(summary_rows):
    bin_values = np.array([row["bins"] for row in summary_rows], dtype=float)
    robustness = {
        "strong_gt_weak_all_bins": bool(np.all([row["strong_minus_weak_chaos_mean"] > 0.0 for row in summary_rows])),
        "weak_noise_gt_chaos_min_fraction": float(np.min([row["weak_noise_gt_chaos_fraction"] for row in summary_rows])),
        "strong_noise_gt_chaos_min_fraction": float(np.min([row["strong_noise_gt_chaos_fraction"] for row in summary_rows])),
    }

    for group_name in ["weak_chaos", "strong_chaos", "weak_noise", "strong_noise"]:
        means = np.array([row[f"{group_name}_mean"] for row in summary_rows], dtype=float)
        mean_value = float(np.mean(means))
        value_range = float(np.max(means) - np.min(means))
        robustness[f"{group_name}_range"] = value_range
        robustness[f"{group_name}_relative_range"] = value_range / max(abs(mean_value), 1e-12)
        robustness[f"{group_name}_log2bin_slope"] = float(np.polyfit(np.log2(bin_values), means, 1)[0]) if len(bin_values) >= 2 else np.nan

    if (
        robustness["strong_gt_weak_all_bins"]
        and robustness["weak_noise_gt_chaos_min_fraction"] == 1.0
        and robustness["strong_noise_gt_chaos_min_fraction"] == 1.0
    ):
        robustness["verdict"] = "relative ordering is robust, but absolute LZMA values remain coarse-graining dependent"
    else:
        robustness["verdict"] = "ordering changes with coarse-graining, so the metric is not robust as a physical complexity proxy"

    return robustness

def save_coarse_graining_summary_csv(summary_rows, output_path):
    if not summary_rows:
        return

    fieldnames = list(summary_rows[0].keys())
    with output_path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        for row in summary_rows:
            writer.writerow(row)

def select_representative_record(records, region_name, target_key="Lyapunov_exponent"):
    subset = [record for record in records if record["chaos_region"] == region_name]
    if not subset:
        raise ValueError(f"No records found for region {region_name}")

    target = float(np.median([record[target_key] for record in subset]))
    return min(subset, key=lambda record: abs(record[target_key] - target))

def simulate_local_phase_cloud(
    f_batch,
    center_state,
    dt=0.01,
    steps=4000,
    sample_interval=20,
    ensemble_size=1024,
    angle_spread=2e-3,
    omega_spread=2e-3,
    rng=None,
):
    if rng is None:
        rng = np.random.default_rng()

    center_state = np.asarray(center_state, dtype=float)
    scales = np.array([angle_spread, omega_spread, angle_spread, omega_spread], dtype=float)
    wrapped_states = wrap_state_angles_batch(
        center_state + rng.normal(loc=0.0, scale=scales, size=(ensemble_size, len(center_state)))
    )
    theta1_unwrapped = wrapped_states[:, 0].copy()
    theta2_unwrapped = wrapped_states[:, 2].copy()

    snapshots = [
        np.column_stack((theta1_unwrapped, wrapped_states[:, 1], theta2_unwrapped, wrapped_states[:, 3]))
    ]
    times = [0.0]

    for step in range(1, steps + 1):
        previous_states = wrapped_states.copy()
        wrapped_states = wrap_state_angles_batch(rk4_step_batch(f_batch, wrapped_states, dt))
        theta1_unwrapped += wrap_angle(wrapped_states[:, 0] - previous_states[:, 0])
        theta2_unwrapped += wrap_angle(wrapped_states[:, 2] - previous_states[:, 2])

        if step % sample_interval == 0:
            snapshots.append(
                np.column_stack((theta1_unwrapped, wrapped_states[:, 1], theta2_unwrapped, wrapped_states[:, 3]))
            )
            times.append(step * dt)

    return np.array(times, dtype=float), np.stack(snapshots, axis=0)

def build_phase_space_partition(snapshot_groups, bins_per_dim=8, margin=0.05):
    pooled = np.concatenate(
        [snapshots.reshape(-1, snapshots.shape[-1]) for snapshots in snapshot_groups],
        axis=0,
    )

    if np.isscalar(bins_per_dim):
        bins = [int(bins_per_dim)] * pooled.shape[1]
    else:
        bins = [int(value) for value in bins_per_dim]

    mins = np.min(pooled, axis=0)
    maxs = np.max(pooled, axis=0)
    spans = np.maximum(maxs - mins, 1e-9)
    mins = mins - margin * spans
    maxs = maxs + margin * spans

    return [np.linspace(mins[index], maxs[index], bins[index] + 1) for index in range(pooled.shape[1])]

def coarse_grained_entropy(snapshot, edges):
    counts, _ = np.histogramdd(snapshot, bins=edges)
    probs = counts.ravel() / np.sum(counts)
    probs = probs[probs > 0.0]
    return float(-np.sum(probs * np.log(probs))), int(np.count_nonzero(counts))

def measure_entropy_curve(times, snapshots, edges):
    entropies = []
    occupied_cells = []

    for snapshot in snapshots:
        entropy, occupied = coarse_grained_entropy(snapshot, edges)
        entropies.append(entropy)
        occupied_cells.append(occupied)

    total_cells = int(np.prod([len(edge) - 1 for edge in edges]))
    max_entropy = float(log(total_cells))
    entropies = np.array(entropies, dtype=float)

    return {
        "times": np.asarray(times, dtype=float),
        "entropy": entropies,
        "occupied_cells": np.array(occupied_cells, dtype=int),
        "normalized_entropy": entropies / max(max_entropy, 1e-12),
        "max_entropy": max_entropy,
        "total_cells": total_cells,
    }

def fit_entropy_growth_rate(times, entropies, saturation_fraction=0.65, min_points=10):
    times = np.asarray(times, dtype=float)
    entropies = np.asarray(entropies, dtype=float)

    if len(times) < 2:
        return {
            "slope": np.nan,
            "intercept": np.nan,
            "fit_end": len(times),
            "fit_time_end": np.nan,
        }

    threshold = entropies[0] + saturation_fraction * (np.max(entropies) - entropies[0])
    first_crossing = np.where(entropies >= threshold)[0]
    fit_end = first_crossing[0] + 1 if len(first_crossing) else len(times)
    fit_end = min(len(times), max(fit_end, min_points))
    slope, intercept = np.polyfit(times[:fit_end], entropies[:fit_end], 1)

    return {
        "slope": float(slope),
        "intercept": float(intercept),
        "fit_end": int(fit_end),
        "fit_time_end": float(times[fit_end - 1]),
    }

def run_entropy_production_experiment(
    records,
    dt,
    settle_steps=3000,
    entropy_steps=4000,
    sample_interval=20,
    ensemble_size=1024,
    phase_bins=8,
    angle_spread=2e-3,
    omega_spread=2e-3,
    seed=20260512,
):
    scalar_f = double_pendulum_dynamics()
    batch_f = double_pendulum_dynamics_batch()
    results = {}

    for offset, region_name in enumerate(["weak_chaos", "strong_chaos"]):
        record = select_representative_record(records, region_name)
        initial_state = np.array([record["theta1_0"], 0.0, record["theta2_0"], 0.0], dtype=float)
        center_state = advance_state(scalar_f, initial_state, dt=dt, steps=settle_steps)
        times, snapshots = simulate_local_phase_cloud(
            batch_f,
            center_state,
            dt=dt,
            steps=entropy_steps,
            sample_interval=sample_interval,
            ensemble_size=ensemble_size,
            angle_spread=angle_spread,
            omega_spread=omega_spread,
            rng=np.random.default_rng(seed + offset),
        )
        results[region_name] = {
            "record": record,
            "initial_state": initial_state,
            "center_state": center_state,
            "times": times,
            "snapshots": snapshots,
        }

    edges = build_phase_space_partition(
        [results["weak_chaos"]["snapshots"], results["strong_chaos"]["snapshots"]],
        bins_per_dim=phase_bins,
    )

    for region_name, result in results.items():
        result.update(measure_entropy_curve(result["times"], result["snapshots"], edges))
        result.update(fit_entropy_growth_rate(result["times"], result["entropy"]))
        result["entropy_gain"] = float(result["entropy"][-1] - result["entropy"][0])

    weak_slope = results["weak_chaos"]["slope"]
    strong_slope = results["strong_chaos"]["slope"]
    slope_ratio = strong_slope / weak_slope if weak_slope > 1e-12 else np.nan
    total_cells = int(np.prod([len(edge) - 1 for edge in edges]))

    summary = {
        "seed": seed,
        "settle_steps": settle_steps,
        "entropy_steps": entropy_steps,
        "sample_interval": sample_interval,
        "ensemble_size": ensemble_size,
        "phase_bins_per_dim": int(phase_bins) if np.isscalar(phase_bins) else tuple(int(value) for value in phase_bins),
        "total_cells": total_cells,
        "angle_spread": angle_spread,
        "omega_spread": omega_spread,
        "strong_faster_than_weak": bool(strong_slope > weak_slope),
        "slope_ratio_strong_to_weak": float(slope_ratio) if np.isfinite(slope_ratio) else np.nan,
    }

    for region_name, result in results.items():
        summary[f"{region_name}_slope"] = result["slope"]
        summary[f"{region_name}_fit_time_end"] = result["fit_time_end"]
        summary[f"{region_name}_entropy_gain"] = result["entropy_gain"]
        summary[f"{region_name}_lambda1"] = result["record"]["Lyapunov_exponent"]
        summary[f"{region_name}_hks"] = result["record"]["KS_entropy_Pesin"]
        summary[f"{region_name}_occupied_final"] = int(result["occupied_cells"][-1])

    return results, summary

def save_entropy_production_csv(results, output_path):
    regions = ["weak_chaos", "strong_chaos"]
    times = results[regions[0]]["times"]
    fieldnames = [
        "time",
        "weak_chaos_entropy",
        "strong_chaos_entropy",
        "weak_chaos_normalized_entropy",
        "strong_chaos_normalized_entropy",
        "weak_chaos_occupied_cells",
        "strong_chaos_occupied_cells",
    ]

    with output_path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()

        for index, time_value in enumerate(times):
            writer.writerow(
                {
                    "time": float(time_value),
                    "weak_chaos_entropy": float(results["weak_chaos"]["entropy"][index]),
                    "strong_chaos_entropy": float(results["strong_chaos"]["entropy"][index]),
                    "weak_chaos_normalized_entropy": float(results["weak_chaos"]["normalized_entropy"][index]),
                    "strong_chaos_normalized_entropy": float(results["strong_chaos"]["normalized_entropy"][index]),
                    "weak_chaos_occupied_cells": int(results["weak_chaos"]["occupied_cells"][index]),
                    "strong_chaos_occupied_cells": int(results["strong_chaos"]["occupied_cells"][index]),
                }
            )

def select_representative_records(records, region_name, count=5, target_key="Lyapunov_exponent"):
    subset = [record for record in records if record["chaos_region"] == region_name]
    if not subset:
        raise ValueError(f"No records found for region {region_name}")

    subset = sorted(subset, key=lambda record: record[target_key])
    count = max(1, min(int(count), len(subset)))
    raw_positions = np.linspace(0, len(subset) - 1, count)
    chosen_indices = []

    for raw_position in raw_positions:
        index = int(np.clip(np.round(raw_position), 0, len(subset) - 1))
        if index not in chosen_indices:
            chosen_indices.append(index)

    if len(chosen_indices) < count:
        for index in range(len(subset)):
            if index not in chosen_indices:
                chosen_indices.append(index)
            if len(chosen_indices) == count:
                break

    return [subset[index] for index in chosen_indices]

def dominant_direction_label(net_directional_area, tolerance=1e-4):
    if not np.isfinite(net_directional_area) or abs(net_directional_area) <= tolerance:
        return "balanced"
    return "theta1->theta2" if net_directional_area > 0.0 else "theta2->theta1"

def format_representative_points(records):
    return ", ".join(f"({record['theta1_0'] / pi:.3f}, {record['theta2_0'] / pi:.3f})" for record in records)

def summarize_information_trials(trials):
    if not trials:
        raise ValueError("At least one trial is required to summarize information flow")

    mi_curve_keys = [
        "mi_forward",
        "mi_backward",
        "mi_mean",
        "excess_forward",
        "excess_backward",
        "excess_mean",
        "normalized_forward",
        "normalized_backward",
        "normalized_mean",
    ]
    mi_scalar_keys = [
        "initial_mi",
        "initial_excess_mi",
        "peak_time",
        "peak_excess_mi",
        "post_peak_decay_time",
        "information_area",
        "direction_asymmetry",
    ]
    te_curve_keys = [
        "excess_forward",
        "excess_backward",
        "normalized_forward",
        "normalized_backward",
        "total_excess",
        "net_excess",
    ]
    te_scalar_keys = [
        "peak_time_forward",
        "peak_time_backward",
        "peak_transfer_forward",
        "peak_transfer_backward",
        "post_peak_decay_forward",
        "post_peak_decay_backward",
        "net_directional_area",
        "total_transfer_area",
        "directionality_strength",
    ]

    mi_summary = summarize_trials([trial["mi"] for trial in trials], mi_curve_keys, mi_scalar_keys)
    te_summary = summarize_trials([trial["te"] for trial in trials], te_curve_keys, te_scalar_keys)
    mi_summary["lag_steps"] = np.asarray(trials[0]["mi"]["lag_steps"], dtype=int)
    te_summary["lag_steps"] = np.asarray(trials[0]["te"]["lag_steps"], dtype=int)

    lyapunov_values = np.array([trial["record"]["Lyapunov_exponent"] for trial in trials], dtype=float)
    ks_values = np.array([trial["record"]["KS_entropy_Pesin"] for trial in trials], dtype=float)

    return {
        "records": [trial["record"] for trial in trials],
        "trial_count": len(trials),
        "mi": mi_summary,
        "te": te_summary,
        "lyapunov_mean": float(np.mean(lyapunov_values)),
        "lyapunov_std": float(np.std(lyapunov_values)),
        "ks_mean": float(np.mean(ks_values)),
        "ks_std": float(np.std(ks_values)),
    }

def run_information_flow_experiment(
    records,
    dt,
    steps=18000,
    discard=3000,
    representative_count=5,
    max_lag_steps=2000,
    lag_stride=10,
    mi_bins=32,
    mi_baseline_shuffles=8,
    te_bins=12,
    te_baseline_shuffles=6,
    seed=20260513,
):
    f_double = double_pendulum_dynamics()
    results = {}

    for region_offset, region_name in enumerate(["weak_chaos", "strong_chaos"]):
        representative_records = select_representative_records(records, region_name, count=representative_count)
        trials = []

        for trial_index, record in enumerate(representative_records):
            initial_state = np.array([record["theta1_0"], 0.0, record["theta2_0"], 0.0], dtype=float)
            states = simulate_state_series(f_double, initial_state, dt=dt, steps=steps, discard=discard)
            theta1 = states[:, 0]
            theta2 = states[:, 2]
            mi_seed = seed + 100 * region_offset + trial_index
            te_seed = seed + 1000 + 100 * region_offset + trial_index
            trials.append(
                {
                    "record": record,
                    "mi": lagged_mutual_information_curve(
                        theta1,
                        theta2,
                        dt=dt,
                        max_lag_steps=max_lag_steps,
                        lag_stride=lag_stride,
                        bins=mi_bins,
                        baseline_shuffles=mi_baseline_shuffles,
                        rng=np.random.default_rng(mi_seed),
                    ),
                    "te": lagged_transfer_entropy_curve(
                        theta1,
                        theta2,
                        dt=dt,
                        max_lag_steps=max_lag_steps,
                        lag_stride=lag_stride,
                        bins=te_bins,
                        baseline_shuffles=te_baseline_shuffles,
                        rng=np.random.default_rng(te_seed),
                    ),
                }
            )

        results[region_name] = summarize_information_trials(trials)
        results[region_name]["dt"] = dt

    weak_mi = results["weak_chaos"]["mi"]
    strong_mi = results["strong_chaos"]["mi"]
    weak_te = results["weak_chaos"]["te"]
    strong_te = results["strong_chaos"]["te"]
    weak_decay = weak_mi["post_peak_decay_time_mean"]
    strong_decay = strong_mi["post_peak_decay_time_mean"]

    summary = {
        "steps": steps,
        "discard": discard,
        "representative_count": representative_count,
        "max_lag_steps": max_lag_steps,
        "lag_stride": lag_stride,
        "mi_bins": mi_bins,
        "mi_baseline_shuffles": mi_baseline_shuffles,
        "te_bins": te_bins,
        "te_baseline_shuffles": te_baseline_shuffles,
        "seed": seed,
        "weak_mi_peak_time": weak_mi["peak_time_mean"],
        "strong_mi_peak_time": strong_mi["peak_time_mean"],
        "weak_mi_decay_time": weak_decay,
        "strong_mi_decay_time": strong_decay,
        "weak_mi_area": weak_mi["information_area_mean"],
        "strong_mi_area": strong_mi["information_area_mean"],
        "weak_te_net_area": weak_te["net_directional_area_mean"],
        "strong_te_net_area": strong_te["net_directional_area_mean"],
        "weak_te_total_area": weak_te["total_transfer_area_mean"],
        "strong_te_total_area": strong_te["total_transfer_area_mean"],
        "weak_te_directionality_strength": weak_te["directionality_strength_mean"],
        "strong_te_directionality_strength": strong_te["directionality_strength_mean"],
        "weak_dominant_direction": dominant_direction_label(weak_te["net_directional_area_mean"]),
        "strong_dominant_direction": dominant_direction_label(strong_te["net_directional_area_mean"]),
    }
    summary["strong_earlier_peak"] = bool(np.isfinite(summary["weak_mi_peak_time"]) and np.isfinite(summary["strong_mi_peak_time"]) and summary["strong_mi_peak_time"] < summary["weak_mi_peak_time"])
    summary["strong_faster_decay"] = bool(np.isfinite(weak_decay) and np.isfinite(strong_decay) and strong_decay < weak_decay)
    summary["strong_smaller_mi_area"] = bool(summary["strong_mi_area"] < summary["weak_mi_area"])
    summary["strong_more_directional"] = bool(
        np.isfinite(summary["weak_te_directionality_strength"])
        and np.isfinite(summary["strong_te_directionality_strength"])
        and summary["strong_te_directionality_strength"] > summary["weak_te_directionality_strength"]
    )
    summary["mi_peak_time_ratio_strong_to_weak"] = float(summary["strong_mi_peak_time"] / summary["weak_mi_peak_time"]) if np.isfinite(summary["weak_mi_peak_time"]) and summary["weak_mi_peak_time"] > 1e-12 and np.isfinite(summary["strong_mi_peak_time"]) else np.nan
    summary["mi_decay_time_ratio_strong_to_weak"] = float(strong_decay / weak_decay) if np.isfinite(weak_decay) and weak_decay > 1e-12 and np.isfinite(strong_decay) else np.nan
    summary["mi_area_ratio_strong_to_weak"] = float(summary["strong_mi_area"] / summary["weak_mi_area"]) if summary["weak_mi_area"] > 1e-12 else np.nan

    return results, summary

def summarize_surrogate_curve_distribution(actual_curves, surrogate_curves, lag_steps, lag_times, surrogate_quantile=0.95):
    actual_stack = np.stack([np.asarray(curve, dtype=float) for curve in actual_curves], axis=0)
    surrogate_stack = np.stack([np.asarray(curve, dtype=float) for curve in surrogate_curves], axis=0)

    actual_mean = np.mean(actual_stack, axis=0)
    return {
        "lag_steps": np.asarray(lag_steps, dtype=int),
        "lag_times": np.asarray(lag_times, dtype=float),
        "actual_mean": actual_mean,
        "actual_std": np.std(actual_stack, axis=0),
        "surrogate_mean": np.mean(surrogate_stack, axis=0),
        "surrogate_std": np.std(surrogate_stack, axis=0),
        "surrogate_q05": np.quantile(surrogate_stack, 0.05, axis=0),
        "surrogate_q95": np.quantile(surrogate_stack, surrogate_quantile, axis=0),
        "actual_above_q95_fraction": float(np.mean(actual_mean > np.quantile(surrogate_stack, surrogate_quantile, axis=0))),
    }

def summarize_surrogate_scalar_distribution(actual_values, surrogate_rows, surrogate_quantile=0.95):
    actual = np.asarray(actual_values, dtype=float)
    surrogate = np.asarray(surrogate_rows, dtype=float)
    pooled = surrogate.reshape(-1)
    trial_quantiles = np.quantile(surrogate, surrogate_quantile, axis=1)
    empirical_p_values = np.array(
        [(np.count_nonzero(row >= value) + 1) / (len(row) + 1) for value, row in zip(actual, surrogate)],
        dtype=float,
    )

    return {
        "actual_mean": float(np.mean(actual)),
        "actual_std": float(np.std(actual)),
        "surrogate_mean": float(np.mean(pooled)),
        "surrogate_std": float(np.std(pooled)),
        "surrogate_q95_mean": float(np.mean(trial_quantiles)),
        "surrogate_q95_pooled": float(np.quantile(pooled, surrogate_quantile)),
        "actual_gt_trial_q95_fraction": float(np.mean(actual > trial_quantiles)),
        "actual_minus_surrogate_mean": float(np.mean(actual) - np.mean(pooled)),
        "empirical_p_mean": float(np.mean(empirical_p_values)),
    }

def run_shuffle_surrogate_test(
    records,
    dt,
    steps=18000,
    discard=3000,
    representative_count=5,
    max_lag_steps=2000,
    lag_stride=10,
    mi_bins=32,
    te_bins=12,
    surrogate_trials=12,
    seed=20260514,
):
    f_double = double_pendulum_dynamics()
    results = {}

    for region_offset, region_name in enumerate(["weak_chaos", "strong_chaos"]):
        representative_records = select_representative_records(records, region_name, count=representative_count)
        actual_mi_curves = []
        surrogate_mi_curves = []
        actual_te_total_curves = []
        surrogate_te_total_curves = []
        actual_mi_peaks = []
        actual_mi_excess_areas = []
        actual_te_excess_areas = []
        actual_te_directionality = []
        surrogate_mi_peak_rows = []
        surrogate_mi_excess_area_rows = []
        surrogate_te_excess_area_rows = []
        surrogate_te_directionality_rows = []
        mi_lag_steps = None
        mi_lag_times = None
        te_lag_steps = None
        te_lag_times = None

        for trial_index, record in enumerate(representative_records):
            initial_state = np.array([record["theta1_0"], 0.0, record["theta2_0"], 0.0], dtype=float)
            states = simulate_state_series(f_double, initial_state, dt=dt, steps=steps, discard=discard)
            theta1 = states[:, 0]
            theta2 = states[:, 2]

            actual_mi = lagged_mutual_information_curve(
                theta1,
                theta2,
                dt=dt,
                max_lag_steps=max_lag_steps,
                lag_stride=lag_stride,
                bins=mi_bins,
                baseline_shuffles=0,
                rng=np.random.default_rng(seed + 100 * region_offset + trial_index),
            )
            actual_te_forward = lagged_transfer_entropy_directional_curve(
                theta1,
                theta2,
                dt=dt,
                max_lag_steps=max_lag_steps,
                lag_stride=lag_stride,
                bins=te_bins,
            )
            actual_te_backward = lagged_transfer_entropy_directional_curve(
                theta2,
                theta1,
                dt=dt,
                max_lag_steps=max_lag_steps,
                lag_stride=lag_stride,
                bins=te_bins,
            )
            actual_te_total_curve = 0.5 * (actual_te_forward["te"] + actual_te_backward["te"])

            if mi_lag_steps is None:
                mi_lag_steps = actual_mi["lag_steps"]
                mi_lag_times = actual_mi["lag_times"]
                te_lag_steps = actual_te_forward["lag_steps"]
                te_lag_times = actual_te_forward["lag_times"]

            actual_mi_curves.append(actual_mi["mi_mean"])
            actual_te_total_curves.append(actual_te_total_curve)
            actual_mi_peaks.append(actual_mi["peak_excess_mi"])
            actual_te_directionality.append(float(np.mean(np.abs(actual_te_forward["te"] - actual_te_backward["te"]))))

            surrogate_mi_peaks = []
            surrogate_mi_excess_areas = []
            surrogate_te_excess_areas = []
            surrogate_te_directionality = []
            local_surrogate_mi_curves = []
            local_surrogate_te_total_curves = []
            surrogate_rng = np.random.default_rng(seed + 10000 + 100 * region_offset + trial_index)

            for _ in range(surrogate_trials):
                surrogate_theta2 = surrogate_rng.permutation(theta2)
                surrogate_mi = lagged_mutual_information_curve(
                    theta1,
                    surrogate_theta2,
                    dt=dt,
                    max_lag_steps=max_lag_steps,
                    lag_stride=lag_stride,
                    bins=mi_bins,
                    baseline_shuffles=0,
                    rng=np.random.default_rng(),
                )
                surrogate_te_forward = lagged_transfer_entropy_directional_curve(
                    surrogate_rng.permutation(theta1),
                    theta2,
                    dt=dt,
                    max_lag_steps=max_lag_steps,
                    lag_stride=lag_stride,
                    bins=te_bins,
                )
                surrogate_te_backward = lagged_transfer_entropy_directional_curve(
                    surrogate_rng.permutation(theta2),
                    theta1,
                    dt=dt,
                    max_lag_steps=max_lag_steps,
                    lag_stride=lag_stride,
                    bins=te_bins,
                )
                surrogate_te_total_curve = 0.5 * (surrogate_te_forward["te"] + surrogate_te_backward["te"])

                surrogate_mi_curves.append(surrogate_mi["mi_mean"])
                surrogate_te_total_curves.append(surrogate_te_total_curve)
                local_surrogate_mi_curves.append(surrogate_mi["mi_mean"])
                local_surrogate_te_total_curves.append(surrogate_te_total_curve)
                surrogate_mi_peaks.append(surrogate_mi["peak_excess_mi"])
                surrogate_te_directionality.append(float(np.mean(np.abs(surrogate_te_forward["te"] - surrogate_te_backward["te"]))))

            surrogate_mi_curve_mean = np.mean(np.stack(local_surrogate_mi_curves, axis=0), axis=0)
            surrogate_te_curve_mean = np.mean(np.stack(local_surrogate_te_total_curves, axis=0), axis=0)
            actual_mi_excess_areas.append(
                float(np.trapezoid(np.maximum(actual_mi["mi_mean"] - surrogate_mi_curve_mean, 0.0), actual_mi["lag_times"]))
            )
            actual_te_excess_areas.append(
                float(np.trapezoid(np.maximum(actual_te_total_curve - surrogate_te_curve_mean, 0.0), actual_te_forward["lag_times"]))
            )
            for surrogate_mi_curve, surrogate_te_curve in zip(local_surrogate_mi_curves, local_surrogate_te_total_curves):
                surrogate_mi_excess_areas.append(
                    float(np.trapezoid(np.maximum(surrogate_mi_curve - surrogate_mi_curve_mean, 0.0), actual_mi["lag_times"]))
                )
                surrogate_te_excess_areas.append(
                    float(np.trapezoid(np.maximum(surrogate_te_curve - surrogate_te_curve_mean, 0.0), actual_te_forward["lag_times"]))
                )

            surrogate_mi_peak_rows.append(surrogate_mi_peaks)
            surrogate_mi_excess_area_rows.append(surrogate_mi_excess_areas)
            surrogate_te_excess_area_rows.append(surrogate_te_excess_areas)
            surrogate_te_directionality_rows.append(surrogate_te_directionality)

        results[region_name] = {
            "records": representative_records,
            "trial_count": len(representative_records),
            "mi_curve": summarize_surrogate_curve_distribution(actual_mi_curves, surrogate_mi_curves, mi_lag_steps, mi_lag_times),
            "te_total_curve": summarize_surrogate_curve_distribution(actual_te_total_curves, surrogate_te_total_curves, te_lag_steps, te_lag_times),
            "mi_peak": summarize_surrogate_scalar_distribution(actual_mi_peaks, surrogate_mi_peak_rows),
            "mi_excess_area": summarize_surrogate_scalar_distribution(actual_mi_excess_areas, surrogate_mi_excess_area_rows),
            "te_excess_area": summarize_surrogate_scalar_distribution(actual_te_excess_areas, surrogate_te_excess_area_rows),
            "te_directionality_strength": summarize_surrogate_scalar_distribution(actual_te_directionality, surrogate_te_directionality_rows),
        }

    weak = results["weak_chaos"]
    strong = results["strong_chaos"]
    summary = {
        "steps": steps,
        "discard": discard,
        "representative_count": representative_count,
        "max_lag_steps": max_lag_steps,
        "lag_stride": lag_stride,
        "mi_bins": mi_bins,
        "te_bins": te_bins,
        "surrogate_trials": surrogate_trials,
        "seed": seed,
        "weak_mi_lag_exceedance": weak["mi_curve"]["actual_above_q95_fraction"],
        "strong_mi_lag_exceedance": strong["mi_curve"]["actual_above_q95_fraction"],
        "weak_te_lag_exceedance": weak["te_total_curve"]["actual_above_q95_fraction"],
        "strong_te_lag_exceedance": strong["te_total_curve"]["actual_above_q95_fraction"],
        "weak_mi_peak_empirical_p": weak["mi_peak"]["empirical_p_mean"],
        "strong_mi_peak_empirical_p": strong["mi_peak"]["empirical_p_mean"],
        "weak_te_area_empirical_p": weak["te_excess_area"]["empirical_p_mean"],
        "strong_te_area_empirical_p": strong["te_excess_area"]["empirical_p_mean"],
    }
    summary["strong_mi_more_significant"] = bool(summary["strong_mi_peak_empirical_p"] < summary["weak_mi_peak_empirical_p"])
    summary["strong_te_more_significant"] = bool(summary["strong_te_area_empirical_p"] < summary["weak_te_area_empirical_p"])

    return results, summary

def save_information_flow_csv(results, output_path):
    weak_result = results["weak_chaos"]
    strong_result = results["strong_chaos"]
    weak_mi_indices = {int(step): index for index, step in enumerate(weak_result["mi"]["lag_steps"])}
    weak_te_indices = {int(step): index for index, step in enumerate(weak_result["te"]["lag_steps"])}
    strong_mi_indices = {int(step): index for index, step in enumerate(strong_result["mi"]["lag_steps"])}
    strong_te_indices = {int(step): index for index, step in enumerate(strong_result["te"]["lag_steps"])}
    lag_steps = sorted(set(weak_mi_indices) | set(weak_te_indices))
    dt = weak_result["dt"]

    def take_metric(region_summary, index_map, key, lag_step):
        if lag_step not in index_map:
            return np.nan
        return float(region_summary[key][index_map[lag_step]])

    fieldnames = [
        "lag_step",
        "lag_time",
        "weak_chaos_mi_normalized_excess_mean",
        "weak_chaos_mi_normalized_excess_std",
        "weak_chaos_mi_excess_mean",
        "weak_chaos_mi_excess_std",
        "weak_chaos_te_forward_mean",
        "weak_chaos_te_forward_std",
        "weak_chaos_te_backward_mean",
        "weak_chaos_te_backward_std",
        "weak_chaos_te_net_mean",
        "weak_chaos_te_net_std",
        "strong_chaos_mi_normalized_excess_mean",
        "strong_chaos_mi_normalized_excess_std",
        "strong_chaos_mi_excess_mean",
        "strong_chaos_mi_excess_std",
        "strong_chaos_te_forward_mean",
        "strong_chaos_te_forward_std",
        "strong_chaos_te_backward_mean",
        "strong_chaos_te_backward_std",
        "strong_chaos_te_net_mean",
        "strong_chaos_te_net_std",
    ]

    with output_path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        for lag_step in lag_steps:
            writer.writerow(
                {
                    "lag_step": int(lag_step),
                    "lag_time": float(lag_step * dt),
                    "weak_chaos_mi_normalized_excess_mean": take_metric(weak_result["mi"], weak_mi_indices, "normalized_mean_mean", lag_step),
                    "weak_chaos_mi_normalized_excess_std": take_metric(weak_result["mi"], weak_mi_indices, "normalized_mean_std", lag_step),
                    "weak_chaos_mi_excess_mean": take_metric(weak_result["mi"], weak_mi_indices, "excess_mean_mean", lag_step),
                    "weak_chaos_mi_excess_std": take_metric(weak_result["mi"], weak_mi_indices, "excess_mean_std", lag_step),
                    "weak_chaos_te_forward_mean": take_metric(weak_result["te"], weak_te_indices, "excess_forward_mean", lag_step),
                    "weak_chaos_te_forward_std": take_metric(weak_result["te"], weak_te_indices, "excess_forward_std", lag_step),
                    "weak_chaos_te_backward_mean": take_metric(weak_result["te"], weak_te_indices, "excess_backward_mean", lag_step),
                    "weak_chaos_te_backward_std": take_metric(weak_result["te"], weak_te_indices, "excess_backward_std", lag_step),
                    "weak_chaos_te_net_mean": take_metric(weak_result["te"], weak_te_indices, "net_excess_mean", lag_step),
                    "weak_chaos_te_net_std": take_metric(weak_result["te"], weak_te_indices, "net_excess_std", lag_step),
                    "strong_chaos_mi_normalized_excess_mean": take_metric(strong_result["mi"], strong_mi_indices, "normalized_mean_mean", lag_step),
                    "strong_chaos_mi_normalized_excess_std": take_metric(strong_result["mi"], strong_mi_indices, "normalized_mean_std", lag_step),
                    "strong_chaos_mi_excess_mean": take_metric(strong_result["mi"], strong_mi_indices, "excess_mean_mean", lag_step),
                    "strong_chaos_mi_excess_std": take_metric(strong_result["mi"], strong_mi_indices, "excess_mean_std", lag_step),
                    "strong_chaos_te_forward_mean": take_metric(strong_result["te"], strong_te_indices, "excess_forward_mean", lag_step),
                    "strong_chaos_te_forward_std": take_metric(strong_result["te"], strong_te_indices, "excess_forward_std", lag_step),
                    "strong_chaos_te_backward_mean": take_metric(strong_result["te"], strong_te_indices, "excess_backward_mean", lag_step),
                    "strong_chaos_te_backward_std": take_metric(strong_result["te"], strong_te_indices, "excess_backward_std", lag_step),
                    "strong_chaos_te_net_mean": take_metric(strong_result["te"], strong_te_indices, "net_excess_mean", lag_step),
                    "strong_chaos_te_net_std": take_metric(strong_result["te"], strong_te_indices, "net_excess_std", lag_step),
                }
            )

def save_shuffle_surrogate_test_csv(results, output_path):
    weak_result = results["weak_chaos"]
    strong_result = results["strong_chaos"]
    weak_mi_indices = {int(step): index for index, step in enumerate(weak_result["mi_curve"]["lag_steps"])}
    weak_te_indices = {int(step): index for index, step in enumerate(weak_result["te_total_curve"]["lag_steps"])}
    strong_mi_indices = {int(step): index for index, step in enumerate(strong_result["mi_curve"]["lag_steps"])}
    strong_te_indices = {int(step): index for index, step in enumerate(strong_result["te_total_curve"]["lag_steps"])}
    lag_steps = sorted(set(weak_mi_indices) | set(weak_te_indices) | set(strong_mi_indices) | set(strong_te_indices))
    dt = float(weak_result["mi_curve"]["lag_times"][1] - weak_result["mi_curve"]["lag_times"][0]) if len(weak_result["mi_curve"]["lag_times"]) > 1 else np.nan

    def take_metric(region_summary, index_map, key, lag_step):
        if lag_step not in index_map:
            return np.nan
        return float(region_summary[key][index_map[lag_step]])

    fieldnames = [
        "lag_step",
        "lag_time",
        "weak_chaos_mi_actual_mean",
        "weak_chaos_mi_actual_std",
        "weak_chaos_mi_surrogate_mean",
        "weak_chaos_mi_surrogate_q05",
        "weak_chaos_mi_surrogate_q95",
        "weak_chaos_te_actual_mean",
        "weak_chaos_te_actual_std",
        "weak_chaos_te_surrogate_mean",
        "weak_chaos_te_surrogate_q05",
        "weak_chaos_te_surrogate_q95",
        "strong_chaos_mi_actual_mean",
        "strong_chaos_mi_actual_std",
        "strong_chaos_mi_surrogate_mean",
        "strong_chaos_mi_surrogate_q05",
        "strong_chaos_mi_surrogate_q95",
        "strong_chaos_te_actual_mean",
        "strong_chaos_te_actual_std",
        "strong_chaos_te_surrogate_mean",
        "strong_chaos_te_surrogate_q05",
        "strong_chaos_te_surrogate_q95",
    ]

    with output_path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        for lag_step in lag_steps:
            writer.writerow(
                {
                    "lag_step": int(lag_step),
                    "lag_time": float(lag_step * dt) if np.isfinite(dt) else np.nan,
                    "weak_chaos_mi_actual_mean": take_metric(weak_result["mi_curve"], weak_mi_indices, "actual_mean", lag_step),
                    "weak_chaos_mi_actual_std": take_metric(weak_result["mi_curve"], weak_mi_indices, "actual_std", lag_step),
                    "weak_chaos_mi_surrogate_mean": take_metric(weak_result["mi_curve"], weak_mi_indices, "surrogate_mean", lag_step),
                    "weak_chaos_mi_surrogate_q05": take_metric(weak_result["mi_curve"], weak_mi_indices, "surrogate_q05", lag_step),
                    "weak_chaos_mi_surrogate_q95": take_metric(weak_result["mi_curve"], weak_mi_indices, "surrogate_q95", lag_step),
                    "weak_chaos_te_actual_mean": take_metric(weak_result["te_total_curve"], weak_te_indices, "actual_mean", lag_step),
                    "weak_chaos_te_actual_std": take_metric(weak_result["te_total_curve"], weak_te_indices, "actual_std", lag_step),
                    "weak_chaos_te_surrogate_mean": take_metric(weak_result["te_total_curve"], weak_te_indices, "surrogate_mean", lag_step),
                    "weak_chaos_te_surrogate_q05": take_metric(weak_result["te_total_curve"], weak_te_indices, "surrogate_q05", lag_step),
                    "weak_chaos_te_surrogate_q95": take_metric(weak_result["te_total_curve"], weak_te_indices, "surrogate_q95", lag_step),
                    "strong_chaos_mi_actual_mean": take_metric(strong_result["mi_curve"], strong_mi_indices, "actual_mean", lag_step),
                    "strong_chaos_mi_actual_std": take_metric(strong_result["mi_curve"], strong_mi_indices, "actual_std", lag_step),
                    "strong_chaos_mi_surrogate_mean": take_metric(strong_result["mi_curve"], strong_mi_indices, "surrogate_mean", lag_step),
                    "strong_chaos_mi_surrogate_q05": take_metric(strong_result["mi_curve"], strong_mi_indices, "surrogate_q05", lag_step),
                    "strong_chaos_mi_surrogate_q95": take_metric(strong_result["mi_curve"], strong_mi_indices, "surrogate_q95", lag_step),
                    "strong_chaos_te_actual_mean": take_metric(strong_result["te_total_curve"], strong_te_indices, "actual_mean", lag_step),
                    "strong_chaos_te_actual_std": take_metric(strong_result["te_total_curve"], strong_te_indices, "actual_std", lag_step),
                    "strong_chaos_te_surrogate_mean": take_metric(strong_result["te_total_curve"], strong_te_indices, "surrogate_mean", lag_step),
                    "strong_chaos_te_surrogate_q05": take_metric(strong_result["te_total_curve"], strong_te_indices, "surrogate_q05", lag_step),
                    "strong_chaos_te_surrogate_q95": take_metric(strong_result["te_total_curve"], strong_te_indices, "surrogate_q95", lag_step),
                }
            )

def pearson_correlation(records, x_key, y_key):
    x = np.array([record[x_key] for record in records], dtype=float)
    y = np.array([record[y_key] for record in records], dtype=float)

    if len(x) < 2:
        return np.nan

    x_std = np.std(x)
    y_std = np.std(y)
    if x_std < 1e-12 or y_std < 1e-12:
        return np.nan

    return float(np.corrcoef(x, y)[0, 1])

def add_boxplot_with_points(ax, records, metric_key, title, ylabel):
    weak = [record[metric_key] for record in records if record["chaos_region"] == "weak_chaos"]
    strong = [record[metric_key] for record in records if record["chaos_region"] == "strong_chaos"]

    ax.boxplot(
        [weak, strong],
        tick_labels=[f"Weak chaos\n(n={len(weak)})", f"Strong chaos\n(n={len(strong)})"],
        patch_artist=True,
        boxprops={"facecolor": "#dbeafe", "edgecolor": "#1d4ed8", "linewidth": 1.2},
        medianprops={"color": "#b91c1c", "linewidth": 1.6},
        whiskerprops={"color": "#1f2937"},
        capprops={"color": "#1f2937"}
    )

    for position, values, color in [(1, weak, "#2563eb"), (2, strong, "#dc2626")]:
        if not values:
            continue
        jitter = np.linspace(-0.08, 0.08, len(values))
        ax.scatter(np.full(len(values), position) + jitter, values, color=color, alpha=0.75, s=24)

    ax.set_title(title)
    ax.set_ylabel(ylabel)
    ax.grid(alpha=0.2, linestyle="--", linewidth=0.7)

def add_group_boxplot(ax, groups, title, ylabel):
    values = [group["values"] for group in groups]
    labels = [group["label"] for group in groups]

    boxplot = ax.boxplot(
        values,
        tick_labels=labels,
        patch_artist=True,
        medianprops={"color": "#111827", "linewidth": 1.5},
        whiskerprops={"color": "#1f2937"},
        capprops={"color": "#1f2937"},
    )

    for patch, group in zip(boxplot["boxes"], groups):
        patch.set_facecolor(group["color"])
        patch.set_edgecolor("#111827")
        patch.set_alpha(0.35)

    for position, group in enumerate(groups, start=1):
        group_values = group["values"]
        if not group_values:
            continue

        jitter = np.linspace(-0.1, 0.1, len(group_values))
        ax.scatter(
            np.full(len(group_values), position) + jitter,
            group_values,
            color=group["color"],
            alpha=0.55,
            s=18,
        )

    ax.set_title(title)
    ax.set_ylabel(ylabel)
    ax.grid(alpha=0.2, linestyle="--", linewidth=0.7)

def add_chaos_region_markers(ax, records):
    weak_points = [record for record in records if record["chaos_region"] == "weak_chaos"]
    strong_points = [record for record in records if record["chaos_region"] == "strong_chaos"]

    if weak_points:
        ax.scatter(
            [record["theta1_0"] / pi for record in weak_points],
            [record["theta2_0"] / pi for record in weak_points],
            s=60,
            marker="o",
            facecolors="none",
            edgecolors="#60a5fa",
            linewidths=1.6,
            label="weak chaos"
        )

    if strong_points:
        ax.scatter(
            [record["theta1_0"] / pi for record in strong_points],
            [record["theta2_0"] / pi for record in strong_points],
            s=62,
            marker="x",
            c="#fca5a5",
            linewidths=1.9,
            label="strong chaos"
        )

def plot_chaos_complexity(records, theta1_values, theta2_values, lyap_grid, thresholds, output_path):
    fig = plt.figure(figsize=(15, 11), constrained_layout=True)
    axes = fig.subplot_mosaic(
        [
            ["map", "lzma"],
            ["map", "lz"],
            ["map", "perm"]
        ],
        width_ratios=[1.3, 1.0]
    )

    theta_extent = [theta1_values[0] / pi, theta1_values[-1] / pi, theta2_values[0] / pi, theta2_values[-1] / pi]
    image = axes["map"].imshow(
        lyap_grid,
        origin="lower",
        extent=theta_extent,
        aspect="auto",
        cmap="magma"
    )
    fig.colorbar(image, ax=axes["map"], label="Lyapunov exponent")
    add_chaos_region_markers(axes["map"], records)

    axes["map"].set_title("Double pendulum: initial-condition map of chaos strength")
    axes["map"].set_xlabel(r"$\theta_1(0) / \pi$")
    axes["map"].set_ylabel(r"$\theta_2(0) / \pi$")
    axes["map"].legend(loc="upper left")
    axes["map"].text(
        0.02,
        0.02,
        (
            f"weak <= {thresholds['weak_cut']:.3f}\n"
            f"strong >= {thresholds['strong_cut']:.3f}\n"
            f"rule: {thresholds['strategy']}"
        ),
        transform=axes["map"].transAxes,
        va="bottom",
        ha="left",
        fontsize=10,
        bbox={"facecolor": "white", "alpha": 0.82, "edgecolor": "#d1d5db"}
    )

    add_boxplot_with_points(axes["lzma"], records, "LZMA_ratio", "LZMA compression ratio", "compressed / raw")
    add_boxplot_with_points(axes["lz"], records, "Lempel_Ziv_complexity", "Binary Lempel-Ziv complexity", "normalized complexity")
    add_boxplot_with_points(axes["perm"], records, "Permutation_entropy", "Permutation entropy", "normalized entropy")

    fig.suptitle("Double pendulum: complexity comparison between weak and strong chaos regions", fontsize=16)
    fig.savefig(output_path, dpi=180)
    plt.close(fig)

def add_lyapunov_scatter(ax, records, metric_key, title, ylabel):
    region_styles = {
        "near_regular": {"label": "near regular", "color": "#64748b", "marker": "o"},
        "weak_chaos": {"label": "weak chaos", "color": "#2563eb", "marker": "o"},
        "intermediate": {"label": "intermediate", "color": "#f59e0b", "marker": "^"},
        "strong_chaos": {"label": "strong chaos", "color": "#dc2626", "marker": "x"}
    }

    x_all = np.array([record["Lyapunov_exponent"] for record in records], dtype=float)
    y_all = np.array([record[metric_key] for record in records], dtype=float)
    correlation = pearson_correlation(records, "Lyapunov_exponent", metric_key)

    for region_name, style in region_styles.items():
        subset = [record for record in records if record["chaos_region"] == region_name]
        if not subset:
            continue

        x = [record["Lyapunov_exponent"] for record in subset]
        y = [record[metric_key] for record in subset]
        ax.scatter(
            x,
            y,
            s=48,
            alpha=0.82,
            color=style["color"],
            marker=style["marker"],
            label=style["label"]
        )

    if len(x_all) >= 2 and np.std(x_all) > 1e-12:
        slope, intercept = np.polyfit(x_all, y_all, 1)
        x_fit = np.linspace(np.min(x_all), np.max(x_all), 200)
        y_fit = slope * x_fit + intercept
        ax.plot(x_fit, y_fit, color="#111827", linewidth=1.3, linestyle="--", label="linear fit")

    ax.set_title(title)
    ax.set_xlabel("Lyapunov exponent")
    ax.set_ylabel(ylabel)
    ax.grid(alpha=0.22, linestyle="--", linewidth=0.7)
    ax.text(
        0.03,
        0.96,
        f"Pearson r = {correlation:.3f}",
        transform=ax.transAxes,
        ha="left",
        va="top",
        fontsize=10,
        bbox={"facecolor": "white", "alpha": 0.82, "edgecolor": "#d1d5db"}
    )

    return correlation

def plot_lyapunov_metric_scatter(records, output_path):
    fig, axes = plt.subplots(1, 3, figsize=(16, 4.8), constrained_layout=True)

    correlations = {
        "LZMA_ratio": add_lyapunov_scatter(
            axes[0],
            records,
            "LZMA_ratio",
            "Lyapunov exponent vs LZMA ratio",
            "LZMA compression ratio"
        ),
        "Lempel_Ziv_complexity": add_lyapunov_scatter(
            axes[1],
            records,
            "Lempel_Ziv_complexity",
            "Lyapunov exponent vs Lempel-Ziv",
            "Lempel-Ziv complexity"
        ),
        "Permutation_entropy": add_lyapunov_scatter(
            axes[2],
            records,
            "Permutation_entropy",
            "Lyapunov exponent vs permutation entropy",
            "Permutation entropy"
        )
    }

    handles, labels = axes[0].get_legend_handles_labels()
    axes[0].legend(handles, labels, loc="lower right", fontsize=9, frameon=True)
    fig.suptitle("Double pendulum: correlation between chaos strength and complexity", fontsize=16)
    fig.savefig(output_path, dpi=180)
    plt.close(fig)

    return correlations

def add_pesin_relation_scatter(ax, records):
    region_styles = {
        "near_regular": {"label": "near regular", "color": "#64748b", "marker": "o"},
        "weak_chaos": {"label": "weak chaos", "color": "#2563eb", "marker": "o"},
        "intermediate": {"label": "intermediate", "color": "#f59e0b", "marker": "^"},
        "strong_chaos": {"label": "strong chaos", "color": "#dc2626", "marker": "x"}
    }

    x_all = np.array([record["Lyapunov_exponent"] for record in records], dtype=float)
    y_all = np.array([record["KS_entropy_Pesin"] for record in records], dtype=float)

    for region_name, style in region_styles.items():
        subset = [record for record in records if record["chaos_region"] == region_name]
        if not subset:
            continue

        ax.scatter(
            [record["Lyapunov_exponent"] for record in subset],
            [record["KS_entropy_Pesin"] for record in subset],
            s=50,
            alpha=0.82,
            color=style["color"],
            marker=style["marker"],
            label=style["label"]
        )

    lower = min(np.min(x_all), np.min(y_all))
    upper = max(np.max(x_all), np.max(y_all))
    ax.plot([lower, upper], [lower, upper], color="#111827", linewidth=1.3, linestyle="--", label=r"$h_{KS} = \lambda_1$")

    correlation = pearson_correlation(records, "Lyapunov_exponent", "KS_entropy_Pesin")
    mean_gap = float(np.mean(y_all - x_all))

    ax.set_title("Pesin estimate vs largest Lyapunov exponent")
    ax.set_xlabel(r"Largest Lyapunov exponent $\lambda_1$")
    ax.set_ylabel(r"KS entropy estimate $h_{KS} \approx \sum \lambda_i^+$")
    ax.grid(alpha=0.22, linestyle="--", linewidth=0.7)
    ax.text(
        0.03,
        0.97,
        f"Pearson r = {correlation:.3f}\nmean gap = {mean_gap:.3e}",
        transform=ax.transAxes,
        ha="left",
        va="top",
        fontsize=10,
        bbox={"facecolor": "white", "alpha": 0.82, "edgecolor": "#d1d5db"}
    )

def add_region_spectrum_summary(ax, records):
    if not records:
        return

    spectrum_keys = lyapunov_component_keys(records[0])
    x_positions = np.arange(1, len(spectrum_keys) + 1)
    region_styles = [
        ("weak_chaos", "Weak chaos", "#2563eb", "o"),
        ("strong_chaos", "Strong chaos", "#dc2626", "s"),
    ]

    for region_name, label, color, marker in region_styles:
        subset = [record for record in records if record["chaos_region"] == region_name]
        if not subset:
            continue

        means = []
        stds = []
        for key in spectrum_keys:
            values = np.array([record[key] for record in subset], dtype=float)
            means.append(np.mean(values))
            stds.append(np.std(values))

        ax.errorbar(
            x_positions,
            means,
            yerr=stds,
            marker=marker,
            markersize=6,
            linewidth=1.6,
            capsize=4,
            color=color,
            label=f"{label} mean ± std"
        )

    ax.axhline(0.0, color="#111827", linewidth=1.0, linestyle=":")
    ax.set_xticks(x_positions)
    ax.set_xlabel("Spectrum index")
    ax.set_ylabel("Lyapunov exponent")
    ax.set_title("Benettin Lyapunov spectrum by chaos region")
    ax.grid(alpha=0.22, linestyle="--", linewidth=0.7)
    ax.legend(loc="lower left", fontsize=9, frameon=True)

def plot_ks_pesin_comparison(records, theta1_values, theta2_values, ks_grid, output_path):
    fig = plt.figure(figsize=(15, 8.5), constrained_layout=True)
    axes = fig.subplot_mosaic(
        [
            ["map", "scatter"],
            ["spectrum", "scatter"],
        ],
        width_ratios=[1.15, 1.0]
    )

    theta_extent = [theta1_values[0] / pi, theta1_values[-1] / pi, theta2_values[0] / pi, theta2_values[-1] / pi]
    image = axes["map"].imshow(
        ks_grid,
        origin="lower",
        extent=theta_extent,
        aspect="auto",
        cmap="viridis"
    )
    fig.colorbar(image, ax=axes["map"], label=r"KS entropy estimate $h_{KS}$")
    add_chaos_region_markers(axes["map"], records)
    axes["map"].set_title("Double pendulum: KS entropy estimate over initial conditions")
    axes["map"].set_xlabel(r"$\theta_1(0) / \pi$")
    axes["map"].set_ylabel(r"$\theta_2(0) / \pi$")
    axes["map"].legend(loc="upper left")

    add_pesin_relation_scatter(axes["scatter"], records)
    handles, labels = axes["scatter"].get_legend_handles_labels()
    axes["scatter"].legend(handles, labels, loc="lower right", fontsize=9, frameon=True)

    add_region_spectrum_summary(axes["spectrum"], records)

    fig.suptitle("Double pendulum: KS entropy approximation with Benettin spectrum", fontsize=16)
    fig.savefig(output_path, dpi=180)
    plt.close(fig)

def plot_noise_comparison(records, noise_records, output_path):
    weak_chaos = [record["Permutation_entropy"] for record in records if record["chaos_region"] == "weak_chaos"]
    strong_chaos = [record["Permutation_entropy"] for record in records if record["chaos_region"] == "strong_chaos"]
    weak_noise = [record["Permutation_entropy"] for record in noise_records if record["source_region"] == "weak_chaos"]
    strong_noise = [record["Permutation_entropy"] for record in noise_records if record["source_region"] == "strong_chaos"]
    weak_delta = [record["Permutation_entropy_delta_vs_source"] for record in noise_records if record["source_region"] == "weak_chaos"]
    strong_delta = [record["Permutation_entropy_delta_vs_source"] for record in noise_records if record["source_region"] == "strong_chaos"]

    weak_sep = permutation_entropy_separation(noise_records, "weak_chaos")
    strong_sep = permutation_entropy_separation(noise_records, "strong_chaos")

    fig, axes = plt.subplots(1, 2, figsize=(15, 5.2), constrained_layout=True)
    add_group_boxplot(
        axes[0],
        [
            {"label": f"Weak chaos\n(n={len(weak_chaos)})", "values": weak_chaos, "color": "#2563eb"},
            {"label": f"Strong chaos\n(n={len(strong_chaos)})", "values": strong_chaos, "color": "#dc2626"},
            {"label": f"Noise | weak\n(n={len(weak_noise)})", "values": weak_noise, "color": "#0f766e"},
            {"label": f"Noise | strong\n(n={len(strong_noise)})", "values": strong_noise, "color": "#16a34a"},
        ],
        "Permutation entropy: chaos vs matched white noise",
        "Permutation entropy",
    )

    add_group_boxplot(
        axes[1],
        [
            {"label": f"Noise - weak chaos\n(n={len(weak_delta)})", "values": weak_delta, "color": "#0f766e"},
            {"label": f"Noise - strong chaos\n(n={len(strong_delta)})", "values": strong_delta, "color": "#16a34a"},
        ],
        "Permutation entropy gap",
        r"$H_{perm}(noise) - H_{perm}(chaos)$",
    )
    axes[1].axhline(0.0, color="#111827", linewidth=1.0, linestyle=":")
    axes[1].text(
        0.03,
        0.97,
        (
            f"noise > chaos share\n"
            f"weak: {weak_sep['positive_fraction']:.1%}\n"
            f"strong: {strong_sep['positive_fraction']:.1%}"
        ),
        transform=axes[1].transAxes,
        ha="left",
        va="top",
        fontsize=10,
        bbox={"facecolor": "white", "alpha": 0.82, "edgecolor": "#d1d5db"},
    )

    fig.suptitle("Double pendulum: separating chaos from white noise with permutation entropy", fontsize=16)
    fig.savefig(output_path, dpi=180)
    plt.close(fig)

def plot_coarse_graining_dependence(summary_rows, robustness, output_path):
    if not summary_rows:
        return

    bin_values = np.array([row["bins"] for row in summary_rows], dtype=float)
    fig, axes = plt.subplots(1, 2, figsize=(15, 5.4), constrained_layout=True)

    line_specs = [
        ("weak_chaos", "Weak chaos", "#2563eb", "o"),
        ("strong_chaos", "Strong chaos", "#dc2626", "s"),
        ("weak_noise", "Noise | weak chaos", "#0f766e", "^"),
        ("strong_noise", "Noise | strong chaos", "#16a34a", "D"),
    ]

    for group_name, label, color, marker in line_specs:
        means = np.array([row[f"{group_name}_mean"] for row in summary_rows], dtype=float)
        stds = np.array([row[f"{group_name}_std"] for row in summary_rows], dtype=float)
        axes[0].errorbar(
            bin_values,
            means,
            yerr=stds,
            marker=marker,
            markersize=6,
            linewidth=1.6,
            capsize=4,
            color=color,
            label=label,
        )

    axes[0].set_xscale("log", base=2)
    axes[0].set_xticks(bin_values)
    axes[0].set_xticklabels([str(int(bins)) for bins in bin_values])
    axes[0].set_xlabel("Quantization bins")
    axes[0].set_ylabel("LZMA compression ratio")
    axes[0].set_title("LZMA ratio under coarse-graining")
    axes[0].grid(alpha=0.22, linestyle="--", linewidth=0.7)
    axes[0].legend(loc="lower right", fontsize=9, frameon=True)

    axes[1].plot(
        bin_values,
        [row["weak_noise_minus_chaos_mean"] for row in summary_rows],
        marker="^",
        markersize=6,
        linewidth=1.6,
        color="#0f766e",
        label="Noise - weak chaos",
    )
    axes[1].plot(
        bin_values,
        [row["strong_noise_minus_chaos_mean"] for row in summary_rows],
        marker="D",
        markersize=6,
        linewidth=1.6,
        color="#16a34a",
        label="Noise - strong chaos",
    )
    axes[1].plot(
        bin_values,
        [row["strong_minus_weak_chaos_mean"] for row in summary_rows],
        marker="s",
        markersize=6,
        linewidth=1.6,
        color="#dc2626",
        label="Strong - weak chaos",
    )
    axes[1].axhline(0.0, color="#111827", linewidth=1.0, linestyle=":")
    axes[1].set_xscale("log", base=2)
    axes[1].set_xticks(bin_values)
    axes[1].set_xticklabels([str(int(bins)) for bins in bin_values])
    axes[1].set_xlabel("Quantization bins")
    axes[1].set_ylabel("LZMA ratio difference")
    axes[1].set_title("Separation stability across bins")
    axes[1].grid(alpha=0.22, linestyle="--", linewidth=0.7)
    axes[1].legend(loc="lower right", fontsize=9, frameon=True)
    axes[1].text(
        0.03,
        0.97,
        (
            f"strong > weak all bins: {robustness['strong_gt_weak_all_bins']}\n"
            f"min weak-noise > chaos share: {robustness['weak_noise_gt_chaos_min_fraction']:.1%}\n"
            f"min strong-noise > chaos share: {robustness['strong_noise_gt_chaos_min_fraction']:.1%}"
        ),
        transform=axes[1].transAxes,
        ha="left",
        va="top",
        fontsize=10,
        bbox={"facecolor": "white", "alpha": 0.82, "edgecolor": "#d1d5db"},
    )

    fig.suptitle("Double pendulum: coarse-graining dependence of compression-based complexity", fontsize=16)
    fig.savefig(output_path, dpi=180)
    plt.close(fig)

def plot_entropy_production(results, summary, output_path):
    fig, axes = plt.subplots(1, 2, figsize=(15, 5.6), constrained_layout=True)
    region_styles = [
        ("weak_chaos", "Weak chaos", "#2563eb"),
        ("strong_chaos", "Strong chaos", "#dc2626"),
    ]

    for region_name, label, color in region_styles:
        result = results[region_name]
        axes[0].plot(result["times"], result["entropy"], color=color, linewidth=1.8, label=label)
        fit_times = result["times"][:result["fit_end"]]
        fit_values = result["slope"] * fit_times + result["intercept"]
        axes[0].plot(
            fit_times,
            fit_values,
            color=color,
            linewidth=1.3,
            linestyle="--",
            label=f"{label} fit",
        )

    axes[0].set_xlabel("time")
    axes[0].set_ylabel(r"Coarse-grained entropy $S(t)$ [nats]")
    axes[0].set_title("Phase-space entropy production from a localized cloud")
    axes[0].grid(alpha=0.22, linestyle="--", linewidth=0.7)
    axes[0].legend(loc="upper left", fontsize=9, frameon=True)
    axes[0].text(
        0.03,
        0.03,
        (
            f"cells = {summary['total_cells']}\n"
            f"ensemble = {summary['ensemble_size']}\n"
            f"partition = {summary['phase_bins_per_dim']} bins / dim"
        ),
        transform=axes[0].transAxes,
        ha="left",
        va="bottom",
        fontsize=10,
        bbox={"facecolor": "white", "alpha": 0.82, "edgecolor": "#d1d5db"},
    )

    x_positions = np.arange(2)
    bar_width = 0.24
    slope_values = [results["weak_chaos"]["slope"], results["strong_chaos"]["slope"]]
    lambda_values = [
        results["weak_chaos"]["record"]["Lyapunov_exponent"],
        results["strong_chaos"]["record"]["Lyapunov_exponent"],
    ]
    hks_values = [
        results["weak_chaos"]["record"]["KS_entropy_Pesin"],
        results["strong_chaos"]["record"]["KS_entropy_Pesin"],
    ]

    axes[1].bar(x_positions - bar_width, slope_values, width=bar_width, color=["#60a5fa", "#f87171"], label=r"$dS/dt$ fit")
    axes[1].bar(x_positions, lambda_values, width=bar_width, color=["#2563eb", "#dc2626"], label=r"$\lambda_1$")
    axes[1].bar(x_positions + bar_width, hks_values, width=bar_width, color=["#93c5fd", "#fca5a5"], label=r"$h_{KS}$")
    axes[1].set_xticks(x_positions)
    axes[1].set_xticklabels(["Weak chaos", "Strong chaos"])
    axes[1].set_ylabel("rate [nats / time]")
    axes[1].set_title("Entropy-growth rate vs local chaos indicators")
    axes[1].grid(alpha=0.22, linestyle="--", linewidth=0.7)
    axes[1].legend(loc="upper left", fontsize=9, frameon=True)
    ratio_text = "n/a" if not np.isfinite(summary["slope_ratio_strong_to_weak"]) else f"{summary['slope_ratio_strong_to_weak']:.2f}"
    axes[1].text(
        0.5,
        0.97,
        (
            f"strong > weak slope: {summary['strong_faster_than_weak']}\n"
            f"strong/weak slope ratio: {ratio_text}"
        ),
        transform=axes[1].transAxes,
        ha="center",
        va="top",
        fontsize=10,
        bbox={"facecolor": "white", "alpha": 0.82, "edgecolor": "#d1d5db"},
    )

    fig.suptitle("Double pendulum: coarse-grained entropy production in phase space", fontsize=16)
    fig.savefig(output_path, dpi=180)
    plt.close(fig)

def plot_mutual_information_decay(results, summary, output_path):
    fig, axes = plt.subplots(2, 2, figsize=(15.8, 9.0), constrained_layout=True)
    region_styles = [
        ("weak_chaos", "Weak chaos", "#2563eb"),
        ("strong_chaos", "Strong chaos", "#dc2626"),
    ]

    for region_name, label, color in region_styles:
        region = results[region_name]
        mi_summary = region["mi"]
        te_summary = region["te"]
        mi_mean = mi_summary["normalized_mean_mean"]
        mi_std = mi_summary["normalized_mean_std"]
        axes[0, 0].plot(mi_summary["lag_times"], mi_mean, color=color, linewidth=1.9, label=label)
        axes[0, 0].fill_between(
            mi_summary["lag_times"],
            np.maximum(mi_mean - mi_std, 0.0),
            mi_mean + mi_std,
            color=color,
            alpha=0.16,
        )
        if np.isfinite(mi_summary["peak_time_mean"]):
            axes[0, 0].axvline(mi_summary["peak_time_mean"], color=color, linewidth=1.0, linestyle="-.", alpha=0.45)

        axes[0, 1].plot(te_summary["lag_times"], te_summary["excess_forward_mean"], color=color, linewidth=1.8, label=f"{label} 1→2")
        axes[0, 1].fill_between(
            te_summary["lag_times"],
            np.maximum(te_summary["excess_forward_mean"] - te_summary["excess_forward_std"], 0.0),
            te_summary["excess_forward_mean"] + te_summary["excess_forward_std"],
            color=color,
            alpha=0.14,
        )
        axes[0, 1].plot(
            te_summary["lag_times"],
            te_summary["excess_backward_mean"],
            color=color,
            linewidth=1.4,
            linestyle="--",
            label=f"{label} 2→1",
        )
        axes[0, 1].fill_between(
            te_summary["lag_times"],
            np.maximum(te_summary["excess_backward_mean"] - te_summary["excess_backward_std"], 0.0),
            te_summary["excess_backward_mean"] + te_summary["excess_backward_std"],
            color=color,
            alpha=0.08,
        )

    axes[0, 0].axhline(np.exp(-1.0), color="#111827", linewidth=1.0, linestyle=":", label=r"$e^{-1}$ threshold")
    axes[0, 0].set_xlabel("lag time")
    axes[0, 0].set_ylabel("Normalized excess mutual information")
    axes[0, 0].set_title("Multi-orbit mean excess MI")
    axes[0, 0].grid(alpha=0.22, linestyle="--", linewidth=0.7)
    axes[0, 0].legend(loc="upper right", fontsize=8, frameon=True)
    axes[0, 0].text(
        0.03,
        0.03,
        f"representatives / region = {summary['representative_count']}",
        transform=axes[0, 0].transAxes,
        ha="left",
        va="bottom",
        fontsize=10,
        bbox={"facecolor": "white", "alpha": 0.82, "edgecolor": "#d1d5db"},
    )

    axes[0, 1].axhline(0.0, color="#111827", linewidth=1.0, linestyle=":")
    axes[0, 1].set_xlabel("lag time")
    axes[0, 1].set_ylabel("Excess transfer entropy [nats]")
    axes[0, 1].set_title("Directional information flow with transfer entropy")
    axes[0, 1].grid(alpha=0.22, linestyle="--", linewidth=0.7)
    axes[0, 1].legend(loc="upper right", fontsize=8, frameon=True, ncol=2)
    axes[0, 1].text(
        0.03,
        0.97,
        (
            f"weak dominant: {summary['weak_dominant_direction']}\n"
            f"strong dominant: {summary['strong_dominant_direction']}"
        ),
        transform=axes[0, 1].transAxes,
        ha="left",
        va="top",
        fontsize=10,
        bbox={"facecolor": "white", "alpha": 0.82, "edgecolor": "#d1d5db"},
    )

    x_positions = np.arange(2)
    bar_width = 0.28
    peak_values = [results["weak_chaos"]["mi"]["peak_time_mean"], results["strong_chaos"]["mi"]["peak_time_mean"]]
    peak_errors = [results["weak_chaos"]["mi"]["peak_time_std"], results["strong_chaos"]["mi"]["peak_time_std"]]
    decay_values = [results["weak_chaos"]["mi"]["post_peak_decay_time_mean"], results["strong_chaos"]["mi"]["post_peak_decay_time_mean"]]
    decay_errors = [results["weak_chaos"]["mi"]["post_peak_decay_time_std"], results["strong_chaos"]["mi"]["post_peak_decay_time_std"]]

    axes[1, 0].bar(
        x_positions - bar_width / 2,
        np.nan_to_num(peak_values, nan=0.0),
        width=bar_width,
        yerr=np.nan_to_num(peak_errors, nan=0.0),
        capsize=4,
        color=["#60a5fa", "#f87171"],
        label="peak lag",
    )
    axes[1, 0].bar(
        x_positions + bar_width / 2,
        np.nan_to_num(decay_values, nan=0.0),
        width=bar_width,
        yerr=np.nan_to_num(decay_errors, nan=0.0),
        capsize=4,
        color=["#93c5fd", "#fca5a5"],
        label="post-peak decay",
    )
    for index, decay_value in enumerate(decay_values):
        if not np.isfinite(decay_value):
            axes[1, 0].text(index + bar_width / 2, 0.02, "n/a", ha="center", va="bottom", fontsize=9, rotation=90)
    axes[1, 0].set_xticks(x_positions)
    axes[1, 0].set_xticklabels(["Weak chaos", "Strong chaos"])
    axes[1, 0].set_ylabel("time")
    axes[1, 0].set_title("MI propagation and memory time")
    axes[1, 0].grid(alpha=0.22, linestyle="--", linewidth=0.7)
    axes[1, 0].legend(loc="upper right", fontsize=9, frameon=True)
    peak_ratio_text = "n/a" if not np.isfinite(summary["mi_peak_time_ratio_strong_to_weak"]) else f"{summary['mi_peak_time_ratio_strong_to_weak']:.2f}"
    decay_ratio_text = "n/a" if not np.isfinite(summary["mi_decay_time_ratio_strong_to_weak"]) else f"{summary['mi_decay_time_ratio_strong_to_weak']:.2f}"
    axes[1, 0].text(
        0.03,
        0.97,
        (
            f"strong earlier peak: {summary['strong_earlier_peak']}\n"
            f"peak ratio strong/weak: {peak_ratio_text}\n"
            f"decay ratio strong/weak: {decay_ratio_text}"
        ),
        transform=axes[1, 0].transAxes,
        ha="left",
        va="top",
        fontsize=10,
        bbox={"facecolor": "white", "alpha": 0.82, "edgecolor": "#d1d5db"},
    )

    net_area_values = [results["weak_chaos"]["te"]["net_directional_area_mean"], results["strong_chaos"]["te"]["net_directional_area_mean"]]
    net_area_errors = [results["weak_chaos"]["te"]["net_directional_area_std"], results["strong_chaos"]["te"]["net_directional_area_std"]]
    total_area_values = [results["weak_chaos"]["te"]["total_transfer_area_mean"], results["strong_chaos"]["te"]["total_transfer_area_mean"]]
    total_area_errors = [results["weak_chaos"]["te"]["total_transfer_area_std"], results["strong_chaos"]["te"]["total_transfer_area_std"]]
    axes[1, 1].bar(
        x_positions - bar_width / 2,
        net_area_values,
        width=bar_width,
        yerr=np.nan_to_num(net_area_errors, nan=0.0),
        capsize=4,
        color=["#2563eb", "#dc2626"],
        label="net directional area",
    )
    axes[1, 1].bar(
        x_positions + bar_width / 2,
        total_area_values,
        width=bar_width,
        yerr=np.nan_to_num(total_area_errors, nan=0.0),
        capsize=4,
        color=["#93c5fd", "#fca5a5"],
        label="total TE area",
    )
    axes[1, 1].axhline(0.0, color="#111827", linewidth=1.0, linestyle=":")
    axes[1, 1].set_xticks(x_positions)
    axes[1, 1].set_xticklabels(["Weak chaos", "Strong chaos"])
    axes[1, 1].set_ylabel("integrated excess TE")
    axes[1, 1].set_title("Directional transfer-entropy summary")
    axes[1, 1].grid(alpha=0.22, linestyle="--", linewidth=0.7)
    axes[1, 1].legend(loc="upper right", fontsize=9, frameon=True)
    axes[1, 1].text(
        0.03,
        0.97,
        (
            f"strong more directional: {summary['strong_more_directional']}\n"
            f"weak |net| mean: {summary['weak_te_directionality_strength']:.4f}\n"
            f"strong |net| mean: {summary['strong_te_directionality_strength']:.4f}"
        ),
        transform=axes[1, 1].transAxes,
        ha="left",
        va="top",
        fontsize=10,
        bbox={"facecolor": "white", "alpha": 0.82, "edgecolor": "#d1d5db"},
    )

    fig.suptitle("Double pendulum: averaged subsystem information flow", fontsize=16)
    fig.savefig(output_path, dpi=180)
    plt.close(fig)

def plot_shuffle_surrogate_test(results, summary, output_path):
    fig, axes = plt.subplots(2, 2, figsize=(15.8, 9.0), constrained_layout=True)
    panel_specs = [
        (axes[0, 0], "weak_chaos", "mi_curve", "Weak chaos: MI vs shuffled surrogate", "Raw mutual information [nats]", "#2563eb"),
        (axes[0, 1], "strong_chaos", "mi_curve", "Strong chaos: MI vs shuffled surrogate", "Raw mutual information [nats]", "#dc2626"),
        (axes[1, 0], "weak_chaos", "te_total_curve", "Weak chaos: TE vs shuffled surrogate", "Raw total transfer entropy [nats]", "#0f766e"),
        (axes[1, 1], "strong_chaos", "te_total_curve", "Strong chaos: TE vs shuffled surrogate", "Raw total transfer entropy [nats]", "#a16207"),
    ]

    for axis, region_name, curve_key, title, ylabel, color in panel_specs:
        region = results[region_name]
        curve = region[curve_key]
        axis.plot(curve["lag_times"], curve["actual_mean"], color=color, linewidth=1.9, label="actual mean")
        axis.fill_between(
            curve["lag_times"],
            np.maximum(curve["actual_mean"] - curve["actual_std"], 0.0),
            curve["actual_mean"] + curve["actual_std"],
            color=color,
            alpha=0.16,
        )
        axis.plot(curve["lag_times"], curve["surrogate_mean"], color="#111827", linewidth=1.5, linestyle="--", label="shuffle mean")
        axis.fill_between(
            curve["lag_times"],
            curve["surrogate_q05"],
            curve["surrogate_q95"],
            color="#9ca3af",
            alpha=0.24,
            label="shuffle 5-95%",
        )
        axis.plot(curve["lag_times"], curve["surrogate_q95"], color="#6b7280", linewidth=1.0, linestyle=":")
        axis.set_xlabel("lag time")
        axis.set_ylabel(ylabel)
        axis.set_title(title)
        axis.grid(alpha=0.22, linestyle="--", linewidth=0.7)
        axis.legend(loc="upper right", fontsize=8, frameon=True)

        if curve_key == "mi_curve":
            peak = region["mi_peak"]
            area = region["mi_excess_area"]
            summary_text = (
                f"peak actual/surrogate: {peak['actual_mean']:.3f} / {peak['surrogate_mean']:.3f}\n"
                f"excess area actual/surrogate: {area['actual_mean']:.3f} / {area['surrogate_mean']:.3f}\n"
                f"actual > trial q95: {peak['actual_gt_trial_q95_fraction']:.1%}\n"
                f"mean empirical p: {peak['empirical_p_mean']:.3f}\n"
                f"lag share > q95: {curve['actual_above_q95_fraction']:.1%}"
            )
        else:
            area = region["te_excess_area"]
            directionality = region["te_directionality_strength"]
            summary_text = (
                f"TE excess area actual/surrogate: {area['actual_mean']:.3f} / {area['surrogate_mean']:.3f}\n"
                f"|ΔTE| actual/surrogate: {directionality['actual_mean']:.3f} / {directionality['surrogate_mean']:.3f}\n"
                f"actual > trial q95: {area['actual_gt_trial_q95_fraction']:.1%}\n"
                f"mean empirical p: {area['empirical_p_mean']:.3f}\n"
                f"lag share > q95: {curve['actual_above_q95_fraction']:.1%}"
            )

        axis.text(
            0.03,
            0.97,
            summary_text,
            transform=axis.transAxes,
            ha="left",
            va="top",
            fontsize=9.5,
            bbox={"facecolor": "white", "alpha": 0.82, "edgecolor": "#d1d5db"},
        )

    fig.suptitle(
        "Double pendulum: shuffle-surrogate test for false-correlation removal\n"
        f"{summary['representative_count']} representative orbits / region, {summary['surrogate_trials']} shuffled surrogates / orbit",
        fontsize=16,
    )
    fig.savefig(output_path, dpi=180)
    plt.close(fig)

# ----------------------------
# main
# ----------------------------

if __name__ == "__main__":
    dt = 0.01
    steps = 18000
    discard = 3000
    renorm_steps = 25
    noise_trials = 16
    noise_seed = 20260510
    coarse_bins = [4, 8, 16, 32, 64, 128, 256]
    coarse_seed = 20260511
    entropy_seed = 20260512
    entropy_steps = 4000
    entropy_sample_interval = 20
    entropy_ensemble_size = 1024
    entropy_phase_bins = 8
    entropy_angle_spread = 2e-3
    entropy_omega_spread = 2e-3
    flow_steps = 18000
    flow_discard = 3000
    flow_representative_count = 5
    flow_max_lag_steps = 2000
    flow_lag_stride = 10
    flow_mi_bins = 32
    flow_mi_baseline_shuffles = 8
    flow_te_bins = 12
    flow_te_baseline_shuffles = 6
    flow_seed = 20260513
    surrogate_test_trials = 12
    surrogate_test_seed = 20260514
    theta1_values = np.linspace(0.15 * pi, 0.95 * pi, 7)
    theta2_values = np.linspace(0.15 * pi, 0.95 * pi, 7)
    base_dir = Path(__file__).resolve().parent
    figure_path = base_dir / "double_pendulum_chaos_complexity.png"
    scatter_figure_path = base_dir / "double_pendulum_lyapunov_scatter.png"
    ks_figure_path = base_dir / "double_pendulum_ks_pesin.png"
    csv_path = base_dir / "double_pendulum_chaos_complexity.csv"
    noise_csv_path = base_dir / "double_pendulum_noise_comparison.csv"
    noise_figure_path = base_dir / "double_pendulum_noise_comparison.png"
    coarse_csv_path = base_dir / "double_pendulum_coarse_graining.csv"
    coarse_figure_path = base_dir / "double_pendulum_coarse_graining.png"
    entropy_csv_path = base_dir / "double_pendulum_entropy_production.csv"
    entropy_figure_path = base_dir / "double_pendulum_entropy_production.png"
    information_flow_csv_path = base_dir / "double_pendulum_information_flow.csv"
    information_flow_figure_path = base_dir / "double_pendulum_information_flow.png"
    surrogate_test_csv_path = base_dir / "double_pendulum_shuffle_surrogate_test.csv"
    surrogate_test_figure_path = base_dir / "double_pendulum_shuffle_surrogate_test.png"

    f_double = double_pendulum_dynamics()
    records, lyap_grid, ks_grid, sampled_series = scan_double_pendulum_grid(
        f_double,
        theta1_values,
        theta2_values,
        dt=dt,
        steps=steps,
        discard=discard,
        observe_index=0,
        renorm_steps=renorm_steps,
    )

    thresholds = label_chaos_regions(records, positive_floor=0.02)
    weak_summary = summarize_region(records, "weak_chaos")
    strong_summary = summarize_region(records, "strong_chaos")
    noise_records = compare_chaos_to_random_noise(
        records,
        sampled_series,
        source_regions={"weak_chaos", "strong_chaos"},
        trials_per_series=noise_trials,
        seed=noise_seed,
    )
    weak_noise_summary = summarize_noise_records(noise_records, "weak_chaos")
    strong_noise_summary = summarize_noise_records(noise_records, "strong_chaos")
    overall_noise_summary = summarize_noise_records(noise_records)
    weak_separation = permutation_entropy_separation(noise_records, "weak_chaos")
    strong_separation = permutation_entropy_separation(noise_records, "strong_chaos")
    overall_separation = permutation_entropy_separation(noise_records)
    coarse_group_rows, coarse_delta_rows = run_coarse_graining_experiment(
        records,
        sampled_series,
        source_regions={"weak_chaos", "strong_chaos"},
        bin_values=coarse_bins,
        noise_trials=noise_trials,
        seed=coarse_seed,
    )
    coarse_summary_rows = summarize_coarse_graining(coarse_group_rows, coarse_delta_rows, coarse_bins)
    coarse_robustness = assess_coarse_graining_robustness(coarse_summary_rows)
    entropy_results, entropy_summary = run_entropy_production_experiment(
        records,
        dt=dt,
        settle_steps=discard,
        entropy_steps=entropy_steps,
        sample_interval=entropy_sample_interval,
        ensemble_size=entropy_ensemble_size,
        phase_bins=entropy_phase_bins,
        angle_spread=entropy_angle_spread,
        omega_spread=entropy_omega_spread,
        seed=entropy_seed,
    )
    mi_results, mi_summary = run_information_flow_experiment(
        records,
        dt=dt,
        steps=flow_steps,
        discard=flow_discard,
        representative_count=flow_representative_count,
        max_lag_steps=flow_max_lag_steps,
        lag_stride=flow_lag_stride,
        mi_bins=flow_mi_bins,
        mi_baseline_shuffles=flow_mi_baseline_shuffles,
        te_bins=flow_te_bins,
        te_baseline_shuffles=flow_te_baseline_shuffles,
        seed=flow_seed,
    )
    surrogate_results, surrogate_summary = run_shuffle_surrogate_test(
        records,
        dt=dt,
        steps=flow_steps,
        discard=flow_discard,
        representative_count=flow_representative_count,
        max_lag_steps=flow_max_lag_steps,
        lag_stride=flow_lag_stride,
        mi_bins=flow_mi_bins,
        te_bins=flow_te_bins,
        surrogate_trials=surrogate_test_trials,
        seed=surrogate_test_seed,
    )

    save_records_csv(records, csv_path)
    save_noise_records_csv(noise_records, noise_csv_path)
    save_coarse_graining_summary_csv(coarse_summary_rows, coarse_csv_path)
    save_entropy_production_csv(entropy_results, entropy_csv_path)
    save_information_flow_csv(mi_results, information_flow_csv_path)
    save_shuffle_surrogate_test_csv(surrogate_results, surrogate_test_csv_path)
    plot_chaos_complexity(records, theta1_values, theta2_values, lyap_grid, thresholds, figure_path)
    correlations = plot_lyapunov_metric_scatter(records, scatter_figure_path)
    plot_ks_pesin_comparison(records, theta1_values, theta2_values, ks_grid, ks_figure_path)
    plot_noise_comparison(records, noise_records, noise_figure_path)
    plot_coarse_graining_dependence(coarse_summary_rows, coarse_robustness, coarse_figure_path)
    plot_entropy_production(entropy_results, entropy_summary, entropy_figure_path)
    plot_mutual_information_decay(mi_results, mi_summary, information_flow_figure_path)
    plot_shuffle_surrogate_test(surrogate_results, surrogate_summary, surrogate_test_figure_path)

    spectrum_keys = lyapunov_component_keys(records[0]) if records else []
    mean_spectrum = [float(np.mean([record[key] for record in records])) for key in spectrum_keys]
    ks_values = np.array([record["KS_entropy_Pesin"] for record in records], dtype=float)
    pesin_gaps = np.array([record["Pesin_gap_lambda1"] for record in records], dtype=float)

    print("\n=== Double pendulum: chaos-strength comparison ===")
    print(f"samples                  : {len(records)}")
    print(f"Benettin renorm steps    : {renorm_steps}")
    print(f"weak-chaos threshold     : <= {thresholds['weak_cut']:.4f}")
    print(f"strong-chaos threshold   : >= {thresholds['strong_cut']:.4f}")
    print(f"classification strategy  : {thresholds['strategy']}")
    print("mean Lyapunov spectrum   : " + ", ".join(f"{value:.4f}" for value in mean_spectrum))
    print(f"mean KS entropy (Pesin)  : {np.mean(ks_values):.4f} ± {np.std(ks_values):.4f}")
    print(f"mean h_KS - lambda_1     : {np.mean(pesin_gaps):.4e} ± {np.std(pesin_gaps):.4e}")

    for region_name, summary in [("weak_chaos", weak_summary), ("strong_chaos", strong_summary)]:
        print(f"\n[{region_name}] n = {summary['count']}")
        print(f"Lyapunov exponent        : {summary['Lyapunov_exponent']:.4f} ± {summary['Lyapunov_exponent_std']:.4f}")
        print(f"KS entropy (Pesin)       : {summary['KS_entropy_Pesin']:.4f} ± {summary['KS_entropy_Pesin_std']:.4f}")
        print(f"h_KS - lambda_1          : {summary['Pesin_gap_lambda1']:.4e} ± {summary['Pesin_gap_lambda1_std']:.4e}")
        print(
            "Benettin spectrum         : ["
            + ", ".join(f"{summary[key]:.4f}" for key in spectrum_keys)
            + "]"
        )
        print(f"LZMA ratio               : {summary['LZMA_ratio']:.4f} ± {summary['LZMA_ratio_std']:.4f}")
        print(f"Lempel-Ziv complexity    : {summary['Lempel_Ziv_complexity']:.4f} ± {summary['Lempel_Ziv_complexity_std']:.4f}")
        print(f"Permutation entropy      : {summary['Permutation_entropy']:.4f} ± {summary['Permutation_entropy_std']:.4f}")

    print("\n=== Correlation: Lyapunov exponent vs complexity ===")
    print(f"Lyapunov vs LZMA ratio            : r = {correlations['LZMA_ratio']:.4f}")
    print(f"Lyapunov vs Lempel-Ziv complexity : r = {correlations['Lempel_Ziv_complexity']:.4f}")
    print(f"Lyapunov vs Permutation entropy   : r = {correlations['Permutation_entropy']:.4f}")
    print(f"Lyapunov vs KS entropy (Pesin)    : r = {pearson_correlation(records, 'Lyapunov_exponent', 'KS_entropy_Pesin'):.4f}")

    print("\n=== Random noise comparison ===")
    print("noise model               : Gaussian white noise matched to each sampled chaos orbit")
    print(f"noise trials per orbit    : {noise_trials}")
    print(f"noise seed                : {noise_seed}")
    print(f"all noise permutation H   : {overall_noise_summary['Permutation_entropy']:.4f} ± {overall_noise_summary['Permutation_entropy_std']:.4f}")
    print(f"all noise - chaos delta H : {overall_separation['mean_delta']:.4f} ± {overall_separation['std_delta']:.4f}")
    print(f"noise > chaos share       : {overall_separation['positive_fraction']:.1%}")

    print("\n[matched to weak_chaos]")
    print(f"noise permutation entropy : {weak_noise_summary['Permutation_entropy']:.4f} ± {weak_noise_summary['Permutation_entropy_std']:.4f}")
    print(f"chaos permutation entropy : {weak_summary['Permutation_entropy']:.4f} ± {weak_summary['Permutation_entropy_std']:.4f}")
    print(f"noise - chaos delta       : {weak_separation['mean_delta']:.4f} ± {weak_separation['std_delta']:.4f}")
    print(f"delta > 0 share           : {weak_separation['positive_fraction']:.1%}")
    print(f"minimum delta             : {weak_separation['min_delta']:.4f}")

    print("\n[matched to strong_chaos]")
    print(f"noise permutation entropy : {strong_noise_summary['Permutation_entropy']:.4f} ± {strong_noise_summary['Permutation_entropy_std']:.4f}")
    print(f"chaos permutation entropy : {strong_summary['Permutation_entropy']:.4f} ± {strong_summary['Permutation_entropy_std']:.4f}")
    print(f"noise - chaos delta       : {strong_separation['mean_delta']:.4f} ± {strong_separation['std_delta']:.4f}")
    print(f"delta > 0 share           : {strong_separation['positive_fraction']:.1%}")
    print(f"minimum delta             : {strong_separation['min_delta']:.4f}")

    print("\n=== Coarse-graining dependence ===")
    print("tested bins               : " + ", ".join(str(bins) for bins in coarse_bins))
    print(f"coarse-graining seed      : {coarse_seed}")
    for row in coarse_summary_rows:
        print(
            f"bins = {row['bins']:>3d} | weak chaos {row['weak_chaos_mean']:.4f} | strong chaos {row['strong_chaos_mean']:.4f} "
            f"| noise|weak {row['weak_noise_mean']:.4f} | noise|strong {row['strong_noise_mean']:.4f}"
        )
    print(f"strong > weak across bins : {coarse_robustness['strong_gt_weak_all_bins']}")
    print(f"min weak-noise > chaos    : {coarse_robustness['weak_noise_gt_chaos_min_fraction']:.1%}")
    print(f"min strong-noise > chaos  : {coarse_robustness['strong_noise_gt_chaos_min_fraction']:.1%}")
    print(f"weak chaos relative range : {100 * coarse_robustness['weak_chaos_relative_range']:.1f}%")
    print(f"strong chaos rel. range   : {100 * coarse_robustness['strong_chaos_relative_range']:.1f}%")
    print(f"weak noise relative range : {100 * coarse_robustness['weak_noise_relative_range']:.1f}%")
    print(f"strong noise rel. range   : {100 * coarse_robustness['strong_noise_relative_range']:.1f}%")
    print(f"verdict                   : {coarse_robustness['verdict']}")

    print("\n=== Coarse-grained entropy production ===")
    print(
        f"phase-space partition     : {entropy_phase_bins} x {entropy_phase_bins} x {entropy_phase_bins} x {entropy_phase_bins} "
        f"({entropy_summary['total_cells']} cells)"
    )
    print(f"ensemble size             : {entropy_ensemble_size}")
    print(f"settle steps              : {discard}")
    print(f"sample interval           : every {entropy_sample_interval} steps")
    print(f"cloud widths              : angle {entropy_angle_spread:.1e}, omega {entropy_omega_spread:.1e}")
    print(f"entropy seed              : {entropy_seed}")

    for region_name in ["weak_chaos", "strong_chaos"]:
        result = entropy_results[region_name]
        record = result["record"]
        print(
            f"\n[{region_name}] representative (theta1/pi, theta2/pi) = "
            f"({record['theta1_0'] / pi:.3f}, {record['theta2_0'] / pi:.3f})"
        )
        print(f"lambda_1                 : {record['Lyapunov_exponent']:.4f}")
        print(f"h_KS (Pesin)             : {record['KS_entropy_Pesin']:.4f}")
        print(f"dS/dt fit                : {result['slope']:.4f}")
        print(f"fit window end           : t = {result['fit_time_end']:.2f}")
        print(f"entropy gain             : {result['entropy_gain']:.4f}")
        print(f"final occupied cells     : {int(result['occupied_cells'][-1])} / {entropy_summary['total_cells']}")

    print(f"\nstrong > weak slope       : {entropy_summary['strong_faster_than_weak']}")
    if np.isfinite(entropy_summary['slope_ratio_strong_to_weak']):
        print(f"strong / weak slope ratio : {entropy_summary['slope_ratio_strong_to_weak']:.2f}")
    else:
        print("strong / weak slope ratio : n/a")

    print("\n=== Information flow across representative orbits ===")
    print(f"representatives / region  : {flow_representative_count}")
    print(f"lag range                 : 0 .. {flow_max_lag_steps} steps (stride {flow_lag_stride})")
    print(f"trajectory length         : {flow_steps - flow_discard} samples after discard")
    print(f"MI bins / shuffles        : {flow_mi_bins} / {flow_mi_baseline_shuffles}")
    print(f"TE bins / shuffles        : {flow_te_bins} / {flow_te_baseline_shuffles}")
    print(f"flow seed                 : {flow_seed}")

    for region_name in ["weak_chaos", "strong_chaos"]:
        result = mi_results[region_name]
        mi_region = result["mi"]
        te_region = result["te"]
        print(
            f"\n[{region_name}] representatives (theta1/pi, theta2/pi) = "
            f"{format_representative_points(result['records'])}"
        )
        print(f"lambda_1 mean            : {result['lyapunov_mean']:.4f} ± {result['lyapunov_std']:.4f}")
        print(f"h_KS mean                : {result['ks_mean']:.4f} ± {result['ks_std']:.4f}")
        print(f"MI peak lag              : {mi_region['peak_time_mean']:.4f} ± {mi_region['peak_time_std']:.4f}")
        print(f"MI peak excess           : {mi_region['peak_excess_mi_mean']:.4f} ± {mi_region['peak_excess_mi_std']:.4f}")
        print(f"MI post-peak decay       : {mi_region['post_peak_decay_time_mean']:.4f} ± {mi_region['post_peak_decay_time_std']:.4f}")
        print(f"normalized MI area       : {mi_region['information_area_mean']:.4f} ± {mi_region['information_area_std']:.4f}")
        print(f"TE peak 1->2             : {te_region['peak_transfer_forward_mean']:.4f} at {te_region['peak_time_forward_mean']:.4f}")
        print(f"TE peak 2->1             : {te_region['peak_transfer_backward_mean']:.4f} at {te_region['peak_time_backward_mean']:.4f}")
        print(f"TE net directional area  : {te_region['net_directional_area_mean']:.4f} ± {te_region['net_directional_area_std']:.4f}")
        print(f"TE total area            : {te_region['total_transfer_area_mean']:.4f} ± {te_region['total_transfer_area_std']:.4f}")
        print(f"dominant direction       : {dominant_direction_label(te_region['net_directional_area_mean'])}")
        print(f"directionality strength  : {te_region['directionality_strength_mean']:.4f} ± {te_region['directionality_strength_std']:.4f}")

    print(f"\nstrong earlier MI peak    : {mi_summary['strong_earlier_peak']}")
    if np.isfinite(mi_summary['mi_peak_time_ratio_strong_to_weak']):
        print(f"peak ratio strong/weak    : {mi_summary['mi_peak_time_ratio_strong_to_weak']:.2f}")
    else:
        print("peak ratio strong/weak    : n/a")
    print(f"strong faster MI decay    : {mi_summary['strong_faster_decay']}")
    if np.isfinite(mi_summary['mi_decay_time_ratio_strong_to_weak']):
        print(f"decay ratio strong/weak   : {mi_summary['mi_decay_time_ratio_strong_to_weak']:.2f}")
    else:
        print("decay ratio strong/weak   : n/a")
    print(f"strong smaller MI area    : {mi_summary['strong_smaller_mi_area']}")
    if np.isfinite(mi_summary['mi_area_ratio_strong_to_weak']):
        print(f"MI area ratio strong/weak : {mi_summary['mi_area_ratio_strong_to_weak']:.2f}")
    else:
        print("MI area ratio strong/weak : n/a")
    print(f"weak dominant direction   : {mi_summary['weak_dominant_direction']}")
    print(f"strong dominant direction : {mi_summary['strong_dominant_direction']}")
    print(f"strong more directional   : {mi_summary['strong_more_directional']}")

    print("\n=== Shuffle surrogate test ===")
    print(f"representatives / region  : {surrogate_summary['representative_count']}")
    print(f"surrogates / orbit        : {surrogate_summary['surrogate_trials']}")
    print(f"lag range                 : 0 .. {surrogate_summary['max_lag_steps']} steps (stride {surrogate_summary['lag_stride']})")
    print(f"MI bins                   : {surrogate_summary['mi_bins']}")
    print(f"TE bins                   : {surrogate_summary['te_bins']}")
    print(f"surrogate seed            : {surrogate_summary['seed']}")

    for region_name in ["weak_chaos", "strong_chaos"]:
        result = surrogate_results[region_name]
        print(
            f"\n[{region_name}] representatives (theta1/pi, theta2/pi) = "
            f"{format_representative_points(result['records'])}"
        )
        print(f"MI peak actual / surrogate: {result['mi_peak']['actual_mean']:.4f} / {result['mi_peak']['surrogate_mean']:.4f}")
        print(f"MI excess-area actual/surrogate: {result['mi_excess_area']['actual_mean']:.4f} / {result['mi_excess_area']['surrogate_mean']:.4f}")
        print(f"MI peak > trial q95 share : {result['mi_peak']['actual_gt_trial_q95_fraction']:.1%}")
        print(f"MI mean empirical p       : {result['mi_peak']['empirical_p_mean']:.4f}")
        print(f"MI lag share > q95        : {result['mi_curve']['actual_above_q95_fraction']:.1%}")
        print(f"TE excess-area actual/surrogate: {result['te_excess_area']['actual_mean']:.4f} / {result['te_excess_area']['surrogate_mean']:.4f}")
        print(f"|ΔTE| actual / surrogate  : {result['te_directionality_strength']['actual_mean']:.4f} / {result['te_directionality_strength']['surrogate_mean']:.4f}")
        print(f"TE area > trial q95 share : {result['te_excess_area']['actual_gt_trial_q95_fraction']:.1%}")
        print(f"TE mean empirical p       : {result['te_excess_area']['empirical_p_mean']:.4f}")
        print(f"TE lag share > q95        : {result['te_total_curve']['actual_above_q95_fraction']:.1%}")

    print(f"\nstrong MI more significant: {surrogate_summary['strong_mi_more_significant']}")
    print(f"strong TE more significant: {surrogate_summary['strong_te_more_significant']}")

    print(f"\nSaved figure: {figure_path}")
    print(f"Saved scatter: {scatter_figure_path}")
    print(f"Saved KS plot: {ks_figure_path}")
    print(f"Saved noise plot: {noise_figure_path}")
    print(f"Saved coarse plot: {coarse_figure_path}")
    print(f"Saved entropy plot: {entropy_figure_path}")
    print(f"Saved information-flow plot: {information_flow_figure_path}")
    print(f"Saved surrogate plot: {surrogate_test_figure_path}")
    print(f"Saved table : {csv_path}")
    print(f"Saved noise table: {noise_csv_path}")
    print(f"Saved coarse table: {coarse_csv_path}")
    print(f"Saved entropy table: {entropy_csv_path}")
    print(f"Saved information-flow table: {information_flow_csv_path}")
    print(f"Saved surrogate table: {surrogate_test_csv_path}")