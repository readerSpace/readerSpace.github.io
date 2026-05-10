import argparse
import csv
import lzma
from collections import Counter
from dataclasses import dataclass
from math import factorial, log, pi
from pathlib import Path

import matplotlib
import numpy as np
import torch

matplotlib.use("Agg")
import matplotlib.pyplot as plt

from mutal_information import lagged_mutual_information_curve, lagged_transfer_entropy_curve, summarize_trials


plt.rcParams["figure.facecolor"] = "white"
plt.rcParams["axes.facecolor"] = "white"


@dataclass
class ExperimentConfig:
    dt: float
    steps: int
    discard: int
    renorm_steps: int
    lyapunov_eps: float
    masses: tuple[float, ...]
    inner_radius: float
    outer_radius_values: np.ndarray
    outer_speed_scale_values: np.ndarray
    outer_phase: float
    softening: float
    noise_trials: int
    noise_seed: int
    coarse_bins: tuple[int, ...]
    coarse_seed: int
    entropy_seed: int
    entropy_steps: int
    entropy_sample_interval: int
    entropy_ensemble_size: int
    entropy_phase_bins: int
    entropy_position_spread: float
    entropy_velocity_spread: float
    otoc_steps: int
    otoc_sample_interval: int
    otoc_representative_count: int
    otoc_settle_steps: int
    otoc_eps: float
    otoc_distance_bin_count: int
    flow_steps: int
    flow_discard: int
    flow_representative_count: int
    flow_max_lag_steps: int
    flow_lag_stride: int
    flow_mi_bins: int
    flow_mi_baseline_shuffles: int
    flow_te_bins: int
    flow_te_baseline_shuffles: int
    flow_seed: int
    surrogate_trials: int
    surrogate_seed: int

    @property
    def body_count(self):
        return len(self.masses)


def make_config(quick=False):
    if quick:
        return ExperimentConfig(
            dt=0.01,
            steps=2200,
            discard=350,
            renorm_steps=14,
            lyapunov_eps=1e-7,
            masses=(1.0, 3.0e-3, 2.4e-3),
            inner_radius=1.0,
            outer_radius_values=np.linspace(1.48, 2.10, 4),
            outer_speed_scale_values=np.linspace(0.86, 1.08, 4),
            outer_phase=0.5 * np.pi,
            softening=5e-3,
            noise_trials=4,
            noise_seed=20260520,
            coarse_bins=(4, 8, 16, 32, 64, 128, 256),
            coarse_seed=20260521,
            entropy_seed=20260522,
            entropy_steps=800,
            entropy_sample_interval=20,
            entropy_ensemble_size=128,
            entropy_phase_bins=6,
            entropy_position_spread=2e-3,
            entropy_velocity_spread=2e-3,
            otoc_steps=1200,
            otoc_sample_interval=6,
            otoc_representative_count=3,
            otoc_settle_steps=450,
            otoc_eps=1e-6,
            otoc_distance_bin_count=3,
            flow_steps=2800,
            flow_discard=450,
            flow_representative_count=3,
            flow_max_lag_steps=360,
            flow_lag_stride=6,
            flow_mi_bins=20,
            flow_mi_baseline_shuffles=4,
            flow_te_bins=10,
            flow_te_baseline_shuffles=3,
            flow_seed=20260523,
            surrogate_trials=4,
            surrogate_seed=20260524,
        )

    return ExperimentConfig(
        dt=0.01,
        steps=9000,
        discard=1400,
        renorm_steps=18,
        lyapunov_eps=1e-7,
        masses=(1.0, 3.0e-3, 2.4e-3),
        inner_radius=1.0,
        outer_radius_values=np.linspace(1.48, 2.16, 7),
        outer_speed_scale_values=np.linspace(0.84, 1.10, 7),
        outer_phase=0.5 * np.pi,
        softening=5e-3,
        noise_trials=10,
        noise_seed=20260520,
        coarse_bins=(4, 8, 16, 32, 64, 128, 256),
        coarse_seed=20260521,
        entropy_seed=20260522,
        entropy_steps=2200,
        entropy_sample_interval=20,
        entropy_ensemble_size=768,
        entropy_phase_bins=6,
        entropy_position_spread=2e-3,
        entropy_velocity_spread=2e-3,
        otoc_steps=4000,
        otoc_sample_interval=10,
        otoc_representative_count=5,
        otoc_settle_steps=1600,
        otoc_eps=1e-6,
        otoc_distance_bin_count=3,
        flow_steps=10000,
        flow_discard=1600,
        flow_representative_count=5,
        flow_max_lag_steps=1200,
        flow_lag_stride=8,
        flow_mi_bins=24,
        flow_mi_baseline_shuffles=6,
        flow_te_bins=10,
        flow_te_baseline_shuffles=4,
        flow_seed=20260523,
        surrogate_trials=8,
        surrogate_seed=20260524,
    )


def wrap_angle(x):
    return (x + np.pi) % (2 * np.pi) - np.pi


def wrap_angle_torch(x):
    period = 2.0 * torch.pi
    return torch.remainder(x + torch.pi, period) - torch.pi


def positive_lyapunov_sum(spectrum, floor=1e-3):
    spectrum = np.asarray(spectrum, dtype=float)
    return float(np.sum(spectrum[spectrum > floor]))


def summarize_array(values):
    values = np.asarray(values, dtype=float)
    finite = values[np.isfinite(values)]
    if len(finite) == 0:
        return np.nan, np.nan
    return float(np.mean(finite)), float(np.std(finite))


def pearson_correlation(records, x_key, y_key):
    x = np.asarray([record[x_key] for record in records], dtype=float)
    y = np.asarray([record[y_key] for record in records], dtype=float)
    if len(x) < 2 or np.std(x) <= 1e-12 or np.std(y) <= 1e-12:
        return np.nan
    return float(np.corrcoef(x, y)[0, 1])


def quantize_bytes(x, bins=256):
    bins = int(bins)
    if bins < 2 or bins > 256:
        raise ValueError("bins must be between 2 and 256")

    x = np.asarray(x, dtype=float)
    x = (x - x.min()) / (x.max() - x.min() + 1e-12)
    q = np.floor(x * (bins - 1)).astype(np.uint8)
    return q.tobytes()


def lzma_ratio(x, bins=256):
    raw = quantize_bytes(x, bins=bins)
    comp = lzma.compress(raw, preset=9)
    return len(comp) / len(raw)


def lzma_ratio_scan(x, bin_values):
    return {int(bins): lzma_ratio(x, bins=int(bins)) for bins in bin_values}


def lz_complexity_binary(x):
    x = np.asarray(x, dtype=float)
    threshold = np.median(x)
    s = "".join("1" if value > threshold else "0" for value in x)
    n = len(s)
    i = 0
    count = 0
    seen = set()

    while i < n:
        j = i + 1
        while j <= n and s[i:j] in seen:
            j += 1
        seen.add(s[i:j])
        count += 1
        i = j

    return count * np.log2(max(n, 2)) / max(n, 1)


def permutation_entropy(x, order=5, delay=1):
    x = np.asarray(x, dtype=float)
    n = len(x) - delay * (order - 1)
    if n <= 0:
        return np.nan

    patterns = []
    for index in range(n):
        window = x[index:index + delay * order:delay]
        patterns.append(tuple(np.argsort(window)))

    counts = Counter(patterns)
    probs = np.array(list(counts.values()), dtype=float)
    probs /= probs.sum()
    entropy = -np.sum(probs * np.log(probs + 1e-15))
    return float(entropy / log(factorial(order)))


def downsample_series(x, max_points=6000):
    x = np.asarray(x, dtype=float)
    if len(x) <= max_points:
        return x
    indices = np.linspace(0, len(x) - 1, max_points, dtype=int)
    return x[indices]


def complexity_metrics(x):
    x = np.asarray(x, dtype=float)
    return {
        "LZMA_ratio": lzma_ratio(x, bins=256),
        "Lempel_Ziv_complexity": lz_complexity_binary(x),
        "Permutation_entropy": permutation_entropy(x, order=5, delay=1),
    }


def select_device(requested):
    if requested == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA was requested, but no CUDA device is available")
        return torch.device("cuda")
    if requested == "cpu":
        return torch.device("cpu")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def describe_device(device):
    if device.type == "cuda":
        return f"cuda:{device.index or 0} ({torch.cuda.get_device_name(device)})"
    return str(device)


class PlanarNBodySystem:
    def __init__(self, masses, device, softening=5e-3, dtype=torch.float64, gravitational_constant=1.0):
        self.device = device
        self.dtype = dtype
        self.masses = torch.as_tensor(masses, dtype=dtype, device=device)
        self.softening = float(softening)
        self.gravitational_constant = float(gravitational_constant)
        self.body_count = int(self.masses.numel())
        self.state_dim = 4 * self.body_count
        self._eye_mask = torch.eye(self.body_count, dtype=torch.bool, device=device)[None, :, :]

    def derivative(self, flat_state):
        squeeze = flat_state.ndim == 1
        if squeeze:
            flat_state = flat_state[None, :]

        state = flat_state.reshape(flat_state.shape[0], self.body_count, 4)
        positions = state[:, :, :2]
        velocities = state[:, :, 2:]
        deltas = positions[:, None, :, :] - positions[:, :, None, :]
        distance_sq = torch.sum(deltas * deltas, dim=-1) + self.softening ** 2
        distance_sq = distance_sq.masked_fill(self._eye_mask, torch.inf)
        inv_distance_cubed = torch.rsqrt(distance_sq) ** 3
        masses = self.masses[None, None, :, None]
        accelerations = self.gravitational_constant * torch.sum(deltas * inv_distance_cubed[:, :, :, None] * masses, dim=2)
        derivative = torch.cat((velocities, accelerations), dim=-1).reshape(flat_state.shape)
        return derivative[0] if squeeze else derivative

    def rk4_step(self, flat_state, dt):
        k1 = self.derivative(flat_state)
        k2 = self.derivative(flat_state + 0.5 * dt * k1)
        k3 = self.derivative(flat_state + 0.5 * dt * k2)
        k4 = self.derivative(flat_state + dt * k3)
        return flat_state + dt * (k1 + 2.0 * k2 + 2.0 * k3 + k4) / 6.0


def tangential_velocity(radius, phase, speed):
    return np.array([-speed * np.sin(phase), speed * np.cos(phase)], dtype=float)


def build_three_body_initial_state(config, outer_radius, outer_speed_scale, outer_phase=None):
    star_mass, inner_mass, outer_mass = config.masses
    inner_radius = config.inner_radius
    inner_phase = 0.0
    if outer_phase is None:
        outer_phase = config.outer_phase

    positions = np.array(
        [
            [0.0, 0.0],
            [inner_radius * np.cos(inner_phase), inner_radius * np.sin(inner_phase)],
            [outer_radius * np.cos(outer_phase), outer_radius * np.sin(outer_phase)],
        ],
        dtype=float,
    )
    velocities = np.array(
        [
            [0.0, 0.0],
            tangential_velocity(inner_radius, inner_phase, np.sqrt(star_mass / inner_radius)),
            tangential_velocity(outer_radius, outer_phase, outer_speed_scale * np.sqrt(star_mass / outer_radius)),
        ],
        dtype=float,
    )

    velocities[0] = -(inner_mass * velocities[1] + outer_mass * velocities[2]) / star_mass
    masses = np.asarray(config.masses, dtype=float)
    center_of_mass = np.average(positions, axis=0, weights=masses)
    positions -= center_of_mass

    state = np.concatenate((positions, velocities), axis=1).reshape(-1)
    return state


def _extract_observables_from_state_array(state):
    positions = state[..., :, :2]
    velocities = state[..., :, 2:]
    star_position = positions[..., 0, :]
    star_velocity = velocities[..., 0, :]
    relative_positions = positions[..., 1:, :] - star_position[..., None, :]
    relative_velocities = velocities[..., 1:, :] - star_velocity[..., None, :]
    radii = np.linalg.norm(relative_positions, axis=-1)
    thetas = np.arctan2(relative_positions[..., 1], relative_positions[..., 0])
    angular_velocity = (
        relative_positions[..., :, 0] * relative_velocities[..., :, 1]
        - relative_positions[..., :, 1] * relative_velocities[..., :, 0]
    ) / (radii * radii + 1e-12)
    return {
        "theta_inner": thetas[..., 0],
        "theta_outer": thetas[..., 1],
        "omega_inner": angular_velocity[..., 0],
        "omega_outer": angular_velocity[..., 1],
        "x_inner": relative_positions[..., 0, 0],
        "x_outer": relative_positions[..., 1, 0],
        "radius_inner": radii[..., 0],
        "radius_outer": radii[..., 1],
    }


def _extract_observables_from_torch(flat_state, body_count):
    squeeze = flat_state.ndim == 1
    if squeeze:
        flat_state = flat_state[None, :]

    state = flat_state.reshape(flat_state.shape[0], body_count, 4)
    positions = state[:, :, :2]
    velocities = state[:, :, 2:]
    star_position = positions[:, 0, :]
    star_velocity = velocities[:, 0, :]
    relative_positions = positions[:, 1:, :] - star_position[:, None, :]
    relative_velocities = velocities[:, 1:, :] - star_velocity[:, None, :]
    radii = torch.linalg.norm(relative_positions, dim=-1)
    thetas = torch.atan2(relative_positions[:, :, 1], relative_positions[:, :, 0])
    angular_velocity = (
        relative_positions[:, :, 0] * relative_velocities[:, :, 1]
        - relative_positions[:, :, 1] * relative_velocities[:, :, 0]
    ) / (radii * radii + 1e-12)

    result = {
        "theta_inner": thetas[:, 0],
        "theta_outer": thetas[:, 1],
        "omega_inner": angular_velocity[:, 0],
        "omega_outer": angular_velocity[:, 1],
        "x_inner": relative_positions[:, 0, 0],
        "x_outer": relative_positions[:, 1, 0],
        "radius_inner": radii[:, 0],
        "radius_outer": radii[:, 1],
    }

    if squeeze:
        return {key: value[0] for key, value in result.items()}
    return result


def _positions_relative_to_com_torch(flat_state, masses):
    squeeze = flat_state.ndim == 1
    if squeeze:
        flat_state = flat_state[None, :]

    body_count = int(masses.numel())
    state = flat_state.reshape(flat_state.shape[0], body_count, 4)
    positions = state[:, :, :2]
    weights = masses[None, :, None]
    center_of_mass = torch.sum(positions * weights, dim=1, keepdim=True) / torch.sum(masses)
    relative_positions = positions - center_of_mass
    return relative_positions[0] if squeeze else relative_positions


@torch.no_grad()
def advance_state(system, initial_state, dt, steps):
    state = torch.as_tensor(initial_state, dtype=system.dtype, device=system.device)
    for _ in range(int(steps)):
        state = system.rk4_step(state, dt)
    return state.detach().cpu().numpy()


@torch.no_grad()
def lyapunov_spectrum_batched(system, initial_states, dt, steps, discard, renorm_steps=18, eps=1e-7, observe_key="x_inner"):
    states = torch.as_tensor(initial_states, dtype=system.dtype, device=system.device)
    batch_size, state_dim = states.shape
    measured_steps = int(steps - discard)
    if measured_steps <= 0:
        raise ValueError("steps must be greater than discard")

    for _ in range(int(discard)):
        states = system.rk4_step(states, dt)

    basis = torch.eye(state_dim, dtype=system.dtype, device=system.device)[None, :, :].expand(batch_size, -1, -1).clone()
    perturbed = states[:, None, :] + eps * basis
    log_sums = torch.zeros((batch_size, state_dim), dtype=system.dtype, device=system.device)
    observed = torch.empty((measured_steps, batch_size), dtype=system.dtype, device=system.device)
    completed_steps = 0
    observed_index = 0

    while completed_steps < measured_steps:
        interval_steps = min(int(renorm_steps), measured_steps - completed_steps)
        for _ in range(interval_steps):
            states = system.rk4_step(states, dt)
            perturbed = system.rk4_step(perturbed.reshape(batch_size * state_dim, state_dim), dt).reshape(batch_size, state_dim, state_dim)
            observed[observed_index] = _extract_observables_from_torch(states, system.body_count)[observe_key]
            observed_index += 1

        deviation_matrix = (perturbed - states[:, None, :]).transpose(1, 2)
        q_matrix, r_matrix = torch.linalg.qr(deviation_matrix)
        stretches = torch.abs(torch.diagonal(r_matrix, dim1=-2, dim2=-1))
        log_sums += torch.log((stretches + 1e-30) / eps)
        perturbed = states[:, None, :] + eps * q_matrix.transpose(1, 2)
        completed_steps += interval_steps

    spectra = torch.sort(log_sums / max(measured_steps * dt, 1e-30), dim=1, descending=True).values
    return observed.transpose(0, 1).detach().cpu().numpy(), spectra.detach().cpu().numpy()


@torch.no_grad()
def simulate_orbit_observables(system, initial_state, dt, steps, discard):
    state = torch.as_tensor(initial_state, dtype=system.dtype, device=system.device)
    keys = ["theta_inner", "theta_outer", "omega_inner", "omega_outer", "x_inner", "x_outer", "radius_inner", "radius_outer"]
    traces = {key: [] for key in keys}

    for step in range(int(steps)):
        state = system.rk4_step(state, dt)
        if step >= discard:
            observables = _extract_observables_from_torch(state, system.body_count)
            for key in keys:
                traces[key].append(float(observables[key]))

    return {key: np.asarray(values, dtype=float) for key, values in traces.items()}


@torch.no_grad()
def simulate_local_phase_cloud(
    system,
    center_state,
    dt,
    steps,
    sample_interval,
    ensemble_size,
    position_spread,
    velocity_spread,
    rng,
):
    center_state = np.asarray(center_state, dtype=float)
    scales = np.zeros_like(center_state)
    for body_index in range(1, system.body_count):
        offset = 4 * body_index
        scales[offset:offset + 2] = position_spread
        scales[offset + 2:offset + 4] = velocity_spread

    states = center_state + rng.normal(loc=0.0, scale=scales, size=(ensemble_size, len(center_state)))
    states = torch.as_tensor(states, dtype=system.dtype, device=system.device)
    initial_obs = _extract_observables_from_torch(states, system.body_count)
    theta_inner_unwrapped = initial_obs["theta_inner"].clone()
    theta_outer_unwrapped = initial_obs["theta_outer"].clone()
    previous_inner = initial_obs["theta_inner"].clone()
    previous_outer = initial_obs["theta_outer"].clone()
    snapshots = [
        torch.stack(
            (
                theta_inner_unwrapped,
                initial_obs["omega_inner"],
                theta_outer_unwrapped,
                initial_obs["omega_outer"],
            ),
            dim=1,
        ).detach().cpu().numpy()
    ]
    times = [0.0]

    for step in range(1, int(steps) + 1):
        states = system.rk4_step(states, dt)
        current_obs = _extract_observables_from_torch(states, system.body_count)
        current_inner = current_obs["theta_inner"]
        current_outer = current_obs["theta_outer"]
        theta_inner_unwrapped = theta_inner_unwrapped + wrap_angle_torch(current_inner - previous_inner)
        theta_outer_unwrapped = theta_outer_unwrapped + wrap_angle_torch(current_outer - previous_outer)
        previous_inner = current_inner
        previous_outer = current_outer

        if step % int(sample_interval) == 0:
            snapshots.append(
                torch.stack(
                    (
                        theta_inner_unwrapped,
                        current_obs["omega_inner"],
                        theta_outer_unwrapped,
                        current_obs["omega_outer"],
                    ),
                    dim=1,
                ).detach().cpu().numpy()
            )
            times.append(step * dt)

    return np.asarray(times, dtype=float), np.stack(snapshots, axis=0)


def lyapunov_component_keys(record):
    return sorted(
        [key for key in record.keys() if key.startswith("Lyapunov_") and key.split("_")[1].isdigit()],
        key=lambda key: int(key.split("_")[1]),
    )


def analyze(system_name, data, spectrum):
    sampled = downsample_series(data, max_points=6000)
    ordered = np.sort(np.asarray(spectrum, dtype=float))[::-1]
    record = {
        "system": system_name,
        **complexity_metrics(sampled),
        "Lyapunov_exponent": float(ordered[0]),
        "KS_entropy_Pesin": positive_lyapunov_sum(ordered),
        "Positive_lyapunov_count": int(np.sum(ordered > 1e-3)),
    }

    for index, value in enumerate(ordered, start=1):
        record[f"Lyapunov_{index}"] = float(value)

    record["Pesin_gap_lambda1"] = record["KS_entropy_Pesin"] - record["Lyapunov_exponent"]
    return record, sampled


def scan_planar_three_body_grid(system, config):
    records = []
    sampled_series = []
    lyap_grid = np.full((len(config.outer_speed_scale_values), len(config.outer_radius_values)), np.nan)
    ks_grid = np.full_like(lyap_grid, np.nan)
    initial_states = []
    grid_points = []

    for row, outer_speed_scale in enumerate(config.outer_speed_scale_values):
        for col, outer_radius in enumerate(config.outer_radius_values):
            initial_states.append(
                build_three_body_initial_state(
                    config,
                    outer_radius=outer_radius,
                    outer_speed_scale=outer_speed_scale,
                )
            )
            grid_points.append((row, col, outer_radius, outer_speed_scale))

    observed, spectra = lyapunov_spectrum_batched(
        system,
        np.asarray(initial_states, dtype=float),
        dt=config.dt,
        steps=config.steps,
        discard=config.discard,
        renorm_steps=config.renorm_steps,
        eps=config.lyapunov_eps,
        observe_key="x_inner",
    )

    for index, (row, col, outer_radius, outer_speed_scale) in enumerate(grid_points):
        record, sampled = analyze("planar_three_body", observed[index], spectra[index])
        record["outer_radius_0"] = float(outer_radius)
        record["outer_speed_scale_0"] = float(outer_speed_scale)
        record["outer_phase_0"] = float(config.outer_phase)
        records.append(record)
        sampled_series.append(sampled)
        lyap_grid[row, col] = record["Lyapunov_exponent"]
        ks_grid[row, col] = record["KS_entropy_Pesin"]

    return records, lyap_grid, ks_grid, sampled_series


def label_chaos_regions(records, positive_floor=0.01):
    lyaps = np.asarray([record["Lyapunov_exponent"] for record in records], dtype=float)
    positive = lyaps[lyaps > positive_floor]

    if len(positive) >= 6:
        weak_cut, strong_cut = np.quantile(positive, [1.0 / 3.0, 2.0 / 3.0])
        strategy = "positive_tertiles"
    else:
        weak_cut, strong_cut = np.quantile(lyaps, [1.0 / 3.0, 2.0 / 3.0])
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
        "strong_cut": float(strong_cut),
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
        values = np.asarray([record[key] for record in subset], dtype=float)
        if len(values) == 0:
            summary[key] = np.nan
            summary[f"{key}_std"] = np.nan
        else:
            summary[key] = float(np.mean(values))
            summary[f"{key}_std"] = float(np.std(values))

    return summary


def save_records_csv(records, output_path):
    if not records:
        return
    fieldnames = [
        "outer_radius_0",
        "outer_speed_scale_0",
        "outer_phase_0",
        "Lyapunov_exponent",
        *lyapunov_component_keys(records[0]),
        "KS_entropy_Pesin",
        "Positive_lyapunov_count",
        "Pesin_gap_lambda1",
        "LZMA_ratio",
        "Lempel_Ziv_complexity",
        "Permutation_entropy",
        "chaos_region",
    ]
    with output_path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        for record in records:
            writer.writerow({key: record.get(key, "") for key in fieldnames})


def generate_matched_white_noise(sampled_series, rng):
    sampled_series = np.asarray(sampled_series, dtype=float)
    mean = float(np.mean(sampled_series))
    std = float(np.std(sampled_series))
    return rng.normal(loc=mean, scale=max(std, 1e-12), size=len(sampled_series))


def compare_chaos_to_random_noise(records, sampled_series, source_regions, trials_per_series=10, seed=20260520):
    rng = np.random.default_rng(seed)
    metric_keys = ["LZMA_ratio", "Lempel_Ziv_complexity", "Permutation_entropy"]
    noise_records = []

    for source_index, (record, sampled) in enumerate(zip(records, sampled_series)):
        region_name = record["chaos_region"]
        if region_name not in source_regions:
            continue

        for trial in range(int(trials_per_series)):
            noise_series = generate_matched_white_noise(sampled, rng)
            metrics = complexity_metrics(noise_series)
            noise_record = {
                "source_region": region_name,
                "source_index": source_index,
                "trial": trial + 1,
                **metrics,
            }
            for key in metric_keys:
                noise_record[f"{key}_minus_chaos"] = float(metrics[key] - record[key])
            noise_records.append(noise_record)

    return noise_records


def summarize_noise_records(noise_records, source_region=None):
    if source_region is None:
        subset = noise_records
    else:
        subset = [record for record in noise_records if record["source_region"] == source_region]

    summary = {"count": len(subset)}
    for key in ["LZMA_ratio", "Lempel_Ziv_complexity", "Permutation_entropy"]:
        values = np.asarray([record[key] for record in subset], dtype=float)
        if len(values) == 0:
            summary[key] = np.nan
            summary[f"{key}_std"] = np.nan
        else:
            summary[key] = float(np.mean(values))
            summary[f"{key}_std"] = float(np.std(values))
    return summary


def permutation_entropy_separation(noise_records, source_region=None):
    if source_region is None:
        subset = noise_records
    else:
        subset = [record for record in noise_records if record["source_region"] == source_region]

    deltas = np.asarray([record["Permutation_entropy_minus_chaos"] for record in subset], dtype=float)
    if len(deltas) == 0:
        return {
            "mean_delta": np.nan,
            "std_delta": np.nan,
            "positive_fraction": np.nan,
            "min_delta": np.nan,
        }

    return {
        "mean_delta": float(np.mean(deltas)),
        "std_delta": float(np.std(deltas)),
        "positive_fraction": float(np.mean(deltas > 0.0)),
        "min_delta": float(np.min(deltas)),
    }


def save_noise_records_csv(noise_records, output_path):
    if not noise_records:
        return
    fieldnames = list(noise_records[0].keys())
    with output_path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(noise_records)


def run_coarse_graining_experiment(records, sampled_series, source_regions, bin_values, noise_trials=10, seed=20260521):
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

        for trial in range(int(noise_trials)):
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
                entry["LZMA_ratio"]
                for entry in group_rows
                if entry["group"] == group_name and entry["bins"] == bins
            ]
            mean_value, std_value = summarize_array(values)
            row[f"{group_name}_mean"] = mean_value
            row[f"{group_name}_std"] = std_value

        weak_deltas = [
            entry["noise_minus_chaos"]
            for entry in delta_rows
            if entry["source_region"] == "weak_chaos" and entry["bins"] == bins
        ]
        strong_deltas = [
            entry["noise_minus_chaos"]
            for entry in delta_rows
            if entry["source_region"] == "strong_chaos" and entry["bins"] == bins
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
    robustness = {
        "strong_gt_weak_all_bins": bool(np.all([row["strong_minus_weak_chaos_mean"] > 0.0 for row in summary_rows])),
        "weak_noise_gt_chaos_min_fraction": float(np.min([row["weak_noise_gt_chaos_fraction"] for row in summary_rows])),
        "strong_noise_gt_chaos_min_fraction": float(np.min([row["strong_noise_gt_chaos_fraction"] for row in summary_rows])),
    }
    bin_values = np.asarray([row["bins"] for row in summary_rows], dtype=float)
    for group_name in ["weak_chaos", "strong_chaos", "weak_noise", "strong_noise"]:
        means = np.asarray([row[f"{group_name}_mean"] for row in summary_rows], dtype=float)
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
        robustness["verdict"] = "relative ordering is robust, but absolute compression values remain coarse-graining dependent"
    else:
        robustness["verdict"] = "ordering changes with coarse-graining, so the metric is not robust as a standalone physical complexity proxy"
    return robustness


def save_coarse_graining_summary_csv(summary_rows, output_path):
    if not summary_rows:
        return
    with output_path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=list(summary_rows[0].keys()))
        writer.writeheader()
        writer.writerows(summary_rows)


def select_representative_record(records, region_name, target_key="Lyapunov_exponent"):
    subset = [record for record in records if record["chaos_region"] == region_name]
    if not subset:
        raise ValueError(f"No records found for region {region_name}")
    target = float(np.median([record[target_key] for record in subset]))
    return min(subset, key=lambda record: abs(record[target_key] - target))


def select_representative_records(records, region_name, count=5, target_key="Lyapunov_exponent"):
    subset = sorted([record for record in records if record["chaos_region"] == region_name], key=lambda record: record[target_key])
    if not subset:
        raise ValueError(f"No records found for region {region_name}")
    count = max(1, min(int(count), len(subset)))
    raw_positions = np.linspace(0, len(subset) - 1, count)
    indices = []
    for raw in raw_positions:
        index = int(np.clip(np.round(raw), 0, len(subset) - 1))
        if index not in indices:
            indices.append(index)
    while len(indices) < count:
        for index in range(len(subset)):
            if index not in indices:
                indices.append(index)
            if len(indices) == count:
                break
    return [subset[index] for index in indices]


def build_phase_space_partition(snapshot_groups, bins_per_dim=6, margin=0.05):
    pooled = np.concatenate([snapshots.reshape(-1, snapshots.shape[-1]) for snapshots in snapshot_groups], axis=0)
    if np.isscalar(bins_per_dim):
        bins_per_dim = [int(bins_per_dim)] * pooled.shape[1]
    edges = []
    for dim, bins in enumerate(bins_per_dim):
        values = pooled[:, dim]
        low = float(np.min(values))
        high = float(np.max(values))
        padding = margin * max(high - low, 1e-6)
        edges.append(np.linspace(low - padding, high + padding, int(bins) + 1))
    return edges


def measure_entropy_curve(times, snapshots, edges):
    total_cells = int(np.prod([len(edge) - 1 for edge in edges]))
    entropy = []
    occupied_cells = []
    for snapshot in snapshots:
        hist, _ = np.histogramdd(snapshot, bins=edges)
        probs = hist.ravel()
        probs = probs / max(np.sum(probs), 1.0)
        mask = probs > 0.0
        entropy.append(float(-np.sum(probs[mask] * np.log(probs[mask] + 1e-30))))
        occupied_cells.append(int(np.count_nonzero(hist)))
    entropy = np.asarray(entropy, dtype=float)
    return {
        "times": np.asarray(times, dtype=float),
        "entropy": entropy,
        "normalized_entropy": entropy / max(np.log(total_cells), 1e-12),
        "occupied_cells": np.asarray(occupied_cells, dtype=int),
    }


def fit_entropy_growth_rate(times, entropy):
    times = np.asarray(times, dtype=float)
    entropy = np.asarray(entropy, dtype=float)
    if len(times) < 4:
        return {"slope": np.nan, "intercept": np.nan, "fit_time_end": np.nan}

    target_fraction = 0.6
    gain = entropy - entropy[0]
    total_gain = gain[-1]
    if total_gain <= 1e-9:
        fit_end_index = min(len(times), max(4, len(times) // 2))
    else:
        crossing = np.where(gain >= target_fraction * total_gain)[0]
        fit_end_index = int(crossing[0] + 1) if len(crossing) > 0 else len(times)
        fit_end_index = max(4, min(fit_end_index, len(times)))

    coeffs = np.polyfit(times[:fit_end_index], entropy[:fit_end_index], 1)
    return {
        "slope": float(coeffs[0]),
        "intercept": float(coeffs[1]),
        "fit_time_end": float(times[fit_end_index - 1]),
    }


def nanmean_std(stack, axis=0):
    stack = np.asarray(stack, dtype=float)
    finite = np.isfinite(stack)
    count = np.sum(finite, axis=axis)
    safe = np.where(finite, stack, 0.0)
    total = np.sum(safe, axis=axis)
    mean = total / np.maximum(count, 1)
    expanded_mean = np.expand_dims(mean, axis=axis)
    sq_total = np.sum(np.where(finite, (stack - expanded_mean) ** 2, 0.0), axis=axis)
    std = np.sqrt(sq_total / np.maximum(count, 1))
    mean = np.where(count > 0, mean, np.nan)
    std = np.where(count > 0, std, np.nan)
    return mean, std, count


def _compute_pair_otoc_from_positions(position_batch, eps, body_count):
    baseline_positions = position_batch[0]
    perturbed_positions = position_batch[1:]
    derivatives = (perturbed_positions - baseline_positions[None, :, :]) / eps
    pair_otoc = np.zeros((body_count, body_count), dtype=float)

    for source_body in range(body_count):
        source_block = derivatives[2 * source_body:2 * source_body + 2]
        pair_otoc[:, source_body] = 0.5 * np.sum(source_block ** 2, axis=(0, 2))

    return pair_otoc


def _pairwise_distance_matrix(points):
    deltas = points[:, None, :] - points[None, :, :]
    return np.linalg.norm(deltas, axis=-1)


@torch.no_grad()
def simulate_otoc_finite_difference(system, center_state, dt, steps, sample_interval, eps):
    center_state = np.asarray(center_state, dtype=float)
    batch_states = [center_state]
    for source_body in range(system.body_count):
        for axis in range(2):
            perturbed = center_state.copy()
            perturbed[4 * source_body + axis] += eps
            batch_states.append(perturbed)

    states = torch.as_tensor(np.asarray(batch_states, dtype=float), dtype=system.dtype, device=system.device)
    pair_curves = []
    mean_all_curves = []
    mean_cross_curves = []
    self_curves = []
    times = []
    pair_distances = None
    cross_mask = ~np.eye(system.body_count, dtype=bool)

    def sample(current_states, time_value):
        nonlocal pair_distances
        relative_positions = _positions_relative_to_com_torch(current_states, system.masses).detach().cpu().numpy()
        pair_otoc = _compute_pair_otoc_from_positions(relative_positions, eps, system.body_count)
        pair_curves.append(pair_otoc)
        mean_all_curves.append(float(np.mean(pair_otoc)))
        mean_cross_curves.append(float(np.mean(pair_otoc[cross_mask])))
        self_curves.append(float(np.mean(np.diag(pair_otoc))))
        times.append(float(time_value))
        if pair_distances is None:
            pair_distances = _pairwise_distance_matrix(relative_positions[0])

    sample(states, 0.0)
    for step in range(1, int(steps) + 1):
        states = system.rk4_step(states, dt)
        if step % int(sample_interval) == 0:
            sample(states, step * dt)

    times = np.asarray(times, dtype=float)
    mean_cross_curves = np.asarray(mean_cross_curves, dtype=float)
    finite_time_lyapunov = np.full_like(times, np.nan)
    valid = times > 0.0
    finite_time_lyapunov[valid] = 0.5 * np.log(np.maximum(mean_cross_curves[valid], 1e-30)) / times[valid]

    return {
        "times": times,
        "pair_otoc": np.stack(pair_curves, axis=0),
        "pair_distances": pair_distances,
        "average_all_otoc": np.asarray(mean_all_curves, dtype=float),
        "average_cross_otoc": mean_cross_curves,
        "self_otoc": np.asarray(self_curves, dtype=float),
        "finite_time_lyapunov": finite_time_lyapunov,
    }


def fit_otoc_growth_rate(times, curve, saturation_fraction=0.3):
    times = np.asarray(times, dtype=float)
    curve = np.asarray(curve, dtype=float)
    positive = np.where((times > 0.0) & np.isfinite(curve) & (curve > 1e-18))[0]
    if len(positive) < 4:
        return {"growth_rate": np.nan, "fit_time_end": np.nan}

    positive_curve = curve[positive]
    max_value = float(np.max(positive_curve))
    baseline_value = float(positive_curve[0])
    if max_value <= baseline_value * 1.05:
        selected = positive[: max(4, min(len(positive), len(positive) // 3 + 1))]
    else:
        threshold = baseline_value + saturation_fraction * (max_value - baseline_value)
        crossing = positive[positive_curve >= threshold]
        end_index = crossing[0] if len(crossing) > 0 else positive[-1]
        selected = positive[positive <= end_index]
        if len(selected) < 4:
            selected = positive[:4]

    coeffs = np.polyfit(times[selected], np.log(curve[selected]), 1)
    return {
        "growth_rate": float(0.5 * coeffs[0]),
        "fit_time_end": float(times[selected[-1]]),
    }


def estimate_otoc_scrambling_time(times, curve, saturation_fraction=0.5):
    times = np.asarray(times, dtype=float)
    curve = np.asarray(curve, dtype=float)
    valid = np.where((times > 0.0) & np.isfinite(curve))[0]
    if len(valid) == 0:
        return np.nan

    values = curve[valid]
    baseline = float(values[0])
    peak_value = float(np.max(values))
    if peak_value <= baseline + 1e-18:
        return np.nan

    threshold = baseline + saturation_fraction * (peak_value - baseline)
    crossing = valid[curve[valid] >= threshold]
    if len(crossing) == 0:
        return np.nan
    return float(times[crossing[0]])


def build_otoc_distance_edges(trial_groups, bin_count=3):
    distances = []
    for trials in trial_groups.values():
        for trial in trials:
            mask = ~np.eye(trial["pair_distances"].shape[0], dtype=bool)
            distances.extend(trial["pair_distances"][mask].tolist())

    distances = np.asarray(distances, dtype=float)
    if len(distances) == 0:
        return np.asarray([0.0, 1.0], dtype=float)

    edges = np.quantile(distances, np.linspace(0.0, 1.0, int(bin_count) + 1))
    edges[0] = float(np.min(distances))
    edges[-1] = float(np.max(distances))
    for index in range(1, len(edges)):
        if edges[index] <= edges[index - 1]:
            edges[index] = edges[index - 1] + 1e-6
    return edges


def summarize_otoc_region_trials(trials, distance_edges):
    times = np.asarray(trials[0]["times"], dtype=float)
    average_all_stack = np.stack([trial["average_all_otoc"] for trial in trials], axis=0)
    average_cross_stack = np.stack([trial["average_cross_otoc"] for trial in trials], axis=0)
    self_stack = np.stack([trial["self_otoc"] for trial in trials], axis=0)
    finite_time_stack = np.stack([trial["finite_time_lyapunov"] for trial in trials], axis=0)
    pair_stack = np.stack([trial["pair_otoc"] for trial in trials], axis=0)

    average_all_mean, average_all_std, _ = nanmean_std(average_all_stack, axis=0)
    average_cross_mean, average_cross_std, _ = nanmean_std(average_cross_stack, axis=0)
    self_mean, self_std, _ = nanmean_std(self_stack, axis=0)
    finite_time_mean, finite_time_std, _ = nanmean_std(finite_time_stack, axis=0)
    pair_mean, pair_std, _ = nanmean_std(pair_stack, axis=0)

    growth_values = np.asarray([trial["growth_rate"] for trial in trials], dtype=float)
    scrambling_values = np.asarray([trial["scrambling_time"] for trial in trials], dtype=float)
    peak_values = np.asarray([np.max(trial["average_cross_otoc"]) for trial in trials], dtype=float)
    late_values = np.asarray([trial["average_cross_otoc"][-1] for trial in trials], dtype=float)
    fit_time_values = np.asarray([trial["fit_time_end"] for trial in trials], dtype=float)

    distance_bins = []
    off_diagonal_mask = ~np.eye(pair_mean.shape[-1], dtype=bool)
    for bin_index in range(len(distance_edges) - 1):
        low = float(distance_edges[bin_index])
        high = float(distance_edges[bin_index + 1])
        curves = []
        pair_counts = []
        for trial in trials:
            selected_curves = []
            for target_body in range(trial["pair_distances"].shape[0]):
                for source_body in range(trial["pair_distances"].shape[1]):
                    if target_body == source_body:
                        continue
                    distance_value = float(trial["pair_distances"][target_body, source_body])
                    in_bin = (low <= distance_value < high) or (bin_index == len(distance_edges) - 2 and low <= distance_value <= high)
                    if in_bin:
                        selected_curves.append(trial["pair_otoc"][:, target_body, source_body])
            pair_counts.append(len(selected_curves))
            if selected_curves:
                curves.append(np.mean(np.stack(selected_curves, axis=0), axis=0))
            else:
                curves.append(np.full(len(times), np.nan))

        curve_stack = np.stack(curves, axis=0)
        curve_mean, curve_std, curve_count = nanmean_std(curve_stack, axis=0)
        label_end = "]" if bin_index == len(distance_edges) - 2 else ")"
        distance_bins.append(
            {
                "index": bin_index,
                "label": f"r in [{low:.2f}, {high:.2f}{label_end}",
                "distance_low": low,
                "distance_high": high,
                "distance_center": 0.5 * (low + high),
                "curve_mean": curve_mean,
                "curve_std": curve_std,
                "sample_count_mean": float(np.mean(pair_counts)),
                "valid_trial_count": int(np.max(curve_count)),
                "final_mean": float(curve_mean[-1]) if np.isfinite(curve_mean[-1]) else np.nan,
            }
        )

    return {
        "records": [trial["record"] for trial in trials],
        "times": times,
        "average_all_otoc_mean": average_all_mean,
        "average_all_otoc_std": average_all_std,
        "average_cross_otoc_mean": average_cross_mean,
        "average_cross_otoc_std": average_cross_std,
        "self_otoc_mean": self_mean,
        "self_otoc_std": self_std,
        "finite_time_lyapunov_mean": finite_time_mean,
        "finite_time_lyapunov_std": finite_time_std,
        "pair_otoc_mean": pair_mean,
        "pair_otoc_std": pair_std,
        "pair_distance_mean": np.mean(np.stack([trial["pair_distances"] for trial in trials], axis=0), axis=0),
        "growth_rate_mean": summarize_array(growth_values)[0],
        "growth_rate_std": summarize_array(growth_values)[1],
        "scrambling_time_mean": summarize_array(scrambling_values)[0],
        "scrambling_time_std": summarize_array(scrambling_values)[1],
        "peak_cross_otoc_mean": summarize_array(peak_values)[0],
        "peak_cross_otoc_std": summarize_array(peak_values)[1],
        "late_cross_otoc_mean": summarize_array(late_values)[0],
        "late_cross_otoc_std": summarize_array(late_values)[1],
        "fit_time_end_mean": summarize_array(fit_time_values)[0],
        "fit_time_end_std": summarize_array(fit_time_values)[1],
        "distance_bins": distance_bins,
        "lyapunov_mean": float(np.mean([trial["record"]["Lyapunov_exponent"] for trial in trials])),
        "lyapunov_std": float(np.std([trial["record"]["Lyapunov_exponent"] for trial in trials])),
        "off_diagonal_pair_count": int(np.count_nonzero(off_diagonal_mask)),
    }


def run_otoc_experiment(records, system, config):
    trial_groups = {}
    for region_name in ["weak_chaos", "strong_chaos"]:
        representative_records = select_representative_records(records, region_name, count=config.otoc_representative_count)
        trials = []
        for record in representative_records:
            initial_state = build_three_body_initial_state(
                config,
                outer_radius=record["outer_radius_0"],
                outer_speed_scale=record["outer_speed_scale_0"],
                outer_phase=record["outer_phase_0"],
            )
            center_state = advance_state(system, initial_state, dt=config.dt, steps=config.otoc_settle_steps)
            trial = simulate_otoc_finite_difference(
                system,
                center_state,
                dt=config.dt,
                steps=config.otoc_steps,
                sample_interval=config.otoc_sample_interval,
                eps=config.otoc_eps,
            )
            trial.update(fit_otoc_growth_rate(trial["times"], trial["average_cross_otoc"]))
            trial["scrambling_time"] = estimate_otoc_scrambling_time(trial["times"], trial["average_cross_otoc"])
            trial["record"] = record
            trials.append(trial)
        trial_groups[region_name] = trials

    distance_edges = build_otoc_distance_edges(trial_groups, bin_count=config.otoc_distance_bin_count)
    results = {
        region_name: summarize_otoc_region_trials(trials, distance_edges)
        for region_name, trials in trial_groups.items()
    }

    summary = {
        "representative_count": config.otoc_representative_count,
        "settle_steps": config.otoc_settle_steps,
        "steps": config.otoc_steps,
        "sample_interval": config.otoc_sample_interval,
        "eps": config.otoc_eps,
        "distance_edges": distance_edges,
        "weak_growth_rate": results["weak_chaos"]["growth_rate_mean"],
        "strong_growth_rate": results["strong_chaos"]["growth_rate_mean"],
        "weak_scrambling_time": results["weak_chaos"]["scrambling_time_mean"],
        "strong_scrambling_time": results["strong_chaos"]["scrambling_time_mean"],
    }
    summary["strong_faster_growth"] = bool(
        np.isfinite(summary["weak_growth_rate"])
        and np.isfinite(summary["strong_growth_rate"])
        and summary["strong_growth_rate"] > summary["weak_growth_rate"]
    )
    summary["strong_earlier_scrambling"] = bool(
        np.isfinite(summary["weak_scrambling_time"])
        and np.isfinite(summary["strong_scrambling_time"])
        and summary["strong_scrambling_time"] < summary["weak_scrambling_time"]
    )
    return results, summary


def save_otoc_csv(results, output_path):
    region_names = ["weak_chaos", "strong_chaos"]
    bin_count = len(results[region_names[0]]["distance_bins"])
    fieldnames = [
        "region",
        "time",
        "average_all_otoc_mean",
        "average_all_otoc_std",
        "average_cross_otoc_mean",
        "average_cross_otoc_std",
        "self_otoc_mean",
        "self_otoc_std",
        "finite_time_lyapunov_mean",
        "finite_time_lyapunov_std",
    ]
    for bin_index in range(bin_count):
        fieldnames.extend(
            [
                f"distance_bin_{bin_index + 1}_low",
                f"distance_bin_{bin_index + 1}_high",
                f"distance_bin_{bin_index + 1}_mean",
                f"distance_bin_{bin_index + 1}_std",
            ]
        )

    with output_path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        for region_name in region_names:
            result = results[region_name]
            for index, time_value in enumerate(result["times"]):
                row = {
                    "region": region_name,
                    "time": float(time_value),
                    "average_all_otoc_mean": float(result["average_all_otoc_mean"][index]),
                    "average_all_otoc_std": float(result["average_all_otoc_std"][index]),
                    "average_cross_otoc_mean": float(result["average_cross_otoc_mean"][index]),
                    "average_cross_otoc_std": float(result["average_cross_otoc_std"][index]),
                    "self_otoc_mean": float(result["self_otoc_mean"][index]),
                    "self_otoc_std": float(result["self_otoc_std"][index]),
                    "finite_time_lyapunov_mean": float(result["finite_time_lyapunov_mean"][index]) if np.isfinite(result["finite_time_lyapunov_mean"][index]) else np.nan,
                    "finite_time_lyapunov_std": float(result["finite_time_lyapunov_std"][index]) if np.isfinite(result["finite_time_lyapunov_std"][index]) else np.nan,
                }
                for bin_index, distance_bin in enumerate(result["distance_bins"], start=1):
                    row[f"distance_bin_{bin_index}_low"] = float(distance_bin["distance_low"])
                    row[f"distance_bin_{bin_index}_high"] = float(distance_bin["distance_high"])
                    row[f"distance_bin_{bin_index}_mean"] = float(distance_bin["curve_mean"][index]) if np.isfinite(distance_bin["curve_mean"][index]) else np.nan
                    row[f"distance_bin_{bin_index}_std"] = float(distance_bin["curve_std"][index]) if np.isfinite(distance_bin["curve_std"][index]) else np.nan
                writer.writerow(row)


def run_entropy_production_experiment(records, system, config):
    results = {}
    for offset, region_name in enumerate(["weak_chaos", "strong_chaos"]):
        record = select_representative_record(records, region_name)
        initial_state = build_three_body_initial_state(
            config,
            outer_radius=record["outer_radius_0"],
            outer_speed_scale=record["outer_speed_scale_0"],
            outer_phase=record["outer_phase_0"],
        )
        center_state = advance_state(system, initial_state, dt=config.dt, steps=config.discard)
        times, snapshots = simulate_local_phase_cloud(
            system,
            center_state,
            dt=config.dt,
            steps=config.entropy_steps,
            sample_interval=config.entropy_sample_interval,
            ensemble_size=config.entropy_ensemble_size,
            position_spread=config.entropy_position_spread,
            velocity_spread=config.entropy_velocity_spread,
            rng=np.random.default_rng(config.entropy_seed + offset),
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
        bins_per_dim=config.entropy_phase_bins,
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
        "seed": config.entropy_seed,
        "settle_steps": config.discard,
        "entropy_steps": config.entropy_steps,
        "sample_interval": config.entropy_sample_interval,
        "ensemble_size": config.entropy_ensemble_size,
        "phase_bins_per_dim": config.entropy_phase_bins,
        "total_cells": total_cells,
        "position_spread": config.entropy_position_spread,
        "velocity_spread": config.entropy_velocity_spread,
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
    times = results["weak_chaos"]["times"]
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


def dominant_direction_label(net_directional_area, tolerance=1e-4):
    if not np.isfinite(net_directional_area) or abs(net_directional_area) <= tolerance:
        return "balanced"
    return "inner->outer" if net_directional_area > 0.0 else "outer->inner"


def format_representative_points(records):
    return ", ".join(f"(r2={record['outer_radius_0']:.3f}, v2={record['outer_speed_scale_0']:.3f})" for record in records)


def summarize_information_trials(trials):
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
        "te_forward",
        "te_backward",
        "excess_forward",
        "excess_backward",
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
    mi_trials = [trial["mi"] for trial in trials]
    te_trials = [trial["te"] for trial in trials]
    return {
        "records": [trial["record"] for trial in trials],
        "lyapunov_mean": float(np.mean([trial["record"]["Lyapunov_exponent"] for trial in trials])),
        "lyapunov_std": float(np.std([trial["record"]["Lyapunov_exponent"] for trial in trials])),
        "ks_mean": float(np.mean([trial["record"]["KS_entropy_Pesin"] for trial in trials])),
        "ks_std": float(np.std([trial["record"]["KS_entropy_Pesin"] for trial in trials])),
        "mi": summarize_trials(mi_trials, mi_curve_keys, mi_scalar_keys),
        "te": summarize_trials(te_trials, te_curve_keys, te_scalar_keys),
    }


def run_information_flow_experiment(records, system, config):
    results = {}
    for region_offset, region_name in enumerate(["weak_chaos", "strong_chaos"]):
        representative_records = select_representative_records(records, region_name, count=config.flow_representative_count)
        trials = []
        for trial_index, record in enumerate(representative_records):
            initial_state = build_three_body_initial_state(
                config,
                outer_radius=record["outer_radius_0"],
                outer_speed_scale=record["outer_speed_scale_0"],
                outer_phase=record["outer_phase_0"],
            )
            series = simulate_orbit_observables(system, initial_state, dt=config.dt, steps=config.flow_steps, discard=config.flow_discard)
            theta_inner = series["theta_inner"]
            theta_outer = series["theta_outer"]
            mi_seed = config.flow_seed + 100 * region_offset + trial_index
            te_seed = config.flow_seed + 1000 + 100 * region_offset + trial_index
            trials.append(
                {
                    "record": record,
                    "mi": lagged_mutual_information_curve(
                        theta_inner,
                        theta_outer,
                        dt=config.dt,
                        max_lag_steps=config.flow_max_lag_steps,
                        lag_stride=config.flow_lag_stride,
                        bins=config.flow_mi_bins,
                        baseline_shuffles=config.flow_mi_baseline_shuffles,
                        rng=np.random.default_rng(mi_seed),
                    ),
                    "te": lagged_transfer_entropy_curve(
                        theta_inner,
                        theta_outer,
                        dt=config.dt,
                        max_lag_steps=config.flow_max_lag_steps,
                        lag_stride=config.flow_lag_stride,
                        bins=config.flow_te_bins,
                        baseline_shuffles=config.flow_te_baseline_shuffles,
                        rng=np.random.default_rng(te_seed),
                    ),
                }
            )
        results[region_name] = summarize_information_trials(trials)
        results[region_name]["dt"] = config.dt

    weak_mi = results["weak_chaos"]["mi"]
    strong_mi = results["strong_chaos"]["mi"]
    weak_te = results["weak_chaos"]["te"]
    strong_te = results["strong_chaos"]["te"]
    weak_decay = weak_mi["post_peak_decay_time_mean"]
    strong_decay = strong_mi["post_peak_decay_time_mean"]
    summary = {
        "steps": config.flow_steps,
        "discard": config.flow_discard,
        "representative_count": config.flow_representative_count,
        "max_lag_steps": config.flow_max_lag_steps,
        "lag_stride": config.flow_lag_stride,
        "mi_bins": config.flow_mi_bins,
        "mi_baseline_shuffles": config.flow_mi_baseline_shuffles,
        "te_bins": config.flow_te_bins,
        "te_baseline_shuffles": config.flow_te_baseline_shuffles,
        "seed": config.flow_seed,
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


def save_information_flow_csv(results, output_path):
    lag_times = results["weak_chaos"]["mi"]["lag_times"]
    te_lag_times = results["weak_chaos"]["te"]["lag_times"]
    max_length = max(len(lag_times), len(te_lag_times))
    fieldnames = [
        "row_index",
        "mi_lag_time",
        "weak_mi_excess_mean",
        "weak_mi_excess_std",
        "strong_mi_excess_mean",
        "strong_mi_excess_std",
        "te_lag_time",
        "weak_te_total_mean",
        "weak_te_total_std",
        "strong_te_total_mean",
        "strong_te_total_std",
        "weak_te_net_mean",
        "strong_te_net_mean",
    ]
    with output_path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        for index in range(max_length):
            row = {"row_index": index}
            if index < len(lag_times):
                row["mi_lag_time"] = float(lag_times[index])
                row["weak_mi_excess_mean"] = float(results["weak_chaos"]["mi"]["excess_mean_mean"][index])
                row["weak_mi_excess_std"] = float(results["weak_chaos"]["mi"]["excess_mean_std"][index])
                row["strong_mi_excess_mean"] = float(results["strong_chaos"]["mi"]["excess_mean_mean"][index])
                row["strong_mi_excess_std"] = float(results["strong_chaos"]["mi"]["excess_mean_std"][index])
            if index < len(te_lag_times):
                row["te_lag_time"] = float(te_lag_times[index])
                row["weak_te_total_mean"] = float(results["weak_chaos"]["te"]["total_excess_mean"][index])
                row["weak_te_total_std"] = float(results["weak_chaos"]["te"]["total_excess_std"][index])
                row["strong_te_total_mean"] = float(results["strong_chaos"]["te"]["total_excess_mean"][index])
                row["strong_te_total_std"] = float(results["strong_chaos"]["te"]["total_excess_std"][index])
                row["weak_te_net_mean"] = float(results["weak_chaos"]["te"]["net_excess_mean"][index])
                row["strong_te_net_mean"] = float(results["strong_chaos"]["te"]["net_excess_mean"][index])
            writer.writerow(row)


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
    empirical_p_values = np.asarray(
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


def run_shuffle_surrogate_test(records, system, config):
    results = {}
    for region_offset, region_name in enumerate(["weak_chaos", "strong_chaos"]):
        representative_records = select_representative_records(records, region_name, count=config.flow_representative_count)
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
            initial_state = build_three_body_initial_state(
                config,
                outer_radius=record["outer_radius_0"],
                outer_speed_scale=record["outer_speed_scale_0"],
                outer_phase=record["outer_phase_0"],
            )
            series = simulate_orbit_observables(system, initial_state, dt=config.dt, steps=config.flow_steps, discard=config.flow_discard)
            theta_inner = series["theta_inner"]
            theta_outer = series["theta_outer"]
            actual_mi = lagged_mutual_information_curve(
                theta_inner,
                theta_outer,
                dt=config.dt,
                max_lag_steps=config.flow_max_lag_steps,
                lag_stride=config.flow_lag_stride,
                bins=config.flow_mi_bins,
                baseline_shuffles=config.flow_mi_baseline_shuffles,
                rng=np.random.default_rng(config.surrogate_seed + 100 * region_offset + trial_index),
            )
            actual_te = lagged_transfer_entropy_curve(
                theta_inner,
                theta_outer,
                dt=config.dt,
                max_lag_steps=config.flow_max_lag_steps,
                lag_stride=config.flow_lag_stride,
                bins=config.flow_te_bins,
                baseline_shuffles=config.flow_te_baseline_shuffles,
                rng=np.random.default_rng(config.surrogate_seed + 1000 + 100 * region_offset + trial_index),
            )
            actual_mi_curves.append(actual_mi["excess_mean"])
            actual_te_total_curves.append(actual_te["total_excess"])
            actual_mi_peaks.append(actual_mi["peak_excess_mi"])
            actual_mi_excess_areas.append(actual_mi["information_area"])
            actual_te_excess_areas.append(actual_te["total_transfer_area"])
            actual_te_directionality.append(actual_te["directionality_strength"])
            mi_lag_steps = actual_mi["lag_steps"]
            mi_lag_times = actual_mi["lag_times"]
            te_lag_steps = actual_te["lag_steps"]
            te_lag_times = actual_te["lag_times"]

            local_rng = np.random.default_rng(config.surrogate_seed + 10000 + 100 * region_offset + trial_index)
            mi_peak_row = []
            mi_area_row = []
            te_area_row = []
            te_directionality_row = []
            for _ in range(int(config.surrogate_trials)):
                shuffled_outer = local_rng.permutation(theta_outer)
                surrogate_mi = lagged_mutual_information_curve(
                    theta_inner,
                    shuffled_outer,
                    dt=config.dt,
                    max_lag_steps=config.flow_max_lag_steps,
                    lag_stride=config.flow_lag_stride,
                    bins=config.flow_mi_bins,
                    baseline_shuffles=config.flow_mi_baseline_shuffles,
                    rng=local_rng,
                )
                surrogate_te = lagged_transfer_entropy_curve(
                    theta_inner,
                    shuffled_outer,
                    dt=config.dt,
                    max_lag_steps=config.flow_max_lag_steps,
                    lag_stride=config.flow_lag_stride,
                    bins=config.flow_te_bins,
                    baseline_shuffles=config.flow_te_baseline_shuffles,
                    rng=local_rng,
                )
                surrogate_mi_curves.append(surrogate_mi["excess_mean"])
                surrogate_te_total_curves.append(surrogate_te["total_excess"])
                mi_peak_row.append(surrogate_mi["peak_excess_mi"])
                mi_area_row.append(surrogate_mi["information_area"])
                te_area_row.append(surrogate_te["total_transfer_area"])
                te_directionality_row.append(surrogate_te["directionality_strength"])

            surrogate_mi_peak_rows.append(mi_peak_row)
            surrogate_mi_excess_area_rows.append(mi_area_row)
            surrogate_te_excess_area_rows.append(te_area_row)
            surrogate_te_directionality_rows.append(te_directionality_row)

        results[region_name] = {
            "records": representative_records,
            "mi_curve": summarize_surrogate_curve_distribution(actual_mi_curves, surrogate_mi_curves, mi_lag_steps, mi_lag_times),
            "te_total_curve": summarize_surrogate_curve_distribution(actual_te_total_curves, surrogate_te_total_curves, te_lag_steps, te_lag_times),
            "mi_peak": summarize_surrogate_scalar_distribution(actual_mi_peaks, surrogate_mi_peak_rows),
            "mi_excess_area": summarize_surrogate_scalar_distribution(actual_mi_excess_areas, surrogate_mi_excess_area_rows),
            "te_excess_area": summarize_surrogate_scalar_distribution(actual_te_excess_areas, surrogate_te_excess_area_rows),
            "te_directionality_strength": summarize_surrogate_scalar_distribution(actual_te_directionality, surrogate_te_directionality_rows),
        }

    summary = {
        "representative_count": config.flow_representative_count,
        "surrogate_trials": config.surrogate_trials,
        "max_lag_steps": config.flow_max_lag_steps,
        "lag_stride": config.flow_lag_stride,
        "mi_bins": config.flow_mi_bins,
        "te_bins": config.flow_te_bins,
        "seed": config.surrogate_seed,
        "strong_mi_more_significant": bool(
            results["strong_chaos"]["mi_peak"]["actual_minus_surrogate_mean"]
            > results["weak_chaos"]["mi_peak"]["actual_minus_surrogate_mean"]
        ),
        "strong_te_more_significant": bool(
            results["strong_chaos"]["te_excess_area"]["actual_minus_surrogate_mean"]
            > results["weak_chaos"]["te_excess_area"]["actual_minus_surrogate_mean"]
        ),
    }
    return results, summary


def save_shuffle_surrogate_test_csv(results, output_path):
    rows = []
    for region_name, result in results.items():
        rows.append(
            {
                "region": region_name,
                "mi_peak_actual_mean": result["mi_peak"]["actual_mean"],
                "mi_peak_surrogate_mean": result["mi_peak"]["surrogate_mean"],
                "mi_excess_area_actual_mean": result["mi_excess_area"]["actual_mean"],
                "mi_excess_area_surrogate_mean": result["mi_excess_area"]["surrogate_mean"],
                "te_excess_area_actual_mean": result["te_excess_area"]["actual_mean"],
                "te_excess_area_surrogate_mean": result["te_excess_area"]["surrogate_mean"],
                "te_directionality_actual_mean": result["te_directionality_strength"]["actual_mean"],
                "te_directionality_surrogate_mean": result["te_directionality_strength"]["surrogate_mean"],
                "mi_curve_above_q95_fraction": result["mi_curve"]["actual_above_q95_fraction"],
                "te_curve_above_q95_fraction": result["te_total_curve"]["actual_above_q95_fraction"],
            }
        )

    with output_path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def _scatter_by_region(ax, records, key, title, ylabel):
    x_positions = {"weak_chaos": 0.0, "intermediate": 1.0, "strong_chaos": 2.0}
    colors = {"weak_chaos": "#3c7dc4", "intermediate": "#8a8f99", "strong_chaos": "#d05f3f"}
    for region_name in ["weak_chaos", "intermediate", "strong_chaos"]:
        subset = [record[key] for record in records if record["chaos_region"] == region_name]
        if not subset:
            continue
        x = np.full(len(subset), x_positions[region_name]) + np.linspace(-0.12, 0.12, len(subset))
        ax.scatter(x, subset, s=34, color=colors[region_name], alpha=0.8, edgecolor="white", linewidth=0.4)
        ax.hlines(np.mean(subset), x_positions[region_name] - 0.18, x_positions[region_name] + 0.18, color=colors[region_name], linewidth=2.0)
    ax.set_xticks([0.0, 1.0, 2.0], ["weak", "mid", "strong"])
    ax.set_title(title)
    ax.set_ylabel(ylabel)
    ax.grid(alpha=0.25)


def plot_chaos_complexity(records, outer_radius_values, outer_speed_scale_values, lyap_grid, thresholds, output_path):
    fig, axes = plt.subplots(2, 2, figsize=(13, 9), constrained_layout=True)
    extent = [outer_radius_values[0], outer_radius_values[-1], outer_speed_scale_values[0], outer_speed_scale_values[-1]]
    image = axes[0, 0].imshow(lyap_grid, origin="lower", aspect="auto", extent=extent, cmap="magma")
    axes[0, 0].set_title("Lyapunov map across outer orbit parameters")
    axes[0, 0].set_xlabel("outer radius r2(0)")
    axes[0, 0].set_ylabel("outer speed scale v2 / v_circ")
    fig.colorbar(image, ax=axes[0, 0], label="lambda_1")
    axes[0, 0].text(
        0.02,
        0.96,
        f"weak <= {thresholds['weak_cut']:.3f}\nstrong >= {thresholds['strong_cut']:.3f}\nrule: {thresholds['strategy']}",
        transform=axes[0, 0].transAxes,
        va="top",
        ha="left",
        fontsize=10,
        bbox={"facecolor": "white", "alpha": 0.85, "edgecolor": "none"},
    )
    _scatter_by_region(axes[0, 1], records, "LZMA_ratio", "Compression complexity", "LZMA ratio")
    _scatter_by_region(axes[1, 0], records, "Lempel_Ziv_complexity", "Binary Lempel-Ziv complexity", "LZ complexity")
    _scatter_by_region(axes[1, 1], records, "Permutation_entropy", "Permutation entropy", "normalized H")
    fig.savefig(output_path, dpi=180)
    plt.close(fig)


def plot_lyapunov_metric_scatter(records, output_path):
    fig, axes = plt.subplots(1, 3, figsize=(14, 4.6), constrained_layout=True)
    metric_labels = [
        ("LZMA_ratio", "LZMA ratio"),
        ("Lempel_Ziv_complexity", "Lempel-Ziv complexity"),
        ("Permutation_entropy", "Permutation entropy"),
    ]
    correlations = {}
    colors = {"weak_chaos": "#3c7dc4", "intermediate": "#8a8f99", "strong_chaos": "#d05f3f", "near_regular": "#6f8d4e"}
    for ax, (metric_key, label) in zip(axes, metric_labels):
        x = np.asarray([record["Lyapunov_exponent"] for record in records], dtype=float)
        y = np.asarray([record[metric_key] for record in records], dtype=float)
        correlations[metric_key] = pearson_correlation(records, "Lyapunov_exponent", metric_key)
        for region_name in sorted({record["chaos_region"] for record in records}):
            subset = [record for record in records if record["chaos_region"] == region_name]
            ax.scatter(
                [record["Lyapunov_exponent"] for record in subset],
                [record[metric_key] for record in subset],
                s=38,
                alpha=0.82,
                color=colors.get(region_name, "#4f5966"),
                label=region_name,
            )
        ax.set_xlabel("Lyapunov exponent")
        ax.set_ylabel(label)
        ax.set_title(f"r = {correlations[metric_key]:.3f}")
        ax.grid(alpha=0.25)
    axes[0].legend(frameon=False, fontsize=8)
    fig.savefig(output_path, dpi=180)
    plt.close(fig)
    return correlations


def plot_ks_pesin_comparison(records, outer_radius_values, outer_speed_scale_values, ks_grid, output_path):
    fig, axes = plt.subplots(1, 2, figsize=(13, 4.8), constrained_layout=True)
    extent = [outer_radius_values[0], outer_radius_values[-1], outer_speed_scale_values[0], outer_speed_scale_values[-1]]
    image = axes[0].imshow(ks_grid, origin="lower", aspect="auto", extent=extent, cmap="viridis")
    axes[0].set_title("KS entropy estimate over parameter grid")
    axes[0].set_xlabel("outer radius r2(0)")
    axes[0].set_ylabel("outer speed scale v2 / v_circ")
    fig.colorbar(image, ax=axes[0], label="h_KS")
    x = np.asarray([record["Lyapunov_exponent"] for record in records], dtype=float)
    y = np.asarray([record["KS_entropy_Pesin"] for record in records], dtype=float)
    axes[1].scatter(x, y, s=38, color="#2f6f6d", alpha=0.85)
    low = min(float(np.min(x)), float(np.min(y)))
    high = max(float(np.max(x)), float(np.max(y)))
    axes[1].plot([low, high], [low, high], linestyle="--", color="#bb5e45", linewidth=1.4)
    axes[1].set_xlabel("lambda_1")
    axes[1].set_ylabel("h_KS (sum of positive exponents)")
    axes[1].set_title(f"corr = {pearson_correlation(records, 'Lyapunov_exponent', 'KS_entropy_Pesin'):.3f}")
    axes[1].grid(alpha=0.25)
    fig.savefig(output_path, dpi=180)
    plt.close(fig)


def plot_noise_comparison(records, noise_records, output_path):
    fig, axes = plt.subplots(1, 3, figsize=(14, 4.8), constrained_layout=True)
    metrics = ["LZMA_ratio", "Lempel_Ziv_complexity", "Permutation_entropy"]
    for ax, key in zip(axes, metrics):
        weak_chaos = [record[key] for record in records if record["chaos_region"] == "weak_chaos"]
        strong_chaos = [record[key] for record in records if record["chaos_region"] == "strong_chaos"]
        weak_noise = [record[key] for record in noise_records if record["source_region"] == "weak_chaos"]
        strong_noise = [record[key] for record in noise_records if record["source_region"] == "strong_chaos"]
        ax.boxplot([weak_chaos, weak_noise, strong_chaos, strong_noise], tick_labels=["weak", "noise|weak", "strong", "noise|strong"], widths=0.65)
        ax.set_title(key.replace("_", " "))
        ax.grid(alpha=0.22)
        ax.tick_params(axis="x", rotation=18)
    fig.savefig(output_path, dpi=180)
    plt.close(fig)


def plot_coarse_graining_dependence(summary_rows, robustness, output_path):
    bins = np.asarray([row["bins"] for row in summary_rows], dtype=float)
    fig, axes = plt.subplots(1, 2, figsize=(13, 4.8), constrained_layout=True)
    for group_name, color in [("weak_chaos", "#3c7dc4"), ("strong_chaos", "#d05f3f"), ("weak_noise", "#79a8d8"), ("strong_noise", "#efb19d")]:
        means = np.asarray([row[f"{group_name}_mean"] for row in summary_rows], dtype=float)
        stds = np.asarray([row[f"{group_name}_std"] for row in summary_rows], dtype=float)
        axes[0].plot(bins, means, marker="o", label=group_name, color=color)
        axes[0].fill_between(bins, means - stds, means + stds, alpha=0.18, color=color)
    axes[0].set_xscale("log", base=2)
    axes[0].set_xlabel("quantization bins")
    axes[0].set_ylabel("LZMA ratio")
    axes[0].set_title("Compression complexity vs coarse graining")
    axes[0].legend(frameon=False, fontsize=8)
    axes[0].grid(alpha=0.25)

    weak_delta = np.asarray([row["weak_noise_minus_chaos_mean"] for row in summary_rows], dtype=float)
    strong_delta = np.asarray([row["strong_noise_minus_chaos_mean"] for row in summary_rows], dtype=float)
    axes[1].plot(bins, weak_delta, marker="o", color="#4a74b7", label="noise - weak chaos")
    axes[1].plot(bins, strong_delta, marker="o", color="#c15c39", label="noise - strong chaos")
    axes[1].axhline(0.0, color="#666666", linestyle="--", linewidth=1.0)
    axes[1].set_xscale("log", base=2)
    axes[1].set_xlabel("quantization bins")
    axes[1].set_ylabel("delta LZMA ratio")
    axes[1].set_title(robustness["verdict"])
    axes[1].legend(frameon=False, fontsize=8)
    axes[1].grid(alpha=0.25)
    fig.savefig(output_path, dpi=180)
    plt.close(fig)


def plot_entropy_production(results, summary, output_path):
    fig, axes = plt.subplots(1, 2, figsize=(13, 4.8), constrained_layout=True)
    for region_name, color in [("weak_chaos", "#3c7dc4"), ("strong_chaos", "#d05f3f")]:
        axes[0].plot(results[region_name]["times"], results[region_name]["normalized_entropy"], color=color, linewidth=2.0, label=region_name)
        axes[1].plot(results[region_name]["times"], results[region_name]["occupied_cells"], color=color, linewidth=2.0, label=region_name)
        axes[0].text(
            0.03,
            0.94 if region_name == "weak_chaos" else 0.84,
            f"{region_name}: slope={results[region_name]['slope']:.4f}",
            transform=axes[0].transAxes,
            color=color,
            va="top",
        )
    axes[0].set_xlabel("time")
    axes[0].set_ylabel("normalized entropy")
    axes[0].set_title("Reduced phase-space entropy growth")
    axes[0].grid(alpha=0.25)
    axes[1].set_xlabel("time")
    axes[1].set_ylabel("occupied cells")
    axes[1].set_title(f"strong/weak slope ratio = {summary['slope_ratio_strong_to_weak']:.2f}")
    axes[1].grid(alpha=0.25)
    axes[0].legend(frameon=False)
    axes[1].legend(frameon=False)
    fig.savefig(output_path, dpi=180)
    plt.close(fig)


def plot_otoc_experiment(results, summary, output_path):
    fig, axes = plt.subplots(2, 2, figsize=(14, 9), constrained_layout=True)
    region_colors = {"weak_chaos": "#3c7dc4", "strong_chaos": "#d05f3f"}
    weak_palette = ["#3c7dc4", "#6a9cce", "#9cbde0"]
    strong_palette = ["#d05f3f", "#e18b69", "#efb39a"]

    for region_name in ["weak_chaos", "strong_chaos"]:
        color = region_colors[region_name]
        result = results[region_name]
        times = result["times"]
        cross_mean = np.maximum(result["average_cross_otoc_mean"], 1e-20)
        cross_lower = np.maximum(result["average_cross_otoc_mean"] - result["average_cross_otoc_std"], 1e-20)
        cross_upper = np.maximum(result["average_cross_otoc_mean"] + result["average_cross_otoc_std"], 1e-20)
        axes[0, 0].semilogy(times, cross_mean, color=color, linewidth=2.2, label=region_name)
        axes[0, 0].fill_between(times, cross_lower, cross_upper, color=color, alpha=0.18)

        lambda_mean = result["finite_time_lyapunov_mean"]
        lambda_std = result["finite_time_lyapunov_std"]
        axes[0, 1].plot(times, lambda_mean, color=color, linewidth=2.2, label=f"{region_name} from OTOC")
        axes[0, 1].fill_between(times, lambda_mean - lambda_std, lambda_mean + lambda_std, color=color, alpha=0.18)
        axes[0, 1].axhline(result["lyapunov_mean"], linestyle="--", color=color, linewidth=1.4, alpha=0.7)

    axes[0, 0].set_title("Average cross-body OTOC")
    axes[0, 0].set_xlabel("time")
    axes[0, 0].set_ylabel(r"$\bar C_{\mathrm{cross}}(t)$")
    axes[0, 0].grid(alpha=0.25)
    axes[0, 0].legend(frameon=False)
    axes[0, 0].text(
        0.03,
        0.05,
        f"strong faster growth: {summary['strong_faster_growth']}\nstrong earlier scrambling: {summary['strong_earlier_scrambling']}",
        transform=axes[0, 0].transAxes,
        va="bottom",
        ha="left",
        fontsize=9,
        bbox={"facecolor": "white", "alpha": 0.82, "edgecolor": "none"},
    )

    axes[0, 1].set_title("Finite-time Lyapunov from OTOC")
    axes[0, 1].set_xlabel("time")
    axes[0, 1].set_ylabel(r"$\lambda_{\mathrm{OTOC}}(t)$")
    axes[0, 1].grid(alpha=0.25)
    axes[0, 1].legend(frameon=False, fontsize=8)

    for ax, region_name, palette in [
        (axes[1, 0], "weak_chaos", weak_palette),
        (axes[1, 1], "strong_chaos", strong_palette),
    ]:
        result = results[region_name]
        times = result["times"]
        for color, distance_bin in zip(palette, result["distance_bins"]):
            curve_mean = np.maximum(distance_bin["curve_mean"], 1e-20)
            curve_lower = np.maximum(distance_bin["curve_mean"] - distance_bin["curve_std"], 1e-20)
            curve_upper = np.maximum(distance_bin["curve_mean"] + distance_bin["curve_std"], 1e-20)
            ax.semilogy(times, curve_mean, color=color, linewidth=2.0, label=distance_bin["label"])
            ax.fill_between(times, curve_lower, curve_upper, color=color, alpha=0.16)
        ax.set_title(f"Distance-resolved OTOC: {region_name}")
        ax.set_xlabel("time")
        ax.set_ylabel(r"$C(r,t)$")
        ax.grid(alpha=0.25)
        ax.legend(frameon=False, fontsize=8)

    fig.savefig(output_path, dpi=180)
    plt.close(fig)


def plot_mutual_information_decay(results, summary, output_path):
    fig, axes = plt.subplots(1, 3, figsize=(15, 4.8), constrained_layout=True)
    for region_name, color in [("weak_chaos", "#3c7dc4"), ("strong_chaos", "#d05f3f")]:
        mi = results[region_name]["mi"]
        te = results[region_name]["te"]
        lag_times = mi["lag_times"]
        te_times = te["lag_times"]
        axes[0].plot(lag_times, mi["excess_mean_mean"], color=color, linewidth=2.0, label=region_name)
        axes[0].fill_between(lag_times, mi["excess_mean_mean"] - mi["excess_mean_std"], mi["excess_mean_mean"] + mi["excess_mean_std"], color=color, alpha=0.18)
        axes[1].plot(te_times, te["total_excess_mean"], color=color, linewidth=2.0, label=region_name)
        axes[1].fill_between(te_times, te["total_excess_mean"] - te["total_excess_std"], te["total_excess_mean"] + te["total_excess_std"], color=color, alpha=0.18)
        axes[2].plot(te_times, te["net_excess_mean"], color=color, linewidth=2.0, label=region_name)
        axes[2].fill_between(te_times, te["net_excess_mean"] - te["net_excess_std"], te["net_excess_mean"] + te["net_excess_std"], color=color, alpha=0.18)
    axes[0].set_title("Excess mutual information")
    axes[1].set_title("Total transfer entropy")
    axes[2].set_title("Net directional transfer")
    for ax in axes:
        ax.set_xlabel("lag time")
        ax.grid(alpha=0.25)
    axes[0].set_ylabel("information")
    axes[1].set_ylabel("information")
    axes[2].set_ylabel("directional excess")
    axes[0].legend(frameon=False)
    fig.savefig(output_path, dpi=180)
    plt.close(fig)


def plot_shuffle_surrogate_test(results, summary, output_path):
    fig, axes = plt.subplots(2, 2, figsize=(13, 9), constrained_layout=True)
    for ax, region_name, color in [(axes[0, 0], "weak_chaos", "#3c7dc4"), (axes[0, 1], "strong_chaos", "#d05f3f")]:
        mi_curve = results[region_name]["mi_curve"]
        ax.plot(mi_curve["lag_times"], mi_curve["actual_mean"], color=color, linewidth=2.0, label="actual")
        ax.plot(mi_curve["lag_times"], mi_curve["surrogate_mean"], color="#666666", linewidth=1.6, label="shuffle mean")
        ax.fill_between(mi_curve["lag_times"], mi_curve["surrogate_q05"], mi_curve["surrogate_q95"], color="#999999", alpha=0.2, label="shuffle q05-q95")
        ax.set_title(f"MI surrogate test: {region_name}")
        ax.set_xlabel("lag time")
        ax.set_ylabel("excess MI")
        ax.grid(alpha=0.25)
        ax.legend(frameon=False, fontsize=8)

    labels = ["weak_chaos", "strong_chaos"]
    x = np.arange(len(labels))
    width = 0.34
    mi_actual = [results[label]["mi_peak"]["actual_mean"] for label in labels]
    mi_surrogate = [results[label]["mi_peak"]["surrogate_mean"] for label in labels]
    te_actual = [results[label]["te_excess_area"]["actual_mean"] for label in labels]
    te_surrogate = [results[label]["te_excess_area"]["surrogate_mean"] for label in labels]
    axes[1, 0].bar(x - width / 2, mi_actual, width=width, color="#4a79bf", label="actual")
    axes[1, 0].bar(x + width / 2, mi_surrogate, width=width, color="#aeb3ba", label="shuffle")
    axes[1, 0].set_xticks(x, labels)
    axes[1, 0].set_title("MI peak vs shuffle baseline")
    axes[1, 0].grid(alpha=0.25, axis="y")
    axes[1, 0].legend(frameon=False)
    axes[1, 1].bar(x - width / 2, te_actual, width=width, color="#c96544", label="actual")
    axes[1, 1].bar(x + width / 2, te_surrogate, width=width, color="#b8b8b8", label="shuffle")
    axes[1, 1].set_xticks(x, labels)
    axes[1, 1].set_title("TE excess area vs shuffle baseline")
    axes[1, 1].grid(alpha=0.25, axis="y")
    axes[1, 1].legend(frameon=False)
    fig.savefig(output_path, dpi=180)
    plt.close(fig)


def build_summary_lines(
    config,
    device_label,
    thresholds,
    records,
    weak_summary,
    strong_summary,
    noise_records,
    weak_noise_summary,
    strong_noise_summary,
    overall_noise_summary,
    weak_separation,
    strong_separation,
    overall_separation,
    coarse_summary_rows,
    coarse_robustness,
    entropy_results,
    entropy_summary,
    otoc_results,
    otoc_summary,
    information_results,
    information_summary,
    surrogate_results,
    surrogate_summary,
    correlations,
):
    lines = []
    spectrum_keys = lyapunov_component_keys(records[0]) if records else []
    mean_spectrum = [float(np.mean([record[key] for record in records])) for key in spectrum_keys]
    ks_values = np.asarray([record["KS_entropy_Pesin"] for record in records], dtype=float)
    pesin_gaps = np.asarray([record["Pesin_gap_lambda1"] for record in records], dtype=float)

    lines.append("=== Planar 3-body gravitational system: chaos and complexity ===")
    lines.append(f"device                   : {device_label}")
    lines.append(f"samples                  : {len(records)}")
    lines.append(f"integration dt           : {config.dt}")
    lines.append(f"Lyapunov steps/discard   : {config.steps}/{config.discard}")
    lines.append(f"Benettin renorm steps    : {config.renorm_steps}")
    lines.append(f"weak-chaos threshold     : <= {thresholds['weak_cut']:.4f}")
    lines.append(f"strong-chaos threshold   : >= {thresholds['strong_cut']:.4f}")
    lines.append(f"classification strategy  : {thresholds['strategy']}")
    lines.append("mean Lyapunov spectrum   : " + ", ".join(f"{value:.4f}" for value in mean_spectrum))
    lines.append(f"mean KS entropy (Pesin)  : {np.mean(ks_values):.4f} +/- {np.std(ks_values):.4f}")
    lines.append(f"mean h_KS - lambda_1     : {np.mean(pesin_gaps):.4e} +/- {np.std(pesin_gaps):.4e}")

    for region_name, summary in [("weak_chaos", weak_summary), ("strong_chaos", strong_summary)]:
        lines.append("")
        lines.append(f"[{region_name}] n = {summary['count']}")
        lines.append(f"Lyapunov exponent        : {summary['Lyapunov_exponent']:.4f} +/- {summary['Lyapunov_exponent_std']:.4f}")
        lines.append(f"KS entropy (Pesin)       : {summary['KS_entropy_Pesin']:.4f} +/- {summary['KS_entropy_Pesin_std']:.4f}")
        lines.append(f"LZMA ratio               : {summary['LZMA_ratio']:.4f} +/- {summary['LZMA_ratio_std']:.4f}")
        lines.append(f"Lempel-Ziv complexity    : {summary['Lempel_Ziv_complexity']:.4f} +/- {summary['Lempel_Ziv_complexity_std']:.4f}")
        lines.append(f"Permutation entropy      : {summary['Permutation_entropy']:.4f} +/- {summary['Permutation_entropy_std']:.4f}")

    lines.append("")
    lines.append("=== Correlation: Lyapunov exponent vs complexity ===")
    lines.append(f"Lyapunov vs LZMA ratio            : r = {correlations['LZMA_ratio']:.4f}")
    lines.append(f"Lyapunov vs Lempel-Ziv complexity : r = {correlations['Lempel_Ziv_complexity']:.4f}")
    lines.append(f"Lyapunov vs Permutation entropy   : r = {correlations['Permutation_entropy']:.4f}")
    lines.append(f"Lyapunov vs KS entropy (Pesin)    : r = {pearson_correlation(records, 'Lyapunov_exponent', 'KS_entropy_Pesin'):.4f}")

    lines.append("")
    lines.append("=== Random noise comparison ===")
    lines.append(f"noise trials per orbit    : {config.noise_trials}")
    lines.append(f"all noise permutation H   : {overall_noise_summary['Permutation_entropy']:.4f} +/- {overall_noise_summary['Permutation_entropy_std']:.4f}")
    lines.append(f"all noise - chaos delta H : {overall_separation['mean_delta']:.4f} +/- {overall_separation['std_delta']:.4f}")
    lines.append(f"noise > chaos share       : {overall_separation['positive_fraction']:.1%}")
    lines.append(f"weak noise permutation H  : {weak_noise_summary['Permutation_entropy']:.4f} +/- {weak_noise_summary['Permutation_entropy_std']:.4f}")
    lines.append(f"strong noise permutation H: {strong_noise_summary['Permutation_entropy']:.4f} +/- {strong_noise_summary['Permutation_entropy_std']:.4f}")
    lines.append(f"weak minimum delta        : {weak_separation['min_delta']:.4f}")
    lines.append(f"strong minimum delta      : {strong_separation['min_delta']:.4f}")

    lines.append("")
    lines.append("=== Coarse-graining dependence ===")
    lines.append("tested bins               : " + ", ".join(str(value) for value in config.coarse_bins))
    for row in coarse_summary_rows:
        lines.append(
            f"bins = {row['bins']:>3d} | weak {row['weak_chaos_mean']:.4f} | strong {row['strong_chaos_mean']:.4f} "
            f"| noise|weak {row['weak_noise_mean']:.4f} | noise|strong {row['strong_noise_mean']:.4f}"
        )
    lines.append(f"verdict                   : {coarse_robustness['verdict']}")

    lines.append("")
    lines.append("=== Coarse-grained entropy production ===")
    lines.append(f"reduced phase partition   : {config.entropy_phase_bins}^4 ({entropy_summary['total_cells']} cells)")
    lines.append(f"ensemble size             : {config.entropy_ensemble_size}")
    for region_name in ["weak_chaos", "strong_chaos"]:
        result = entropy_results[region_name]
        record = result["record"]
        lines.append(
            f"{region_name}: r2={record['outer_radius_0']:.3f}, v2={record['outer_speed_scale_0']:.3f}, "
            f"lambda_1={record['Lyapunov_exponent']:.4f}, dS/dt={result['slope']:.4f}, gain={result['entropy_gain']:.4f}"
        )
    lines.append(f"strong / weak slope ratio : {entropy_summary['slope_ratio_strong_to_weak']:.2f}")

    lines.append("")
    lines.append("=== Classical OTOC scrambling ===")
    lines.append(f"representatives / region  : {config.otoc_representative_count}")
    lines.append(f"settle steps              : {config.otoc_settle_steps}")
    lines.append(f"OTOC steps/sample         : {config.otoc_steps} / {config.otoc_sample_interval}")
    lines.append(f"finite-difference eps     : {config.otoc_eps:.1e}")
    for region_name in ["weak_chaos", "strong_chaos"]:
        result = otoc_results[region_name]
        lines.append(f"{region_name}: {format_representative_points(result['records'])}")
        lines.append(f"  peak cross OTOC         : {result['peak_cross_otoc_mean']:.4e} +/- {result['peak_cross_otoc_std']:.4e}")
        lines.append(f"  lambda_OTOC             : {result['growth_rate_mean']:.4f} +/- {result['growth_rate_std']:.4f}")
        lines.append(f"  scrambling time         : {result['scrambling_time_mean']:.4f} +/- {result['scrambling_time_std']:.4f}")
        lines.append(f"  late cross OTOC         : {result['late_cross_otoc_mean']:.4e} +/- {result['late_cross_otoc_std']:.4e}")
        lines.append(
            "  distance-bin finals     : "
            + "; ".join(f"{distance_bin['label']} -> {distance_bin['final_mean']:.4e}" for distance_bin in result['distance_bins'])
        )
    lines.append(f"strong faster OTOC growth : {otoc_summary['strong_faster_growth']}")
    lines.append(f"strong earlier scrambling : {otoc_summary['strong_earlier_scrambling']}")

    lines.append("")
    lines.append("=== Information flow across representative orbits ===")
    lines.append(f"representatives / region  : {config.flow_representative_count}")
    for region_name in ["weak_chaos", "strong_chaos"]:
        result = information_results[region_name]
        mi_region = result["mi"]
        te_region = result["te"]
        lines.append(f"{region_name}: {format_representative_points(result['records'])}")
        lines.append(f"  MI peak lag             : {mi_region['peak_time_mean']:.4f} +/- {mi_region['peak_time_std']:.4f}")
        lines.append(f"  MI peak excess          : {mi_region['peak_excess_mi_mean']:.4f} +/- {mi_region['peak_excess_mi_std']:.4f}")
        lines.append(f"  MI area                 : {mi_region['information_area_mean']:.4f} +/- {mi_region['information_area_std']:.4f}")
        lines.append(f"  TE total area           : {te_region['total_transfer_area_mean']:.4f} +/- {te_region['total_transfer_area_std']:.4f}")
        lines.append(f"  TE net directional area : {te_region['net_directional_area_mean']:.4f} +/- {te_region['net_directional_area_std']:.4f}")
        lines.append(f"  dominant direction      : {dominant_direction_label(te_region['net_directional_area_mean'])}")
    lines.append(f"strong earlier MI peak    : {information_summary['strong_earlier_peak']}")
    lines.append(f"strong smaller MI area    : {information_summary['strong_smaller_mi_area']}")
    lines.append(f"strong more directional   : {information_summary['strong_more_directional']}")

    lines.append("")
    lines.append("=== Shuffle surrogate test ===")
    lines.append(f"surrogates / orbit        : {config.surrogate_trials}")
    for region_name in ["weak_chaos", "strong_chaos"]:
        result = surrogate_results[region_name]
        lines.append(
            f"{region_name}: MI peak actual/shuffle = {result['mi_peak']['actual_mean']:.4f}/{result['mi_peak']['surrogate_mean']:.4f}, "
            f"TE area actual/shuffle = {result['te_excess_area']['actual_mean']:.4f}/{result['te_excess_area']['surrogate_mean']:.4f}"
        )
    lines.append(f"strong MI more significant: {surrogate_summary['strong_mi_more_significant']}")
    lines.append(f"strong TE more significant: {surrogate_summary['strong_te_more_significant']}")
    return lines


def parse_args():
    parser = argparse.ArgumentParser(description="Run chaos-complexity experiments on a planar 3-body gravitational system")
    parser.add_argument("--quick", action="store_true", help="Run a smaller smoke-test configuration")
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto", help="PyTorch device selection")
    parser.add_argument("--output-dir", default=None, help="Directory to write CSV/PNG outputs")
    return parser.parse_args()


def main():
    args = parse_args()
    config = make_config(quick=args.quick)
    device = select_device(args.device)
    device_label = describe_device(device)
    torch.manual_seed(config.flow_seed)
    np.random.seed(config.flow_seed)

    base_dir = Path(args.output_dir) if args.output_dir else Path(__file__).resolve().parent
    base_dir.mkdir(parents=True, exist_ok=True)

    system = PlanarNBodySystem(config.masses, device=device, softening=config.softening)

    figure_path = base_dir / "n_body_chaos_complexity.png"
    scatter_figure_path = base_dir / "n_body_lyapunov_scatter.png"
    ks_figure_path = base_dir / "n_body_ks_pesin.png"
    csv_path = base_dir / "n_body_chaos_complexity.csv"
    noise_csv_path = base_dir / "n_body_noise_comparison.csv"
    noise_figure_path = base_dir / "n_body_noise_comparison.png"
    coarse_csv_path = base_dir / "n_body_coarse_graining.csv"
    coarse_figure_path = base_dir / "n_body_coarse_graining.png"
    entropy_csv_path = base_dir / "n_body_entropy_production.csv"
    entropy_figure_path = base_dir / "n_body_entropy_production.png"
    otoc_csv_path = base_dir / "n_body_otoc.csv"
    otoc_figure_path = base_dir / "n_body_otoc.png"
    information_flow_csv_path = base_dir / "n_body_information_flow.csv"
    information_flow_figure_path = base_dir / "n_body_information_flow.png"
    surrogate_test_csv_path = base_dir / "n_body_shuffle_surrogate_test.csv"
    surrogate_test_figure_path = base_dir / "n_body_shuffle_surrogate_test.png"
    summary_path = base_dir / "n_body_run_summary.txt"

    records, lyap_grid, ks_grid, sampled_series = scan_planar_three_body_grid(system, config)
    thresholds = label_chaos_regions(records, positive_floor=0.01)
    weak_summary = summarize_region(records, "weak_chaos")
    strong_summary = summarize_region(records, "strong_chaos")

    noise_records = compare_chaos_to_random_noise(
        records,
        sampled_series,
        source_regions={"weak_chaos", "strong_chaos"},
        trials_per_series=config.noise_trials,
        seed=config.noise_seed,
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
        bin_values=config.coarse_bins,
        noise_trials=config.noise_trials,
        seed=config.coarse_seed,
    )
    coarse_summary_rows = summarize_coarse_graining(coarse_group_rows, coarse_delta_rows, config.coarse_bins)
    coarse_robustness = assess_coarse_graining_robustness(coarse_summary_rows)

    entropy_results, entropy_summary = run_entropy_production_experiment(records, system, config)
    otoc_results, otoc_summary = run_otoc_experiment(records, system, config)
    information_results, information_summary = run_information_flow_experiment(records, system, config)
    surrogate_results, surrogate_summary = run_shuffle_surrogate_test(records, system, config)

    save_records_csv(records, csv_path)
    save_noise_records_csv(noise_records, noise_csv_path)
    save_coarse_graining_summary_csv(coarse_summary_rows, coarse_csv_path)
    save_entropy_production_csv(entropy_results, entropy_csv_path)
    save_otoc_csv(otoc_results, otoc_csv_path)
    save_information_flow_csv(information_results, information_flow_csv_path)
    save_shuffle_surrogate_test_csv(surrogate_results, surrogate_test_csv_path)

    plot_chaos_complexity(records, config.outer_radius_values, config.outer_speed_scale_values, lyap_grid, thresholds, figure_path)
    correlations = plot_lyapunov_metric_scatter(records, scatter_figure_path)
    plot_ks_pesin_comparison(records, config.outer_radius_values, config.outer_speed_scale_values, ks_grid, ks_figure_path)
    plot_noise_comparison(records, noise_records, noise_figure_path)
    plot_coarse_graining_dependence(coarse_summary_rows, coarse_robustness, coarse_figure_path)
    plot_entropy_production(entropy_results, entropy_summary, entropy_figure_path)
    plot_otoc_experiment(otoc_results, otoc_summary, otoc_figure_path)
    plot_mutual_information_decay(information_results, information_summary, information_flow_figure_path)
    plot_shuffle_surrogate_test(surrogate_results, surrogate_summary, surrogate_test_figure_path)

    summary_lines = build_summary_lines(
        config,
        device_label,
        thresholds,
        records,
        weak_summary,
        strong_summary,
        noise_records,
        weak_noise_summary,
        strong_noise_summary,
        overall_noise_summary,
        weak_separation,
        strong_separation,
        overall_separation,
        coarse_summary_rows,
        coarse_robustness,
        entropy_results,
        entropy_summary,
        otoc_results,
        otoc_summary,
        information_results,
        information_summary,
        surrogate_results,
        surrogate_summary,
        correlations,
    )
    summary_lines.extend(
        [
            "",
            f"Saved figure: {figure_path}",
            f"Saved scatter: {scatter_figure_path}",
            f"Saved KS plot: {ks_figure_path}",
            f"Saved noise plot: {noise_figure_path}",
            f"Saved coarse plot: {coarse_figure_path}",
            f"Saved entropy plot: {entropy_figure_path}",
            f"Saved OTOC plot: {otoc_figure_path}",
            f"Saved information-flow plot: {information_flow_figure_path}",
            f"Saved surrogate plot: {surrogate_test_figure_path}",
            f"Saved table: {csv_path}",
            f"Saved noise table: {noise_csv_path}",
            f"Saved coarse table: {coarse_csv_path}",
            f"Saved entropy table: {entropy_csv_path}",
            f"Saved OTOC table: {otoc_csv_path}",
            f"Saved information-flow table: {information_flow_csv_path}",
            f"Saved surrogate table: {surrogate_test_csv_path}",
            f"Saved summary: {summary_path}",
        ]
    )
    summary_path.write_text("\n".join(summary_lines) + "\n", encoding="utf-8")
    print("\n".join(summary_lines))


if __name__ == "__main__":
    main()