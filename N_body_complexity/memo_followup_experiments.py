from pathlib import Path

import matplotlib
import numpy as np
import pandas as pd

matplotlib.use("Agg")
import matplotlib.pyplot as plt

import numerical_exp as ne


BASE_DIR = Path(__file__).resolve().parent
OUTDIR = BASE_DIR / "memo_followup_outputs"
OUTDIR.mkdir(parents=True, exist_ok=True)

CLASS_ORDER = ["weak_chaos", "intermediate", "strong_chaos"]
CLASS_COLORS = {
    "weak_chaos": "#3c7dc4",
    "intermediate": "#8a8f99",
    "strong_chaos": "#d05f3f",
}


def to_numpy(x):
    return ne.to_numpy(x) if hasattr(ne, "to_numpy") else np.asarray(x)


def finite_mean_std(values, axis=0):
    values = np.asarray(values, dtype=float)
    valid = np.isfinite(values)
    counts = np.sum(valid, axis=axis)
    sums = np.nansum(values, axis=axis)
    mean = np.divide(sums, counts, out=np.full_like(sums, np.nan, dtype=float), where=counts > 0)
    centered = np.where(valid, values - np.expand_dims(mean, axis=axis), 0.0)
    var = np.divide(
        np.sum(centered ** 2, axis=axis),
        counts,
        out=np.full_like(sums, np.nan, dtype=float),
        where=counts > 0,
    )
    return mean, np.sqrt(var)


def classify_diffusion(alpha, tolerance=0.1):
    if not np.isfinite(alpha):
        return "undetermined"
    if alpha < 1.0 - tolerance:
        return "subdiffusion"
    if alpha > 1.0 + tolerance:
        return "superdiffusion"
    return "normal diffusion"


def compute_scrambling_times(otoc_distance, threshold, time_axis):
    curves = np.asarray(to_numpy(otoc_distance), dtype=float)
    time_axis = np.asarray(time_axis, dtype=float)
    n_runs, n_distance_bins, _ = curves.shape
    scrambling = np.full((n_runs, n_distance_bins), np.nan, dtype=float)

    for run_index in range(n_runs):
        for distance_index in range(n_distance_bins):
            hit = np.where(curves[run_index, distance_index] >= threshold)[0]
            if len(hit) > 0:
                scrambling[run_index, distance_index] = time_axis[hit[0]]

    return scrambling


def fit_front_velocity(distance_centers, mean_times):
    distance_centers = np.asarray(distance_centers, dtype=float)
    mean_times = np.asarray(mean_times, dtype=float)
    mask = np.isfinite(distance_centers) & np.isfinite(mean_times)
    if np.count_nonzero(mask) < 2:
        return {"slope": np.nan, "intercept": np.nan, "v_b": np.nan}

    slope, intercept = np.polyfit(distance_centers[mask], mean_times[mask], 1)
    v_b = 1.0 / slope if slope > 1e-12 else np.nan
    return {"slope": float(slope), "intercept": float(intercept), "v_b": float(v_b) if np.isfinite(v_b) else np.nan}


def plot_butterfly_front_by_class(classes, otoc_distance, distance_centers, time_axis, threshold=1e3):
    classes = np.asarray(classes)
    scrambling = compute_scrambling_times(otoc_distance, threshold=threshold, time_axis=time_axis)
    distance_centers = np.asarray(distance_centers, dtype=float)
    summary_rows = []

    fig, ax = plt.subplots(figsize=(7.4, 5.2), constrained_layout=True)
    for class_name in ["weak_chaos", "strong_chaos"]:
        mask = classes == class_name
        if not np.any(mask):
            continue

        mean_times, std_times = finite_mean_std(scrambling[mask], axis=0)
        fit = fit_front_velocity(distance_centers, mean_times)
        label = class_name
        if np.isfinite(fit["v_b"]):
            label = f"{class_name} (v_B≈{fit['v_b']:.2f})"
        ax.errorbar(
            distance_centers,
            mean_times,
            yerr=std_times,
            marker="o",
            linewidth=1.8,
            capsize=4,
            color=CLASS_COLORS[class_name],
            label=label,
        )
        if np.isfinite(fit["slope"]):
            ax.plot(
                distance_centers,
                fit["intercept"] + fit["slope"] * distance_centers,
                linestyle="--",
                linewidth=1.2,
                color=CLASS_COLORS[class_name],
                alpha=0.7,
            )

        summary_rows.append(
            {
                "experiment": "butterfly_front",
                "class": class_name,
                "threshold": float(threshold),
                "mean_scrambling_time": float(np.nanmean(scrambling[mask])),
                "std_scrambling_time": float(np.nanstd(scrambling[mask])),
                "front_slope": fit["slope"],
                "butterfly_velocity": fit["v_b"],
            }
        )

    ax.set_xlabel("distance r")
    ax.set_ylabel(r"$t_*(r)$")
    ax.set_title("Weak vs strong butterfly front")
    ax.grid(alpha=0.28)
    ax.legend(frameon=False)
    fig.savefig(OUTDIR / "butterfly_front_by_class.png", dpi=180)
    plt.close(fig)
    return scrambling, summary_rows


def compute_msd_curves(trajectories):
    trajectories = ne.to_torch(trajectories)
    n_runs, steps = trajectories.shape[:2]
    msd_curves = np.empty((n_runs, steps), dtype=float)

    for run_index in range(n_runs):
        positions = trajectories[run_index, :, 1:, :2].reshape(steps, -1)
        displacement_sq = np.mean(to_numpy((positions - positions[0]) ** 2), axis=1)
        msd_curves[run_index] = displacement_sq

    return msd_curves


def fit_loglog_alpha(times, msd_curve, start_fraction=0.15, end_fraction=0.8):
    times = np.asarray(times, dtype=float)
    msd_curve = np.asarray(msd_curve, dtype=float)
    start_index = int(len(times) * start_fraction)
    end_index = int(len(times) * end_fraction)
    end_index = max(end_index, start_index + 5)

    window_times = times[start_index:end_index]
    window_values = msd_curve[start_index:end_index]
    mask = (window_times > 0.0) & np.isfinite(window_values) & (window_values > 0.0)
    if np.count_nonzero(mask) < 5:
        return np.nan

    slope, _ = np.polyfit(np.log(window_times[mask]), np.log(window_values[mask]), 1)
    return float(slope)


def quantile_bin_curve(x, y, bin_count=6):
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    mask = np.isfinite(x) & np.isfinite(y)
    if np.count_nonzero(mask) < 3:
        return np.array([]), np.array([]), np.array([])

    x = x[mask]
    y = y[mask]
    edges = np.quantile(x, np.linspace(0.0, 1.0, bin_count + 1))
    edges = np.unique(edges)
    if len(edges) < 3:
        edges = np.linspace(np.min(x), np.max(x) + 1e-12, min(bin_count, len(x)) + 1)

    centers = []
    means = []
    stds = []
    for bin_index in range(len(edges) - 1):
        low = edges[bin_index]
        high = edges[bin_index + 1]
        in_bin = (x >= low) & (x < high)
        if bin_index == len(edges) - 2:
            in_bin = (x >= low) & (x <= high)
        if np.count_nonzero(in_bin) == 0:
            continue
        centers.append(float(np.mean(x[in_bin])))
        means.append(float(np.mean(y[in_bin])))
        stds.append(float(np.std(y[in_bin])))
    return np.asarray(centers), np.asarray(means), np.asarray(stds)


def contiguous_true_segments(mask):
    segments = []
    start = None
    for index, value in enumerate(np.asarray(mask, dtype=bool)):
        if value and start is None:
            start = index
        elif not value and start is not None:
            segments.append((start, index - 1))
            start = None
    if start is not None:
        segments.append((start, len(mask) - 1))
    return segments


def summarize_burst_segments(series, threshold, sample_dt):
    series = np.asarray(series, dtype=float)
    valid_mask = np.isfinite(series)
    burst_mask = valid_mask & (series > threshold)
    segments = contiguous_true_segments(burst_mask)
    durations = np.asarray([(end - start + 1) * sample_dt for start, end in segments], dtype=float)
    waiting_times = np.asarray(
        [(segments[idx + 1][0] - segments[idx][1] - 1) * sample_dt for idx in range(len(segments) - 1)],
        dtype=float,
    )
    peaks = np.asarray([np.nanmax(series[start:end + 1]) for start, end in segments], dtype=float)
    centers = np.asarray([(start + end) // 2 for start, end in segments], dtype=int)
    return {
        "burst_count": int(len(segments)),
        "mean_duration": float(np.nanmean(durations)) if len(durations) else np.nan,
        "mean_waiting_time": float(np.nanmean(waiting_times)) if len(waiting_times) else np.nan,
        "mean_peak": float(np.nanmean(peaks)) if len(peaks) else np.nan,
        "burst_fraction": float(np.mean(burst_mask[valid_mask])) if np.any(valid_mask) else np.nan,
        "centers": centers,
    }


def nan_corrcoef(x, y):
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    mask = np.isfinite(x) & np.isfinite(y)
    if np.count_nonzero(mask) < 3:
        return np.nan
    x_valid = x[mask]
    y_valid = y[mask]
    if np.std(x_valid) < 1e-12 or np.std(y_valid) < 1e-12:
        return np.nan
    return float(np.corrcoef(x_valid, y_valid)[0, 1])


def plot_class_metric_summary(metrics_df, specs, filename, title):
    fig, axes = plt.subplots(1, len(specs), figsize=(4.7 * len(specs), 4.4), constrained_layout=True)
    if len(specs) == 1:
        axes = [axes]

    for ax, (column, ylabel) in zip(axes, specs):
        for class_index, class_name in enumerate(CLASS_ORDER):
            class_values = metrics_df.loc[metrics_df["chaos_region"] == class_name, column].to_numpy(dtype=float)
            finite_values = class_values[np.isfinite(class_values)]
            if len(finite_values) == 0:
                continue
            jitter = np.linspace(-0.08, 0.08, len(finite_values)) if len(finite_values) > 1 else np.array([0.0])
            ax.scatter(
                np.full(len(finite_values), class_index, dtype=float) + jitter,
                finite_values,
                s=28,
                alpha=0.78,
                color=CLASS_COLORS[class_name],
            )
            ax.errorbar(
                class_index,
                np.nanmean(finite_values),
                yerr=np.nanstd(finite_values),
                fmt="_",
                markersize=18,
                capsize=5,
                color="#222222",
                linewidth=1.3,
            )
        ax.set_xticks(range(len(CLASS_ORDER)), CLASS_ORDER, rotation=20)
        ax.set_ylabel(ylabel)
        ax.grid(alpha=0.25)

    fig.suptitle(title)
    fig.savefig(OUTDIR / filename, dpi=180)
    plt.close(fig)


def summarize_by_class(metrics_df, experiment, metric_columns):
    summary_rows = []
    for class_name in CLASS_ORDER:
        class_df = metrics_df.loc[metrics_df["chaos_region"] == class_name]
        if class_df.empty:
            continue
        row = {"experiment": experiment, "class": class_name}
        for column in metric_columns:
            values = class_df[column].to_numpy(dtype=float)
            row[f"{column}_mean"] = float(np.nanmean(values)) if np.any(np.isfinite(values)) else np.nan
            row[f"{column}_std"] = float(np.nanstd(values)) if np.any(np.isfinite(values)) else np.nan
        summary_rows.append(row)
    return summary_rows


def plot_diffusion_followup(trajectories, classes, lambda1, sample_dt):
    classes = np.asarray(classes)
    lambda1 = np.asarray(to_numpy(lambda1), dtype=float)
    msd_curves = compute_msd_curves(trajectories)
    times = np.arange(msd_curves.shape[1], dtype=float) * float(sample_dt)
    alpha_values = np.asarray([fit_loglog_alpha(times, curve) for curve in msd_curves], dtype=float)

    fig, axes = plt.subplots(1, 2, figsize=(13.2, 4.8), constrained_layout=True)
    for class_name in CLASS_ORDER:
        mask = classes == class_name
        if not np.any(mask):
            continue
        mean_curve, std_curve = finite_mean_std(msd_curves[mask], axis=0)
        axes[0].loglog(times[1:], mean_curve[1:], color=CLASS_COLORS[class_name], linewidth=2.0, label=class_name)
        axes[0].fill_between(
            times[1:],
            np.maximum(mean_curve[1:] - std_curve[1:], 1e-12),
            np.maximum(mean_curve[1:] + std_curve[1:], 1e-12),
            color=CLASS_COLORS[class_name],
            alpha=0.16,
        )

        axes[1].scatter(lambda1[mask], alpha_values[mask], s=44, alpha=0.82, color=CLASS_COLORS[class_name], label=class_name)

    centers, means, stds = quantile_bin_curve(lambda1, alpha_values, bin_count=6)
    if len(centers) > 0:
        axes[1].plot(centers, means, color="#222222", linewidth=1.6, marker="o", label="binned mean")
        axes[1].fill_between(centers, means - stds, means + stds, color="#222222", alpha=0.12)

    axes[0].set_xlabel("time")
    axes[0].set_ylabel("MSD")
    axes[0].set_title(r"MSD log-log and anomalous diffusion exponent $\alpha$")
    axes[0].grid(alpha=0.28)
    axes[0].legend(frameon=False, fontsize=8)

    axes[1].axhline(1.0, linestyle="--", color="#666666", linewidth=1.0)
    axes[1].set_xlabel(r"$\lambda_1$")
    axes[1].set_ylabel(r"$\alpha$ from MSD $\sim t^\alpha$")
    axes[1].set_title("Diffusion exponent vs Lyapunov")
    axes[1].grid(alpha=0.28)
    axes[1].legend(frameon=False, fontsize=8)
    fig.savefig(OUTDIR / "diffusion_msd_alpha_followup.png", dpi=180)
    plt.close(fig)

    summary_rows = []
    for class_name in CLASS_ORDER:
        mask = classes == class_name
        if not np.any(mask):
            continue
        class_alphas = alpha_values[mask]
        summary_rows.append(
            {
                "experiment": "diffusion_alpha",
                "class": class_name,
                "alpha_mean": float(np.nanmean(class_alphas)),
                "alpha_std": float(np.nanstd(class_alphas)),
                "alpha_regime_majority": max(
                    [classify_diffusion(value) for value in class_alphas if np.isfinite(value)] or ["undetermined"],
                    key=([classify_diffusion(value) for value in class_alphas if np.isfinite(value)] or ["undetermined"]).count,
                ),
            }
        )
    return msd_curves, alpha_values, summary_rows


def analyze_lambda_bursts(finite_lambda, classes, sample_dt, threshold_quantile=0.9):
    classes = np.asarray(classes)
    finite_lambda = np.asarray(to_numpy(finite_lambda), dtype=float)
    threshold = float(np.nanquantile(finite_lambda[np.isfinite(finite_lambda)], threshold_quantile))

    rows = []
    for run_index in range(finite_lambda.shape[0]):
        stats = summarize_burst_segments(finite_lambda[run_index], threshold=threshold, sample_dt=sample_dt)
        rows.append(
            {
                "run_index": run_index,
                "chaos_region": classes[run_index],
                "lambda_burst_count": stats["burst_count"],
                "lambda_burst_duration": stats["mean_duration"],
                "lambda_burst_waiting_time": stats["mean_waiting_time"],
                "lambda_burst_peak": stats["mean_peak"],
                "lambda_burst_fraction": stats["burst_fraction"],
            }
        )

    metrics_df = pd.DataFrame(rows)
    plot_class_metric_summary(
        metrics_df,
        [
            ("lambda_burst_count", "burst count"),
            ("lambda_burst_duration", "mean duration"),
            ("lambda_burst_waiting_time", "mean waiting time"),
        ],
        filename="lambda_burst_followup.png",
        title=rf"Finite-time $\lambda$ bursts above q={threshold_quantile}",
    )

    summary_rows = summarize_by_class(
        metrics_df,
        experiment="lambda_burst",
        metric_columns=[
            "lambda_burst_count",
            "lambda_burst_duration",
            "lambda_burst_waiting_time",
            "lambda_burst_peak",
            "lambda_burst_fraction",
        ],
    )
    for row in summary_rows:
        row["threshold_quantile"] = float(threshold_quantile)
        row["threshold_value"] = threshold
    return metrics_df, summary_rows


def compute_min_pair_distance_series(trajectory):
    positions = np.asarray(to_numpy(ne.to_torch(trajectory)[..., :2]), dtype=float)
    steps, body_count = positions.shape[:2]
    min_dist = np.full(steps, np.nan, dtype=float)
    for step_index in range(steps):
        delta = positions[step_index, :, None, :] - positions[step_index, None, :, :]
        distances = np.linalg.norm(delta, axis=-1)
        np.fill_diagonal(distances, np.nan)
        min_dist[step_index] = np.nanmin(distances)
    return min_dist


def analyze_entropy_bursts(trajectories, classes, sample_dt, bins=32, threshold_quantile=0.9):
    classes = np.asarray(classes)
    trajectories = ne.to_torch(trajectories)
    n_runs, steps = trajectories.shape[:2]
    entropy_series = []
    distance_series = []

    for run_index in range(n_runs):
        state = trajectories[run_index, :, 1:, :].reshape(steps, -1)
        labels = ne.coarse_labels(state, bins=bins)
        entropies = []
        for t_index in range(5, steps):
            entropies.append(ne.shannon_entropy_from_labels(labels[:t_index]).item())
        entropies = np.asarray(entropies, dtype=float)
        entropy_series.append(np.diff(entropies))
        distance_series.append(compute_min_pair_distance_series(trajectories[run_index])[6:])

    positive_values = np.concatenate([series[np.isfinite(series) & (series > 0.0)] for series in entropy_series])
    threshold = float(np.nanquantile(positive_values, threshold_quantile))

    rows = []
    for run_index, d_entropy in enumerate(entropy_series):
        stats = summarize_burst_segments(d_entropy, threshold=threshold, sample_dt=sample_dt)
        aligned_distances = np.asarray(distance_series[run_index], dtype=float)
        burst_distances = aligned_distances[stats["centers"]] if len(stats["centers"]) else np.array([], dtype=float)
        rows.append(
            {
                "run_index": run_index,
                "chaos_region": classes[run_index],
                "entropy_burst_count": stats["burst_count"],
                "entropy_burst_duration": stats["mean_duration"],
                "entropy_burst_waiting_time": stats["mean_waiting_time"],
                "entropy_burst_peak": stats["mean_peak"],
                "entropy_burst_fraction": stats["burst_fraction"],
                "entropy_burst_distance": float(np.nanmean(burst_distances)) if len(burst_distances) else np.nan,
                "baseline_distance": float(np.nanmean(aligned_distances)) if np.any(np.isfinite(aligned_distances)) else np.nan,
                "inverse_distance_corr": nan_corrcoef(np.maximum(d_entropy, 0.0), 1.0 / np.maximum(aligned_distances, 1e-6)),
            }
        )

    metrics_df = pd.DataFrame(rows)
    plot_class_metric_summary(
        metrics_df,
        [
            ("entropy_burst_count", "burst count"),
            ("entropy_burst_waiting_time", "mean waiting time"),
            ("entropy_burst_distance", "distance at burst"),
        ],
        filename="entropy_burst_followup.png",
        title=rf"Entropy bursts above positive q={threshold_quantile}",
    )

    summary_rows = summarize_by_class(
        metrics_df,
        experiment="entropy_burst",
        metric_columns=[
            "entropy_burst_count",
            "entropy_burst_duration",
            "entropy_burst_waiting_time",
            "entropy_burst_peak",
            "entropy_burst_fraction",
            "entropy_burst_distance",
            "baseline_distance",
            "inverse_distance_corr",
        ],
    )
    for row in summary_rows:
        row["threshold_quantile"] = float(threshold_quantile)
        row["threshold_value"] = threshold
    return metrics_df, summary_rows


def compute_edge_metrics(trajectories):
    trajectories = ne.to_torch(trajectories)
    n_runs, steps = trajectories.shape[:2]
    predictive_peak = np.full(n_runs, np.nan, dtype=float)
    statistical_complexity = np.full(n_runs, np.nan, dtype=float)
    te_total = np.full(n_runs, np.nan, dtype=float)

    for run_index in range(n_runs):
        outer_radius = np.linalg.norm(to_numpy(trajectories[run_index, :, 2, :2]), axis=1)
        predictive_values = []
        for past_window in [2, 4, 8, 16]:
            value = ne.predictive_information(outer_radius, past=past_window, future=8, bins=8)
            predictive_values.append(float(value.detach().cpu()))
        predictive_peak[run_index] = float(np.nanmax(predictive_values))

        state = trajectories[run_index, :, 1:, :].reshape(steps, -1)
        labels = ne.coarse_labels(state, bins=16).detach().cpu().numpy()
        statistical_complexity[run_index] = float(ne.statistical_complexity_markov(labels))

        radii = np.linalg.norm(to_numpy(trajectories[run_index, :, :, :2]), axis=-1)
        te_forward = ne.transfer_entropy_discrete(radii[:, 1], radii[:, 2], bins=8)
        te_backward = ne.transfer_entropy_discrete(radii[:, 2], radii[:, 1], bins=8)
        te_total[run_index] = float((te_forward + te_backward).detach().cpu())

    return {
        "predictive_information_peak": predictive_peak,
        "statistical_complexity": statistical_complexity,
        "te_total_score": te_total,
    }


def plot_metric_vs_lambda(ax, lambda1, metric, classes, ylabel):
    lambda1 = np.asarray(lambda1, dtype=float)
    metric = np.asarray(metric, dtype=float)
    for class_name in CLASS_ORDER:
        mask = classes == class_name
        if not np.any(mask):
            continue
        ax.scatter(lambda1[mask], metric[mask], s=42, alpha=0.8, color=CLASS_COLORS[class_name], label=class_name)

    centers, means, stds = quantile_bin_curve(lambda1, metric, bin_count=6)
    if len(centers) > 0:
        ax.plot(centers, means, color="#222222", linewidth=1.7, marker="o", label="binned mean")
        ax.fill_between(centers, means - stds, means + stds, color="#222222", alpha=0.12)
    ax.set_xlabel(r"$\lambda_1$")
    ax.set_ylabel(ylabel)
    ax.grid(alpha=0.28)
    return centers, means


def plot_edge_of_chaos_followup(lambda1, classes, edge_metrics):
    classes = np.asarray(classes)
    lambda1 = np.asarray(to_numpy(lambda1), dtype=float)
    metric_specs = [
        ("predictive_information_peak", r"peak predictive info $I(past;future)$"),
        ("statistical_complexity", r"statistical complexity $C_\mu$"),
        ("te_total_score", "total TE score"),
    ]

    fig, axes = plt.subplots(1, 3, figsize=(15.2, 4.8), constrained_layout=True)
    summary_rows = []
    for ax, (metric_key, ylabel) in zip(axes, metric_specs):
        centers, means = plot_metric_vs_lambda(ax, lambda1, edge_metrics[metric_key], classes, ylabel)
        ax.set_title(metric_key.replace("_", " "))
        if len(centers) > 0 and np.any(np.isfinite(means)):
            peak_index = int(np.nanargmax(means))
            summary_rows.append(
                {
                    "experiment": "edge_of_chaos",
                    "metric": metric_key,
                    "peak_lambda_bin_center": float(centers[peak_index]),
                    "peak_metric_mean": float(means[peak_index]),
                }
            )

    axes[0].legend(frameon=False, fontsize=8)
    fig.savefig(OUTDIR / "edge_of_chaos_followup.png", dpi=180)
    plt.close(fig)
    return summary_rows


def save_summary(metrics_table, summary_rows):
    metrics_table.to_csv(OUTDIR / "memo_followup_metrics.csv", index=False)
    summary_df = pd.DataFrame(summary_rows)
    summary_df.to_csv(OUTDIR / "memo_followup_summary.csv", index=False)

    lines = [
        "Memo follow-up experiments",
        "- butterfly front: weak/strong separated scrambling front",
        "- diffusion coefficient follow-up: MSD log-log and anomalous exponent alpha",
        "- edge-of-chaos follow-up: predictive information / statistical complexity / TE vs lambda",
        "- burst follow-up: finite-time Lyapunov bursts and entropy-production bursts",
        "",
    ]
    for row in summary_rows:
        if row.get("experiment") == "butterfly_front":
            lines.append(
                f"butterfly_front {row['class']}: mean_t*={row['mean_scrambling_time']:.4f}, "
                f"slope={row['front_slope']:.4f}, v_B={row['butterfly_velocity']:.4f}"
            )
        elif row.get("experiment") == "diffusion_alpha":
            lines.append(
                f"diffusion_alpha {row['class']}: alpha={row['alpha_mean']:.4f} +/- {row['alpha_std']:.4f}, "
                f"majority={row['alpha_regime_majority']}"
            )
        elif row.get("experiment") == "edge_of_chaos":
            lines.append(
                f"edge_of_chaos {row['metric']}: peak near lambda={row['peak_lambda_bin_center']:.4f}, "
                f"mean={row['peak_metric_mean']:.4f}"
            )
        elif row.get("experiment") == "lambda_burst":
            lines.append(
                f"lambda_burst {row['class']}: count={row['lambda_burst_count_mean']:.4f}, "
                f"duration={row['lambda_burst_duration_mean']:.4f}, "
                f"waiting={row['lambda_burst_waiting_time_mean']:.4f}, "
                f"peak={row['lambda_burst_peak_mean']:.4f}, fraction={row['lambda_burst_fraction_mean']:.4f}"
            )
        elif row.get("experiment") == "entropy_burst":
            lines.append(
                f"entropy_burst {row['class']}: count={row['entropy_burst_count_mean']:.4f}, "
                f"waiting={row['entropy_burst_waiting_time_mean']:.4f}, "
                f"burst_distance={row['entropy_burst_distance_mean']:.4f}, "
                f"baseline_distance={row['baseline_distance_mean']:.4f}, "
                f"corr(inv_r,dS)={row['inverse_distance_corr_mean']:.4f}"
            )

    (OUTDIR / "memo_followup_summary.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    data = ne.load_data()
    classes = np.asarray(data["classes"])
    lambda1 = np.asarray(to_numpy(data["lambda1"]), dtype=float)
    trajectories = data["trajectories"]

    summary_rows = []
    _, front_rows = plot_butterfly_front_by_class(
        classes,
        data["otoc_distance"],
        data["distance_centers"],
        data["otoc_times"],
        threshold=1e3,
    )
    summary_rows.extend(front_rows)

    _, alpha_values, diffusion_rows = plot_diffusion_followup(
        trajectories,
        classes,
        lambda1,
        sample_dt=data["sample_dt"],
    )
    summary_rows.extend(diffusion_rows)

    lambda_burst_metrics, lambda_burst_rows = analyze_lambda_bursts(
        data["finite_lambda"],
        classes,
        sample_dt=data["sample_dt"],
        threshold_quantile=0.9,
    )
    summary_rows.extend(lambda_burst_rows)

    entropy_burst_metrics, entropy_burst_rows = analyze_entropy_bursts(
        trajectories,
        classes,
        sample_dt=data["sample_dt"],
        bins=32,
        threshold_quantile=0.9,
    )
    summary_rows.extend(entropy_burst_rows)

    edge_metrics = compute_edge_metrics(trajectories)
    summary_rows.extend(plot_edge_of_chaos_followup(lambda1, classes, edge_metrics))

    metrics_table = pd.DataFrame(
        {
            "run_index": np.arange(len(classes), dtype=int),
            "chaos_region": classes,
            "Lyapunov_exponent": lambda1,
            "diffusion_alpha": alpha_values,
            "predictive_information_peak": edge_metrics["predictive_information_peak"],
            "statistical_complexity": edge_metrics["statistical_complexity"],
            "te_total_score": edge_metrics["te_total_score"],
        }
    )
    metrics_table = metrics_table.merge(lambda_burst_metrics, on=["run_index", "chaos_region"], how="left")
    metrics_table = metrics_table.merge(entropy_burst_metrics, on=["run_index", "chaos_region"], how="left")
    save_summary(metrics_table, summary_rows)
    print(f"Saved follow-up outputs to: {OUTDIR}")


if __name__ == "__main__":
    main()