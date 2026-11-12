/** Presentation-only angular motion. Times are pointer/rAF timestamps, never Core time. */
export function angularMotion() {
    let last = null, position = 0, latest = -Infinity;
    let samples = [];
    return {
        move(x, y, at) {
            if (!Number.isFinite(at) || at < latest)
                return 0;
            latest = at;
            // Angle is unstable at the axis. Reanchor on exit instead of inventing a turn.
            if (Math.hypot(x, y) < 12) {
                last = null;
                samples = [];
                return 0;
            }
            const next = Math.atan2(y, x);
            let delta = last === null ? 0 : next - last;
            if (delta > Math.PI)
                delta -= 2 * Math.PI;
            if (delta < -Math.PI)
                delta += 2 * Math.PI;
            last = next;
            const degrees = delta * 180 / Math.PI;
            position += degrees;
            samples = samples.filter(s => s.at >= at - 100 && s.at !== at).slice(-63);
            samples.push({ at, position });
            return degrees;
        },
        velocity(at) {
            if (at < latest || at - latest >= 100 || samples.length < 2)
                return 0;
            const recent = samples.filter(s => s.at >= at - 100);
            // A pause before release reduces momentum; pointer event batching does not.
            if (at > latest)
                recent.push({ at, position });
            if (recent.length < 2 || recent.at(-1).at - recent[0].at < 12)
                return 0;
            const meanTime = recent.reduce((sum, s) => sum + s.at - at, 0) / recent.length;
            const meanPosition = recent.reduce((sum, s) => sum + s.position, 0) / recent.length;
            let covariance = 0, variance = 0;
            for (const s of recent) {
                const t = s.at - at - meanTime;
                covariance += t * (s.position - meanPosition);
                variance += t * t;
            }
            return variance === 0 ? 0 : Math.max(-1.2, Math.min(1.2, covariance / variance));
        },
    };
}
/** Exact exponential integration gives the same travel at different frame rates. */
export function coastRotation(speed, milliseconds) {
    const decay = Math.exp(-Math.max(0, milliseconds) / 700);
    return { speed: speed * decay, degrees: speed * 700 * (1 - decay) };
}
