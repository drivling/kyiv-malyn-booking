"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startIntervalJob = startIntervalJob;
function startIntervalJob(name, run, opts) {
    const { intervalMin } = opts;
    if (!Number.isFinite(intervalMin) || intervalMin <= 0)
        return null; // 0 = вимкнено
    const log = opts.log ?? ((m) => console.log(m));
    let running = false;
    const tick = async () => {
        if (running)
            return;
        running = true;
        try {
            await run();
        }
        catch (e) {
            log(`[${name}] tick error: ${e instanceof Error ? e.message : String(e)}`);
        }
        finally {
            running = false;
        }
    };
    const timer = setInterval(() => void tick(), intervalMin * 60000);
    timer.unref();
    const first = setTimeout(() => void tick(), opts.firstDelayMs ?? 60000);
    first.unref();
    log(`[${name}] scheduler started (every ${intervalMin} min${opts.note ? `, ${opts.note}` : ''})`);
    return {
        stop() {
            clearInterval(timer);
            clearTimeout(first);
        },
    };
}
