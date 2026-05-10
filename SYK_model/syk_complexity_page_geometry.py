"""
syk_complexity_page_geometry_pytorch.py

PyTorch verification script for:

A) SYK-like effective model and OTOC comparison
B) Complexity growth / Susskind-style circuit-complexity proxy
C) Page-curve-like analysis / information recovery
D) Tensor-network style transport graph ↔ geometry analysis
E) Emergent metric from TE network

This is designed as a research prototype, not an exact full SYK solver.
It uses small Hilbert spaces, exact diagonalization, random Majorana-like operators,
and graph/geometric diagnostics. For exact large-N SYK, replace build_syk_like_hamiltonian()
with a true Majorana/Jordan-Wigner construction.

Run:
    python syk_complexity_page_geometry_pytorch.py --out results --cuda

Main outputs:
    results/analysis_results.json
    results/otoc_comparison.png
    results/complexity_growth.png
    results/page_curve.png
    results/emergent_metric.png

Dependencies:
    pip install torch numpy matplotlib networkx scipy
Optional:
    pip install scikit-learn
"""

from __future__ import annotations

import argparse
import json
import math
import os
from dataclasses import dataclass, asdict
from typing import Dict, List, Tuple, Optional, Any

import numpy as np
import torch

try:
    import matplotlib.pyplot as plt
except Exception:
    plt = None

try:
    import networkx as nx
except Exception:
    nx = None

try:
    from scipy.spatial.distance import pdist, squareform
    from scipy.stats import pearsonr, spearmanr
except Exception:
    pdist = squareform = pearsonr = spearmanr = None

try:
    from sklearn.manifold import MDS
except Exception:
    MDS = None


# ============================================================
# Basic utilities
# ============================================================


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def to_numpy(x: torch.Tensor) -> np.ndarray:
    return x.detach().cpu().numpy()


def dagger(A: torch.Tensor) -> torch.Tensor:
    return A.conj().transpose(-1, -2)


def commutator(A: torch.Tensor, B: torch.Tensor) -> torch.Tensor:
    return A @ B - B @ A


def trace_normed(A: torch.Tensor) -> torch.Tensor:
    return torch.trace(A) / A.shape[-1]


def entropy_probs(p: torch.Tensor, eps: float = 1e-12) -> torch.Tensor:
    p = torch.clamp(p.real, min=0)
    p = p / torch.clamp(p.sum(), min=eps)
    return -(p * torch.log(torch.clamp(p, min=eps))).sum()


def von_neumann_entropy(rho: torch.Tensor, eps: float = 1e-12) -> torch.Tensor:
    evals = torch.linalg.eigvalsh((rho + dagger(rho)) / 2)
    evals = torch.clamp(evals.real, min=0)
    evals = evals / torch.clamp(evals.sum(), min=eps)
    return entropy_probs(evals, eps=eps)


def save_json(obj: Any, path: str) -> None:
    def convert(o):
        if hasattr(o, "__dataclass_fields__"):
            return asdict(o)
        if isinstance(o, torch.Tensor):
            return to_numpy(o).tolist()
        if isinstance(o, np.ndarray):
            return o.tolist()
        if isinstance(o, (np.floating, np.integer)):
            return o.item()
        raise TypeError(type(o).__name__)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False, default=convert)


# ============================================================
# Pauli strings and SYK-like effective Hamiltonian
# ============================================================


def pauli_matrices(device: str = "cpu", dtype: torch.dtype = torch.complex64) -> Dict[str, torch.Tensor]:
    I = torch.tensor([[1, 0], [0, 1]], device=device, dtype=dtype)
    X = torch.tensor([[0, 1], [1, 0]], device=device, dtype=dtype)
    Y = torch.tensor([[0, -1j], [1j, 0]], device=device, dtype=dtype)
    Z = torch.tensor([[1, 0], [0, -1]], device=device, dtype=dtype)
    return {"I": I, "X": X, "Y": Y, "Z": Z}


def kron_all(ops: List[torch.Tensor]) -> torch.Tensor:
    out = ops[0]
    for op in ops[1:]:
        out = torch.kron(out, op)
    return out


def local_pauli(n_qubits: int, site: int, kind: str, device: str = "cpu") -> torch.Tensor:
    P = pauli_matrices(device)
    ops = [P["I"] for _ in range(n_qubits)]
    ops[site] = P[kind]
    return kron_all(ops)


def random_pauli_string(n_qubits: int, weight: int, device: str = "cpu") -> torch.Tensor:
    P = pauli_matrices(device)
    sites = torch.randperm(n_qubits)[:weight].tolist()
    ops = [P["I"] for _ in range(n_qubits)]
    for s in sites:
        ops[s] = P[np.random.choice(["X", "Y", "Z"])]
    return kron_all(ops)


def build_syk_like_hamiltonian(
    n_qubits: int,
    n_terms: int = 200,
    weight: int = 4,
    J: float = 1.0,
    device: str = "cpu",
) -> torch.Tensor:
    """
    SYK-like effective model using random q-body Pauli strings.

    Not an exact Majorana SYK Hamiltonian, but captures:
    - all-to-all random q-body interactions
    - fast scrambling tendency
    - comparison target for OTOC growth
    """
    D = 2 ** n_qubits
    H = torch.zeros((D, D), device=device, dtype=torch.complex64)
    scale = J / math.sqrt(n_terms)
    for _ in range(n_terms):
        coeff = torch.randn((), device=device).item() * scale
        H = H + coeff * random_pauli_string(n_qubits, weight=min(weight, n_qubits), device=device)
    H = (H + dagger(H)) / 2
    return H


def build_local_chaotic_hamiltonian(
    n_qubits: int,
    J: float = 1.0,
    h: float = 0.7,
    g: float = 0.5,
    device: str = "cpu",
) -> torch.Tensor:
    """Nonintegrable transverse/longitudinal-field Ising-like chain."""
    D = 2 ** n_qubits
    H = torch.zeros((D, D), device=device, dtype=torch.complex64)
    for i in range(n_qubits):
        Zi = local_pauli(n_qubits, i, "Z", device)
        Xi = local_pauli(n_qubits, i, "X", device)
        H = H + h * Zi + g * Xi
        Zj = local_pauli(n_qubits, (i + 1) % n_qubits, "Z", device)
        H = H + J * Zi @ Zj
    H = (H + dagger(H)) / 2
    return H


def diagonalize(H: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
    evals, evecs = torch.linalg.eigh(H)
    return evals.real, evecs


def evolve_operator_from_eig(A: torch.Tensor, evals: torch.Tensor, evecs: torch.Tensor, t: float) -> torch.Tensor:
    """A(t)=exp(iHt) A exp(-iHt) using eigendecomposition."""
    phase_plus = torch.exp(1j * evals * t)
    phase_minus = torch.exp(-1j * evals * t)
    A_e = dagger(evecs) @ A @ evecs
    A_t_e = phase_plus[:, None] * A_e * phase_minus[None, :]
    return evecs @ A_t_e @ dagger(evecs)


# ============================================================
# A) OTOC comparison
# ============================================================

@dataclass
class OTOCResult:
    times: List[float]
    syk_otoc: List[float]
    local_otoc: List[float]
    syk_commutator_growth: List[float]
    local_commutator_growth: List[float]
    syk_early_growth_rate: float
    local_early_growth_rate: float


def compute_otoc_curve(
    H: torch.Tensor,
    W: torch.Tensor,
    V: torch.Tensor,
    times: torch.Tensor,
    beta: float = 0.0,
) -> Tuple[torch.Tensor, torch.Tensor]:
    """
    Infinite/finite-temperature OTOC:
        F(t)=Tr[rho W(t) V W(t) V]
    Commutator growth:
        C(t)= - Tr[rho [W(t),V]^2]
    For Hermitian unitary Pauli W,V, C(t) roughly tracks scrambling.
    """
    evals, evecs = diagonalize(H)
    D = H.shape[0]
    if beta == 0:
        rho_e = torch.ones(D, device=H.device, dtype=torch.complex64) / D
    else:
        w = torch.exp(-beta * evals)
        rho_e = (w / w.sum()).to(torch.complex64)

    V_e = dagger(evecs) @ V @ evecs
    W_e = dagger(evecs) @ W @ evecs
    Fvals = []
    Cvals = []
    for t in times.tolist():
        phase_plus = torch.exp(1j * evals * t)
        phase_minus = torch.exp(-1j * evals * t)
        Wt_e = phase_plus[:, None] * W_e * phase_minus[None, :]
        O = Wt_e @ V_e @ Wt_e @ V_e
        Fvals.append((rho_e * torch.diagonal(O)).sum().real)
        C = Wt_e @ V_e - V_e @ Wt_e
        C2 = dagger(C) @ C
        Cvals.append((rho_e * torch.diagonal(C2)).sum().real)
    return torch.stack(Fvals), torch.stack(Cvals)


def early_growth_rate(times: torch.Tensor, C: torch.Tensor, t_max: float = 2.0) -> float:
    mask = (times > 0) & (times <= t_max) & (C > 1e-8)
    if mask.sum() < 3:
        return float("nan")
    x = times[mask].float()
    y = torch.log(C[mask].float())
    xm, ym = x.mean(), y.mean()
    slope = ((x - xm) * (y - ym)).sum() / torch.clamp(((x - xm) ** 2).sum(), min=1e-12)
    return float(slope.item())


def otoc_comparison(n_qubits: int, times: torch.Tensor, device: str) -> OTOCResult:
    H_syk = build_syk_like_hamiltonian(n_qubits, n_terms=200, weight=min(4, n_qubits), device=device)
    H_local = build_local_chaotic_hamiltonian(n_qubits, device=device)
    W = local_pauli(n_qubits, 0, "Z", device)
    V = local_pauli(n_qubits, n_qubits // 2, "Z", device)
    F_syk, C_syk = compute_otoc_curve(H_syk, W, V, times)
    F_loc, C_loc = compute_otoc_curve(H_local, W, V, times)
    return OTOCResult(
        times=to_numpy(times).tolist(),
        syk_otoc=to_numpy(F_syk).tolist(),
        local_otoc=to_numpy(F_loc).tolist(),
        syk_commutator_growth=to_numpy(C_syk).tolist(),
        local_commutator_growth=to_numpy(C_loc).tolist(),
        syk_early_growth_rate=early_growth_rate(times, C_syk),
        local_early_growth_rate=early_growth_rate(times, C_loc),
    )


# ============================================================
# B) Complexity growth / Susskind-style proxy
# ============================================================

@dataclass
class ComplexityResult:
    times: List[float]
    krylov_complexity: List[float]
    operator_entanglement_proxy: List[float]
    spectral_complexity_proxy: List[float]
    linear_growth_slope: float


def lanczos_krylov_complexity(H: torch.Tensor, psi0: torch.Tensor, times: torch.Tensor, m: int = 32) -> torch.Tensor:
    """
    Krylov complexity proxy:
        C_K(t)=sum_n n |a_n(t)|^2
    where a_n are amplitudes in the Lanczos basis.

    This is not identical to Nielsen/Susskind circuit complexity,
    but is a useful computable proxy for complexity growth.
    """
    D = H.shape[0]
    m = min(m, D)
    q_prev = torch.zeros_like(psi0)
    q = psi0 / torch.linalg.norm(psi0)
    Q = []
    alpha = []
    beta = []
    b_prev = torch.tensor(0.0, device=H.device)
    for k in range(m):
        Q.append(q)
        z = H @ q
        a = torch.vdot(q, z).real
        z = z - a * q - b_prev * q_prev
        b = torch.linalg.norm(z)
        alpha.append(a)
        if k < m - 1:
            beta.append(b)
        if b < 1e-10:
            break
        q_prev, q = q, z / b
        b_prev = b

    K = len(Q)
    Tmat = torch.zeros((K, K), device=H.device, dtype=torch.complex64)
    for i in range(K):
        Tmat[i, i] = alpha[i].to(torch.complex64)
        if i < K - 1:
            Tmat[i, i + 1] = beta[i].to(torch.complex64)
            Tmat[i + 1, i] = beta[i].to(torch.complex64)
    evals, evecs = torch.linalg.eigh(Tmat)
    e0 = torch.zeros(K, device=H.device, dtype=torch.complex64)
    e0[0] = 1
    ns = torch.arange(K, device=H.device).float()
    comps = []
    for t in times.tolist():
        phases = torch.exp(-1j * evals * t)
        amp = evecs @ (phases * (dagger(evecs) @ e0))
        p = torch.abs(amp) ** 2
        comps.append((ns * p.real).sum())
    return torch.stack(comps).real


def operator_entanglement_proxy(U: torch.Tensor, n_qubits: int) -> torch.Tensor:
    """
    Approximate operator entanglement across half cut by reshaping U.
    For small n only.
    """
    dA = 2 ** (n_qubits // 2)
    dB = 2 ** (n_qubits - n_qubits // 2)
    U4 = U.reshape(dA, dB, dA, dB).permute(0, 2, 1, 3).reshape(dA * dA, dB * dB)
    s = torch.linalg.svdvals(U4)
    p = (s.real ** 2) / torch.clamp((s.real ** 2).sum(), min=1e-12)
    return entropy_probs(p)


def spectral_complexity_proxy(H: torch.Tensor, t: float) -> torch.Tensor:
    """
    Proxy based on distance from identity in unitary space:
        C_spec(t)=D - |Tr U(t)|^2/D
    related to spectral form-factor decay.
    """
    evals = torch.linalg.eigvalsh(H).real
    trU = torch.exp(-1j * evals * t).sum()
    D = H.shape[0]
    return (D - (torch.abs(trU) ** 2) / D).real


def complexity_growth(n_qubits: int, times: torch.Tensor, device: str) -> ComplexityResult:
    H = build_syk_like_hamiltonian(n_qubits, n_terms=200, weight=min(4, n_qubits), device=device)
    D = H.shape[0]
    psi0 = torch.zeros(D, device=device, dtype=torch.complex64)
    psi0[0] = 1
    Kc = lanczos_krylov_complexity(H, psi0, times, m=min(48, D))

    evals, evecs = diagonalize(H)
    op_ent = []
    spec = []
    for t in times.tolist():
        U = evecs @ torch.diag(torch.exp(-1j * evals * t).to(torch.complex64)) @ dagger(evecs)
        op_ent.append(operator_entanglement_proxy(U, n_qubits))
        spec.append(spectral_complexity_proxy(H, t))
    op_ent = torch.stack(op_ent)
    spec = torch.stack(spec)

    mask = (times > times.max() * 0.1) & (times < times.max() * 0.5)
    if mask.sum() >= 3:
        x, y = times[mask], Kc[mask]
        slope = (((x - x.mean()) * (y - y.mean())).sum() / torch.clamp(((x - x.mean()) ** 2).sum(), min=1e-12)).item()
    else:
        slope = float("nan")

    return ComplexityResult(
        times=to_numpy(times).tolist(),
        krylov_complexity=to_numpy(Kc).tolist(),
        operator_entanglement_proxy=to_numpy(op_ent).tolist(),
        spectral_complexity_proxy=to_numpy(spec).tolist(),
        linear_growth_slope=float(slope),
    )


# ============================================================
# C) Page curve-like information recovery
# ============================================================

@dataclass
class PageCurveResult:
    subsystem_sizes: List[int]
    entropy_mean: List[float]
    entropy_page_prediction: List[float]
    mutual_information_with_reference: List[float]
    recovery_onset_subsystem_size: int


def random_pure_state(D: int, device: str) -> torch.Tensor:
    psi = torch.randn(D, device=device, dtype=torch.complex64) + 1j * torch.randn(D, device=device, dtype=torch.complex64)
    return psi / torch.linalg.norm(psi)


def reduced_density_from_state(psi: torch.Tensor, dims: List[int], keep: List[int]) -> torch.Tensor:
    """Partial trace pure state |psi><psi| keeping subsystem indices keep."""
    n = len(dims)
    keep = list(keep)
    trace = [i for i in range(n) if i not in keep]
    psi_t = psi.reshape(*dims)
    perm = keep + trace
    psi_perm = psi_t.permute(*perm)
    d_keep = int(np.prod([dims[i] for i in keep])) if keep else 1
    d_trace = int(np.prod([dims[i] for i in trace])) if trace else 1
    M = psi_perm.reshape(d_keep, d_trace)
    rho = M @ dagger(M)
    return rho / torch.clamp(torch.trace(rho).real, min=1e-12)


def page_prediction(dA: int, dB: int) -> float:
    """
    Page entropy approximation in nats:
        S_A ≈ ln dA - dA/(2 dB), for dA <= dB.
    Symmetrized by using min/max.
    """
    da, db = min(dA, dB), max(dA, dB)
    return float(math.log(da) - da / (2 * db))


def page_curve_analysis(n_qubits: int, n_samples: int, device: str) -> PageCurveResult:
    """
    Page-curve-like analysis with reference qubit R entangled with system.

    Construct random states on R + radiation/body qubits and compute:
    - S(A) vs subsystem size |A|
    - I(R:A) as proxy for information recovery
    """
    dims = [2] * (n_qubits + 1)  # qubit 0 = reference R
    D = 2 ** (n_qubits + 1)
    sizes = list(range(1, n_qubits + 1))
    ent_sum = torch.zeros(len(sizes), device=device)
    mi_sum = torch.zeros(len(sizes), device=device)

    for _ in range(n_samples):
        psi = random_pure_state(D, device)
        rho_R = reduced_density_from_state(psi, dims, [0])
        S_R = von_neumann_entropy(rho_R)
        for idx, k in enumerate(sizes):
            A = list(range(1, 1 + k))
            rho_A = reduced_density_from_state(psi, dims, A)
            rho_RA = reduced_density_from_state(psi, dims, [0] + A)
            S_A = von_neumann_entropy(rho_A)
            S_RA = von_neumann_entropy(rho_RA)
            ent_sum[idx] += S_A
            mi_sum[idx] += S_R + S_A - S_RA

    ent_mean = ent_sum / n_samples
    mi_mean = mi_sum / n_samples
    preds = [page_prediction(2**k, 2 ** (n_qubits - k)) for k in sizes]
    max_mi = float(mi_mean.max().item())
    threshold = 0.5 * max_mi
    onset = sizes[int(torch.nonzero(mi_mean >= threshold, as_tuple=False)[0, 0].item())] if max_mi > 0 else -1
    return PageCurveResult(
        subsystem_sizes=sizes,
        entropy_mean=to_numpy(ent_mean).tolist(),
        entropy_page_prediction=preds,
        mutual_information_with_reference=to_numpy(mi_mean).tolist(),
        recovery_onset_subsystem_size=onset,
    )


# ============================================================
# D/E) Transport graph ↔ geometry and emergent metric
# ============================================================

@dataclass
class GeometryResult:
    te_matrix: List[List[float]]
    distance_matrix: List[List[float]]
    embedding_2d: List[List[float]]
    graph_geodesic_distance: List[List[float]]
    geometry_correlation_pearson: Optional[float]
    geometry_correlation_spearman: Optional[float]
    tensor_network_bond_weights: List[List[float]]
    note: str


def discretize_quantile(x: torch.Tensor, n_bins: int = 4) -> torch.Tensor:
    qs = torch.quantile(x.flatten().float(), torch.linspace(0, 1, n_bins + 1, device=x.device)[1:-1])
    return torch.bucketize(x.float(), qs).long()


def transfer_entropy_pair(x: torch.Tensor, y: torch.Tensor, n_bins: int = 4, eps: float = 1e-12) -> float:
    xs = discretize_quantile(x, n_bins)
    ys = discretize_quantile(y, n_bins)
    yt1 = ys[1:]
    yt = ys[:-1]
    xt = xs[:-1]
    B = n_bins
    idx = yt1 * B * B + yt * B + xt
    p = torch.bincount(idx, minlength=B**3).double().reshape(B, B, B)
    p = p / torch.clamp(p.sum(), min=eps)
    p_yx = p.sum(dim=0)
    p_yy = p.sum(dim=2)
    p_y = p_yy.sum(dim=0)
    te = torch.tensor(0.0, device=x.device, dtype=torch.float64)
    for a in range(B):
        for b in range(B):
            for c in range(B):
                val = p[a, b, c]
                if val > 0:
                    p1 = val / torch.clamp(p_yx[b, c], min=eps)
                    p2 = p_yy[a, b] / torch.clamp(p_y[b], min=eps)
                    te += val * torch.log(torch.clamp(p1 / torch.clamp(p2, min=eps), min=eps))
    return float(te.item())


def te_matrix_from_node_series(X: torch.Tensor, n_bins: int = 4) -> torch.Tensor:
    """X: [T,N] node activity."""
    T, N = X.shape
    TE = torch.zeros((N, N), device=X.device)
    for i in range(N):
        for j in range(N):
            if i != j:
                TE[i, j] = transfer_entropy_pair(X[:, i], X[:, j], n_bins=n_bins)
    return TE


def emergent_distance_from_te(TE: torch.Tensor, eps: float = 1e-8) -> torch.Tensor:
    """
    Directed TE -> symmetric emergent distance.
    Strong causal channel means short distance:
        d_ij = -log((TE_ij+TE_ji)/2 normalized)
    """
    W = (TE + TE.T) / 2
    W = W / torch.clamp(W.max(), min=eps)
    D = -torch.log(torch.clamp(W, min=eps))
    D.fill_diagonal_(0)
    return D


def floyd_warshall_torch(D: torch.Tensor) -> torch.Tensor:
    out = D.clone()
    N = out.shape[0]
    for k in range(N):
        out = torch.minimum(out, out[:, k:k+1] + out[k:k+1, :])
    return out


def classical_mds_torch(D: torch.Tensor, dim: int = 2) -> torch.Tensor:
    """Classical MDS from distance matrix."""
    N = D.shape[0]
    D2 = D ** 2
    J = torch.eye(N, device=D.device) - torch.ones((N, N), device=D.device) / N
    B = -0.5 * J @ D2 @ J
    evals, evecs = torch.linalg.eigh((B + B.T) / 2)
    idx = torch.argsort(evals, descending=True)[:dim]
    vals = torch.clamp(evals[idx], min=0)
    return evecs[:, idx] * torch.sqrt(vals)[None, :]


def tensor_network_bond_weights_from_te(TE: torch.Tensor, max_bond: float = 8.0) -> torch.Tensor:
    """
    Tensor-network-inspired mapping:
        stronger TE -> larger effective bond dimension chi_ij
        w_ij = log chi_ij
    """
    W = (TE + TE.T) / 2
    if W.max() > 0:
        Wn = W / W.max()
    else:
        Wn = W
    chi = 1.0 + (max_bond - 1.0) * Wn
    return torch.log(chi)


def geometry_from_transport_graph(node_series: torch.Tensor, physical_positions: Optional[torch.Tensor] = None, n_bins: int = 4) -> GeometryResult:
    TE = te_matrix_from_node_series(node_series, n_bins=n_bins)
    D_te = emergent_distance_from_te(TE)
    D_geo = floyd_warshall_torch(D_te)
    emb = classical_mds_torch(D_geo, dim=2)
    bond_w = tensor_network_bond_weights_from_te(TE)

    pear = spear = None
    if physical_positions is not None and pdist is not None and pearsonr is not None:
        phys = squareform(pdist(to_numpy(physical_positions.float())))
        emerg = to_numpy(D_geo)
        mask = np.triu(np.ones_like(phys, dtype=bool), k=1)
        try:
            pear = float(pearsonr(phys[mask], emerg[mask])[0])
            spear = float(spearmanr(phys[mask], emerg[mask])[0])
        except Exception:
            pear = spear = None

    return GeometryResult(
        te_matrix=to_numpy(TE).tolist(),
        distance_matrix=to_numpy(D_te).tolist(),
        embedding_2d=to_numpy(emb).tolist(),
        graph_geodesic_distance=to_numpy(D_geo).tolist(),
        geometry_correlation_pearson=pear,
        geometry_correlation_spearman=spear,
        tensor_network_bond_weights=to_numpy(bond_w).tolist(),
        note="Distance is d_ij=-log normalized symmetric TE; embedding is classical MDS; bond weights are log effective chi.",
    )


# ============================================================
# Demo transport series
# ============================================================


def simulate_transport_series(T: int, N: int, lam: float, device: str) -> torch.Tensor:
    """Coupled logistic-like transport activity [T,N]."""
    x = torch.rand(N, device=device)
    out = []
    coupling = min(max(lam, 0.0), 0.45)
    r = 3.55 + 1.2 * min(max(lam, 0.0), 0.35)
    for _ in range(T):
        local = r * x * (1 - x)
        neigh = 0.5 * (torch.roll(local, 1) + torch.roll(local, -1))
        x = (1 - coupling) * local + coupling * neigh
        x = torch.remainder(x, 1.0)
        out.append(x.clone())
    return torch.stack(out, dim=0)


# ============================================================
# Plotting
# ============================================================


def plot_otoc(res: OTOCResult, out: str) -> None:
    if plt is None:
        return
    t = np.array(res.times)
    plt.figure(figsize=(7, 4))
    plt.plot(t, res.syk_commutator_growth, label="SYK-like commutator growth")
    plt.plot(t, res.local_commutator_growth, label="local chaotic commutator growth")
    plt.xlabel("time")
    plt.ylabel("C(t)")
    plt.title("OTOC / commutator growth comparison")
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(os.path.join(out, "otoc_comparison.png"), dpi=160)
    plt.close()


def plot_complexity(res: ComplexityResult, out: str) -> None:
    if plt is None:
        return
    t = np.array(res.times)
    plt.figure(figsize=(7, 4))
    plt.plot(t, res.krylov_complexity, label="Krylov complexity")
    plt.plot(t, res.operator_entanglement_proxy, label="operator entanglement proxy")
    plt.plot(t, np.array(res.spectral_complexity_proxy) / max(res.spectral_complexity_proxy), label="spectral proxy normalized")
    plt.xlabel("time")
    plt.ylabel("complexity proxy")
    plt.title("Complexity growth proxies")
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(os.path.join(out, "complexity_growth.png"), dpi=160)
    plt.close()


def plot_page(res: PageCurveResult, out: str) -> None:
    if plt is None:
        return
    k = np.array(res.subsystem_sizes)
    plt.figure(figsize=(7, 4))
    plt.plot(k, res.entropy_mean, marker="o", label="mean entropy")
    plt.plot(k, res.entropy_page_prediction, marker="s", label="Page prediction")
    plt.plot(k, res.mutual_information_with_reference, marker="^", label="I(reference:subsystem)")
    plt.xlabel("subsystem size")
    plt.ylabel("nats")
    plt.title("Page-curve-like information recovery")
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(os.path.join(out, "page_curve.png"), dpi=160)
    plt.close()


def plot_metric(res: GeometryResult, out: str) -> None:
    if plt is None:
        return
    emb = np.array(res.embedding_2d)
    plt.figure(figsize=(5, 5))
    plt.scatter(emb[:, 0], emb[:, 1])
    for i, (x, y) in enumerate(emb):
        plt.text(x, y, str(i), fontsize=9)
    plt.title("Emergent geometry from TE metric")
    plt.axis("equal")
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(os.path.join(out, "emergent_metric.png"), dpi=160)
    plt.close()


# ============================================================
# Pipeline
# ============================================================


def run(args: argparse.Namespace) -> Dict[str, Any]:
    ensure_dir(args.out)
    device = "cuda" if args.cuda and torch.cuda.is_available() else "cpu"
    times = torch.linspace(0, args.t_max, args.n_times, device=device)

    results: Dict[str, Any] = {"device": device}

    # A
    otoc_res = otoc_comparison(args.n_qubits, times, device)
    results["A_syk_like_otoc_comparison"] = otoc_res
    plot_otoc(otoc_res, args.out)

    # B
    comp_res = complexity_growth(args.n_qubits, times, device)
    results["B_complexity_growth"] = comp_res
    plot_complexity(comp_res, args.out)

    # C
    page_res = page_curve_analysis(args.page_qubits, args.page_samples, device)
    results["C_page_curve_information_recovery"] = page_res
    plot_page(page_res, args.out)

    # D/E
    if args.input_series:
        data = torch.load(args.input_series, map_location=device)
        node_series = data["node_series"].to(device).float()
        physical_positions = data.get("physical_positions", None)
        if physical_positions is not None:
            physical_positions = physical_positions.to(device).float()
    else:
        node_series = simulate_transport_series(args.transport_T, args.transport_N, args.transport_lambda, device)
        physical_positions = torch.stack([
            torch.cos(torch.linspace(0, 2 * math.pi, args.transport_N + 1, device=device)[:-1]),
            torch.sin(torch.linspace(0, 2 * math.pi, args.transport_N + 1, device=device)[:-1]),
        ], dim=1)

    geom_res = geometry_from_transport_graph(node_series, physical_positions=physical_positions, n_bins=args.te_bins)
    results["D_tensor_network_transport_graph_geometry"] = {
        "tensor_network_bond_weights": geom_res.tensor_network_bond_weights,
        "geometry_correlation_pearson": geom_res.geometry_correlation_pearson,
        "geometry_correlation_spearman": geom_res.geometry_correlation_spearman,
        "note": "Transport graph is mapped to tensor-network-like bond weights log chi_ij from TE strength.",
    }
    results["E_emergent_metric_from_TE_network"] = geom_res
    plot_metric(geom_res, args.out)

    save_json(results, os.path.join(args.out, "analysis_results.json"))
    return results


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser()
    p.add_argument("--out", type=str, default="results_syk_geometry")
    p.add_argument("--cuda", action="store_true")

    p.add_argument("--n-qubits", type=int, default=6, help="Hilbert size is 2^n; keep <= 8 unless you know what you are doing.")
    p.add_argument("--t-max", type=float, default=8.0)
    p.add_argument("--n-times", type=int, default=80)

    p.add_argument("--page-qubits", type=int, default=8)
    p.add_argument("--page-samples", type=int, default=32)

    p.add_argument("--input-series", type=str, default=None, help="Optional .pt with node_series [T,N] and optional physical_positions [N,dim].")
    p.add_argument("--transport-T", type=int, default=512)
    p.add_argument("--transport-N", type=int, default=16)
    p.add_argument("--transport-lambda", type=float, default=0.08)
    p.add_argument("--te-bins", type=int, default=4)
    return p


if __name__ == "__main__":
    args = build_parser().parse_args()
    results = run(args)
    brief = {}
    for k, v in results.items():
        if hasattr(v, "__dataclass_fields__"):
            brief[k] = asdict(v)
        else:
            brief[k] = v if isinstance(v, str) else "saved"
    print(json.dumps(brief, indent=2, ensure_ascii=False)[:4000])
    print(f"\nSaved to: {os.path.abspath(args.out)}")
