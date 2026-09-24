"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestTiming = requestTiming;
const SKIP_LOG_PATHS = new Set(['/health']);
function requestTiming(opts = {}) {
    const log = opts.log ?? (process.env.HTTP_TIMING_LOG !== '0' && !process.env.VITEST);
    return (req, res, next) => {
        const startedAt = process.hrtime.bigint();
        let headerSet = false;
        const setHeader = () => {
            if (headerSet || res.headersSent)
                return;
            headerSet = true;
            const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
            res.setHeader('X-Response-Time', `${ms.toFixed(1)}ms`);
        };
        // Виставляємо заголовок перед першим записом у відповідь (writeHead викликається і з json()).
        const origWriteHead = res.writeHead.bind(res);
        res.writeHead = ((...args) => {
            setHeader();
            return origWriteHead(...args);
        });
        if (log) {
            res.on('finish', () => {
                const path = req.originalUrl.split('?')[0];
                if (SKIP_LOG_PATHS.has(path))
                    return;
                const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
                console.log(`[http] ${req.method} ${path} ${res.statusCode} ${ms.toFixed(0)}ms`);
            });
        }
        next();
    };
}
