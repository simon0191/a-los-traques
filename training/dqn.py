"""
Dueling DQN with Double Q-learning for El Cerebro (RFC 0020 §4).

Single-file, CleanRL-style implementation. No external RL framework.

Architecture:
  obs(47) → Linear(128, ReLU) → Linear(128, ReLU) → Dueling heads:
    - Value:     Linear(1)
    - Advantage: Linear(72)
  Q(s,a) = V(s) + A(s,a) - mean(A(s,:))

Features:
  - Double DQN (target network for action selection, online for value)
  - Prioritized experience replay (proportional, sum-tree)
  - Polyak-averaged target network updates
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np


# --- Network ---

class DuelingDQN(nn.Module):
    """Dueling DQN with shared trunk and separate value/advantage heads."""

    def __init__(self, obs_dim: int = 47, n_actions: int = 72, hidden: int = 128):
        super().__init__()
        self.trunk = nn.Sequential(
            nn.Linear(obs_dim, hidden),
            nn.ReLU(),
            nn.Linear(hidden, hidden),
            nn.ReLU(),
        )
        self.value_head = nn.Linear(hidden, 1)
        self.advantage_head = nn.Linear(hidden, n_actions)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        features = self.trunk(x)
        value = self.value_head(features)           # (B, 1)
        advantage = self.advantage_head(features)    # (B, n_actions)
        # Q = V + (A - mean(A))
        q = value + advantage - advantage.mean(dim=-1, keepdim=True)
        return q


# --- Prioritized Replay Buffer ---

class SumTree:
    """Binary sum-tree for O(log N) prioritized sampling."""

    def __init__(self, capacity: int):
        self.capacity = capacity
        self.tree = np.zeros(2 * capacity - 1, dtype=np.float64)
        self.data_pointer = 0
        self.size = 0

    def total(self) -> float:
        return self.tree[0]

    def add(self, priority: float):
        idx = self.data_pointer + self.capacity - 1
        self.update(idx, priority)
        self.data_pointer = (self.data_pointer + 1) % self.capacity
        self.size = min(self.size + 1, self.capacity)

    def update(self, tree_idx: int, priority: float):
        delta = priority - self.tree[tree_idx]
        self.tree[tree_idx] = priority
        while tree_idx > 0:
            tree_idx = (tree_idx - 1) // 2
            self.tree[tree_idx] += delta

    def get(self, value: float) -> int:
        """Sample a leaf index proportional to priority."""
        idx = 0
        while idx < self.capacity - 1:
            left = 2 * idx + 1
            right = left + 1
            if value <= self.tree[left]:
                idx = left
            else:
                value -= self.tree[left]
                idx = right
        data_idx = idx - (self.capacity - 1)
        return data_idx, self.tree[idx]


class PrioritizedReplayBuffer:
    """Prioritized experience replay with sum-tree sampling."""

    def __init__(self, capacity: int, obs_dim: int, alpha: float = 0.6):
        self.capacity = capacity
        self.alpha = alpha
        self.tree = SumTree(capacity)

        # Pre-allocate storage
        self.obs = np.zeros((capacity, obs_dim), dtype=np.float32)
        self.actions = np.zeros(capacity, dtype=np.int64)
        self.rewards = np.zeros(capacity, dtype=np.float32)
        self.next_obs = np.zeros((capacity, obs_dim), dtype=np.float32)
        self.dones = np.zeros(capacity, dtype=np.float32)

        self._ptr = 0
        self._size = 0
        self._max_priority = 1.0

    def __len__(self):
        return self._size

    def add(self, obs, action, reward, next_obs, done):
        self.obs[self._ptr] = obs
        self.actions[self._ptr] = action
        self.rewards[self._ptr] = reward
        self.next_obs[self._ptr] = next_obs
        self.dones[self._ptr] = done

        priority = self._max_priority ** self.alpha
        self.tree.add(priority)

        self._ptr = (self._ptr + 1) % self.capacity
        self._size = min(self._size + 1, self.capacity)

    def add_batch(self, obs, actions, rewards, next_obs, dones):
        """Add a batch of transitions."""
        n = len(actions)
        for i in range(n):
            self.add(obs[i], actions[i], rewards[i], next_obs[i], dones[i])

    def sample(self, batch_size: int, beta: float = 0.4):
        """Sample a batch with importance-sampling weights."""
        indices = []
        priorities = []
        segment = self.tree.total() / batch_size

        for i in range(batch_size):
            lo = segment * i
            hi = segment * (i + 1)
            value = np.random.uniform(lo, hi)
            idx, priority = self.tree.get(value)
            indices.append(idx)
            priorities.append(priority)

        indices = np.array(indices)
        priorities = np.array(priorities, dtype=np.float64)

        # Importance-sampling weights
        probs = priorities / self.tree.total()
        weights = (self._size * probs) ** (-beta)
        weights /= weights.max()

        batch = dict(
            obs=self.obs[indices],
            actions=self.actions[indices],
            rewards=self.rewards[indices],
            next_obs=self.next_obs[indices],
            dones=self.dones[indices],
            indices=indices,
            weights=weights.astype(np.float32),
        )
        return batch

    def update_priorities(self, indices, td_errors):
        """Update priorities based on TD-error magnitude."""
        for idx, td in zip(indices, td_errors):
            priority = (abs(td) + 1e-6) ** self.alpha
            tree_idx = idx + self.tree.capacity - 1
            self.tree.update(tree_idx, priority)
            self._max_priority = max(self._max_priority, abs(td) + 1e-6)


# --- Training Loop ---

def load_data(data_dir: str):
    """Load all batch_XXXXX directories from a data directory."""
    import os
    batches = sorted(
        d for d in os.listdir(data_dir)
        if d.startswith('batch_') and os.path.isdir(os.path.join(data_dir, d))
    )
    all_obs, all_actions, all_rewards, all_next_obs, all_dones = [], [], [], [], []
    for b in batches:
        path = os.path.join(data_dir, b)
        all_obs.append(np.load(os.path.join(path, 'obs.npy')))
        all_actions.append(np.load(os.path.join(path, 'actions.npy')))
        all_rewards.append(np.load(os.path.join(path, 'rewards.npy')))
        all_next_obs.append(np.load(os.path.join(path, 'next_obs.npy')))
        all_dones.append(np.load(os.path.join(path, 'dones.npy')))

    return dict(
        obs=np.concatenate(all_obs),
        actions=np.concatenate(all_actions).astype(np.int64),
        rewards=np.concatenate(all_rewards),
        next_obs=np.concatenate(all_next_obs),
        dones=np.concatenate(all_dones).astype(np.float32),
    )


def train(
    data_dir: str,
    obs_dim: int = 47,
    n_actions: int = 72,
    hidden: int = 128,
    capacity: int = 1_000_000,
    batch_size: int = 256,
    lr: float = 1e-4,
    gamma: float = 0.99,
    tau: float = 0.005,
    target_update_freq: int = 10_000,
    total_steps: int = 500_000,
    checkpoint_dir: str = "checkpoints",
    checkpoint_every: int = 100_000,
    resume: str = None,
    device: str = None,
):
    """Train a Dueling DQN from offline data."""
    import os

    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
    device = torch.device(device)
    print(f"Device: {device}")

    # Load data
    print(f"Loading data from {data_dir}...")
    data = load_data(data_dir)
    n_transitions = len(data['actions'])
    print(f"Loaded {n_transitions:,} transitions")

    # Fill replay buffer
    print("Filling replay buffer...")
    buffer = PrioritizedReplayBuffer(min(capacity, n_transitions * 2), obs_dim)
    buffer.add_batch(data['obs'], data['actions'], data['rewards'],
                     data['next_obs'], data['dones'])
    print(f"Buffer size: {len(buffer):,}")

    # Networks
    online = DuelingDQN(obs_dim, n_actions, hidden).to(device)
    target = DuelingDQN(obs_dim, n_actions, hidden).to(device)

    if resume:
        print(f"Resuming from {resume}")
        online.load_state_dict(torch.load(resume, map_location=device, weights_only=True))

    target.load_state_dict(online.state_dict())
    optimizer = torch.optim.Adam(online.parameters(), lr=lr)

    os.makedirs(checkpoint_dir, exist_ok=True)

    # Training
    print(f"Training for {total_steps:,} steps...")
    losses = []

    for step in range(1, total_steps + 1):
        # Anneal beta for importance sampling: 0.4 → 1.0
        beta = min(1.0, 0.4 + 0.6 * step / total_steps)

        batch = buffer.sample(batch_size, beta=beta)

        obs_t = torch.tensor(batch['obs'], device=device)
        actions_t = torch.tensor(batch['actions'], device=device, dtype=torch.long)
        rewards_t = torch.tensor(batch['rewards'], device=device)
        next_obs_t = torch.tensor(batch['next_obs'], device=device)
        dones_t = torch.tensor(batch['dones'], device=device)
        weights_t = torch.tensor(batch['weights'], device=device)

        # Current Q-values
        q_values = online(obs_t)
        q_selected = q_values.gather(1, actions_t.unsqueeze(1)).squeeze(1)

        # Double DQN: online selects action, target evaluates
        with torch.no_grad():
            next_actions = online(next_obs_t).argmax(dim=1)
            next_q = target(next_obs_t).gather(1, next_actions.unsqueeze(1)).squeeze(1)
            td_target = rewards_t + gamma * next_q * (1 - dones_t)

        # Weighted Huber loss
        td_error = q_selected - td_target
        loss = (weights_t * F.huber_loss(q_selected, td_target, reduction='none')).mean()

        optimizer.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(online.parameters(), 10.0)
        optimizer.step()

        # Update priorities
        buffer.update_priorities(
            batch['indices'],
            td_error.detach().cpu().numpy()
        )

        # Polyak update target network
        if step % target_update_freq == 0:
            with torch.no_grad():
                for p_online, p_target in zip(online.parameters(), target.parameters()):
                    p_target.data.mul_(1 - tau).add_(p_online.data, alpha=tau)

        losses.append(loss.item())

        # Logging
        if step % 10_000 == 0:
            avg_loss = np.mean(losses[-10_000:])
            print(f"  step {step:>7,}/{total_steps:,} | loss: {avg_loss:.6f} | beta: {beta:.3f}")

        # Checkpoint
        if step % checkpoint_every == 0:
            path = os.path.join(checkpoint_dir, f"checkpoint_{step}.pt")
            torch.save(online.state_dict(), path)
            print(f"  → saved {path}")

    # Final save
    final_path = os.path.join(checkpoint_dir, "final.pt")
    torch.save(online.state_dict(), final_path)
    print(f"\nTraining complete. Final model: {final_path}")

    return online


# --- CLI ---

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Train Dueling DQN for El Cerebro")
    parser.add_argument("--data-dir", required=True, help="Directory with batch_XXXXX/ subdirs")
    parser.add_argument("--checkpoint-dir", default="checkpoints", help="Where to save checkpoints")
    parser.add_argument("--steps", type=int, default=500_000, help="Total training steps")
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--gamma", type=float, default=0.99)
    parser.add_argument("--capacity", type=int, default=1_000_000)
    parser.add_argument("--checkpoint-every", type=int, default=100_000)
    parser.add_argument("--resume", type=str, default=None, help="Path to checkpoint .pt to resume")
    parser.add_argument("--device", type=str, default=None)
    args = parser.parse_args()

    train(
        data_dir=args.data_dir,
        checkpoint_dir=args.checkpoint_dir,
        total_steps=args.steps,
        batch_size=args.batch_size,
        lr=args.lr,
        gamma=args.gamma,
        capacity=args.capacity,
        checkpoint_every=args.checkpoint_every,
        resume=args.resume,
        device=args.device,
    )
