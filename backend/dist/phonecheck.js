"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPhoneCheckForPhone = runPhoneCheckForPhone;
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
async function runPhoneCheckForPhone(phone) {
    const normalized = phone?.trim().replace(/^\+/, '');
    if (!normalized)
        return null;
    const pythonCmd = process.env.PHONECHECK_PYTHON?.trim() ||
        process.env.OPENDATABOT_PYTHON?.trim() ||
        process.env.TELEGRAM_USER_PYTHON?.trim() ||
        'python3';
    const scriptPath = path_1.default.join(__dirname, '..', 'phonecheck.top', 'run_phonecheck_lookup.py');
    return new Promise((resolve) => {
        const child = (0, child_process_1.spawn)(pythonCmd, [scriptPath, normalized], {
            env: {
                ...process.env,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr?.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        child.on('close', (code) => {
            const text = stdout.trim();
            if (code === 0 && text) {
                try {
                    const data = JSON.parse(text);
                    const hasData = data.hasData ?? data.has_data ?? false;
                    resolve({
                        phone: data.phone || normalized,
                        url: data.url,
                        hasData,
                        html: hasData ? (data.html ?? null) : null,
                    });
                }
                catch (err) {
                    console.error('resolvePhoneCheck: failed to parse JSON', err);
                    resolve(null);
                }
            }
            else {
                if (code && code !== 0) {
                    console.error(`ℹ️ runPhoneCheckForPhone (${normalized}): код ${code}`, stderr.slice(0, 200));
                }
                resolve(null);
            }
        });
        child.on('error', () => resolve(null));
    });
}
