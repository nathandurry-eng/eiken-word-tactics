export class TurnTimer {
  constructor(onTick, onExpire, now = () => Date.now()) {
    this.onTick = onTick;
    this.onExpire = onExpire;
    this.now = now;
    this.interval = null;
    this.state = null;
  }

  attach(state) {
    this.pause();
    this.state = state;
    if (this.state) {
      this.state.running = false;
      this.state.deadline = null;
    }
  }

  start(state = this.state) {
    this.pause();
    this.state = state;
    if (!state || state.remaining <= 0) return;
    state.running = true;
    state.deadline = this.now() + state.remaining * 1000;
    this.interval = setInterval(() => this.tick(), 200);
    this.onTick?.(state);
  }

  tick() {
    if (!this.state?.running) return;
    const previous = this.state.remaining;
    this.state.remaining = Math.max(0, Math.ceil((this.state.deadline - this.now()) / 1000));
    if (this.state.remaining !== previous) this.onTick?.(this.state, previous);
    if (this.state.remaining === 0) {
      this.pause(false);
      this.onExpire?.(this.state);
    }
  }

  pause(update = true) {
    if (update && this.state?.running) this.tick();
    clearInterval(this.interval);
    this.interval = null;
    if (this.state) {
      this.state.running = false;
      this.state.deadline = null;
    }
    this.onTick?.(this.state);
  }

  reset(duration) {
    this.pause();
    if (!this.state) return;
    this.state.duration = duration;
    this.state.remaining = duration;
    this.onTick?.(this.state);
  }

  add(seconds) {
    if (!this.state) return;
    const wasRunning = this.state.running;
    this.pause();
    this.state.duration += seconds;
    this.state.remaining += seconds;
    if (wasRunning) this.start(); else this.onTick?.(this.state);
  }

  destroy() {
    this.pause();
    this.state = null;
  }
}
