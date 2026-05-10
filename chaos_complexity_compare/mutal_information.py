from math import pi

import numpy as np


def digitize_series(values, bins, low=-pi, high=pi):
    values = np.asarray(values, dtype=float)
    clipped = np.clip(values, low, high)
    scaled = (clipped - low) / (high - low + 1e-12)
    codes = np.floor(scaled * bins).astype(np.int64)
    return np.clip(codes, 0, bins - 1)


def mutual_information_from_codes(x_codes, y_codes, x_bins, y_bins):
    joint = np.bincount(
        x_codes * y_bins + y_codes,
        minlength=x_bins * y_bins,
    ).reshape(x_bins, y_bins)
    total = np.sum(joint)
    if total <= 0:
        return 0.0

    probs = joint / total
    px = np.sum(probs, axis=1, keepdims=True)
    py = np.sum(probs, axis=0, keepdims=True)
    joint_mask = probs > 0.0
    return float(np.sum(probs[joint_mask] * np.log(probs[joint_mask] / ((px @ py)[joint_mask] + 1e-30))))


def conditional_mutual_information_from_codes(x_codes, y_codes, z_codes, x_bins, y_bins, z_bins):
    joint = np.bincount(
        (x_codes * y_bins + y_codes) * z_bins + z_codes,
        minlength=x_bins * y_bins * z_bins,
    ).reshape(x_bins, y_bins, z_bins)
    total = np.sum(joint)
    if total <= 0:
        return 0.0

    probs_xyz = joint / total
    probs_xz = np.sum(probs_xyz, axis=1)
    probs_yz = np.sum(probs_xyz, axis=0)
    probs_z = np.sum(probs_xz, axis=0)

    probs_xz = probs_xz[:, None, :]
    probs_yz = probs_yz[None, :, :]
    probs_z = probs_z[None, None, :]
    mask = probs_xyz > 0.0

    numerator = probs_xyz * probs_z
    denominator = probs_xz * probs_yz + 1e-30
    return float(np.sum(probs_xyz[mask] * np.log(numerator[mask] / denominator[mask] + 1e-30)))


def first_decay_time_after_peak(lags, values, threshold_fraction=np.exp(-1.0)):
    lags = np.asarray(lags, dtype=float)
    values = np.asarray(values, dtype=float)

    if len(values) == 0:
        return np.nan, np.nan, np.nan

    peak_index = int(np.argmax(values))
    peak_value = float(values[peak_index])
    peak_time = float(lags[peak_index])
    if peak_value <= 1e-12:
        return peak_time, peak_value, np.nan

    threshold = peak_value * threshold_fraction
    trailing = np.where(values[peak_index:] <= threshold)[0]
    if len(trailing) == 0:
        return peak_time, peak_value, np.nan

    decay_time = float(lags[peak_index + trailing[0]] - peak_time)
    return peak_time, peak_value, decay_time


def _shuffle_baseline(metric_fn, baseline_shuffles, rng):
    if baseline_shuffles <= 0:
        return 0.0

    return float(np.mean([metric_fn(rng) for _ in range(baseline_shuffles)]))


def lagged_mutual_information_curve(
    x,
    y,
    dt,
    max_lag_steps=600,
    lag_stride=5,
    bins=32,
    baseline_shuffles=8,
    rng=None,
):
    if rng is None:
        rng = np.random.default_rng()

    lags = np.arange(0, max_lag_steps + 1, lag_stride, dtype=int)
    x_codes = digitize_series(x, bins=bins)
    y_codes = digitize_series(y, bins=bins)
    mi_forward = []
    mi_backward = []
    baseline_forward = []
    baseline_backward = []

    for lag in lags:
        if lag == 0:
            x_aligned = x_codes
            y_forward = y_codes
            y_aligned = y_codes
            x_forward = x_codes
        else:
            x_aligned = x_codes[:-lag]
            y_forward = y_codes[lag:]
            y_aligned = y_codes[:-lag]
            x_forward = x_codes[lag:]

        mi_forward.append(mutual_information_from_codes(x_aligned, y_forward, bins, bins))
        mi_backward.append(mutual_information_from_codes(y_aligned, x_forward, bins, bins))
        baseline_forward.append(
            _shuffle_baseline(
                lambda local_rng: mutual_information_from_codes(
                    x_aligned,
                    local_rng.permutation(y_forward),
                    bins,
                    bins,
                ),
                baseline_shuffles=baseline_shuffles,
                rng=rng,
            )
        )
        baseline_backward.append(
            _shuffle_baseline(
                lambda local_rng: mutual_information_from_codes(
                    y_aligned,
                    local_rng.permutation(x_forward),
                    bins,
                    bins,
                ),
                baseline_shuffles=baseline_shuffles,
                rng=rng,
            )
        )

    lags_time = lags * dt
    mi_forward = np.asarray(mi_forward, dtype=float)
    mi_backward = np.asarray(mi_backward, dtype=float)
    baseline_forward = np.asarray(baseline_forward, dtype=float)
    baseline_backward = np.asarray(baseline_backward, dtype=float)
    mi_mean = 0.5 * (mi_forward + mi_backward)
    excess_forward = np.maximum(mi_forward - baseline_forward, 0.0)
    excess_backward = np.maximum(mi_backward - baseline_backward, 0.0)
    excess_mean = 0.5 * (excess_forward + excess_backward)
    normalized_forward = excess_forward / max(np.max(excess_forward), 1e-12)
    normalized_backward = excess_backward / max(np.max(excess_backward), 1e-12)
    normalized_mean = excess_mean / max(np.max(excess_mean), 1e-12)
    peak_time, peak_mi, post_peak_decay = first_decay_time_after_peak(lags_time, excess_mean)

    return {
        "lag_steps": lags,
        "lag_times": lags_time,
        "mi_forward": mi_forward,
        "mi_backward": mi_backward,
        "baseline_forward": baseline_forward,
        "baseline_backward": baseline_backward,
        "mi_mean": mi_mean,
        "excess_forward": excess_forward,
        "excess_backward": excess_backward,
        "excess_mean": excess_mean,
        "normalized_forward": normalized_forward,
        "normalized_backward": normalized_backward,
        "normalized_mean": normalized_mean,
        "initial_mi": float(mi_mean[0]),
        "initial_excess_mi": float(excess_mean[0]),
        "peak_time": peak_time,
        "peak_excess_mi": peak_mi,
        "post_peak_decay_time": post_peak_decay,
        "information_area": float(np.trapezoid(normalized_mean, lags_time)),
        "direction_asymmetry": float(np.mean(np.abs(mi_forward - mi_backward))),
    }


def transfer_entropy_from_codes(source_codes, target_codes, bins, lag):
    if lag < 1 or lag >= len(source_codes) or lag >= len(target_codes):
        return 0.0

    source_aligned = source_codes[:-lag]
    target_future = target_codes[lag:]
    target_past = target_codes[lag - 1:-1]
    return conditional_mutual_information_from_codes(
        source_aligned,
        target_future,
        target_past,
        bins,
        bins,
        bins,
    )


def lagged_transfer_entropy_directional_curve(
    source,
    target,
    dt,
    max_lag_steps=600,
    lag_stride=5,
    bins=12,
):
    lags = np.arange(max(1, lag_stride), max_lag_steps + 1, lag_stride, dtype=int)
    source_codes = digitize_series(source, bins=bins)
    target_codes = digitize_series(target, bins=bins)
    te_values = np.asarray(
        [transfer_entropy_from_codes(source_codes, target_codes, bins, lag) for lag in lags],
        dtype=float,
    )
    lags_time = lags * dt
    normalized_te = te_values / max(np.max(te_values), 1e-12)
    peak_time, peak_transfer, post_peak_decay = first_decay_time_after_peak(lags_time, te_values)

    return {
        "lag_steps": lags,
        "lag_times": lags_time,
        "te": te_values,
        "normalized_te": normalized_te,
        "peak_time": peak_time,
        "peak_transfer": peak_transfer,
        "post_peak_decay_time": post_peak_decay,
        "information_area": float(np.trapezoid(te_values, lags_time)),
        "directionality_strength": float(np.mean(np.abs(te_values))),
    }


def lagged_transfer_entropy_curve(
    x,
    y,
    dt,
    max_lag_steps=600,
    lag_stride=5,
    bins=12,
    baseline_shuffles=8,
    rng=None,
):
    if rng is None:
        rng = np.random.default_rng()

    lags = np.arange(max(1, lag_stride), max_lag_steps + 1, lag_stride, dtype=int)
    x_codes = digitize_series(x, bins=bins)
    y_codes = digitize_series(y, bins=bins)
    te_forward = []
    te_backward = []
    baseline_forward = []
    baseline_backward = []

    for lag in lags:
        te_forward.append(transfer_entropy_from_codes(x_codes, y_codes, bins, lag))
        te_backward.append(transfer_entropy_from_codes(y_codes, x_codes, bins, lag))
        baseline_forward.append(
            _shuffle_baseline(
                lambda local_rng: transfer_entropy_from_codes(local_rng.permutation(x_codes), y_codes, bins, lag),
                baseline_shuffles=baseline_shuffles,
                rng=rng,
            )
        )
        baseline_backward.append(
            _shuffle_baseline(
                lambda local_rng: transfer_entropy_from_codes(local_rng.permutation(y_codes), x_codes, bins, lag),
                baseline_shuffles=baseline_shuffles,
                rng=rng,
            )
        )

    lags_time = lags * dt
    te_forward = np.asarray(te_forward, dtype=float)
    te_backward = np.asarray(te_backward, dtype=float)
    baseline_forward = np.asarray(baseline_forward, dtype=float)
    baseline_backward = np.asarray(baseline_backward, dtype=float)
    excess_forward = np.maximum(te_forward - baseline_forward, 0.0)
    excess_backward = np.maximum(te_backward - baseline_backward, 0.0)
    normalized_forward = excess_forward / max(np.max(excess_forward), 1e-12)
    normalized_backward = excess_backward / max(np.max(excess_backward), 1e-12)
    total_excess = 0.5 * (excess_forward + excess_backward)
    net_excess = excess_forward - excess_backward
    peak_time_forward, peak_forward, decay_forward = first_decay_time_after_peak(lags_time, excess_forward)
    peak_time_backward, peak_backward, decay_backward = first_decay_time_after_peak(lags_time, excess_backward)

    return {
        "lag_steps": lags,
        "lag_times": lags_time,
        "te_forward": te_forward,
        "te_backward": te_backward,
        "baseline_forward": baseline_forward,
        "baseline_backward": baseline_backward,
        "excess_forward": excess_forward,
        "excess_backward": excess_backward,
        "normalized_forward": normalized_forward,
        "normalized_backward": normalized_backward,
        "total_excess": total_excess,
        "net_excess": net_excess,
        "peak_time_forward": peak_time_forward,
        "peak_time_backward": peak_time_backward,
        "peak_transfer_forward": peak_forward,
        "peak_transfer_backward": peak_backward,
        "post_peak_decay_forward": decay_forward,
        "post_peak_decay_backward": decay_backward,
        "net_directional_area": float(np.trapezoid(net_excess, lags_time)),
        "total_transfer_area": float(np.trapezoid(total_excess, lags_time)),
        "directionality_strength": float(np.mean(np.abs(net_excess))),
    }


def summarize_trials(trials, curve_keys, scalar_keys):
    summary = {"sample_count": len(trials)}
    if not trials:
        return summary

    summary["lag_times"] = np.asarray(trials[0]["lag_times"], dtype=float)

    for key in curve_keys:
        stacked = np.stack([np.asarray(trial[key], dtype=float) for trial in trials], axis=0)
        summary[f"{key}_mean"] = np.mean(stacked, axis=0)
        summary[f"{key}_std"] = np.std(stacked, axis=0)

    for key in scalar_keys:
        values = np.asarray([trial[key] for trial in trials], dtype=float)
        finite = values[np.isfinite(values)]
        if len(finite) == 0:
            summary[f"{key}_mean"] = np.nan
            summary[f"{key}_std"] = np.nan
            summary[f"{key}_count"] = 0
        else:
            summary[f"{key}_mean"] = float(np.mean(finite))
            summary[f"{key}_std"] = float(np.std(finite))
            summary[f"{key}_count"] = int(len(finite))

    return summary